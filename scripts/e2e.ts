/**
 * End-to-end smoke test against a real, private `opencode serve` instance.
 *
 *   bun scripts/e2e.ts <empty-project-dir> [provider/model] [condition]
 *
 * The model defaults to the `opencode` provider; override it with the second argument or the E2E_MODEL
 * environment variable (e.g. `E2E_MODEL=openrouter/anthropic/claude bun scripts/e2e.ts <dir>`).
 *
 * Writes `.opencode/opencode.json` loading this plugin into the project (a rerun with the identical
 * payload is a no-op; a different payload stops with a clear message), starts a standalone server
 * there (your background service is untouched), runs `/goal` through the API and follows the loop
 * until the goal resolves. Exits 0 when the goal resolves as `achieved`, 1 otherwise (including on
 * timeout). Ctrl-C kills the server before exiting. Post-resolution diagnostics (digest, file
 * listing) never change the exit code.
 */
import { OpenCode } from "@opencode/client"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream, statSync } from "node:fs"
import path from "node:path"
import { renderTranscript } from "../src/core/transcript.ts"
import { GoalRpc } from "../src/rpc.ts"
import { parseModelArg, resolveModel, buildIntendedConfig, decideConfigAction, refuseConfigMessage, goalExitCode } from "./e2e-lib.ts"

const TIMEOUT_MS = 10 * 60_000
const [projectArg, rawModelArg, conditionArg] = process.argv.slice(2)
if (!projectArg) throw new Error("usage: bun scripts/e2e.ts <empty-project-dir> [provider/model] [condition]")
const modelArg = resolveModel(rawModelArg, process.env.E2E_MODEL)
// The model must be "provider/model" — a bare word used to parse as provider "openroute" + id
// "openrouter" (and a trailing slash as an empty model id), failing much later with an opaque server error.
const { providerID, modelID } = parseModelArg(modelArg)

const project = path.resolve(projectArg)
const pluginRoot = path.resolve(import.meta.dir, "..")
const port = 4700 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`
const condition =
  conditionArg ??
  "notes/plan.md exists with exactly three numbered steps for brewing tea, and notes/done.txt contains the single word DONE. Prove both by printing the files."
const password = crypto.randomUUID()
const headers = { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` }
const e2ePlugin = process.env.E2E_PLUGIN ?? pluginRoot.replaceAll("\\", "/")

// The documented contract is an existing empty project dir. A missing path used to be created
// silently, which hid typos by running the whole smoke test in the wrong place.
if (!existsSync(project) || !statSync(project).isDirectory()) {
  throw new Error(`project directory does not exist: ${project} — create the empty directory first`)
}

// The documented contract is an empty project dir. A differing .opencode/opencode.json already in
// place is never rewritten: an identical payload makes a rerun a no-op (a read-only but
// up-to-date config no longer fails with EACCES), anything else stops with a clear message.
const opencodeJson = path.join(project, ".opencode", "opencode.json")
const intendedJson = buildIntendedConfig(e2ePlugin)
const existingJson = existsSync(opencodeJson) ? readFileSync(opencodeJson, "utf8") : null
const configAction = decideConfigAction(existingJson, intendedJson)
if (configAction === "refuse") throw new Error(refuseConfigMessage(opencodeJson))

const serverLog = path.join(project, "server.log")
if (configAction === "write") {
  mkdirSync(path.join(project, ".opencode"), { recursive: true })
  writeFileSync(opencodeJson, intendedJson)
}

const log = createWriteStream(serverLog)
let serverError: Error | undefined
log.on("error", (error) => {
  // Logging is diagnostics; a broken log stream must not take the harness down with it.
  console.error(`server.log stream failed (${serverLog}):`, error)
})
const server = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs", "--log-level", "info"], {
  cwd: project,
  shell: process.platform === "win32",
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
})
server.stdout.pipe(log)
server.stderr.pipe(log)
// Without an "error" listener a failed spawn (e.g. opencode not on PATH) crashes the process with a
// raw stack; record it and fail fast in the readiness loop instead of waiting out the full timeout.
server.on("error", (error) => {
  serverError = error
})

const stamp = () => new Date().toISOString().slice(11, 19)
const say = (...args: unknown[]) => console.log(stamp(), ...args)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const killServer = () => {
  // On Windows the server runs under a shell wrapper: kill the whole tree first, or the server
  // outlives us. On POSIX the direct child gets SIGTERM.
  if (process.platform === "win32" && server.pid) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" })
  else server.kill()
}
// A bare Ctrl-C used to orphan the server (the finally block never ran). Forward the signal: kill
// the server, then exit with the conventional 128+signo.
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.on(signal, () => {
    say(`received ${signal}, killing the server`)
    killServer()
    log.end()
    process.exit(code)
  })
}

