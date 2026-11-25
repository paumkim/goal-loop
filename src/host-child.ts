/**
 * Shared lifecycle for harness-owned subagent children (judge and arm-time planner).
 *
 * A child is created once per working session, reused across generations, registered with the
 * background tracker, and released on failure/abort. The caller owns the event-stream decision
 * (what counts as a terminal event) and parses the result; this module owns the plumbing both
 * children used to duplicate line for line.
 */
import type { Plugin } from "@opencode/plugin"
import type { SessionPromptInput } from "@opencode/client"
import type { ModelRef } from "./core/types.ts"

type Host = Pick<Plugin.Context, "location" | "session">

/** The host client type omits the per-prompt model override the plugin uses to follow /model switches. */
export type ChildPromptInput = SessionPromptInput & { readonly model: ModelRef }

/** Fields the harness reads from host child events; narrowed once at the subscription boundary. */
export type ChildEvent = {
  readonly type: string
  readonly data?: {
    readonly sessionID?: string
    readonly delta?: unknown
    readonly error?: unknown
    readonly reason?: unknown
    readonly message?: unknown
  }
}

/** The per-generation state handed to the child's event observer. */
export interface ChildRun {
  readonly id: string
  /** Aborts the child's event subscription. */
  readonly signal: AbortSignal
  abort(): void
  /** Resolves the generation wait with the text collected so far. */
  finish(value?: string): void
  /** Records a failure without aborting the subscription. */
  fail(error: unknown): void
  append(delta: string): void
  text(): string
  failed(): boolean
}

/** One generation on a cached harness-owned child. */
export async function spawnHostChild({
  host,
  cache,
  active,
  noteInternal,
  sessionID,
  agentID,
  title,
  model,
  text: promptText,
  signal,
  observe,
  promptRejected,
}: {
  host: Host
  cache: Map<string, string>
  active: Set<string>
  noteInternal: (id: string, agentID: string) => void
  sessionID: string
  agentID: string
  title: string
  model: ModelRef
  text: string
  signal: AbortSignal
  observe: (run: ChildRun) => (() => void) | void
  promptRejected: (run: ChildRun, error: unknown) => void
}): Promise<{ text: string; id: string; failure: unknown; aborted: boolean }> {
  let id = cache.get(sessionID)
  if (!id) {
    id = (await host.session.create({ location: host.location, parentID: sessionID, title, agent: agentID, model })).id
    cache.set(sessionID, id)
  }
  noteInternal(id, agentID)
  active.add(id)

  const child = new AbortController()
  let answer = ""
  let failure: unknown
  let finish!: (value?: string) => void
  const done = new Promise<string>((resolve) => { finish = (value) => resolve(value ?? answer) })
  const run: ChildRun = {
    id,
    signal: child.signal,
    abort: () => child.abort(),
    finish,
    fail: (error) => { if (failure === undefined) failure = error; finish() },
    append: (delta) => { answer += delta },
    text: () => answer,
    failed: () => failure !== undefined,
  }

  let cleanup: (() => void) | void = () => {}
  try {
    cleanup = observe(run)
    // The signal must reach the host prompt: a child that ignores an external abort used to keep the
    // caller parked after `done` had resolved, defeating the timeout. Race so any abort converges.
    const input: ChildPromptInput = { sessionID: id, text: promptText, model }
    await Promise.race([
      host.session.prompt(input, { signal }).catch((error: unknown) => promptRejected(run, error)),
      done.then(() => undefined),
    ])
    const text = await done
    return { text, id, failure, aborted: signal.aborted }
  } finally {
    cleanup?.()
    active.delete(id)
    // A failed or interrupted generation may have left the child in a bad state; drop it so the next
    // generation starts from a clean child. Successful children stay cached and are reused.
    if ((failure !== undefined || signal.aborted) && cache.get(sessionID) === id) cache.delete(sessionID)
  }
}
