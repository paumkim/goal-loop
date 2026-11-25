import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { formatValue } from "../core/errors.ts"
import path from "node:path"
import { markBacklog, recordOutcome } from "./apply.ts"
import { parseBacklog, selectNextTask, summarizeBacklog, writeLineStatus } from "./backlog.ts"
import { isRepoAllowed, loadConfig } from "./config.ts"
import { BACKLOG_TEMPLATE, CONFIG_TEMPLATE, SUCCESS_STATUS } from "./defaults.ts"
import { runTask } from "./driver.ts"
import { addWorktree, aheadCount, branchExists, isRepo, tipAheadOf, trackedDirty } from "./git.ts"
import { readPromptBodies, buildObjective } from "./objective.ts"
import { approve, cleanupWorktree, reject, reviewLines } from "./review.ts"
import { describeStop, killSwitch, newBudget, noteUsage, stopReason } from "./safety.ts"
import { byStatus, loadState } from "./state.ts"
import { FINISHED_TASK_STATUSES, TASK_STATUSES, type BacklogLine, type Config, type TaskState } from "./types.ts"
import { globalStopFile, logPath, money, prompterHome, short, statePath, worktreeRoot } from "./util.ts"

const say = (...parts: unknown[]): void => console.log(parts.map((p) => String(p)).join(" "))
const die = (message: string): never => { console.error(`error: ${message}`); process.exit(1) }

const usage = (): string => `prompter — autonomous work loop with a human review gate

Usage:
  prompter init [repo]                 create AUTONOMY.md + config template (never overwrites)
  prompter tick [repo]                 run one reviewed unit of work (budget + kill switch apply)
  prompter status [repo]               show backlog, state, and active limits
  prompter review [repo]               list tasks awaiting your decision
  prompter approve <id> [repo] [--verify]   mark merged after proving the commit landed on base
  prompter reject <id> [reason]        abandon a reviewed task
  prompter stop                        write the global kill switch
  prompter resume                      remove the global kill switch
  prompter cleanup [repo]              remove stale worktree/branches of finished tasks`

interface Parsed {
  readonly command: string
  readonly positional: string[]
  readonly flags: Set<string>
  readonly repoFlag?: string
}

const parseArgs = (argv: string[]): Parsed => {
  const [command = "", ...rest] = argv
  const positional: string[] = []
  const flags = new Set<string>()
  let repoFlag: string | undefined
  for (const token of rest) {
    if (token.startsWith("--repo=")) { repoFlag = token.slice(7); continue }
    if (token.startsWith("--")) { flags.add(token); continue }
    positional.push(token)
  }
  return { command, positional, flags, ...(repoFlag ? { repoFlag } : {}) }
}

const resolveRepo = (parsed: Parsed): string => path.resolve(parsed.repoFlag ?? parsed.positional.at(-1) ?? process.cwd())

const ensureHome = (): void => {
  for (const dir of [prompterHome(), path.join(prompterHome(), "state"), path.join(prompterHome(), "worktree"), path.join(prompterHome(), "log")]) {
    mkdirSync(dir, { recursive: true })
  }
}

const readBacklogText = (repo: string, config: Config): string => {
  const file = path.resolve(repo, config.backlog)
  if (!existsSync(file)) die(`backlog ${file} not found — run 'prompter init ${repo}'`)
  return readFileSync(file, "utf8")
}

/** Recover records left `running` by a crashed tick into `interrupted`. */
const recoverRunning = (states: Map<string, TaskState>, repo: string, stateFile: string, text: string): string => {
  let updated = text
  for (const state of byStatus(states, "running")) {
    const line = parseBacklog(text).find((l) => l.id === state.id)
    if (line) updated = writeMarker(updated, line, "interrupted", state.id)
    recordOutcome(stateFile, {
      id: state.id, objective: state.objective, status: "interrupted", repo,
      branch: state.branch, worktree: state.worktree, reason: "recovered from a previous interrupted tick",
    })
  }
  return updated
}

const writeMarker = (text: string, line: BacklogLine, status: string, id: string): string =>
  writeLineStatus(text, line, status, id, false)

