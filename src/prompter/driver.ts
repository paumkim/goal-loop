import { OpenCode } from "@opencode/client"
import { spawn } from "node:child_process"
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { logPath, money, short, sleep } from "./util.ts"
import { SUCCESS_STATUS, TERMINAL_STATUSES } from "./defaults.ts"
import { GoalRpc } from "./goal-rpc.ts"
import type { Config, TaskResult } from "./types.ts"

export const isTerminal = (status: string | undefined): boolean => !!status && TERMINAL_STATUSES.has(status)

/**
 * Best-effort write to the append-only log. A SIGTERM can close the stream while the spawned server still has
 * buffered stdout/stderr to flush; writing after `end()` throws ERR_STREAM_WRITE_AFTER_END and would crash the
 * shutdown path before the task state is finalized.
 */
export const writeLogLine = (stream: { writable: boolean; write(chunk: string): unknown }, line: string): void => {
  if (stream.writable) stream.write(line)
}

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0)

/** Extract the outcome from a goal-loop record. Pure; unit-tested without a server. */
export const extractResult = (record: unknown): TaskResult => {
  const r = (record && typeof record === "object" ? record : {}) as Record<string, unknown>
  const spend = r.spend && typeof r.spend === "object" ? (r.spend as Record<string, unknown>) : {}
  return {
    status: typeof r.status === "string" ? r.status : "failed",
    reason: typeof r.reason === "string" ? r.reason : "",
    turns: num(r.turns),
    costUsd: num(spend.cost),
    tokens: num(spend.input) + num(spend.output),
  }
}

/**
 * Live dollar/token breach from the goal record itself. The CLI's `budget` is only noted after runTask
 * returns, so `shouldStop()` alone can never halt overspend mid-task; the poll loop checks this each tick.
 */
export const liveBudgetStop = (config: Config, record: unknown): string | undefined => {
  const { costUsd, tokens } = extractResult(record)
  if (config.maxSpendUsd > 0 && costUsd >= config.maxSpendUsd) {
    return `budget: spent ${money(costUsd)} of ${money(config.maxSpendUsd)} (live goal spend)`
  }
  if (config.maxTokens > 0 && tokens >= config.maxTokens) {
    return `budget: ${tokens}/${config.maxTokens} tokens (live goal usage)`
  }
  return undefined
}

/** A budget breach is fail-closed: it must never be presented as an achieved task awaiting review. */
export const budgetStoppedResult = (result: TaskResult, reason: string): TaskResult => ({
  ...result,
  status: "failed",
  reason: result.reason ? `${result.reason} | ${reason}` : reason,
})

interface RunTaskInput {
  readonly repo: string
  readonly worktree: string
  readonly config: Config
  readonly objective: string
  readonly onLog?: (line: string) => void
  /** Checked on every poll; a non-empty reason aborts the session. */
  readonly shouldStop: () => string | undefined
  readonly signal?: AbortSignal
}

