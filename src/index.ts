/**
 * goal-loop: `/goal <condition>` and `/goal-loop <objective>` for OpenCode v2.
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
import { ensureStartupScaffold, hasJq, pluginRootFromMeta, resolveCoordinatorBin } from "./core/bootstrap.ts"
import { resolveConfig } from "./core/config.ts"
import { EVALUATOR_AGENT_ID, EVALUATOR_AGENT_TITLE, EVALUATOR_SYSTEM_PROMPT, SUBAGENT_PROMPT_PREFIX, findNativeReport, verdictFromNativeReport } from "./core/evaluator-agent.ts"
import { findRepository, resolveCommitPolicy, resolveProjectRoot } from "./core/git.ts"
import { parseGoalLoopDirective } from "./core/parse.ts"
import { renderTranscript } from "./core/transcript.ts"
import { carriesGoalGrammar, directive as directivePrompt, systemReminder, stripGoalNotes, stripGoalContext, stripGoalEvaluations, isGoalEvaluationMessage, TERMINAL_REMINDER } from "./core/prompts.ts"
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
import { update as cliUpdate } from "../bin/goal-loop.mjs"

const PLUGIN_ID = "goal-loop"

/** Keep the provider's classification text (429 / "free usage limit" / "rate limit") on a judge failure so the
 * controller can pause a quota error instead of retrying it as a generic unreadable verdict. */
function asJudgeError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    const status = typeof record.status === "number" ? `status ${record.status} ` : ""
    return new Error(`evaluator child failed (${status}${String(record.message ?? record.type ?? record.error ?? JSON.stringify(record))})`)
  }
  return new Error(`evaluator child failed (${String(value)})`)
}

