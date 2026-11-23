/**
 * Shared fixtures for the headless render scripts. Not shipped (`scripts/` is not in package.json
 * `files`). The reduced-color flag and the verdict-trail mapper were repeated in four and two
 * fixtures respectively; one copy keeps the arms byte-identical.
 */
import type { GoalSnapshot, Verdict } from "../src/core/types.ts"

/** Ask for reduced color and set NO_COLOR before any component reads it. */
export const monoFlag = (args: readonly string[] = process.argv.slice(2)): boolean => {
  const mono = args.includes("--mono")
  if (mono) process.env.NO_COLOR = "1"
  return mono
}

/** A verdict trail at a fixed clock, so render frames are diffable across runs. */
export const verdicts = (list: Verdict[], now: number): GoalSnapshot["history"] =>
  list.map((verdict, index) => ({ turn: index + 1, verdict, reason: verdict === "met" ? "done" : "not yet", at: now - 1000 * 60 * (list.length - index), toolCalls: verdict === "met" ? 4 : 2 }))