const tick = async (parsed: Parsed): Promise<void> => {
  const repo = resolveRepo(parsed)
  ensureHome()
  const config = loadConfig(repo)
  const stateFile = config.stateFile ?? statePath(repo)

  if (!isRepoAllowed(config, repo)) {
    die(`repo ${repo} is not in allowedRepos: ${config.allowedRepos.join(", ")}`)
  }
  const stoppedNow = killSwitch(config, repo, { exists: existsSync, env: process.env })
  if (stoppedNow) { say(`STOP: ${stoppedNow}`); return }

  if (!isRepo(repo)) die(`not a git repository: ${repo}`)
  if (!branchExists(repo, config.baseBranch)) die(`base branch '${config.baseBranch}' does not exist in ${repo}`)
  const dirty = trackedDirty(repo)
  if (config.requireCleanTree && dirty) die(`main checkout has ${dirty}; commit or stash them before ticking`)

  let backlogText = readBacklogText(repo, config)
  const states = loadState(stateFile)
  backlogText = recoverRunning(states, repo, stateFile, backlogText)
  if (backlogText !== readFileSync(path.resolve(repo, config.backlog), "utf8")) {
    writeFileSync(path.resolve(repo, config.backlog), backlogText, "utf8")
  }

  const pending = byStatus(states, "in_review")
  if (pending.length > 0) {
    say(`STOP: ${pending.length} task(s) awaiting review. Decide them before starting new work:`)
    say(reviewLines([...pending]))
    say(`Run 'prompter review ${repo}' then 'prompter approve <id>' or 'prompter reject <id>'.`)
    return
  }

  const budget = newBudget()
  const controller = new AbortController()
  const onSignal = (): void => controller.abort()
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)

  say(`tick ${repo}`)
  say(`limits ${describeStop(config)}`)
  say(`log   ${logPath(repo)}`)

  try {
    for (let i = 0; i < config.maxTasksPerTick; i++) {
      const reason = stopReason(config, repo, { exists: existsSync, env: process.env }, budget, () => controller.signal.aborted)
      if (reason) { say(`STOP: ${reason}`); break }

      const lines = parseBacklog(backlogText)
      const task = selectNextTask(lines, loadState(stateFile))
      if (!task) { say("backlog has no unattempted tasks"); break }

      const branch = `${config.branchPrefix}${task.id}`
      const worktree = path.join(worktreeRoot(repo), task.id)
      say(`task  ${task.id}  ${short(task.objective)}`)
      say(`branch ${branch}`)

      if (branchExists(repo, branch)) {
        const msg = `branch ${branch} already exists — delete it or run 'prompter cleanup ${repo}'`
        failTask(task, repo, config, stateFile, branch, worktree, msg)
        say(`STOP: ${msg}`)
        break
      }
      const added = addWorktree(repo, worktree, branch, config.baseBranch)
      if (!added.ok) {
        const msg = `could not create worktree: ${short(added.stderr || added.stdout)}`
        failTask(task, repo, config, stateFile, branch, worktree, msg)
        say(`STOP: ${msg}`)
        break
      }

      recordOutcome(stateFile, {
        id: task.id, objective: task.objective, status: "running", repo, branch, worktree,
      })

      const { bodies, missing } = readPromptBodies(config)
      for (const file of missing) say(`warn: prompt not found: ${file}`)
      const objective = buildObjective({
        objective: task.objective, branch, baseBranch: config.baseBranch, worktree, promptBodies: bodies,
      })

      const result = await awaitRunTask(repo, worktree, config, objective, controller.signal, () =>
        stopReason(config, repo, { exists: existsSync, env: process.env }, budget, () => controller.signal.aborted),
      )
      noteUsage(budget, result.costUsd, result.tokens)
      say(`goal  ${result.status}  turns=${result.turns}  cost=${money(result.costUsd)}  ${short(result.reason, 200)}`)

      if (result.status === SUCCESS_STATUS) {
        const commit = tipAheadOf(repo, config.baseBranch, branch)
        const count = aheadCount(repo, config.baseBranch, branch)
        if (!commit || count === 0) {
          const msg = "goal achieved but no commit ahead of base was found on the task branch"
          failTask(task, repo, config, stateFile, branch, worktree, msg)
          say(`STOP: ${msg}`)
          break
        }
        recordOutcome(stateFile, {
          id: task.id, objective: task.objective, status: "in_review", repo, branch, worktree,
          commit, turns: result.turns, costUsd: result.costUsd, tokens: result.tokens, goalStatus: result.status,
          reason: result.reason || "goal achieved; awaiting human review",
        })
        const freshLines = parseBacklog(readFileSync(path.resolve(repo, config.backlog), "utf8"))
        const fresh = freshLines.find((l) => l.id === task.id)
        if (fresh) markBacklog(repo, config, fresh, "in_review", task.id, false)
        say(`REVIEW: commit ${commit.slice(0, 12)} on ${branch}`)
        say(`  prompter review ${repo}`)
        say(`  prompter approve ${task.id} ${repo}   # after merging into ${config.baseBranch}`)
        say("STOP: one unit at a time — review it before the next tick")
        break
      }

      const msg = result.reason || `goal ended as ${result.status}`
      failTask(task, repo, config, stateFile, branch, worktree, msg, result.status, result.turns, result.costUsd, result.tokens)
      say(`STOP: ${msg}`)
      break
    }
  } finally {
    process.removeListener("SIGINT", onSignal)
    process.removeListener("SIGTERM", onSignal)
  }
  say(`done: ${describeStop(config)} · spent ${money(budget.costUsd)} · ${budget.tasks} task(s)`)
}

const failTask = (
  task: BacklogLine, repo: string, config: Config, stateFile: string, branch: string, worktree: string,
  reason: string, goalStatus?: string, turns?: number, costUsd?: number, tokens?: number,
): void => {
  recordOutcome(stateFile, {
    id: task.id, objective: task.objective, status: "failed", repo, branch, worktree, reason,
    ...(goalStatus ? { goalStatus } : {}), ...(turns !== undefined ? { turns } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}), ...(tokens !== undefined ? { tokens } : {}),
  })
  const line = parseBacklog(readFileSync(path.resolve(repo, config.backlog), "utf8")).find((l) => l.id === task.id)
  if (line) markBacklog(repo, config, line, "failed", task.id, false)
  say(`failed: ${task.id} ${reason}`)
}