const DESCRIPTION = "keep working until a condition is met"
const LOOP_DESCRIPTION = "keep working toward an objective; bare /goal-loop checks for plugin updates; each achieved goal arms an improved one"

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

    // Ship the judge as a first-class agent type, not just a rubric sent to `general`. `AgentEditor.update`
    // creates the agent when absent (host agent.ts contract), so registering here is idempotent across reloads.
    // `mode: "subagent"` keeps it out of the primary picker; deny-all makes tools impossible even before the
    // generate hook strips them. The visible title and system prompt are what make a verdict look like a real
    // delegated task in the terminal.
    await ctx.agent.transform((editor) => {
      editor.update(EVALUATOR_AGENT_ID, (agent) => {
        agent.name = "Evaluator" as unknown as typeof agent.name
        agent.description = "Judges whether the armed /goal condition holds from visible evidence; replies with one verdict object."
        agent.mode = "subagent"
        agent.hidden = false
        agent.color = "#A78BFA"
        agent.system = EVALUATOR_SYSTEM_PROMPT
        agent.permissions = [{ action: "*", resource: "*", effect: "deny" }] as typeof agent.permissions
      })
    })

    // Startup scaffold: provision an idempotent, ready-to-use workflow on bootstrap (git repos get
    // coordinator/workplace layout, goal runtime dirs, workflow docs/templates, and gitignore rules;
    // non-git dirs get runtime-only setup). Never overwrites user content, never breaks goal arming.
    let coordinatorBin: string | undefined
    try {
      const pluginRoot = pluginRootFromMeta(import.meta.dir)
      const repository = findRepository(ctx.location.directory)
      // Anchor the scaffold at the git root: launching from a subfolder (e.g. docs/) must not create
      // .term in that subfolder. resolveProjectRoot returns the repo root for a subfolder and the
      // directory itself outside a repo, so the runtime-only path still applies there.
      const projectRoot = resolveProjectRoot(ctx.location.directory)
      const startup = ensureStartupScaffold({ projectRoot, pluginRoot, learningPath: config.learning.path })
      if (startup.created.length > 0 || startup.notes.length > 0) {
        log.info("startup scaffold", { created: startup.created, existing: startup.existing, notes: startup.notes })
      } else {
        log.info("startup scaffold", { created: [], existing: startup.existing.length, notes: startup.notes })
      }
      if (repository) {
        coordinatorBin = resolveCoordinatorBin(pluginRoot, repository.root)
        if (config.commit.enabled && config.commit.coordinator !== false && !hasJq()) {
          log.warn("jq not found; coordinator state requires jq")
        }
      }
    } catch (error) {
      log.warn("startup scaffold failed", { error: String(error) })
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

    // Generation child, used ONLY for the opt-in consensus:2 second vote and /goal-loop's summarize/next-condition
    // steps. The per-turn verdict itself is always the worker's native `evaluator` subagent delegation — this child
    // is an auxiliary generate call and would hit the free-tier gate if it were the primary judge. Its completion
    // is reported back as a queued, non-waking `<subagent>` message.
    const judgeChildren = new Set<string>()
    // Persistent: these plugin-spawned children deliver synthetic reports with the same metadata as a native
    // delegation. Their IDs are excluded so they can never be mistaken for a verdict on a later turn.
    const pluginJudgeIDs = new Set<string>()

    const spawnJudge = async (parentSessionID: string, model: ModelRef, prompt: string, signal: AbortSignal): Promise<string> => {
      const { id } = await ctx.session.create({
        location: ctx.location,
        parentID: parentSessionID,
        title: EVALUATOR_AGENT_TITLE,
        agent: EVALUATOR_AGENT_ID,
        model: model as any,
      } as any)
      judgeChildren.add(id)
      pluginJudgeIDs.add(id)
      const abort = new AbortController()
      let answer = ""
      let state: "completed" | "error" = "completed"
      let failure: unknown
      let finish!: (value: string) => void
      const done = new Promise<string>((resolve) => { finish = resolve })
      const onAbort = () => { abort.abort(); finish(answer) }
      // An external abort is the evaluator's own timeout/interrupt, not a provider failure.
      const fail = (error: unknown) => {
        if (signal.aborted) return
        state = "error"
        if (failure === undefined) failure = error
        abort.abort()
        finish("")
      }
      try {
        if (signal.aborted) onAbort()
        else signal.addEventListener("abort", onAbort, { once: true })
        void (async () => {
          try {
            for await (const evt of ctx.event.subscribe({ signal: abort.signal })) {
              const data = (evt as any).data ?? {}
              if (data.sessionID !== id) continue
              if (evt.type === "session.text.delta") answer += String(data.delta ?? "")
              if (evt.type === "session.execution.succeeded") { abort.abort(); finish(answer); return }
              if (evt.type === "session.execution.failed") {
                fail(data.error ?? data.reason ?? data.message ?? "judge execution failed")
                return
              }
            }
          } catch {
            // The subscription was aborted (verdict already delivered) or the event stream closed.
          }
          // A stream that ends without a terminal event must still release the judge, not hang until timeout.
          finish(answer)
        })()
        // The native subagent shape: host prefix + rubric, `resume: false` so the fresh child admits the prompt
        // without a wake of its own. The signal must reach the host prompt: a child turn that ignores an external
        // abort used to keep `spawnJudge` parked after `done` had resolved, defeating the evaluator's timeout.
        // Race so any abort converges immediately; the text still comes from `done` (the child's text deltas).
        await Promise.race([
          ctx.session.prompt({
            sessionID: id,
            text: `${SUBAGENT_PROMPT_PREFIX}${prompt}`,
            resume: false,
          } as any, { signal }).catch((error: unknown) => fail(error)),
          done.then(() => undefined),
        ])
        const verdict = await done
        // Native-looking completion report: visible in the parent as the delegated task's result, but queued
        // and non-waking so it never starts an extra working turn. Shape and metadata match the host's
        // `SubagentCompletion.deliver`; delivery/resume are the plugin's no-wake variation.
        try {
          await ctx.session.synthetic({
            sessionID: parentSessionID,
            description: EVALUATOR_AGENT_TITLE,
            text: `<subagent sessionID="${id}" state="${state}" description="${EVALUATOR_AGENT_TITLE}">\n${verdict}\n</subagent>`,
            metadata: { source: "subagent", childID: id, agent: EVALUATOR_AGENT_ID, state },
            delivery: "queue",
            resume: false,
          } as any)
        } catch (error) {
          log.warn("evaluator subagent report could not be delivered", { error: String(error) })
        }
        // Throw after the visible report so callers can classify a quota error and pause instead of retrying.
        if (failure !== undefined) throw asJudgeError(failure)
        return verdict
      } finally {
        signal.removeEventListener("abort", onAbort)
        judgeChildren.delete(id)
        // Native subagents persist and stay navigable: no `session.remove` here.
      }
    }

    // Evaluator self-talk is not evidence: strip every <goal-evaluation> prompt from the transcript digest.
    const evaluatorContext = async (sessionID: string, signal: AbortSignal) =>
      stripGoalEvaluations(await ctx.session.context({ sessionID }, { signal }))

    // A worker that delegates the verdict to the native `evaluator` subagent leaves a `<subagent>` completion in
    // this transcript. Consume the newest unused one so a verdict is read exactly once (a duplicate turn-end must
    // not re-arm from the same report). `findNativeReport` excludes this plugin's own fallback-judge reports so a
    // prior turn's verdict is never replayed as a fresh one.
    const consumedReports = new Set<string>()
    const seenNativeTurns = new Map<string, number>()
    const nativeVerdict = async (sessionID: string, signal: AbortSignal, turn: number) => {
      const messages = await evaluatorContext(sessionID, signal)
      const candidate = findNativeReport(messages, consumedReports, pluginJudgeIDs, seenNativeTurns, turn)
      if (!candidate) return undefined
      consumedReports.add(candidate.key)
      return verdictFromNativeReport(candidate)
    }

    // Resolve per generation so a /model switch mid-goal is followed on the next verdict.
    const sessionModel = async (sessionID: string, signal: AbortSignal): Promise<ModelRef | undefined> => {
      const current = (await ctx.session.get({ sessionID }, { signal })).model
      return current ? { providerID: current.providerID, id: current.id, ...(current.variant ? { variant: current.variant } : {}) } : undefined
    }

    const evaluator = new Evaluator(
      {
        nativeVerdict,
        // Session mode is still a real child turn: the child has no parent conversation, so embed the parent
        // digest in the prompt (the rubric says "conversation above"). Every judge path now clears the gate.
        sessionGenerate: async (sessionID, prompt, signal) => {
          const model = await sessionModel(sessionID, signal)
          if (!model) throw new Error("inherited evaluator model unavailable: session has no active model")
          const transcript = renderTranscript(await evaluatorContext(sessionID, signal), { maxChars: config.evaluator.maxTranscriptChars })
          return spawnJudge(sessionID, model, `<conversation>\n${transcript}\n</conversation>\n\n${prompt}`, signal)
        },
        modelGenerate: (sessionID, model, prompt, signal) => spawnJudge(sessionID, model, prompt, signal),
        context: evaluatorContext,
        sessionModel,
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
      // A goal follows its session across directories; re-resolve the commit rule for the new checkout so the
      // agent's directives name the right branch and coordinator policy after a move.
      commitFor: (directory) => resolveCommitPolicy(config.commit, directory, coordinatorBin),
      session,
      evaluator,
      background,
      store,
      emitter,
      verifier: createVerifier(),
      compactAtBoundary: (sessionID, opts) => compactor.compactAtBoundary(sessionID, opts),
      estimateContext: async (sessionID) => estimateContextTokens((await ctx.session.context({ sessionID })) as readonly unknown[]),
      context: async (sessionID) => (await ctx.session.context({ sessionID })) as readonly unknown[],
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

    // ---- bare /goal-loop = update check
    // `plugins[].options.update` is the one source of truth, already parsed into `config.update` alongside
    // every other option. The check never blocks prompt admission: it is deferred to the next macrotask,
    // so a fast plugin disposal aborts it before any network request leaves the machine. An immediate
    // toast tells the user the check started; a second toast carries the result. `mode: off` (and probe
    // mode) keep the old status-only behavior.
    const updateTimers = new Set<ReturnType<typeof setTimeout>>()
    const scheduleUpdateCheck = (sessionID: string) => {
      if (probe || config.update.mode !== "auto") return
      emit.notice({
        sessionID,
        kind: "set",
        level: "info",
        title: "goal-loop update",
        message: `Checking GitHub for the ${config.update.channel} channel…`,
      })
      const timer = setTimeout(() => {
        updateTimers.delete(timer)
        if (lifetime.signal.aborted) return
        void (async () => {
          try {
            const result = await cliUpdate([], { env: process.env, cwd: ctx.location.directory })
            const text = (result.stdout || result.stderr).trim() || "Update check produced no output."
            if (!lifetime.signal.aborted) emit.notice({
              sessionID,
              kind: "set",
              level: result.code === 0 ? "info" : "warning",
              title: "goal-loop update",
              message: text,
            })
          } catch (error) {
            if (!lifetime.signal.aborted) emit.notice({
              sessionID,
              kind: "set",
              level: "warning",
              title: "goal-loop update",
              message: `Update check failed: ${error instanceof Error ? error.message : String(error)}`,
            })
          }
        })()
      }, 0)
      updateTimers.add(timer)
    }
    const handleBareLoop = async (sessionID: string): Promise<"update" | "status"> => {
      if (probe || config.update.mode !== "auto") {
        await controller.status(sessionID)
        return "status"
      }
      scheduleUpdateCheck(sessionID)
      return "update"
    }

    // ---- the /goal and /goal-loop commands
    await ctx.command.transform((editor) => {
      const addCommand = (name: string, description: string, loop: boolean) =>
        editor.add({
          name,
          description,
          execute: async ({ sessionID, prompt, delivery }) => {
            if (loop && (prompt.text ?? "").trim() === "") {
              await handleBareLoop(sessionID)
              return
            }
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
      // A worker delegating the verdict leaves a short task prompt in the native call ("Judge the goal condition
      // and return the verdict JSON"). Give that child the full evidence contract, formatted cleanly, so its view
      // reads like a real delegated task instead of the former raw `<conversation>` dump. Enrichment is additive
      // and scoped to evaluator children of a live goal — every other prompt is untouched.
      // Plugin-spawned generation children (consensus second vote / loop steps) already carry the full rubric and digest — never double them.
      if (!judgeChildren.has(event.sessionID)) try {
        const child = await ctx.session.get({ sessionID: event.sessionID })
        const agentID = typeof child.agent === "string" ? child.agent : (child.agent as any)?.id
        if (agentID === EVALUATOR_AGENT_ID && child.parentID) {
          const condition = controller.activeCondition(child.parentID)
          if (condition) {
            const digest = renderTranscript(await evaluatorContext(child.parentID, lifetime.signal), { maxChars: config.evaluator.maxTranscriptChars })
            const facts = `turn ${(controller.live(child.parentID)?.turns ?? 0) + 1}`
            const block = [
              `<goal-evaluation>`,
              `Judge whether this condition holds, using only the evidence below.`,
              ``,
              `<condition>${condition.replace(/<\/condition>/gi, "<\\/condition>")}</condition>`,
              `<facts>${facts}</facts>`,
              ``,
              `<conversation>`,
              digest || "(no visible evidence yet)",
              `</conversation>`,
              ``,
              `Answer with exactly one JSON object: {"verdict":"met"|"not_met"|"impossible","reason":"..."}. No preamble.`,
              `</goal-evaluation>`,
            ].join("\n")
            event.prompt.text = `${event.prompt.text}\n\n${block}`
          }
        }
      } catch {
        // Enrichment is best-effort; a failed lookup must never block the child's prompt.
      }
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
          // Bare directive (/goal-loop, /goal-loop-<N> with no objective): update check (or status when off).
          if (goalLoop.invalidCount !== undefined) controller.noteInvalidLoopCount(event.sessionID, goalLoop.invalidCount)
          const action = await handleBareLoop(event.sessionID)
          controller.onUserPrompt(event.sessionID)
          event.prompt.text = action === "update"
            ? "A goal-loop update check was requested; acknowledge briefly and do not set a goal."
            : "Show the current goal loop status."
          return
        }
        const maxLoops = goalLoop.maxLoops ?? config.maxLoops
        // The admitted user message is the kickoff (no synthetic prompt is sent): the model sees exactly what the
        // command path would have delivered, with the directive token and the count removed from the objective.
        const originalPrompt = event.prompt.text
        event.prompt.text = directivePrompt(objective, controller.commitForSession(event.sessionID), { iteration: 1, maxLoops, objective, history: [] })
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
    // Evaluator-only shaping of judge-child generations. The child already runs on the plugin's deny-all
    // `evaluator` agent, but belt-and-braces: a small judge that answers the rubric with a tool call yields no
    // text, so all three repair attempts come back empty and the goal stalls on `unreadable verdict after 3
    // attempts: ""`. STRICT_REPAIR's "do not call tools" is only prose; the tools must actually be removed for
    // the request. Deleting in place (the documented SDK mutation pattern) is safe: the surrounding context hook
    // already edits system/messages for these requests. Non-evaluator generations keep their tools untouched.
    await ctx.session.hook("generate", (event) => {
      // Only judge children are toolless. A user prompt admitted while an evaluation is in flight must keep its
      // own tools — the parent is no longer the generation surface, so its inflight flag is irrelevant here.
      if (!judgeChildren.has(event.sessionID)) return
      event.options.maxTokens = config.evaluator.maxOutputTokens
      for (const name of Object.keys(event.tools)) delete event.tools[name]
    })
    // One context hook, up to three injections: the standing system reminder (config-gated), the
    // one-shot post-compaction re-anchor (never gated — the ground truth must reach the model even
    // when the reminder is off; it is invisible on every request except the one after a landing),
    // and one ground-truth line for sessions whose goal already ended here (achieved / impossible /
    // cleared / failed) — the counter-instruction to a compaction summary that quotes the expired
    // `<goal>` kickoff. The first two are no-ops while no goal work is armed; the third is gated on the
    // request still carrying goal text, so it never becomes a session-long stale system line.
    await ctx.session.hook("context", (event) => {
      const live = controller.live(event.sessionID) !== undefined
      if (config.systemReminder) {
        const condition = controller.activeCondition(event.sessionID)
        if (condition) event.system.push({ type: "text", text: systemReminder(condition, controller.commitForSession(event.sessionID)) })
      }
      const anchor = controller.consumeAnchor(event.sessionID)
      if (anchor) event.system.push({ type: "text", text: anchor })
      // Goal messages are history, not instructions. While a goal is live the kickoff and the armed
      // continuations carry the state and must ride context; only notes are stripped. Once no live
      // goal exists for the session, every goal-grammar message is stripped — a finished goal's
      // "keep working" text must not ride any later request, including the one after a compaction.
      // Splice in place — the host holds the caller's array reference, so a rebound property could go unseen.
      if (Array.isArray(event.messages)) {
        const original = event.messages
        let kept = live ? stripGoalNotes(original) : stripGoalContext(original)
        // The evaluator's own voice is not evidence and must not accumulate in model-bound context.
        // On a working turn drop every <goal-evaluation> prompt; while an evaluation is in flight keep
        // only the most recent one — the live rubric the model must answer — and drop older echoes.
        kept = stripGoalEvaluations(kept, { keepLast: evaluator.isEvaluating(event.sessionID) || judgeChildren.has(event.sessionID) })
        if (kept.length !== original.length) {
          // Never dispatch a request that does not end on a user turn: strict providers reject it ("The
          // last message must have role=user."), and after a landing compaction the trailing turn can be
          // the only user message in the request (opencode folds the whole summary into it). If stripping
          // removed that trailing turn, keep it: a stale goal line is harmless history, while an invalid
          // request aborts the turn. Splice in place — the host holds the caller's array reference.
          const trailing = original[original.length - 1]
          // Never undo the use-and-forget strip by re-adding a trailing evaluation prompt merely to
          // satisfy the trailing-user repair — a working turn's trailing turn is its steer, not self-talk.
          const repairable = trailing !== undefined && !isGoalEvaluationMessage(trailing) ? trailing : undefined
          const last = kept[kept.length - 1]
          const repaired = last?.role === "user" || repairable === undefined || last === repairable ? kept : [...kept, repairable]
          original.splice(0, original.length, ...repaired)
        }
      }
      // The terminal ground-truth line is a counter-instruction, so it rides only a request that still
      // carries goal text: a compaction checkpoint quoting the expired `<goal>` kickoff, or a trailing
      // user turn the strict-provider repair kept. With no goal text left in the request there is nothing
      // to counter, and a line injected on every later request would be stale boilerplate for the rest of
      // the session — it is not injected.
      const stillCarriesGoal = Array.isArray(event.messages) ? carriesGoalGrammar(event.messages) : false
      if (!live && stillCarriesGoal && controller.hasTerminalRecord(event.sessionID)) event.system.push({ type: "text", text: TERMINAL_REMINDER })
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

    void controller.restore({ resume: !probe }).catch((error) => log.error("goal restore failed", { error: String(error) }))
    log.info("ready", {
      evaluator: config.evaluator.mode,
      model: config.evaluator.model ?? (config.evaluator.inheritModel ? "session (inherited)" : "session"),
    })

    return async () => {
      lifetime.abort()
      for (const timer of updateTimers) clearTimeout(timer)
      updateTimers.clear()
      await controller.dispose()
    }
  },
})
