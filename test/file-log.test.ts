/**
 * The opt-in file sink (`OPENCODE_GOAL_LOG_FILE`): JSONL lines, best-effort semantics, one-generation
 * rotation so very long sessions cannot grow the log without bound.
 */
import { describe, expect, test, afterEach } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { withFileSink, FILE_LOG_MAX_BYTES } from "../src/core/file-log.ts"
import type { Logger } from "../src/runtime/ports.ts"

const dirs: string[] = []
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "goal-filelog-"))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const recordingLogger = () => {
  const calls: Array<{ level: string; message: string; value?: Record<string, unknown> }> = []
  const logger: Logger = {
    info: (message, value) => calls.push({ level: "info", message, value }),
    warn: (message, value) => calls.push({ level: "warn", message, value }),
    error: (message, value) => calls.push({ level: "error", message, value }),
  }
  return { logger, calls }
}

describe("withFileSink", () => {
  test("returns the base logger unchanged when the file is unset or blank", () => {
    const { logger } = recordingLogger()
    expect(withFileSink(logger, undefined)).toBe(logger)
    expect(withFileSink(logger, "")).toBe(logger)
    expect(withFileSink(logger, "   ")).toBe(logger)
  })

  test("appends one JSONL line per call with ts, level, message and data", () => {
    const file = join(scratch(), "goal.log")
    const { logger } = recordingLogger()
    const log = withFileSink(logger, file, { now: () => Date.UTC(2026, 10, 18, 12, 0, 0) })
    log.info("hello", { detail: 42 })
    log.error("boom")
    const lines = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({ ts: "2026-11-18T12:00:00.000Z", level: "info", message: "hello", data: { detail: 42 } })
    expect(lines[1]).toEqual({ ts: "2026-11-18T12:00:00.000Z", level: "error", message: "boom" })
  })

  test("always calls the base logger, even when the file write fails", () => {
    const dir = scratch()
    const { logger, calls } = recordingLogger()
    // A directory as the target path makes appendFileSync throw; the base logger must still see the line.
    const log = withFileSink(logger, dir)
    expect(() => log.warn("still logged", { a: 1 })).not.toThrow()
    expect(calls).toEqual([{ level: "warn", message: "still logged", value: { a: 1 } }])
  })

  test("creates a missing parent directory on first write", () => {
    const file = join(scratch(), "nested", "deep", "goal.log")
    const { logger } = recordingLogger()
    withFileSink(logger, file).info("made it")
    expect(JSON.parse(readFileSync(file, "utf8").trim()).message).toBe("made it")
  })

  test("rotates to <file>.1 once the target exceeds maxBytes, replacing any previous .1", () => {
    const file = join(scratch(), "goal.log")
    writeFileSync(file, "x".repeat(2048))
    writeFileSync(`${file}.1`, "stale")
    const { logger } = recordingLogger()
    withFileSink(logger, file, { maxBytes: 1024 }).info("fresh")
    expect(readFileSync(`${file}.1`, "utf8")).toBe("x".repeat(2048))
    const lines = readFileSync(file, "utf8").trim().split("\n")
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] as string).message).toBe("fresh")
  })

  test("a file at or under maxBytes is not rotated", () => {
    const file = join(scratch(), "goal.log")
    writeFileSync(file, "small")
    const { logger } = recordingLogger()
    withFileSink(logger, file, { maxBytes: 1024 }).info("appended")
    expect(existsSync(`${file}.1`)).toBe(false)
    expect(readFileSync(file, "utf8").startsWith("small")).toBe(true)
  })

  test("unserializable data (cycles, bigints, Errors) still yields a line and never throws", () => {
    const file = join(scratch(), "goal.log")
    const { logger } = recordingLogger()
    const cyclic: Record<string, unknown> = { n: 1n }
    cyclic.self = cyclic
    expect(() => withFileSink(logger, file).error("weird", cyclic)).not.toThrow()
    const line = JSON.parse(readFileSync(file, "utf8").trim())
    expect(line.level).toBe("error")
    expect(line.data.n).toBe("1")
    expect(line.data.self).toBe("[circular]")
    expect(() => withFileSink(logger, file).error("err", { e: new Error("kablam") })).not.toThrow()
    const second = JSON.parse(readFileSync(file, "utf8").trim().split("\n").at(-1) as string)
    expect(second.data.e.message).toBe("kablam")
  })

  test("the default rotation threshold is 5 MiB", () => {
    expect(FILE_LOG_MAX_BYTES).toBe(5 * 1024 * 1024)
  })

  test("writes survive a large value without corrupting the line structure", () => {
    const file = join(scratch(), "goal.log")
    const { logger } = recordingLogger()
    withFileSink(logger, file).info("big", { blob: "y".repeat(100_000) })
    expect(statSync(file).size).toBeGreaterThan(100_000)
    const line = readFileSync(file, "utf8").trim()
    expect(() => JSON.parse(line)).not.toThrow()
  })
})
