import { describe, expect, test } from "bun:test"
import { AgentMessaging, MAX_MESSAGES_PER_INBOX, MESSAGE_PREFIX, type AgentMessage } from "../src/runtime/messaging.ts"
import type { Clock, StoragePort } from "../src/runtime/ports.ts"

function storage() {
  const map = new Map<string, unknown>()
  const port: StoragePort = {
    get: async (key) => map.get(key),
    set: async (key, value) => void map.set(key, value),
    remove: async (key) => void map.delete(key),
    scan: async () => ({ entries: [] }),
  }
  return { port, map }
}

const clock: Clock = { now: () => 1_700_000_000_000, setTimeout: () => 0, clearTimeout: () => {} }

describe("agent-to-agent messaging", () => {
  test("messages are tagged by parent session id and route to the addressed inbox", async () => {
    const { port, map } = storage()
    const m = new AgentMessaging(port, clock)
    await m.send("ses_parent_A", "ses_parent_B", "hello from A")
    expect(map.has(`${MESSAGE_PREFIX}ses_parent_B`)).toBe(true)
    expect(map.has(`${MESSAGE_PREFIX}ses_parent_A`)).toBe(false)

    const inboxB = await m.drain("ses_parent_B")
    expect(inboxB).toHaveLength(1)
    expect(inboxB[0]).toMatchObject({ from: "ses_parent_A", to: "ses_parent_B", text: "hello from A" })
    expect(typeof inboxB[0]!.id).toBe("string")
    expect(inboxB[0]!.at).toBe(clock.now())
    expect(await m.drain("ses_parent_B")).toHaveLength(0)
  })

  test("two-way exchange: each parent is both sender and receiver", async () => {
    const { port } = storage()
    const m = new AgentMessaging(port, clock)
    await m.send("ses_A", "ses_B", "question")
    await m.send("ses_B", "ses_A", "answer")
    const forA = await m.drain("ses_A")
    const forB = await m.drain("ses_B")
    expect(forA.map((x) => x.from)).toEqual(["ses_B"])
    expect(forA[0]!.text).toBe("answer")
    expect(forB.map((x) => x.from)).toEqual(["ses_A"])
    expect(forB[0]!.text).toBe("question")
  })

  test("concurrent sends to one inbox do not lose messages", async () => {
    const { port } = storage()
    const m = new AgentMessaging(port, clock)
    await Promise.all(Array.from({ length: 25 }, (_, i) => m.send(`ses_${i}`, "ses_target", `m${i}`)))
    const inbox = await m.drain("ses_target")
    expect(inbox).toHaveLength(25)
    expect(new Set(inbox.map((x) => x.text)).size).toBe(25)
  })

  test("an inbox is capped and drops the oldest messages", async () => {
    const { port } = storage()
    const m = new AgentMessaging(port, clock)
    for (let i = 0; i < MAX_MESSAGES_PER_INBOX + 5; i++) await m.send("ses_sender", "ses_target", `m${i}`)
    const inbox = await m.drain("ses_target")
    expect(inbox).toHaveLength(MAX_MESSAGES_PER_INBOX)
    expect(inbox[0]!.text).toBe("m5")
    expect(inbox.at(-1)!.text).toBe(`m${MAX_MESSAGES_PER_INBOX + 4}`)
  })

  test("count reflects queued messages without clearing them", async () => {
    const { port } = storage()
    const m = new AgentMessaging(port, clock)
    expect(await m.count("ses_target")).toBe(0)
    await m.send("ses_A", "ses_target", "one")
    await m.send("ses_B", "ses_target", "two")
    expect(await m.count("ses_target")).toBe(2)
    expect(await m.count("ses_target")).toBe(2)
    await m.drain("ses_target")
    expect(await m.count("ses_target")).toBe(0)
  })

  test("malformed or corrupt stored data is ignored", async () => {
    const { port, map } = storage()
    const m = new AgentMessaging(port, clock)
    map.set(m.keyFor("ses_target"), { nope: true })
    expect(await m.drain("ses_target")).toEqual([])
    map.set(m.keyFor("ses_target"), ["junk", { from: "x", to: "ses_target", text: "y", at: 1, id: "good" }])
    const inbox = await m.drain("ses_target") as AgentMessage[]
    expect(inbox).toHaveLength(1)
    expect(inbox[0]!.text).toBe("y")
  })

  test("read-only (probe) mode never persists and reports an empty inbox", async () => {
    const { port, map } = storage()
    const m = new AgentMessaging(port, clock, { readOnly: true })
    await m.send("ses_A", "ses_B", "hidden")
    expect(map.size).toBe(0)
    expect(await m.count("ses_B")).toBe(0)
    expect(await m.drain("ses_B")).toEqual([])
  })

  test("a storage read failure degrades to an empty inbox instead of throwing", async () => {
    const throwing: StoragePort = {
      get: async () => { throw new Error("storage down") },
      set: async () => {},
      remove: async () => {},
      scan: async () => ({ entries: [] }),
    }
    const m = new AgentMessaging(throwing, clock)
    expect(await m.drain("ses_target")).toEqual([])
    expect(await m.send("ses_A", "ses_B", "still works")).toMatchObject({ to: "ses_B" })
  })
})
