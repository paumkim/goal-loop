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
import { Plugin, type Agent } from "@opencode/plugin"
import { createHarness, evaluatorChildBySession, plannerChildBySession } from "./harness.ts"
import { registerHooks } from "./hooks.ts"
import { ensureStartupScaffold, hasJq, pluginRootFromMeta, resolveCoordinatorBin } from "./core/bootstrap.ts"
import { resolveConfig } from "./core/config.ts"
import { EVALUATOR_AGENT_ID, EVALUATOR_SYSTEM_PROMPT } from "./core/evaluator-agent.ts"
import { findRepository, resolveCommitPolicy, resolveProjectRoot } from "./core/git.ts"
import { parseBool, parseGoalCommand } from "./core/parse.ts"
import { MESSAGE_WAKE_TEXT } from "./core/prompts.ts"
import { PLANNER_AGENT_ID, PLANNER_AGENT_TITLE, PLANNER_SYSTEM_PROMPT } from "./core/planner.ts"
import { renderTranscript } from "./core/transcript.ts"
import type { UsageSnapshot } from "./core/types.ts"
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
import { AgentMessaging } from "./runtime/messaging.ts"
import { withFileSink } from "./core/file-log.ts"
// Shared plain-language error formatter (the filename is historical: it was born in the TUI).
import { userFacingError } from "./tui-error.ts"
import { update as cliUpdate } from "../bin/goal-loop.mjs"

const PLUGIN_ID = "goal-loop"

/** The host brands display names; both names below are fixed plugin literals, not user input. */
const asAgentName = (name: string) => name as Agent.Info["name"]

/**
 * The cold window installed by `/reset-context`. OpenCode's transcript builder replays a completed compaction's
 * `native.messages` *instead of* its summary (`to-llm-message.ts`, `case "compaction"`). An upstream host labels a
 * completed compaction that carries `native.messages` "Provider compaction"; that is the unwanted divider, and it
 * is hardcoded in the host TUI with no slot, theme token or config key to override. Patching the host source or the
 * installed binary would fix the text but would write outside this repo and would not survive a reinstall, so the
 * plugin avoids the trigger instead: no native window, an empty summary, and an empty kept range replay as an empty
 * `<conversation-checkpoint>` — still a cold start, but the host renders its generic "Compaction" divider.
 *
 * `metadata.recent` is set explicitly because `SessionRecentText.kept()` reads it: an unset value could inherit a
 * kept range from the compaction being replaced and pull old text back into the checkpoint.
 */
export const COLD_REPLAY = { summary: "", metadata: { recent: "" } }

/**
 * Budget for the *native* evaluator child's evidence digest. Deliberately far below the generation judge's
 * `maxTranscriptChars` (20k): a native child gets the condition explicitly and only needs the worker's latest
 * tool evidence. A large digest in a long-lived session carried prior verdicts about other conditions and
 * drowned out the real one (see renderParentSummary).
 */
const EVALUATION_SUMMARY_CHARS = 4_000

/**
 * The worker's reply can still be landing when the turn ends and the harness builds the judge prompt (a small model
 * once delegated first and wrote its "hi" answer 25 ms later). When the first parent-context read has no usable
 * evidence, wait this bounded window and re-read so the judge scores the turn's real output, not an empty summary.
 * Abortable so a killed goal never parks the verdict.
 */
const EVALUATION_SETTLE_MS = 250
const settle = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  if (signal.aborted) return resolve()
  const onAbort = () => { clearTimeout(timer); resolve() }
  const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve() }, ms)
  signal.addEventListener("abort", onAbort, { once: true })
})

/** Keep the provider's classification text (429 / "free usage limit" / "rate limit") on an evaluator failure so the
 * controller can pause a quota error instead of retrying it as a generic unreadable verdict. */