/** Run one /goal session headlessly against the isolated worktree. */
export const runTask = async (input: RunTaskInput): Promise<TaskResult> => {
  const { repo, worktree, config, objective, onLog = () => {}, shouldStop, signal } = input
  const log = (line: string): void => onLog(line.replace(/\s+/g, " ").trim())

  // Optional explicit plugin pin. Global opencode config is authoritative by default (plugin: "").
  if (config.plugin) {
    const dir = path.join(worktree, ".opencode")
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, "opencode.json")
    const intended = JSON.stringify({ plugins: [config.plugin] }, null, 2)
    if (!existsSync(file)) writeFileSync(file, intended, "utf8")
    // Keep this harness config out of the task's commit even if the repo tracks .opencode/.
    const exclude = path.join(worktree, ".git")
    if (existsSync(exclude)) {
      const info = path.join(exclude, "info")
      if (existsSync(info)) {
        const excludeFile = path.join(info, "exclude")
        const current = existsSync(excludeFile) ? readFileSafe(excludeFile) : ""
        if (!current.includes(".opencode/")) appendFileSync(excludeFile, "\n.opencode/\n")
      }
    }
  }

  const port = 4700 + Math.floor(Math.random() * 200)
  const baseUrl = `http://127.0.0.1:${port}`
  const password = crypto.randomUUID()
  const headers = { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` }
  const outFile = logPath(repo)
  mkdirSync(path.dirname(outFile), { recursive: true })
  const fileLog = createWriteStream(outFile, { flags: "a" })
  fileLog.on("error", (error) => log(`log write failed: ${error.message}`))
  const logBoth = (line: string): void => {
    writeLogLine(fileLog, `${new Date().toISOString()} ${line}\n`)
    log(line)
  }

  const env: NodeJS.ProcessEnv = { ...process.env, OPENCODE_SERVER_PASSWORD: password }
  if (config.verifyCommand) env.OPENCODE_GOAL_VERIFY_COMMAND = config.verifyCommand
  const server = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs", "--log-level", "info"], {
    cwd: worktree,
    stdio: ["ignore", "pipe", "pipe"],
    env,
  })
  let serverError: Error | undefined
  server.on("error", (error) => { serverError = error })
  server.stdout?.on("data", (chunk: Buffer) => logBoth(`[serve] ${chunk.toString()}`))
  server.stderr?.on("data", (chunk: Buffer) => logBoth(`[serve:err] ${chunk.toString()}`))

  const killServer = (): void => { if (!server.killed) server.kill() }
  // Signal handling only kills the child; the stream is closed once in `finally`, after its data handlers have
  // stopped. Closing here races with late output and caused write-after-end crashes.
  const stopSignal = (): void => { killServer() }
  process.once("SIGTERM", stopSignal)
  process.once("SIGINT", stopSignal)

  let last: unknown
  let reason = ""
  let budgetBreach = ""

  try {
    const client = OpenCode.make({ baseUrl, headers })
    for (let i = 0; ; i++) {
      if (serverError) throw new Error(`failed to spawn opencode: ${serverError.message}`)
      if (signal?.aborted) throw new Error("stopped: signal received")
      const stopped = shouldStop()
      if (stopped) throw new Error(stopped)
      if (await client.server.info().then(() => true, () => false)) break
      if (i > 120) throw new Error(`server did not start within ~60s (see ${outFile})`)
      await sleep(500)
    }
    logBoth("server up")

    const location = { directory: worktree }
    let registered = false
    for (let i = 0; i < 60 && !registered; i++) {
      const commands = await client.command.list({ location }).catch(() => undefined)
      registered = /"name":"goal"/.test(JSON.stringify(commands ?? ""))
      if (!registered) await sleep(1_000)
    }
    if (!registered) throw new Error("/goal command not registered — is goal-loop installed in the global opencode config?")
    logBoth("goal command registered")

    const model = config.model ? parseModelRef(config.model) : undefined
    const session = await client.session.create({
      location,
      title: `prompter ${path.basename(worktree)}`,
      ...(model ? { model } : {}),
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    })
    const sessionID = session.id
    logBoth(`session ${sessionID}`)

    const abortEvents = new AbortController()
    void (async () => {
      for await (const event of client.event.subscribe({ signal: abortEvents.signal })) {
        const data = (event as { data?: Record<string, unknown> }).data ?? {}
        if (data.sessionID && data.sessionID !== sessionID) continue
        if (event.type === "rpc.goal.notice") {
          logBoth(`NOTICE ${String(data.level ?? "info")} ${String(data.title ?? "")}: ${short(String(data.message ?? ""), 240)}`)
        } else if (event.type === "session.execution.failed") {
          logBoth(`execution failed: ${short(JSON.stringify(data.error ?? ""), 240)}`)
        }
      }
    })().catch(() => {})

    await client.session.command({ sessionID, name: "goal", text: objective })
    logBoth("/goal sent")

    const goal = client.rpc(GoalRpc)
    const started = Date.now()
    while (true) {
      const stopped = shouldStop()
      if (stopped) { reason = stopped; break }
      if (signal?.aborted) { reason = "stopped: signal received"; break }
      if (Date.now() - started >= config.maxWallMsPerTask) { reason = `per-task timeout (${Math.round(config.maxWallMsPerTask / 60_000)}m)`; break }
      await sleep(config.pollMs)
      const response = await goal.get({ sessionID }, { location }).catch((error: unknown) => {
        logBoth(`goal.get failed: ${String(error)}`)
        return undefined
      })
      last = (response as { goal?: unknown } | undefined)?.goal
      const activeStop = liveBudgetStop(config, last)
      if (activeStop) { budgetBreach = activeStop; reason = activeStop; break }
      const status = (last as { status?: string } | null)?.status
      if (isTerminal(status)) break
    }
    abortEvents.abort()
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error)
    logBoth(`error: ${reason}`)
  } finally {
    process.removeListener("SIGTERM", stopSignal)
    process.removeListener("SIGINT", stopSignal)
    killServer()
    if (fileLog.writable) fileLog.end()
    await Promise.race([onceClose(fileLog), sleep(2_000)]).catch(() => {})
  }

  const result = extractResult(last)
  if (budgetBreach) return budgetStoppedResult(result, budgetBreach)
  if (!isTerminal(result.status)) {
    return { ...result, status: "failed", reason: result.reason || reason || "goal did not reach a terminal status" }
  }
  if (reason && result.status !== SUCCESS_STATUS) {
    return { ...result, reason: result.reason ? `${result.reason} | ${reason}` : reason }
  }
  return result
}

const onceClose = (stream: { once: (event: string, cb: () => void) => void }): Promise<void> =>
  new Promise((resolve) => stream.once("finish", resolve))

const readFileSafe = (file: string): string => {
  try { return readFileSync(file, "utf8") } catch { return "" }
}

const parseModelRef = (value: string): { providerID: string; id: string } => {
  const slash = value.indexOf("/")
  return { providerID: value.slice(0, slash), id: value.slice(slash + 1) }
}
