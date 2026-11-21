import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import type { Config } from "./types.ts"

/** Read workflow prompts from the library. Missing files are reported, not fatal. */
export const readPromptBodies = (config: Config): { bodies: string[]; missing: string[] } => {
  const bodies: string[] = []
  const missing: string[] = []
  for (const rel of config.prompts) {
    const file = path.resolve(config.promptLibrary, rel)
    if (!existsSync(file)) {
      missing.push(file)
      continue
    }
    bodies.push(readFileSync(file, "utf8").trim())
  }
  return { bodies, missing }
}

export interface ObjectiveInput {
  readonly objective: string
  readonly branch: string
  readonly baseBranch: string
  readonly worktree: string
  readonly promptBodies: readonly string[]
}

/** Build the /goal condition. The evaluator judges only the <condition> block. */
export const buildObjective = (input: ObjectiveInput): string => {
  const workflow = input.promptBodies.length > 0
    ? input.promptBodies.map((body, i) => `### Workflow ${i + 1}\n${body}`).join("\n\n")
    : "Use the repository's own conventions and checks."

  return `<prompter-task>
${input.objective}
</prompter-task>

<workflow-guidance>
The blocks below describe how to work. They are guidance, not the completion condition.
${workflow}
</workflow-guidance>

<constraints>
- Your current working directory is an isolated git worktree. Work only there.
- You are already on branch \`${input.branch}\`, created from \`${input.baseBranch}\`. Stay on it.
- NEVER commit to \`${input.baseBranch}\` or \`main\`, NEVER merge, NEVER push, NEVER force-push,
  NEVER reset, NEVER rebase, and NEVER run destructive git commands.
- Stage explicit paths only (never \`git add -A\` / \`git add .\`). Do not touch files outside this worktree.
- Run the repository's required checks before declaring done. If a check fails, fix the cause; never
  skip, weaken, or delete tests or guards.
- Commit your change on \`${input.branch}\` with a clear message. Leave the branch and worktree in place
  for human review. Do NOT merge it yourself.
- Quote the exact commit hash and the check output in your final message as evidence.
</constraints>

<condition>
The prompter task is fully implemented and verified in this worktree. All required checks pass.
The change is committed on branch \`${input.branch}\` (a commit ahead of \`${input.baseBranch}\`), the commit hash is
visible in the transcript, the worktree has no tracked changes, and NO merge or push was performed.
</condition>`
}
