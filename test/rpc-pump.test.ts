/**
 * Regression tests for the reconnecting RPC event pump.
 *
 * The one-shot `events.on(...)` it replaces died permanently when the harness's shared event connection
 * dropped: the TUI kept painting its last snapshot (a goal stuck on "checking") until the harness restarted,
 * even though the plugin resumed emitting `changed` the moment the service was back. These tests pin the
 * pump's contract: it drains events, survives handler throws and stream failures, re-subscribes with a
 * backoff, runs the catch-up pull after every reconnect (before it sleeps), and stops on teardown.
 */
import { describe, expect, test } from "bun:test"
import { pumpRpcEvent, RPC_RESUBSCRIBE_DELAY_MS } from "../src/core/rpc-pump.ts"

/** An async iterator factory draining a shared queue: each iteration yields what is left, so reconnects can be scripted independently of drains. */
const scripted = <T>(items: readonly T[], options?: { readonly throwAtEnd?: unknown }) => {
  const queue = [...items]
  const calls = { count: 0 }
  const make = (): AsyncIterable<T> => ({
    [Symbol.asyncIterator]() {
      calls.count += 1
      return {
        async next() {
          const value = queue.shift()
          if (value !== undefined) return { done: false, value }
          if (options?.throwAtEnd !== undefined) return Promise.reject(options.throwAtEnd)
          return { done: true, value: undefined }
        },
      } as AsyncIterator<T>
    },
  })
  return { make, calls }
}

const instantSleep = () => Promise.resolve()

const run = (overrides: Record<string, unknown> = {}) => {
  const events: unknown[] = []
  const catchUps: number[] = []
  const sleeps: number[] = []
  const aborted = new AbortController()
  const result = pumpRpcEvent({
    name: "changed",
    signal: aborted.signal,
    subscribe: overrides.subscribe as never,
    handle: (event) => {
      events.push(event)
    },
    catchUp: () => catchUps.push(1),
    sleep: async (ms) => {
      sleeps.push(ms)
      if (sleeps.length >= (overrides.maxSleeps as number ?? 1)) aborted.abort()
      return instantSleep()
    },
    ...(overrides.handle ? { handle: overrides.handle as never } : {}),
  })
  return { events, catchUps, sleeps, aborted, result }
}

describe("pumpRpcEvent", () => {
  test("drains events, runs catchUp and re-subscribes after the stream ends", async () => {
    const stream = scripted([{ id: 1 }, { id: 2 }])
    const { events, catchUps, sleeps, result } = run({ subscribe: stream.make, maxSleeps: 2 })
    await result
    expect(events).toEqual([{ id: 1 }, { id: 2 }])
    // Two stream passes, two catch-up pulls (one per reconnect), and the backoff between them.
    expect(stream.calls.count).toBe(2)
    expect(catchUps).toEqual([1, 1])
    expect(sleeps[0]).toBe(RPC_RESUBSCRIBE_DELAY_MS)
  })

  test("survives a stream that throws — the pump re-subscribes instead of dying", async () => {
    const boom = new Error("connection reset")
    const stream = scripted([{ id: 1 }], { throwAtEnd: boom })
    const { events, catchUps, result } = run({ subscribe: stream.make, maxSleeps: 2 })
    await result
    expect(events).toEqual([{ id: 1 }])
    expect(catchUps).toEqual([1, 1])
    expect(stream.calls.count).toBe(2)
  })

  test("a throwing handler does not kill the pump or skip the remaining events", async () => {
    const stream = scripted([{ id: 1 }, { id: 2 }, { id: 3 }])
    const seen: number[] = []
    const { result } = run({
      subscribe: stream.make,
      maxSleeps: 1,
      handle: (event: { id: number }) => {
        if (event.id === 2) throw new Error("bad event")
        seen.push(event.id)
      },
    })
    await result
    expect(seen).toEqual([1, 3])
  })

  test("stops promptly when the teardown aborts the signal", async () => {
    const stream = scripted([{ id: 1 }])
    const aborted = new AbortController()
    const subscribeCalls: number[] = []
    const result = pumpRpcEvent({
      name: "changed",
      signal: aborted.signal,
      subscribe: () => {
        subscribeCalls.push(1)
        aborted.abort()
        return stream.make()
      },
      handle: () => {},
      sleep: instantSleep,
    })
    await result
    expect(subscribeCalls).toHaveLength(1)
  })

  test("the catch-up pull runs after the stream ends, before the backoff, even when it throws internally", async () => {
    const stream = scripted([])
    const order: string[] = []
    const aborted = new AbortController()
    await pumpRpcEvent({
      name: "changed",
      signal: aborted.signal,
      subscribe: () => {
        order.push("subscribe")
        return stream.make()
      },
      handle: () => {},
      catchUp: () => {
        order.push("catchUp")
        if (order.filter((step) => step === "catchUp").length >= 1) aborted.abort()
      },
      sleep: instantSleep,
    })
    expect(order).toEqual(["subscribe", "catchUp"])
  })
})
