import type { BudgetState, Config } from "./types.ts"
import { globalStopFile, localStopFile, money, short } from "./util.ts"

export interface StopDeps {
  readonly exists: (p: string) => boolean
  readonly env: NodeJS.ProcessEnv
}

/** Return the reason the loop must stop, or undefined when it may continue. */
export const killSwitch = (config: Config, repo: string, deps: StopDeps): string | undefined => {
  const env = deps.env.PROMPTER_STOP
  if (env && !["0", "false", "off", "no"].includes(env.trim().toLowerCase())) {
    return `kill switch: PROMPTER_STOP=${env}`
  }
  const paths = [globalStopFile(), localStopFile(repo), ...config.stopFiles]
  for (const p of paths) {
    if (deps.exists(p)) return `kill switch: ${p} exists`
  }
  return undefined
}

export const newBudget = (now = Date.now()): BudgetState => ({ tasks: 0, costUsd: 0, tokens: 0, startedAt: now })

export const noteUsage = (budget: BudgetState, costUsd: number, tokens: number): void => {
  budget.tasks += 1
  budget.costUsd += Number.isFinite(costUsd) ? costUsd : 0
  budget.tokens += Number.isFinite(tokens) ? tokens : 0
}

/** Budget / wall-clock stop reason, or undefined. */
export const budgetStop = (config: Config, budget: BudgetState, now = Date.now()): string | undefined => {
  if (budget.tasks >= config.maxTasksPerTick) {
    return `budget: ${budget.tasks}/${config.maxTasksPerTick} tasks this tick`
  }
  if (config.maxSpendUsd > 0 && budget.costUsd >= config.maxSpendUsd) {
    return `budget: spent ${money(budget.costUsd)} of ${money(config.maxSpendUsd)}`
  }
  if (config.maxTokens > 0 && budget.tokens >= config.maxTokens) {
    return `budget: ${budget.tokens}/${config.maxTokens} tokens this tick`
  }
  const elapsed = now - budget.startedAt
  if (elapsed >= config.maxWallMsPerTick) {
    return `budget: ${Math.round(elapsed / 1000)}s wall clock this tick`
  }
  return undefined
}

/** Combined gate used before starting a task and on every poll. */
export const stopReason = (
  config: Config,
  repo: string,
  deps: StopDeps,
  budget: BudgetState,
  aborted: () => boolean,
  now = Date.now(),
): string | undefined => {
  if (aborted()) return "stopped: signal received"
  return killSwitch(config, repo, deps) ?? budgetStop(config, budget, now)
}

export const describeStop = (config: Config): string =>
  short(`maxTasks=${config.maxTasksPerTick} maxSpend=${money(config.maxSpendUsd)} maxTokens=${config.maxTokens} ` +
    `tick=${Math.round(config.maxWallMsPerTick / 60_000)}m task=${Math.round(config.maxWallMsPerTask / 60_000)}m`)