function asEvaluatorError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    const status = typeof record.status === "number" ? `status ${record.status} ` : ""
    const error = new Error(`evaluator child failed (${status}${String(record.message ?? record.type ?? record.error ?? JSON.stringify(record))})`)
    // A provider quota error is an object whose 429/code lives in structured fields, not in the message text
    // ("slow down" carries no quota phrase). Flattening to a string alone drops that signal, so the tightened
    // isUsageLimitError would miss a genuine quota and retry instead of pausing. Carry the structured fields
    // onto the Error so the detector reads the same 429/code it would have read before flattening.
    for (const key of ["status", "code", "type", "name", "error"] as const) {
      const field = record[key]
      if (typeof field === "string" || typeof field === "number") {
        Object.defineProperty(error, key, { value: field, enumerable: true, configurable: true })
      }
    }
    return error
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
const probeFlag = (value: string | undefined) => parseBool(value) === true

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

/**
 * Return a planner scope only when it was distilled for the condition being judged.
 *
 * A goal can be armed without a fresh plan (planner quota/timeout, /goal clear followed by /goal, a raw
 * /goal-loop directive). The previous goal's scope must not leak into the new goal's evaluation request,
 * so the stored plan is paired with the condition it belongs to.
 */
export function planScopeFor(
  stored: { condition: string; scope: "trivial" | "code" } | undefined,
  condition: string,
): "trivial" | "code" | undefined {
  return stored?.condition === condition ? stored.scope : undefined
}

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const config = resolveConfig(ctx.options, process.env)
    const log = withFileSink(createLogger(), process.env.OPENCODE_GOAL_LOG_FILE)
    const lifetime = new AbortController()
    const probe = probeFlag(process.env.OPENCODE_GOAL_PROBE)

    // Ship the evaluator as a first-class agent type, not just a rubric sent to `general`. `AgentEditor.update`
    // creates the agent when absent (host agent.ts contract), so registering here is idempotent across reloads.
    // `mode: "subagent"` keeps it out of the primary picker; deny-all makes tools impossible even before the
    // generate hook strips them. The visible title and system prompt are what make a verdict look like a real
    // delegated task in the terminal.
    await ctx.agent.transform((editor) => {
      editor.update(EVALUATOR_AGENT_ID, (agent) => {
        agent.name = asAgentName("Evaluator")
        agent.description = "Judges whether the armed /goal condition holds from visible evidence; replies with one verdict object."
        agent.mode = "subagent"
        agent.hidden = false
        agent.color = "#A78BFA"
        agent.system = EVALUATOR_SYSTEM_PROMPT
        agent.permissions = [{ action: "*", resource: "*", effect: "deny" }] as typeof agent.permissions
      })
      // Arm-time planner: one short child that turns a raw pasted /goal body into a concise, self-contained
      // condition. Deny-all and hidden — it never shows in the primary picker and needs no tools.
      editor.update(PLANNER_AGENT_ID, (agent) => {
        agent.name = asAgentName(PLANNER_AGENT_TITLE)
        agent.description = "Distills a raw /goal request into one concise condition before the goal is armed."
        agent.mode = "subagent"
        agent.hidden = true
        agent.system = PLANNER_SYSTEM_PROMPT
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
      compact: async (sessionID, opts) => {
        // A cold compact is a loop-boundary version bump: mark the session so the compaction hook installs
        // COLD_REPLAY instead of a generated summary. On failure drop the mark so a later ordinary compaction
        // keeps its normal summary. Ordinary auto-compaction never passes `cold`.
        if (opts?.cold) resetPending.add(sessionID)
        try {
          await ctx.session.compact({ sessionID } as Parameters<typeof ctx.session.compact>[0])
        } catch (error) {
          if (opts?.cold) resetPending.delete(sessionID)
          throw error
        }
      },
    }

    const harness = createHarness({
      ctx,
      config,
      log,
      lifetime,
      probe,
      controller: () => controller,
      background: () => background,
      emit: () => emit,
      noteInternal: (id, agent) => background.noteInternal(id, agent),
      asEvaluatorError,
      settle,
      planScopeFor,
      EVALUATION_SUMMARY_CHARS,
      EVALUATION_SETTLE_MS,
      sleep,
    })
    const { evaluatorChildren, plannerChildren, seenBackgroundResults, isPluginReport, isInternalChildReport, isInjectedPrompt, spawnEvaluator, evaluatorContext, nativeVerdict, sessionModel, planGoal, armedPlanScopes } = harness

    const evaluator = new Evaluator(
      {
        nativeVerdict,
        // Loop steps reuse the same evaluator subagent child. Its own context has no parent conversation, so embed
        // the parent digest in the prompt (the rubric says "conversation above"). Every judge path clears the gate.
        sessionGenerate: async (sessionID, prompt, signal) => {
          const model = await sessionModel(sessionID, signal)
          if (!model) throw new Error("inherited evaluator model unavailable: session has no active model")
          const transcript = renderTranscript(await evaluatorContext(sessionID, signal), { maxChars: config.evaluator.maxTranscriptChars })
          const { text } = await spawnEvaluator(
            sessionID,
            model,
            `<conversation>\n${transcript}\n</conversation>\n\n${prompt}`,
            signal,
          )
          return text
        },
        modelGenerate: async (sessionID, model, prompt, signal) => {
          const { text } = await spawnEvaluator(sessionID, model, prompt, signal)
          return text
        },
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

    if (probe) log.warn("probe mode: goal storage is read-only (OPENCODE_GOAL_PROBE); restore() will not persist anything")
    const store = new GoalStore(ctx.storage, (error) => log.error("goal storage write failed", { error: String(error) }), { readOnly: probe })

    // Agent-to-agent messaging lives here, inside the plugin's setup(): the tools and the unread hint below exist
    // only while the goal-plugin is enabled, and disappear with it. A worker's messages are tagged with the id of
    // its parent session (the "parent agent"), so each parent is both sender and receiver across parallel tasks.
    const messaging = new AgentMessaging(ctx.storage, systemClock, { readOnly: probe })
    const agentIdFor = async (sessionID: string): Promise<string> => {
      const info = await ctx.session.get({ sessionID }).catch(() => undefined) as { parentID?: unknown } | undefined
      const parent = info?.parentID
      return typeof parent === "string" && parent !== "" && parent !== sessionID ? parent : sessionID
    }
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "goal_msg_send",
        description: "Send a message to another session's parent agent (two-way parallel-work messaging). `to` is the recipient's parent session id (a `ses_...` id); `text` is the body. Your message is tagged with your own parent session id so the recipient can reply with goal_msg_send.",
        input: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient parent session id" },
            text: { type: "string", description: "Message body" },
          },
          required: ["to", "text"],
        } as const,
        async execute(input, toolContext) {
          const to = typeof (input as { to?: unknown }).to === "string" ? (input as { to: string }).to.trim() : ""
          const text = typeof (input as { text?: unknown }).text === "string" ? (input as { text: string }).text : ""
          if (!to || !text.trim()) return { content: "goal_msg_send needs a non-empty `to` session id and `text`." }
          const from = await agentIdFor(toolContext.sessionID)
          // Wake only on the empty -> non-empty transition: a burst of messages addressed to a parked parent
          // produces one nudge, not one turn per message. Probe mode writes nothing, so it wakes nothing.
          const hadUnread = await messaging.count(to).catch(() => 0)
          const message = await messaging.send(from, to, text)
          if (!probe && hadUnread === 0) {
            // "Idle" = no turn executing and no background work delegated. A failed activity check counts as
            // active (fail closed) so a storage/host hiccup cannot park a session behind an unread message.
            const active = controller.isExecuting(to) || await controller.isActive(to).catch(() => true)
            if (!active) {
              await ctx.session.prompt({
                sessionID: to,
                text: MESSAGE_WAKE_TEXT,
                delivery: "steer",
              } as Parameters<typeof ctx.session.prompt>[0]).catch((error) => {
                log.warn("goal message wake failed", { sessionID: to, error: String(error) })
              })
            }
          }
          return { content: `Sent to ${to} from ${from} (id ${message.id}).` }
        },
      })
      editor.add({
        name: "goal_msg_read",
        description: "Read and clear messages addressed to your parent agent's session id. Reply to a sender by passing its `from` id as `to` in goal_msg_send.",
        input: {
          type: "object",
          properties: {},
          required: [],
        } as const,
        async execute(_input, toolContext) {
          const agent = await agentIdFor(toolContext.sessionID)
          const messages = await messaging.drain(agent)
          if (messages.length === 0) return { content: `No messages for ${agent}.` }
          const body = messages.map((m) => `[${m.from}] ${m.text}`).join("\n")
          return { content: `${messages.length} message(s) for ${agent}:\n${body}` }
        },
      })
    })
    // The compactor and the controller need each other: the controller asks the compactor to compact at a loop boundary,
    // and the compactor asks the controller (and the background tracker) whether the session has work in flight.
    // The compactor is assigned before anything can call it, so the deferred closure is safe.
    let compactor!: AutoCompactor
    const controller: GoalController = new GoalController({
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
      compact: (sessionID, opts) => session.compact(sessionID, opts),
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
              message: `Could not check for updates. ${userFacingError(error)}`,
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

    // Sessions whose next compaction must replay a cold context: the explicit /reset-context command, or the
    // compaction a goal-loop version bump requests at its boundary. The hook consumes the entry exactly once, so
    // an ordinary auto-compaction in the same session keeps its normal summary. A Set keeps concurrent sessions
    // independent; each caller drops its own mark when compact() fails.
    const resetPending = new Set<string>()

    // ---- the /goal, /goal-loop and /reset-context commands
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
            const raw = prompt.text ?? ""
            // Status / clear / invalid are commands, not goals — never send them to the planner.
            const shouldPlan = parseGoalCommand(raw, config.maxConditionChars).type === "set"
            const planned = shouldPlan ? await planGoal(sessionID, raw) : undefined
            if (planned) armedPlanScopes.set(sessionID, { condition: planned.condition, scope: planned.scope })
            else armedPlanScopes.delete(sessionID)
            await controller.command({
              sessionID,
              text: planned?.condition ?? raw,
              delivery,
              loop,
              planned: true,
              ...(prompt.files ? { files: prompt.files } : {}),
              ...(prompt.agents ? { agents: prompt.agents } : {}),
              ...(prompt.skills ? { skills: prompt.skills } : {}),
            })
          },
        })
      addCommand("goal", DESCRIPTION, false)
      addCommand("goal-loop", LOOP_DESCRIPTION, true)

      // Same-session context reset. The host still performs a real compaction (so prior messages leave the model
      // request), but the compaction hook below stores an empty checkpoint instead of a native replay window.
      // No new session is created, so the session ID, its files and its history on disk all survive; only the
      // model-visible context is cleared.
      editor.add({
        name: "reset-context",
        description: "Drop this session's context in place, keeping the same session ID",
        execute: async ({ sessionID }) => {
          resetPending.add(sessionID)
          try {
            await session.compact(sessionID)
          } catch (error) {
            resetPending.delete(sessionID)
            throw error
          }
          emit.notice({
            sessionID,
            kind: "compact",
            level: "info",
            title: "goal-loop",
            message: "Context reset. Same session ID; the next turn starts with no conversation history.",
          })
        },
      })
    })

    await registerHooks({
      ctx,
      config,
      controller,
      evaluator,
      messaging,
      background,
      agentIdFor,
      handleBareLoop,
      planGoal,
      armedPlanScopes,
      resetPending,
      isInjectedPrompt,
      plannerChildren,
      evaluatorChildren,
      seenBackgroundResults,
      isPluginReport,
      isInternalChildReport,
      coldReplay: COLD_REPLAY,
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

    // Restore is started without blocking setup, but teardown must wait for it: otherwise it can adopt
    // goals and commit through a controller that dispose() has already invalidated and flushed.
    const restoring = controller.restore({ resume: !probe }).catch((error) => log.error("goal restore failed", { error: String(error) }))
    log.info("ready", {
      evaluator: config.evaluator.mode,
      model: config.evaluator.model ?? (config.evaluator.inheritModel ? "session (inherited)" : "session"),
    })

    return async () => {
      lifetime.abort()
      evaluatorChildBySession.clear()
      plannerChildBySession.clear()
      for (const timer of updateTimers) clearTimeout(timer)
      updateTimers.clear()
      await restoring
      await controller.dispose()
    }
  },
})