/** Promise wrapper kept separate so `tick` reads linearly. */
const awaitRunTask = (
  repo: string, worktree: string, config: Config, objective: string, signal: AbortSignal, shouldStop: () => string | undefined,
) => runTask({ repo, worktree, config, objective, signal, shouldStop, onLog: (line) => say(`  ${line}`) })

// --- CLI dispatch -----------------------------------------------------------

const main = async (): Promise<void> => {
  const parsed = parseArgs(process.argv.slice(2))
  switch (parsed.command) {
    case "init": {
      const repo = resolveRepo(parsed)
      ensureHome()
      const dir = path.join(repo, ".prompter")
      mkdirSync(dir, { recursive: true })
      const backlog = path.join(repo, "AUTONOMY.md")
      if (!existsSync(backlog)) { writeFileSync(backlog, BACKLOG_TEMPLATE, "utf8"); say(`created ${backlog}`) }
      else say(`kept   ${backlog}`)
      const configFile = path.join(dir, "config.json")
      if (!existsSync(configFile)) {
        writeFileSync(configFile, `${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`, "utf8")
        say(`created ${configFile}`)
      } else say(`kept   ${configFile}`)
      say(`state  ${statePath(repo)}`)
      say("next: edit AUTONOMY.md, then 'prompter tick'")
      return
    }
    case "tick":
      await tick(parsed)
      return
    case "status": {
      const repo = resolveRepo(parsed)
      const config = loadConfig(repo)
      const states = loadState(config.stateFile ?? statePath(repo))
      say(`repo    ${repo}`)
      say(`base    ${config.baseBranch}   backlog ${config.backlog}`)
      say(`limits  ${describeStop(config)}`)
      say(`stop    ${killSwitch(config, repo, { exists: existsSync, env: process.env }) ?? "clear"}`)
      say(`states  ${TASK_STATUSES.map((s) => `${s}=${byStatus(states, s).length}`).join("  ")}`)
      say("backlog:")
      say(summarizeBacklog(parseBacklog(readBacklogText(repo, config)), states))
      return
    }
    case "review": {
      const repo = resolveRepo(parsed)
      const config = loadConfig(repo)
      const states = loadState(config.stateFile ?? statePath(repo))
      say(reviewLines([...states.values()]))
      return
    }
    case "approve": {
      const id = parsed.positional[0]
      const repo = resolveRepo({ ...parsed, positional: parsed.positional.slice(1) })
      if (!id) throw new Error("usage: prompter approve <id> [repo] [--verify]")
      const config = loadConfig(repo)
      const state = loadState(config.stateFile ?? statePath(repo)).get(id)
      if (!state) throw new Error(`unknown task id: ${formatValue(id)}`)
      const result = approve(state, config, repo, config.stateFile ?? statePath(repo), { exists: existsSync, env: process.env }, { runVerify: parsed.flags.has("--verify") })
      say(result.message)
      if (!result.ok) process.exitCode = 1
      return
    }
    case "reject": {
      const id = parsed.positional[0]
      if (!id) throw new Error("usage: prompter reject <id> [reason] [--repo path]")
      const rest = parsed.positional.slice(1)
      const repo = path.resolve(parsed.repoFlag ?? process.cwd())
      const reason = rest.join(" ")
      const config = loadConfig(repo)
      const state = loadState(config.stateFile ?? statePath(repo)).get(id)
      if (!state) throw new Error(`unknown task id: ${formatValue(id)}`)
      const result = reject(state, config, repo, config.stateFile ?? statePath(repo), reason)
      say(result.message)
      if (!result.ok) process.exitCode = 1
      return
    }
    case "stop": {
      ensureHome()
      const file = globalStopFile()
      writeFileSync(file, `stopped ${new Date().toISOString()}\n`, "utf8")
      say(`kill switch written: ${file}`)
      return
    }
    case "resume": {
      const file = globalStopFile()
      if (existsSync(file)) { rmSync(file); say(`kill switch removed: ${file}`) }
      else say("no kill switch present")
      return
    }
    case "cleanup": {
      const repo = resolveRepo(parsed)
      const config = loadConfig(repo)
      const states = loadState(config.stateFile ?? statePath(repo))
      let removed = 0
      for (const state of states.values()) {
        if (FINISHED_TASK_STATUSES.includes(state.status)) {
          // cleanupWorktree checks the worktree and branch independently — reach it even when only a stale
          // branch remains (e.g. the worktree was removed by hand or by the OS).
          const notes = cleanupWorktree(repo, state)
          say(`cleaned ${state.id}${notes.length ? ` (${notes.join("; ")})` : ""}`)
          removed++
        }
      }
      say(`removed ${removed} stale worktree(s)`)
      return
    }
    default:
      say(usage())
  }
}

main().catch((error: unknown) => die(error instanceof Error ? error.message : String(error)))
