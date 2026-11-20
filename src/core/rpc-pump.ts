/**
 * Reconnecting pump for the TUI's RPC event subscriptions.
 *
 * The harness's shared event connection can end (a background-service handoff, a dropped stream). When it
 * does, every one-shot `events.on(...)` subscription seeded before the drop ends with it — permanently: the
 * `@opencode/client` `makeRpc` wrapper iterates the shared stream once and never re-opens it, so the TUI
 * keeps painting its last snapshot (a goal stuck on "checking") until the whole harness restarts, even
 * though the plugin's `changed` emissions resume the moment the service is back.
 *
 * Subscribing through `events.subscribe(...)` gives each iteration of this pump a fresh iterator on the
 * shared bus, and the bus lazily opens a new connection once the old one is gone. The pump re-opens the
 * stream with a small backoff whenever it ends (normally or with an error), skips a throwing handler so one
 * bad event cannot kill the pump, and — for streams that opt in — runs a catch-up pull after every
 * reconnect so events missed during the gap are re-read from the server's truth. Pure wiring; the I/O lives
 * at the call site.
 */
export const RPC_RESUBSCRIBE_DELAY_MS = 1_000

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

interface RpcPumpOptions {
  /** Event stream name, for diagnostics only. */
  readonly name: "changed" | "notice"
  /** Abort the pump (plugin teardown). */
  readonly signal: AbortSignal
  /** Open a fresh subscription. Ends when the shared connection drops; may throw instead. */
  readonly subscribe: () => AsyncIterable<unknown>
  /** Handle one event. A throwing handler is reported and skipped, never propagates. */
  readonly handle: (event: unknown) => void
  /** Convergence pull run after every reconnect (the gap may have swallowed events). Never throws. */
  readonly catchUp?: () => void
  /** Injected for tests; defaults to an abortable delay. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  /** Optional diagnostics sink; receives "rpc event stream dropped" / "rpc event handler failed". */
  readonly log?: (event: string, detail?: Record<string, unknown>) => void
}

/**
 * Runs until `signal` aborts: subscribe → drain → (catchUp) → backoff → re-subscribe. Never throws — every
 * failure mode is logged and retried on the next pass, so a dead event bus converges the TUI back to live
 * the moment the harness revives it.
 */
export const pumpRpcEvent = async (options: RpcPumpOptions): Promise<void> => {
  const { name, signal, subscribe, handle, catchUp, log } = options
  const sleep = options.sleep ?? defaultSleep
  while (!signal.aborted) {
    try {
      for await (const event of subscribe()) {
        if (signal.aborted) return
        try {
          handle(event)
        } catch (error) {
          log?.("rpc event handler failed", { name, error: errorMessage(error) })
        }
      }
      // The stream ended cleanly: the shared connection is gone. Events published while it was down are
      // lost, so pull the server's current truth before re-subscribing.
      log?.("rpc event stream ended", { name })
    } catch (error) {
      log?.("rpc event stream dropped", { name, error: errorMessage(error) })
    }
    if (signal.aborted) return
    try {
      catchUp?.()
    } catch (error) {
      log?.("rpc catch-up failed", { name, error: errorMessage(error) })
    }
    await sleep(RPC_RESUBSCRIBE_DELAY_MS, signal)
  }
}
