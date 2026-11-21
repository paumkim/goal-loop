import path from "node:path"
import type { Config } from "./types.ts"

/** Bundled prompt library: resolves from this source file to <package-root>/prompts. */
export const DEFAULT_PROMPT_LIBRARY = path.resolve(import.meta.dir, "..", "..", "prompts")

export const DEFAULT_CONFIG: Config = {
  backlog: "AUTONOMY.md",
  configFile: ".prompter/config.json",
  baseBranch: "dev",
  branchPrefix: "autonomy/",
  promptLibrary: DEFAULT_PROMPT_LIBRARY,
  prompts: ["maintenance/autonomous-maintainer.md"],
  plugin: "",
  maxTasksPerTick: 1,
  maxSpendUsd: 2,
  maxTokens: 500_000,
  maxWallMsPerTick: 30 * 60_000,
  maxWallMsPerTask: 20 * 60_000,
  pollMs: 5_000,
  verifyCommand: "",
  stopFiles: [],
  allowedRepos: [],
  requireCleanTree: true,
}

/** Terminal goal statuses from goal-loop (src/core/types.ts). */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["achieved", "impossible", "cleared", "failed"])
export const SUCCESS_STATUS = "achieved"

export const BACKLOG_TEMPLATE = `# Autonomy Backlog

Tasks here are picked up by \`prompter tick\`, one at a time, in file order.
Write one unchecked item per unit of work. Add details that make "done" verifiable.

<!-- prompter: add, edit, or remove lines freely. Status markers are managed by prompter. -->

- [ ] Example: add a regression test for the parser and prove it with \`bun test\`

## Notes
- Re-run a failed task: delete its \`<!-- prompter: ... -->\` marker and leave the box unchecked.
- A task marked \`in_review\` is left alone until you run \`prompter review\` and approve or reject it.
- \`prompter stop\` writes the global kill switch; \`prompter resume\` removes it.
`

export const CONFIG_TEMPLATE = {
  backlog: "AUTONOMY.md",
  baseBranch: "dev",
  branchPrefix: "autonomy/",
  promptLibrary: DEFAULT_PROMPT_LIBRARY,
  prompts: ["maintenance/autonomous-maintainer.md"],
  model: "",
  maxTasksPerTick: 1,
  maxSpendUsd: 2,
  maxTokens: 500000,
  maxWallMsPerTick: 1800000,
  maxWallMsPerTask: 1200000,
  pollMs: 5000,
  verifyCommand: "",
  requireCleanTree: true,
}
