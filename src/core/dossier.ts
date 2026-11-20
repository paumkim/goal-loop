/**
 * Pure builder behind the `goal.dossier.copy` palette command: renders the record the
 * TUI snapshot carries as one self-contained Markdown document — the loop's objective,
 * armed/elapsed, per-iteration ledger (turns/tools/sha/spend/context), the per-turn
 * verdict trail with the evaluator's full reasons, the boundary-compaction state, and
 * the verify gate's last word. No I/O, no JSX, no theme; unit-tested in `test/dossier.test.ts`.
 *
 * Honesty rules, same as the rest of the plugin: a measurement the record does not carry
 * is printed as "—", never estimated; free text (condition, summaries, reasons, verify
 * tail) is quoted, fenced, or blockquote-prefixed so it can never forge document
 * structure; the session id is deliberately omitted so a pasted dossier leaks nothing
 * about where it came from.
 */
import { COMPACT_MISS_CAP } from "./types.ts"
import type { GoalSnapshot, LoopEntry, UsageSnapshot, VerdictEntry } from "./types.ts"
import { formatCost, formatDuration, formatSpend, formatTokens, statusLabel } from "./format.ts"
import { iterationDurations, loopTotals, verdictCounts } from "./history.ts"

/** Em-dash gap marker — the one thing every absent measurement renders as. */
export const GAP = "—"

/** ISO-8601 UTC for a timestamp; non-finite or unrepresentable input renders the gap, never a guess. */
export const isoOf = (ms: number): string => {
  if (!Number.isFinite(ms)) return GAP
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? GAP : date.toISOString()
}

/**
 * ISO-8601 UTC for a generated stamp line. A non-finite or unrepresentable clock stamps the epoch
 * rather than throwing — the generated artifacts promise a stamp, never a guess. Matches the
 * file-name builders' posture.
 */
