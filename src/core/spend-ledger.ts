/**
 * The spend story, one file — `goal.dossier.spend` writes an O_EXCL markdown spend report:
 * one row per landed `/goal-loop` iteration carrying the usage delta the harness attributed
 * to it (cost, tokens in/out/reasoning, cache read/write), tool calls and the sha it landed
 * on, then totals over exactly the measured iterations, then an honesty footer. Pure name and
 * content construction; the single I/O point is one synchronous `writeFileSync(..., "wx")`,
 * which is what makes "never overwrites" a guarantee of the filesystem rather than a promise
 * of this module. Unit-tested in `test/spend-ledger.test.ts`.
 *
 * Honesty rules, same as the rest of the plugin:
 *   - A measurement the record does not carry renders as "—", never estimated. An iteration
 *     counts as measured only when its full usage snapshot is present and every field is
 *     finite and >= 0 — a partial or corrupt snapshot degrades the whole iteration to
 *     unmeasured rather than fabricating the missing cells.
 *   - Totals sum only measured iterations and say so: the spend line names "M of N measured"
 *     when the measurement is partial, renders "no iteration carried a measurement" when it
 *     is absent, and never claims a $0.00 the record is silent on.
 *   - A record trimmed by the loop-history retention cap says so in the heading and the totals:
 *     the figures below cover the retained iterations only; the dropped ones are unknown, never $0.00.
 *   - The figures are the record's own; nothing was estimated, sampled, probed, or
 *     re-verified here. Cost is the host's reported usage delta, not a re-price.
 *   - Free text (objective, conditions) is quoted so it can never forge document structure;
 *     the session id is deliberately omitted so a pasted ledger leaks nothing about where
 *     it came from.
 *   - The write is O_EXCL with collision retries; a failed write throws with the filesystem's
 *     own message and the host toasts it. No directory is created, moved, or removed — the
 *     target is always the existing directory the caller names (the host's cwd).
 */
import { writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { GAP, fileStampOf, isoOf, quote, shortSha } from "./dossier.ts"
import { formatCost } from "./format.ts"
import { MAX_EXPORT_ATTEMPTS } from "./dossier-export.ts"
import { MAX_LOOP_HISTORY_ENTRIES, type GoalSnapshot, type LoopEntry, type UsageSnapshot } from "./types.ts"

/**
 * `goal-spend-ledger-20261116-172233.md` from a clock; attempt > 0 appends `-attempt` (`-2`, `-3`, ...).
 * Deterministic: the same (nowMs, attempt) always yields the same name. A non-finite or
 * unrepresentable clock stamps the epoch rather than throwing — the name stays honest.
 * The stamp itself is the dossier family's shared `fileStampOf`; only the stem and the
 * collision suffix are local, so every exporter's compact UTC stamp stays identical.
 */
export const spendLedgerName = (nowMs: number, attempt = 0): string => {
  const suffix = attempt > 0 ? `-${attempt + 1}` : ""
  return `goal-spend-ledger-${fileStampOf(nowMs)}${suffix}.md`
}

/** The full usage snapshot when every field is present and finite and >= 0; undefined otherwise — the one measurement rule this module and its totals share. */
const measuredSpend = (entry: LoopEntry): UsageSnapshot | undefined => {
  const spend = entry.spend
  if (!spend) return undefined
  const fields = [spend.cost, spend.input, spend.output, spend.reasoning, spend.cacheRead, spend.cacheWrite]
  if (!fields.every((n) => Number.isFinite(n) && n >= 0)) return undefined
  return spend
}

/** Exact integer cells — the ledger is a receipt, not a summary; rounding lives in formatTokens and stays out of it. */
const count = (n: number | undefined): string => (n !== undefined && Number.isFinite(n) ? String(Math.round(n)) : GAP)
const costCell = (spend: UsageSnapshot | undefined): string => (spend ? formatCost(spend.cost) : GAP)
const toolsCell = (entry: LoopEntry): string => (Number.isFinite(entry.toolCalls) ? String(entry.toolCalls) : GAP)

interface SpendTotals {
  readonly iterations: number
  readonly measured: number
  readonly turns: number
  readonly tools: number
  readonly cost?: number
  readonly input?: number
  readonly output?: number
  readonly reasoning?: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
}

const totalsOf = (entries: readonly LoopEntry[]): SpendTotals => {
  let measured = 0
  let turns = 0
  let tools = 0
  let cost = 0
  let input = 0
  let output = 0
  let reasoning = 0
  let cacheRead = 0
  let cacheWrite = 0
  for (const entry of entries) {
    turns += Number.isFinite(entry.turns) ? entry.turns : 0
    tools += Number.isFinite(entry.toolCalls) ? entry.toolCalls : 0
    const spend = measuredSpend(entry)
    if (!spend) continue
    measured += 1
    cost += spend.cost
    input += spend.input
    output += spend.output
    reasoning += spend.reasoning
    cacheRead += spend.cacheRead
    cacheWrite += spend.cacheWrite
  }
  if (measured === 0) return { iterations: entries.length, measured, turns, tools }
  return { iterations: entries.length, measured, turns, tools, cost, input, output, reasoning, cacheRead, cacheWrite }
}

interface BuiltSpendLedger {
  /** The complete report document. */
  readonly markdown: string
  /** Landed iterations on the record. */
  readonly iterations: number
  /** Iterations whose full usage snapshot is present and finite. */
  readonly measured: number
  /** Sum of measured costs; absent when nothing measured — never a claimed $0.00. */
  readonly spendTotal?: number
}

/**
 * Renders the spend ledger. Deterministic: the same record and the same clock render the
 * same document, byte for byte. `nowMs` is the caller's clock — nothing here reads Date.now().
 */
export function buildSpendLedger(goal: GoalSnapshot, nowMs: number): BuiltSpendLedger {
  const entries = goal.loopHistory ?? []
  const dropped = goal.loopHistoryDropped ?? 0
  const isLoop = Boolean(goal.loopEnabled)
  const totals = totalsOf(entries)
  const stamp = isoOf(nowMs)
  const lines: string[] = []

  lines.push(isLoop ? "# Goal loop spend ledger" : "# Goal spend ledger")
  lines.push("")
  lines.push(
    `_Generated ${stamp} from the goal-loop plugin's record. Every figure below is the record's own measurement — the usage delta the harness attributed to each landed iteration (arm → advance). A measurement the record does not carry renders as ${GAP}, never estimated. The session id is omitted on purpose._`,
  )
  lines.push("")

  lines.push(isLoop ? "## Objective" : "## Condition")
  lines.push("")
  lines.push(...quote(isLoop ? (goal.loopObjective ?? goal.condition) : goal.condition))
  lines.push("")

  lines.push(dropped > 0 ? `## Per-iteration spend (${entries.length} most recent of ${entries.length + dropped} landed iterations)` : `## Per-iteration spend (${entries.length} landed iteration${entries.length === 1 ? "" : "s"})`)
  if (dropped > 0) lines.push(`_${dropped} earlier iteration record${dropped === 1 ? "" : "s"} dropped by the loop-history retention cap (${MAX_LOOP_HISTORY_ENTRIES} kept); the rows and totals below cover the retained iterations only — the dropped ones are not $0.00, they are unknown._`)
  lines.push("")
  if (entries.length === 0) {
    lines.push("None — this record has not landed an iteration, so there is nothing to attribute. No figures are claimed.")
    lines.push("")
  } else {
    lines.push(
      "| iteration | ended | spend | in | out | reasoning | cache read | cache write | tools | sha |",
      "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    )
    for (const entry of entries) {
      const spend = measuredSpend(entry)
      lines.push(
        `| v${entry.version} | ${isoOf(entry.endedAt)} | ${costCell(spend)} | ${count(spend?.input)} | ${count(spend?.output)} | ${count(spend?.reasoning)} | ${count(spend?.cacheRead)} | ${count(spend?.cacheWrite)} | ${toolsCell(entry)} | ${shortSha(entry.sha)} |`,
      )
    }
    lines.push("")
  }

  lines.push("## Totals")
  lines.push("")
  lines.push(`- Iterations recorded: ${totals.iterations}${dropped > 0 ? ` (+ ${dropped} dropped by the retention cap; totals cover the retained iterations only)` : ""}`)
  lines.push(`- Turns: ${totals.turns} · Tool calls: ${totals.tools}`)
  if (totals.measured === 0) {
    lines.push("- Spend across iterations: no iteration carried a measurement")
    lines.push(`- In tokens: ${GAP} · Out tokens: ${GAP} · Reasoning tokens: ${GAP}`)
    lines.push(`- Cache read: ${GAP} · Cache write: ${GAP}`)
  } else {
    const partial = totals.measured < totals.iterations ? ` (${totals.measured} of ${totals.iterations} iterations measured — the unmeasured iterations are not $0.00; they are unknown)` : ""
    lines.push(`- Spend across measured iterations: ${formatCost(totals.cost ?? 0)}${partial}`)
    lines.push(`- In tokens: ${count(totals.input)} · Out tokens: ${count(totals.output)} · Reasoning tokens: ${count(totals.reasoning)}`)
    lines.push(`- Cache read: ${count(totals.cacheRead)} · Cache write: ${count(totals.cacheWrite)}`)
    if (totals.measured < totals.iterations) {
      lines.push(`- Token totals sum the ${totals.measured} measured iterations only; adding the ${totals.iterations - totals.measured} unmeasured ones would be inventing numbers.`)
    }
  }
  lines.push("")

  lines.push("---")
  lines.push(
    "_goal-loop spend ledger · source: plugin record · the figures are the record's own measurements; cost is the host's reported usage delta, not a re-price; nothing was estimated, sampled, probed, or re-verified; an iteration counts as measured only when its full usage snapshot is present and finite; a measurement the record does not carry renders as " + GAP + "._",
  )

  return {
    markdown: lines.join("\n"),
    iterations: totals.iterations,
    measured: totals.measured,
    ...(totals.cost !== undefined ? { spendTotal: totals.cost } : {}),
  }
}

interface SpendLedgerExportResult {
  /** Absolute path of the written file. */
  readonly path: string
  /** Bytes written (UTF-8). */
  readonly bytes: number
  /** How many candidate names were tried (1 = the plain name was free). */
  readonly attempts: number
  readonly iterations: number
  readonly measured: number
  /** Sum of measured costs; absent when nothing measured — never a claimed $0.00. */
  readonly spendTotal?: number
}

/**
 * Writes the spend ledger for `goal` as one new file inside `dir` (the caller passes the
 * host's cwd). Never overwrites: the write is O_EXCL and collisions retry with a numeric
 * suffix, up to `MAX_EXPORT_ATTEMPTS`. Throws — never resolves partial — when no candidate
 * name is free or when the directory rejects the write; the message is the filesystem's own.
 */
export function exportSpendLedger(goal: GoalSnapshot, nowMs: number, dir: string): SpendLedgerExportResult {
  const targetDir = resolve(dir)
  const ledger = buildSpendLedger(goal, nowMs)
  const bytes = Buffer.byteLength(ledger.markdown, "utf8")
  for (let attempt = 0; attempt < MAX_EXPORT_ATTEMPTS; attempt++) {
    const path = join(targetDir, spendLedgerName(nowMs, attempt))
    try {
      writeFileSync(path, ledger.markdown, { encoding: "utf8", flag: "wx" })
      return {
        path,
        bytes,
        attempts: attempt + 1,
        iterations: ledger.iterations,
        measured: ledger.measured,
        ...(ledger.spendTotal !== undefined ? { spendTotal: ledger.spendTotal } : {}),
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code === "EEXIST") continue // the stem collided — try the next suffix, never clobber
      throw error
    }
  }
  throw new Error(`no free spend ledger filename after ${MAX_EXPORT_ATTEMPTS} attempts in ${targetDir}`)
}

/** The one-line outcome for the toast and the tests. No glyphs, no color — callers paint their own chrome. */
export function spendSummaryLine(result: Pick<BuiltSpendLedger, "iterations" | "measured" | "spendTotal">): string {
  if (result.iterations === 0) return "no landed iterations to report"
  if (result.measured === 0) return `spend ledger written: no iteration carried a measurement (0 of ${result.iterations})`
  const spend = formatCost(result.spendTotal ?? 0)
  if (result.measured < result.iterations)
    return `spend ledger written: ${spend} across ${result.measured} of ${result.iterations} measured iterations`
  return `spend ledger written: ${spend} across ${result.iterations} iteration${result.iterations === 1 ? "" : "s"}`
}