let exitCode = 1

try {
  const client = OpenCode.make({ baseUrl, headers })
  for (let i = 0; ; i++) {
    if (serverError) throw new Error(`failed to spawn opencode: ${serverError.message}`)
    if (await client.server.info().then(() => true, () => false)) break
    if (i > 120) throw new Error(`server did not start within ~60s (see ${serverLog})`)
    await sleep(500)
  }
  say(`server up on ${baseUrl}`)
  server.on("exit", (code, signal) => say("server exited", code, signal ?? ""))
  const location = { directory: project }
  const session = await client.session.create({
    location,
    title: "goal e2e",
    model: { providerID, id: modelID },
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  })
  const sessionID = session.id
  say("session", sessionID)

  const plugins = await client.plugin.list({ location }).catch((error) => String(error))
  const ours = JSON.stringify(plugins).match(/[^{}]*OpenCodeGoal[^{}]*/i)?.[0]
  say("plugin:", ours ?? JSON.stringify(plugins).slice(0, 600))
  // Plugins activate in the background after the location boots; wait for the command to appear.
  let registered = false
  for (let i = 0; i < 60 && !registered; i++) {
    const commands = await client.command.list({ location }).catch(() => undefined)
    registered = /"name":"goal"/.test(JSON.stringify(commands ?? ""))
    if (!registered) await sleep(1_000)
  }
  say("goal command registered:", registered)
  if (!registered) throw new Error("plugin did not register /goal (see server.log)")

  const abort = new AbortController()
  void (async () => {
    for await (const event of client.event.subscribe({ signal: abort.signal })) {
      const data = (event as { data?: Record<string, any> }).data ?? {}
      if (data.sessionID && data.sessionID !== sessionID) continue
      switch (event.type) {
        case "session.execution.started":
        case "session.execution.succeeded":
          say(event.type)
          break
        case "session.execution.failed":
          say(event.type, JSON.stringify(data.error))
          break
        case "session.execution.interrupted":
          say(event.type, data.reason)
          break
        case "session.tool.called":
          say("  tool", JSON.stringify(data.input).slice(0, 120))
          break
        case "rpc.goal.notice":
          say(`NOTICE [${data.level}] ${data.title}: ${String(data.message).replace(/\s+/g, " ").slice(0, 200)}`)
          break
      }
    }
  })().catch(() => {})

  const goal = client.rpc(GoalRpc)
  await client.session.command({ sessionID, name: "goal", text: condition })
  say("/goal sent")

  const started = Date.now()
  let last: any
  let timedOut = false
  while (true) {
    if (Date.now() - started >= TIMEOUT_MS) {
      timedOut = true
      break
    }
    await sleep(3_000)
    last = ((await goal.get({ sessionID }, { location })) as { goal: any }).goal
    if (last && !["active"].includes(last.status)) break
  }
  abort.abort()
  // The exit code reflects the goal outcome and is frozen here; nothing after this point may flip it.
  exitCode = goalExitCode(last?.status)
  if (timedOut) say(`TIMEOUT after ${Math.round(TIMEOUT_MS / 60_000)} minutes; last known status: ${last?.status ?? "unknown"}`)
  say("final", JSON.stringify({ status: last?.status, turns: last?.turns, reason: last?.reason, spend: last?.spend, history: last?.history?.map((h: any) => `${h.turn}:${h.verdict}`) }))

  // Diagnostics (clear the goal, render the evaluator's digest, list the condition's files) are
  // best-effort: a failure here is reported but must not downgrade the goal's own exit code.
  try {
    const digest = renderTranscript(await client.session.context({ sessionID }), { maxChars: 60_000 })
    say(`digest: ${digest.length} chars`, JSON.stringify(digest.slice(0, 1500)))
    await client.session.command({ sessionID, name: "goal", text: "" })
    for (const file of ["notes/plan.md", "notes/done.txt"]) {
      const full = path.join(project, file)
      say(file, existsSync(full) ? JSON.stringify(readFileSync(full, "utf8")) : "(missing)")
    }
  } catch (error) {
    console.error("post-run diagnostics failed (goal result is unaffected):", error)
  }
} catch (error) {
  console.error(error)
} finally {
  killServer()
  log.end()
  // Give the log stream a bounded chance to flush before the process exits.
  await Promise.race([once(log, "finish"), sleep(2_000)]).catch(() => {})
  process.exit(exitCode)
}