export const stampOf = (ms: number): string => {
  const date = new Date(Number.isFinite(ms) ? ms : 0)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

/** First 7 chars of a hex sha; non-hex shas (legacy/odd writers) print whole rather than invented. */
export const shortSha = (sha: string | undefined): string => {
  if (!sha) return GAP
  const flat = sha.trim()
  if (flat.length === 0) return GAP
  return flat.length > 7 ? flat.slice(0, 7) : flat
}

/** Inline-code fence that outgrows any backtick run inside the text. */
export const inlineCode = (text: string): string => {
  let longest = 0
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  if (longest === 0) return `\`${text}\``
  const fence = "`".repeat(longest + 1)
  return `${fence} ${text} ${fence}`
}

/** Fenced code block whose fence outgrows any ``` run inside the payload. Returns the block's lines. */
export const fenceBlock = (text: string): string[] => {
  let longest = 2
  for (const run of text.match(/`{3,}/g) ?? []) longest = Math.max(longest, run.length)
  const fence = "`".repeat(longest + 1)
  const body = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n")
  return [fence, ...body, fence]
}

/** Blockquote-prefix every line; empty lines become a bare `>` so the quote never breaks. */
export const quote = (text: string): string[] => {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  return lines.map((line) => (line.trim().length === 0 ? ">" : `> ${line}`))
}

/** Spend cell for tables and ledgers: "$0.42" style, gap when unmeasured. */
const spendCell = (spend: UsageSnapshot | undefined): string =>
  spend && Number.isFinite(spend.cost) && spend.cost > 0 ? formatCost(spend.cost) : GAP

/** Per-iteration ledger join; warps nothing, drops nothing. */
const iterationLines = (entry: LoopEntry, spanMs: number): string[] => {
  const lines = [
    `### Iteration v${entry.version} — met`,
    "",
    `- Ended: ${isoOf(entry.endedAt)}${spanMs > 0 ? ` (wall span ${formatDuration(spanMs)})` : ""}`,
    `- Turns: ${entry.turns} · Tool calls: ${entry.toolCalls ?? GAP}`,
    `- Commit: ${shortSha(entry.sha)}`,
    `- Context at arm: ${entry.contextTokens !== undefined && Number.isFinite(entry.contextTokens) ? `~${formatTokens(entry.contextTokens)} tokens` : GAP}`,
    `- Spend: ${entry.spend ? formatSpend(entry.spend) : GAP}`,
  ]
  lines.push(`- Summary:`, "", ...quote(entry.summary), "")
  lines.push(`- Evaluator reason:`, "", ...quote(entry.reason))
  return lines
}

const verifyCell = (entry: VerdictEntry): string => {
  const m = entry.verification
  if (m) {
    const req = m.checks.filter((c) => c.required)
    const pass = req.filter((c) => c.pass && c.scoped).length
    const label = `${pass}/${req.length || m.checks.length} ${m.pass ? "pass" : "fail"}`
    const extras: string[] = []
    if (m.timing?.reused) extras.push(`reused ${m.timing.reused}`)
    if (m.timing?.parallel) extras.push(`parallel x${m.timing.concurrency}`)
    const suffix = extras.length ? `, ${extras.join(", ")}` : ""
    return m.broadGoal ? `${label} (broad${suffix})` : `${label}${suffix ? ` (${extras.join(", ")})` : ""}`
  }
  const verify = entry.verify
  if (!verify) return GAP
  if (verify.timedOut) return "timeout"
  if (verify.code === null) return "error"
  return `exit ${verify.code}`
}

const matrixCheckLine = (check: NonNullable<VerdictEntry["verification"]>["checks"][number]): string => {
  const result = !check.scoped && check.required ? "unscoped" : check.pass ? "pass" : check.skipped ? "skipped" : check.timedOut ? "timeout" : check.code === null ? "error/unavailable" : `exit ${check.code}`
  const bits = [
    check.id,
    check.type,
    check.required ? "required" : "optional",
    `source=${check.source ?? "configured"}`,
    `mode=${check.executionMode ?? check.runState ?? check.evidenceMode ?? "command"}`,
    result,
  ]
  if (check.label) bits.push(`label=${check.label}`)
  if (check.reused) bits.push("reused")
  if (check.parallel) bits.push(`parallel${check.concurrency ? `@${check.concurrency}` : ""}`)
  if (typeof check.durationMs === "number") bits.push(`${check.durationMs}ms`)
  return bits.join(" · ")
}

/** One row per evaluated turn in the verdict trail. */
const verdictTable = (history: readonly VerdictEntry[]): string[] => {
  const lines = [
    "| turn | verdict | tools | commit | spend | verify |",
    "| ---: | --- | ---: | --- | --- | --- |",
  ]
  for (const entry of history) {
    const tools = entry.toolCalls ?? GAP
    lines.push(
      `| ${entry.turn} | ${entry.verdict} | ${tools} | ${shortSha(entry.sha)} | ${spendCell(entry.spend)} | ${verifyCell(entry)} |`,
    )
  }
  return lines
}

/** Full evaluator prose, one blockquote per evaluated turn — the part a table cannot carry. */
const verdictProse = (history: readonly VerdictEntry[]): string[] => {
  const lines: string[] = []
  for (const entry of history) {
    const bits = [`turn ${entry.turn}`, entry.verdict, isoOf(entry.at)]
    if (entry.toolCalls !== undefined) bits.push(`${entry.toolCalls} tool${entry.toolCalls === 1 ? "" : "s"}`)
    if (entry.sha) bits.push(shortSha(entry.sha))
    if (entry.verification) {
      const req = entry.verification.checks.filter((c) => c.required).length
      const t = entry.verification.timing
      const timing = t ? `, ${t.totalMs}ms${t.parallel ? ` parallel x${t.concurrency}` : ""}${t.reused ? ` reused ${t.reused}` : ""}` : ""
      bits.push(`matrix ${entry.verification.profile}${entry.verification.broadGoal ? "/broad" : ""} ${entry.verification.pass ? "pass" : "fail"} (${req} required${timing})`)
    } else if (entry.verify) {
      const v = entry.verify
      const state = v.timedOut ? "timeout" : v.code === null ? "error" : `exit ${v.code}`
      bits.push(`verify ${state} ${inlineCode(v.command)}`)
    }
    lines.push(`- ${bits.join(" · ")}`)
    lines.push(...quote(entry.reason))
    if (entry.verification) {
      const m = entry.verification
      lines.push(...quote(`verification matrix checks (profile=${m.profile}, broad=${m.broadGoal}, deterministic coverage enforced):`))
      if (m.coverageReasons?.length) lines.push(...quote(`coverage reasons: ${m.coverageReasons.join("; ")}`))
      if (m.timing) lines.push(...quote(`timing: total ${m.timing.totalMs}ms, concurrency ${m.timing.concurrency}, executed ${m.timing.executed}, reused ${m.timing.reused}, skipped ${m.timing.skipped}, parallel ${m.timing.parallel}`))
      for (const check of m.checks) {
        lines.push(...quote(`- ${matrixCheckLine(check)} cmd=${check.command}`))
        if (check.scopeDecision) lines.push(...quote(`  scope decision: ${check.scopeDecision}`))
        if (check.artifactPatterns?.length) lines.push(...quote(`  artifact patterns: ${check.artifactPatterns.join(" || ")}`))
        if (check.artifactMatched?.length) lines.push(...quote(`  artifact matched: ${check.artifactMatched.join(" || ")}`))
        if (check.artifactMissing?.length) lines.push(...quote(`  artifact missing: ${check.artifactMissing.join(" || ")}`))
        if (check.reason) lines.push(...quote(`  reason: ${check.reason}`))
        if (check.nextAction && !check.pass) lines.push(...quote(`  next action: ${check.nextAction}`))
        if (check.tail) lines.push(...quote(`  evidence/output tail:\n${check.tail}`))
      }
      if (m.missing.length) lines.push(...quote(`missing/unscoped/failed required checks: ${m.missing.join(", ")}`))
      if (m.malformedGoalChecks?.length) lines.push(...quote(`malformed goal-declared directives ignored (never executed): ${m.malformedGoalChecks.map((x) => `${x.raw} (${x.reason})`).join("; ")}`))
    } else if (entry.verify?.tail) {
      lines.push(...quote(`verify output tail:\n${entry.verify.tail}`))
    }
  }
  return lines
}

/**
 * Re-anchor honesty: the persisted record keeps only the count (the card paints it as `⟲ N`).
 * Which turns were re-anchored and what the re-anchored prompt said are not logged anywhere, so
 * the section says exactly that — a count is reported, never dressed up as a history. Non-finite or
 * sub-zero counts (legacy/corrupt snapshots) render as the absent case, never as a guess.
 */
const reanchorLines = (goal: GoalSnapshot): string[] => {
  const count = goal.reanchorCount
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) {
    return ["No post-compaction re-anchors on this record. (The record keeps only the count; a re-anchor re-states the objective through the system prompt after a boundary compaction so the loop does not drift.)"]
  }
  return [
    `- Re-anchors armed: ${count}`,
    "- What is recorded: the count alone. Which turns were re-anchored and what the re-anchored prompt said are not logged anywhere; nothing here was re-verified.",
  ]
}

const boundaryCompactLines = (goal: GoalSnapshot, nowMs: number): string[] => {
  const compact = goal.loopCompact
  if (!compact) {
    return [
      "No boundary-compaction request on this record. (The record keeps only the latest request; earlier ones are not logged anywhere.)",
    ]
  }
  const lines = [
    `- Latest request: ${isoOf(compact.requestedAt)} for iteration ${compact.iteration} (${formatDuration(Math.max(0, nowMs - compact.requestedAt))} ago)`,
    `- Context at request: ${compact.estimatedTokens !== undefined && Number.isFinite(compact.estimatedTokens) ? `~${formatTokens(compact.estimatedTokens)} tokens` : "unknown (unestimable arm)"}`,
  ]
  if (compact.landedAt) {
    lines.push(`- Outcome: landed at ${isoOf(compact.landedAt)} (${formatDuration(Math.max(0, nowMs - compact.landedAt))} ago)`)
  } else {
    lines.push(`- Outcome: pending · miss ${compact.misses}/${COMPACT_MISS_CAP}`)
  }
  if (compact.unmeasurableTicks !== undefined && compact.unmeasurableTicks > 0)
    lines.push(`- Unestimable arms in a row: ${compact.unmeasurableTicks} (never a miss; a landing cannot be ruled out)`)
  if (compact.stalenessUnknown) lines.push(`- Landing unresolvable: repeated unmeasurable arms; this request is never suspended.`)
  if (compact.unwillingWarned) lines.push(`- Host-unwilling warning fired: two measurable arms without a landing.`)
  return lines
}

const verifyLines = (goal: GoalSnapshot): string[] => {
  const matrix = goal.lastVerification
  if (matrix) {
    const req = matrix.checks.filter((c) => c.required)
    const passed = req.filter((c) => c.pass && c.scoped).length
    const lines = [
      `- Matrix profile: ${matrix.profile}${matrix.broadGoal ? " (broad goal)" : ""}`,
      `- Result: ${matrix.pass ? "pass" : "fail"} · ${passed}/${req.length} required checks satisfied · ${isoOf(matrix.at)}`,
    ]
    if (matrix.timing) lines.push(`- Timing: total ${matrix.timing.totalMs}ms, concurrency ${matrix.timing.concurrency}, executed ${matrix.timing.executed}, reused ${matrix.timing.reused}, skipped ${matrix.timing.skipped}, parallel ${matrix.timing.parallel}`)
    if (matrix.coverageReasons?.length) lines.push(`- Coverage reasons: ${matrix.coverageReasons.join("; ")}`)
    if (matrix.missing.length) lines.push(`- Missing/unscoped/failed required checks: ${matrix.missing.join(", ")}`)
    if (matrix.malformedGoalChecks?.length) lines.push(`- Malformed goal-declared directives ignored (never executed): ${matrix.malformedGoalChecks.map((x) => `${x.raw} (${x.reason})`).join("; ")}`)
    lines.push("- Checks:")
    for (const check of matrix.checks) {
      lines.push(`  - ${matrixCheckLine(check)} cmd=${inlineCode(check.command)}`)
      if (check.scopeDecision) lines.push(`    - scope decision: ${check.scopeDecision}`)
      if (check.artifactPatterns?.length) lines.push(`    - artifact patterns: ${check.artifactPatterns.join(" || ")}`)
      if (check.artifactMatched?.length) lines.push(`    - artifact matched: ${check.artifactMatched.join(" || ")}`)
      if (check.artifactMissing?.length) lines.push(`    - artifact missing: ${check.artifactMissing.join(" || ")}`)
      if (check.reason) lines.push(`    - reason: ${check.reason}`)
      if (check.nextAction && !check.pass) lines.push(`    - next action: ${check.nextAction}`)
      if (check.tail) {
        lines.push("    - evidence/output tail:")
        lines.push(...fenceBlock(check.tail).map((l) => `      ${l}`))
      }
    }
    return lines
  }
  const verify = goal.lastVerify
  if (!verify) {
    return [
      "No verify gate result on this record. (The gate runs only after a `met` verdict, and only when verification is configured.)",
    ]
  }
  const result = verify.timedOut
    ? "timed out"
    : verify.code === null
      ? "no exit code (spawn error or timeout)"
      : `exit ${verify.code}`
  const lines = [`- Command: ${inlineCode(verify.command)}`, `- Result: ${result} · ${isoOf(verify.at)}`]
  if (verify.tail) {
    lines.push("- Output tail:", "")
    lines.push(...fenceBlock(verify.tail))
  } else {
    lines.push("- Output tail: (none — the command produced no output)")
  }
  return lines
}

/**
 * The whole dossier. Deterministic: the same record and the same clock render the same
 * document, byte for byte. `nowMs` is the caller's clock — nothing here reads Date.now().
 */
export function buildLoopDossier(goal: GoalSnapshot, nowMs: number): string {
  const lines: string[] = []
  const isLoop = Boolean(goal.loopEnabled)
  const generatedAt = isoOf(nowMs)

  lines.push(isLoop ? "# Goal loop dossier" : "# Goal dossier")
  lines.push("")
  lines.push(
    `_Generated ${generatedAt} from the goal-loop plugin's record. Everything below is the record's own bookkeeping; a measurement it does not carry renders as ${GAP}, never estimated. The session id is omitted on purpose._`,
  )
  lines.push("")

  // ---- Objective
  lines.push(isLoop ? "## Objective" : "## Condition")
  lines.push("")
  lines.push(...quote(isLoop ? (goal.loopObjective ?? goal.condition) : goal.condition))
  lines.push("")

  // ---- Status
  lines.push("## Status")
  lines.push("")
  const statusBits = [statusLabel(goal.status)]
  if (goal.pauseCause) statusBits.push(`paused: ${goal.pauseCause}`)
  if (goal.failureLabel) statusBits.push(`failure: ${goal.failureLabel}`)
  lines.push(`- Status: ${statusBits.join(" · ")}`)
  lines.push(`- Set: ${isoOf(goal.setAt)} · ${goal.endedAt ? `Ended: ${isoOf(goal.endedAt)} · ` : ""}Elapsed: ${formatDuration(Math.max(0, goal.elapsedMs))}`)
  const turnsBits = [`${goal.turns} turn${goal.turns === 1 ? "" : "s"} evaluated`]
  if (goal.stall > 0) turnsBits.push(`stall ${goal.stall}`)
  if (goal.retries > 0) turnsBits.push(`retries ${goal.retries}`)
  lines.push(`- ${turnsBits.join(" · ")}`)
  if (goal.contextSize !== undefined && Number.isFinite(goal.contextSize)) {
    const threshold =
      goal.compactAtTokens !== undefined && goal.compactAtTokens > 0
        ? ` of ~${formatTokens(goal.compactAtTokens)} auto-compact threshold`
        : ""
    lines.push(`- Context (est.): ~${formatTokens(goal.contextSize)} tokens${threshold}`)
  }
  if (goal.spend) lines.push(`- Spend (this goal): ${formatSpend(goal.spend)}`)
  if (isLoop) {
    const iteration = goal.loopIteration ?? 1
    const max = goal.loopMaxLoops !== undefined && goal.loopMaxLoops > 0 ? ` of at most ${goal.loopMaxLoops}` : ""
    lines.push(`- Iteration: ${iteration}${max}`)
    if (goal.loopNotProgress !== undefined && goal.loopNotProgress > 0)
      lines.push(`- Consecutive zero-tool iterations: ${goal.loopNotProgress}`)
  }
  if (goal.reason) {
    lines.push(`- Reason:`)
    lines.push(...quote(goal.reason))
  }
  lines.push("")

  // ---- Iterations
  const entries = goal.loopHistory ?? []
  const dropped = goal.loopHistoryDropped ?? 0
  if (isLoop || entries.length > 0) {
    lines.push(dropped > 0 ? `## Completed iterations (${entries.length} most recent of ${entries.length + dropped})` : `## Completed iterations (${entries.length})`)
    if (dropped > 0) lines.push(`_${dropped} earlier iteration record${dropped === 1 ? "" : "s"} dropped by the loop-history retention cap; the rows and totals below cover the retained iterations only — the dropped ones are not $0.00, they are unknown._`)
    lines.push("")
    if (entries.length === 0) {
      lines.push("None yet — this loop has not landed an iteration.")
      lines.push("")
    } else {
      const spans = iterationDurations(entries, goal.setAt)
      entries.forEach((entry, index) => {
        lines.push(...iterationLines(entry, spans[index] ?? 0))
        lines.push("")
      })
    }
  }

  // ---- Verdict trail
  const history = goal.history ?? []
  const historyDropped = goal.historyDropped ?? 0
  const totalTrail = history.length + historyDropped
  lines.push(historyDropped > 0 ? `## Verdict trail (${history.length} most recent of ${totalTrail} evaluated turns)` : `## Verdict trail (${history.length} evaluated turn${history.length === 1 ? "" : "s"})`)
  if (historyDropped > 0) lines.push(`_${historyDropped} earlier verdict${historyDropped === 1 ? "" : "s"} dropped by the verdict-trail retention cap; the tallies and rows below cover the retained turns only — the dropped ones are unknown, never inferred._`)
  lines.push("")
  if (history.length === 0) {
    lines.push("No turns have been evaluated yet.")
    lines.push("")
  } else {
    lines.push(...verdictTable(history))
    lines.push("")
    const counts = verdictCounts(history)
    const zeroToolMet = history.filter((entry) => entry.verdict === "met" && entry.toolCalls === 0).length
    const tally = [`met ${counts.met}`, `not_met ${counts.not_met}`, `impossible ${counts.impossible}`]
    if (zeroToolMet > 0) tally.push(`${zeroToolMet} met with zero tool calls (condition already held at HEAD)`)
    lines.push(historyDropped > 0 ? `Tallies: ${tally.join(" · ")} · retained turns only` : `Tallies: ${tally.join(" · ")}`)
    lines.push("")
    lines.push(...verdictProse(history))
    lines.push("")
  }

  // ---- Boundary compaction
  lines.push("## Boundary compaction")
  lines.push("")
  lines.push(...boundaryCompactLines(goal, nowMs))
  lines.push("")

  // ---- Re-anchor (the count the card paints as ⟲ N, said once in the record)
  lines.push("## Re-anchor")
  lines.push("")
  lines.push(...reanchorLines(goal))
  lines.push("")

  // ---- Verify gate
  lines.push("## Verify gate")
  lines.push("")
  lines.push(...verifyLines(goal))
  lines.push("")

  // ---- Totals
  const totals = loopTotals(entries, goal.setAt)
  lines.push("## Totals")
  lines.push("")
  lines.push(`- Iterations complete: ${totals.iterations}`)
  lines.push(`- Turns: ${totals.turns} · Tool calls: ${totals.tools}`)
  if (totals.spanMs > 0) lines.push(`- Wall span (first iteration → last landing): ${formatDuration(totals.spanMs)}`)
  if (totals.spend) {
    const partial = totals.spend.measured < totals.iterations ? ` (${totals.spend.measured} of ${totals.iterations} iterations measured)` : ""
    lines.push(`- Spend across iterations: ${formatCost(totals.spend.total)}${partial}`)
  } else if (entries.length > 0) {
    lines.push("- Spend across iterations: no iteration carried a measurement")
  }
  lines.push("")
  lines.push("---")
  lines.push("_goal-loop dossier · source: plugin record · nothing above was re-verified; it is the record's own bookkeeping._")

  return lines.join("\n")
}
