/**
 * opencode-goal: `/goal <condition>` and `/goal-loop <objective>` for OpenCode v2.
 *
 * Sets a completion condition for the session; after every turn an evaluator checks it against the conversation
 * and, until it holds, the plugin starts the next turn itself. `/goal-loop` layers a continuous improvement
 * loop on the same machinery: once the evaluator says `met`, the achieved iteration is summarized and the next,
 * harder goal is armed automatically until the loop is cleared, capped, or the evaluator finds nothing left.
 * Mirrors Claude Code's /goal (status, clear aliases, met / not met / impossible verdicts, stall guard, retries,
 * background-work check-ins, restore on restart).
 */
import { estimateContextTokens } from "./core/context-size.ts"
import { Plugin } from "@opencode/plugin"
import { ensureCoordinatorLayout, hasJq, pluginRootFromMeta, resolveCoordinatorBin } from "./core/bootstrap.ts"
import { resolveConfig } from "./core/config.ts"
import { findRepository, resolveCommitPolicy } from "./core/git.ts"
import { parseGoalLoopDirective } from "./core/parse.ts"
import { directive as directivePrompt, systemReminder, stripGoalNotes, stripGoalContext, TERMINAL_REMINDER } from "./core/prompts.ts"
import type { ModelRef, UsageSnapshot } from "./core/types.ts"
import { createRpcHandlers } from "./rpc-handlers.ts"
import { GoalRpc } from "./rpc.ts"
import { BackgroundTracker } from "./runtime/background.ts"
import { AutoCompactor } from "./runtime/compactor.ts"
import { GoalController } from "./runtime/controller.ts"
import { Evaluator } from "./runtime/evaluator.ts"
import { createGoalMirror } from "./core/mirror.ts"
import { createRouter, type ServerEvent } from "./runtime/events.ts"
import { systemClock, type EmitterPort, type Logger, type SessionPort } from "./runtime/ports.ts"
import { GoalStore } from "./runtime/store.ts"
import { withFileSink } from "./core/file-log.ts"

const PLUGIN_ID = "opencode-goal"

const DESCRIPTION = "keep working until a condition is met"
const LOOP_DESCRIPTION = "keep working toward an objective; each achieved goal arms an improved one, until cleared or capped"

function createLogger(): Logger {
  const tag = `[${PLUGIN_ID}]`
  const extra = (value?: Record<string, unknown>) => (value ? [value] : [])
  return {
    info: (message, value) => console.info(tag, message, ...extra(value)),
    warn: (message, value) => console.warn(tag, message, ...extra(value)),
    error: (message, value) => console.error(tag, message, ...extra(value)),
  }
}

function toUsage(info: { cost?: number; tokens?: Partial<{ input: number; output: number; reasoning: number; cache: { read: number; write: number } }> }): UsageSnapshot {
  const tokens = info.tokens ?? {}
  return {
    cost: info.cost ?? 0,
    input: tokens.input ?? 0,
    output: tokens.output ?? 0,
    reasoning: tokens.reasoning ?? 0,
    cacheRead: tokens.cache?.read ?? 0,
    cacheWrite: tokens.cache?.write ?? 0,
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })

/** Env flag: `1/true/yes/on` (case-insensitive) enables; anything else is off. Probe mode makes plugin storage read-only. */
const probeFlag = (value: string | undefined) => {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return ["1", "true", "yes", "on"].includes(normalized)
}

