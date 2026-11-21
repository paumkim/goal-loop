/**
 * The evaluator as a first-class agent type shipped by the plugin.
 *
 * A verdict is produced by a real OpenCode child session of this agent, created with `parentID` so it shows up
 * in the terminal like any other delegated subagent. This module is the single source of truth for the agent's
 * id, its task label and its system prompt; the long evidence matrix / output contract stays in the per-verdict
 * rubric (core/prompts.ts), byte-identical.
 */

export const EVALUATOR_AGENT_ID = "evaluator"
export const EVALUATOR_AGENT_TITLE = "evaluator"

/** The exact prefix the host's own `subagent` tool prepends to every delegated prompt. */
export const SUBAGENT_PROMPT_PREFIX = "You are a subagent spawned by another session.\n"

/**
 * Identity prompt for the `evaluator` agent. Kept short and role-focused on purpose: applying the rubric clause
 * by clause and emitting the verdict object are the per-turn prompt's job. The judge has no tools (deny-all
 * permissions plus the generate hook), so asking it to run commands would only produce an empty reply.
 */
export const EVALUATOR_SYSTEM_PROMPT = `You are the Evaluator, a subagent shipped by the goal-loop plugin. Your only job is to decide whether the armed completion condition holds.

You receive one evaluation request with the condition, harness facts, a rubric and the evidence transcript. Judge solely from that evidence. You have no tools and cannot run commands or read files.

- Credit only fresh evidence visible at the current HEAD. Narration, prior verdicts and absence of failure are not proof.
- Apply the rubric clause by clause, name material gaps or contradictions, and never invent evidence.
- Answer with exactly one JSON object in the form the rubric requires — no preamble, no prose, no questions.`