/** Runs a verification command via the user's shell, capturing combined output (tail kept). Never touches plugin storage. */
export function createVerifier() {
  return {
    async verify({ command, cwd, timeoutMs, signal }: { command: string; cwd: string; timeoutMs: number; signal: AbortSignal }) {
      const MAX = 16_000
      // Detached, so the command owns its process group and the budget can kill the whole tree, not just the
      // shell. Measured before this fix: `bash -c 'sleep 3; echo hi'` under a 200ms budget returned at 3003ms —
      // SIGKILL reached only the shell, and the surviving `sleep` still held stdout, so the drain waited for it.
      // A command that starts a server would have waited forever.
      const child = Bun.spawn(["bash", "-c", command], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
        detached: true,
      })
      let output = ""
      // One streaming decoder so a multi-byte sequence split across chunks is not corrupted.
      const decoder = new TextDecoder()
      const append = (chunk: Uint8Array) => {
        output = (output + decoder.decode(chunk, { stream: true })).slice(-MAX)
      }
      const readers: Array<ReadableStreamDefaultReader<Uint8Array>> = []
      // Both streams are drained concurrently: an unread pipe fills the OS buffer and blocks the child.
      const read = async (stream: typeof child.stdout) => {
        if (!stream) return
        const reader = stream.getReader()
        readers.push(reader)
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) append(value)
          }
        } catch {
          // stream closed by kill
        }
      }
      let timedOut = false
      // Kill the group, then cancel the drains. Cancelling matters as much as the kill: a descendant that
      // survives the sweep (or a pipe the kernel has not closed yet) must not stall the very budget that
      // just fired — the result is the tail captured so far, never an open-ended wait.
      const killTree = () => {
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL")
          else child.kill("SIGKILL")
        } catch {
          try {
            child.kill("SIGKILL")
          } catch {
            // already gone
          }
        }
        for (const reader of readers) {
          try {
            void reader.cancel().catch(() => {})
          } catch {
            // already released
          }
        }
      }
      const timer = setTimeout(() => {
        timedOut = true
        killTree()
      }, timeoutMs)
      const onAbort = () => killTree()
      // Only arm on a live signal: an already-aborted signal never fires its listener, so a cancel that landed
      // between the controller's signal and this spawn would otherwise have run the command to completion.
      if (signal.aborted) onAbort()
      else signal.addEventListener("abort", onAbort, { once: true })
      try {
        const [code] = await Promise.all([child.exited, read(child.stdout), read(child.stderr)])
        return { code, output, timedOut }
      } finally {
        clearTimeout(timer)
        signal.removeEventListener("abort", onAbort)
      }
    },
  }
}

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const config = resolveConfig(ctx.options, process.env)
    const log = withFileSink(createLogger(), process.env.OPENCODE_GOAL_LOG_FILE)
    const lifetime = new AbortController()

    // The commit rule needs the session's directory: outside a git repository there is nothing to commit, and
    // inside one the finished work has to land on a branch before the goal counts as met. In coordinator
    // repositories (term) normal agents land on wt/<slug> and submit; the coordinator merges to the target.
    let coordinatorBin: string | undefined
    try {
      const pluginRoot = pluginRootFromMeta(import.meta.dir)
      if (config.commit.enabled && config.commit.coordinator !== false) {
        const repository = findRepository(ctx.location.directory)
        if (repository) {
          const bootstrap = ensureCoordinatorLayout(repository.root, pluginRoot)
          if (bootstrap.created.length > 0) log.info("coordinator bootstrap", { created: bootstrap.created })
          coordinatorBin = resolveCoordinatorBin(pluginRoot, repository.root)
          if (!hasJq()) log.warn("jq not found; coordinator state requires jq")
        }
      }
    } catch (error) {
      log.warn("coordinator bootstrap failed", { error: String(error) })
    }
    const commit = resolveCommitPolicy(config.commit, ctx.location.directory, coordinatorBin)
    log.info("commit rule", { required: commit.required, branch: commit.branch, mode: commit.mode ?? "direct", reason: commit.reason })

    // ---- ports onto the OpenCode context
    const session: SessionPort = {
      prompt: async ({ sessionID, text, delivery, files, agents, skills }) => {
        await ctx.session.prompt({ sessionID, text, delivery, files, agents, skills } as Parameters<typeof ctx.session.prompt>[0])
      },
      synthetic: async (input) => {
        await ctx.session.synthetic(input as Parameters<typeof ctx.session.synthetic>[0])
      },
      usage: async (sessionID) => toUsage(await ctx.session.get({ sessionID })),
      compact: async (sessionID) => {
        await ctx.session.compact({ sessionID } as Parameters<typeof ctx.session.compact>[0])
      },
    }

    const evaluator = new Evaluator(
      {
        sessionGenerate: async (sessionID, prompt, signal) => (await ctx.session.generate({ sessionID, prompt }, { signal })).text,
        modelGenerate: async (model: ModelRef, prompt, signal) => (await ctx.generate.text({ prompt, model }, { signal })).text,
        context: (sessionID, signal) => ctx.session.context({ sessionID }, { signal }),
      },
      config.evaluator,
      commit,
      log,
    )

    const background = new BackgroundTracker({
      parentOf: async (sessionID) => (await ctx.session.get({ sessionID })).parentID,
    })

    // RPC is registered after the controller exists; events emitted before that are simply dropped.
    let emit: EmitterPort = { changed: () => {}, notice: () => {} }
    const emitter: EmitterPort = {
      changed: (sessionID, goal) => emit.changed(sessionID, goal),
      notice: (notice) => emit.notice(notice),
    }

    const probe = probeFlag(process.env.OPENCODE_GOAL_PROBE)
    if (probe) log.warn("probe mode: goal storage is read-only (OPENCODE_GOAL_PROBE); restore() will not persist anything")
    const store = new GoalStore(ctx.storage, (error) => log.error("goal storage write failed", { error: String(error) }), { readOnly: probe })
    // The compactor and the controller need each other: the controller asks the compactor to compact at a loop boundary,
    // and the compactor asks the controller (and the background tracker) whether the session has work in flight.
    // The compactor is assigned before anything can call it, so the deferred closure is safe.
    let compactor!: AutoCompactor
    const controller = new GoalController({
      config,
      directory: ctx.location.directory,
      commit,
      session,
      evaluator,
      background,
      store,
      emitter,
      verifier: createVerifier(),
      compactAtBoundary: (sessionID, opts) => compactor.compactAtBoundary(sessionID, opts),
      estimateContext: async (sessionID) => estimateContextTokens((await ctx.session.context({ sessionID })) as readonly unknown[]),
      clock: systemClock,
      log,
    })
    compactor = new AutoCompactor({
      config,
      compact: (sessionID) => session.compact(sessionID),
      context: async (sessionID) => (await ctx.session.context({ sessionID })) as readonly unknown[],
      emitter,
      clock: systemClock,
      log,
      isBusy: async (sessionID) => {
        const work = await background.busy(sessionID).catch(() => ({ subagents: 0, shells: 0 }))
        return work.subagents + work.shells > 0 || controller.isExecuting(sessionID)
      },
    })

    // ---- RPC for clients (status line, dialogs, palette actions)
    const rpc = await ctx.rpc.register(GoalRpc, createRpcHandlers({ controller, log }))
    const quiet = (error: unknown) => log.warn("goal event emit failed", { error: String(error) })
    // Backstop mirror of the latest snapshot: the TUI reads it when both RPC paths are wedged (see core/mirror.ts).
    // Disabled in probe mode (read-only storage) and by OPENCODE_GOAL_MIRROR=0; best-effort, never throws.
    const mirrorEnabled = !probe && process.env.OPENCODE_GOAL_MIRROR !== "0"
    const mirror = mirrorEnabled ? createGoalMirror() : undefined
    emit = {
      changed: (sessionID, goal) => {
        if (mirror) {
          try {
            if (goal) mirror.write(goal)
            else mirror.remove(sessionID)
          } catch (error) {
            log.warn("goal mirror write failed", { error: String(error) })
          }
        }
        return void rpc.events.emit("changed", { sessionID, goal }).catch(quiet)
      },
      notice: (notice) => void rpc.events.emit("notice", { ...notice }).catch(quiet),
    }

    // ---- the /goal and /goal-loop commands
    await ctx.command.transform((editor) => {
      const addCommand = (name: string, description: string, loop: boolean) =>
        editor.add({
          name,
          description,
          execute: async ({ sessionID, prompt, delivery }) => {
            await controller.command({
              sessionID,
              text: prompt.text ?? "",
              delivery,
              loop,
              ...(prompt.files ? { files: prompt.files } : {}),
              ...(prompt.agents ? { agents: prompt.agents } : {}),
              ...(prompt.skills ? { skills: prompt.skills } : {}),
            })
          },
        })
      addCommand("goal", DESCRIPTION, false)
      addCommand("goal-loop", LOOP_DESCRIPTION, true)
    })

    // ---- hooks
    // Only real user prompts pass through this hook (synthetic continuations do not), so it is the resume signal.
    // The hook also carries the /goal-loop directive: harnesses that do not know the `/goal-loop-<N>` spelling fall
    // through to a plain prompt, and the plugin arms the loop right here — the host awaits this hook before the
    // prompt is admitted, and the mutated text (directive stripped, count applied to this run only) is what the
    // model sees. Unknown-count tokens (not 1..1000) are not guessed: a warning is shown and the default is used.
    await ctx.session.hook("prompt", async (event) => {
      const text = typeof event.prompt?.text === "string" ? event.prompt.text : ""
      const goalLoop = parseGoalLoopDirective(text)
      if (goalLoop) {
        const objective = goalLoop.objective
        // The raw-prompt path bypasses parseGoalCommand, so enforce the configured condition limit here too.
        // Count code points, not UTF-16 units, matching parseGoalCommand: astral characters must not count double.
        if (
          objective !== "" &&
          Number.isFinite(config.maxConditionChars) &&
          config.maxConditionChars < Number.MAX_SAFE_INTEGER &&
          [...objective].length > config.maxConditionChars
        ) {
          controller.noteConditionTooLong(event.sessionID, [...objective].length, config.maxConditionChars)
          controller.onUserPrompt(event.sessionID)
          return
        }
        if (objective === "") {
          // Bare directive (/goal-loop, /goal-loop-<N> with no objective): same as bare /goal-loop — show status.
          if (goalLoop.invalidCount !== undefined) controller.noteInvalidLoopCount(event.sessionID, goalLoop.invalidCount)
          await controller.status(event.sessionID)
          controller.onUserPrompt(event.sessionID)
          return
        }
        const maxLoops = goalLoop.maxLoops ?? config.maxLoops
        // The admitted user message is the kickoff (no synthetic prompt is sent): the model sees exactly what the
        // command path would have delivered, with the directive token and the count removed from the objective.
        const originalPrompt = event.prompt.text
        event.prompt.text = directivePrompt(objective, commit, { iteration: 1, maxLoops, objective, history: [] })
        const armed = await controller.armFromPrompt({
          sessionID: event.sessionID,
          condition: objective,
          maxLoops,
          ...(goalLoop.invalidCount !== undefined ? { invalidCount: goalLoop.invalidCount } : {}),
        })
        // Workstream XLV: the arming-side no-new-gap gate refused (a terminal record was persisted and the notice
        // fired). Restore the user's own line — the directive would tell the model a loop is armed when it is not.
        if (armed.status !== "active") event.prompt.text = originalPrompt
        return
      }
      controller.onUserPrompt(event.sessionID)
    })
    // Bound the evaluator's transient request without touching tools or system, which would break the cached prefix.
    await ctx.session.hook("generate", (event) => {
      if (evaluator.isEvaluating(event.sessionID)) event.options.maxTokens = config.evaluator.maxOutputTokens
    })
    // One context hook, up to three injections: the standing system reminder (config-gated), the
    // one-shot post-compaction re-anchor (never gated — the ground truth must reach the model even
    // when the reminder is off; it is invisible on every request except the one after a landing),
    // and one ground-truth line for sessions whose goal already ended here (achieved / impossible /
    // cleared / failed) — the counter-instruction to a compaction summary that quotes the expired
    // `<goal>` kickoff. All three are no-ops while no goal work is armed.
    await ctx.session.hook("context", (event) => {
      const live = controller.live(event.sessionID) !== undefined
      if (config.systemReminder) {
        const condition = controller.activeCondition(event.sessionID)
        if (condition) event.system.push({ type: "text", text: systemReminder(condition, commit) })
      }
      const anchor = controller.consumeAnchor(event.sessionID)
      if (anchor) event.system.push({ type: "text", text: anchor })
      if (!live && controller.hasTerminalRecord(event.sessionID)) event.system.push({ type: "text", text: TERMINAL_REMINDER })
      // Goal messages are history, not instructions. While a goal is live the kickoff and the armed
      // continuations carry the state and must ride context; only notes are stripped. Once no live
      // goal exists for the session, every goal-grammar message is stripped — a finished goal's
      // "keep working" text must not ride any later request, including the one after a compaction.
      // Splice in place — the host holds the caller's array reference, so a rebound property could go unseen.
      if (Array.isArray(event.messages)) {
        const original = event.messages
        const kept = live ? stripGoalNotes(original) : stripGoalContext(original)
        if (kept.length !== original.length) {
          // Never dispatch a request that does not end on a user turn: strict providers reject it ("The
          // last message must have role=user."), and after a landing compaction the trailing turn can be
          // the only user message in the request (opencode folds the whole summary into it). If stripping
          // removed that trailing turn, keep it: a stale goal line is harmless history, while an invalid
          // request aborts the turn. Splice in place — the host holds the caller's array reference.
          const trailing = original[original.length - 1]
          const last = kept[kept.length - 1]
          const repaired = last?.role === "user" || trailing === undefined || last === trailing ? kept : [...kept, trailing]
          original.splice(0, original.length, ...repaired)
        }
      }
    })

    // ---- event pump with reconnect
    const route = createRouter({ controller, background, log, compactor })
    void (async () => {
      let backoff = 500
      while (!lifetime.signal.aborted) {
        try {
          for await (const event of ctx.event.subscribe({ signal: lifetime.signal })) {
            backoff = 500
            route(event as ServerEvent)
          }
        } catch (error) {
          if (lifetime.signal.aborted) break
          log.warn("event stream dropped; reconnecting", { error: String(error) })
        }
        await sleep(backoff, lifetime.signal)
        backoff = Math.min(backoff * 2, 15_000)
      }
    })()

    void controller.restore().catch((error) => log.error("goal restore failed", { error: String(error) }))
    log.info("ready", { evaluator: config.evaluator.mode, model: config.evaluator.model ?? "session" })

    return async () => {
      lifetime.abort()
      await controller.dispose()
    }
  },
})
