/**
 * Shared machinery for the three record attestations — verification (does the sha resolve),
 * ancestry (is it on this line) and seal (does git verify a signature). Each of the three modules
 * keeps its own exported names, probe taxonomy, counts field names and prose; this module owns only
 * the parts that were function-for-function identical: the sweep over the quoted shas, the Markdown
 * table skeleton, the summary/ack branches and the yes/no/unknown cell mapping.
 *
 * Honesty rules are unchanged: a probe that throws or cannot answer is `unknown`, never folded into
 * either the positive or the negative bucket. The formatter strings come from the caller verbatim,
 * so every rendered byte — leading spaces, glyphs, singular/plural, the gap row, the trailing blank
 * line — stays exactly where it was.
 */
import { conditionCellOf, iterationList, recordStatusCell, shortSha, stampOf } from "./dossier.ts"
import type { RecordAnswer } from "./dossier.ts"
import type { GoalSnapshot } from "./types.ts"

/** The shas the record quotes, in first-appearance order, with the iterations that quote each. */
export function recordShaMentions(goal: GoalSnapshot): { readonly sha: string; readonly iterations: number[] }[] {
  const mentions: { sha: string; iterations: number[] }[] = []
  const index = new Map<string, number>()
  for (const entry of goal.loopHistory ?? []) {
    const sha = typeof entry.sha === "string" ? entry.sha.trim() : ""
    if (!sha) continue
    const at = index.get(sha)
    if (at !== undefined) {
      mentions[at]!.iterations.push(entry.version)
      continue
    }
    index.set(sha, mentions.length)
    mentions.push({ sha, iterations: [entry.version] })
  }
  return mentions
}

/** Neutral probe contract: true = the caller's positive answer, false = the negative answer, "unknown" = no answer. */
export type RecordAnswerProbe = (sha: string) => boolean | "unknown"

/** One per-sha check, with the status typed to the positive/negative/unknown union the caller chose. */
export interface RecordCheckShape<Status extends string = string> {
  readonly sha: string
  readonly shortSha: string
  /** 1-based loop iterations that quote this sha (oldest first). */
  readonly iterations: readonly number[]
  readonly status: Status
}

/** The four neutral counts every renderer consumes, before the caller renames them. */
export interface NeutralCounts {
  readonly unique: number
  readonly positive: number
  readonly negative: number
  readonly unknown: number
}

/** The sweep result: neutral counts plus the per-sha checks. */
export interface RecordSweep<Status extends string = string> extends NeutralCounts {
  readonly checks: readonly RecordCheckShape<Status>[]
  /** Total mentions across all iterations (unique shas can be > 0 mentions apart). */
  readonly mentions: number
}

/**
 * Sweeps the record's quoted shas against the probe. Pure: the probe is injected, the sweep never
 * throws. `positive` and `negative` are the caller's status labels; `unknown` is the third bucket,
 * used when the probe throws or cannot answer. Counts are neutral so each caller can remap names.
 */
export function sweepRecordMentions<Status extends string = string>(
  goal: GoalSnapshot,
  probe: RecordAnswerProbe,
  positive: Status,
  negative: Status,
): RecordSweep<Status> {
  const checks = recordShaMentions(goal).map((m): RecordCheckShape<Status> => {
    let answer: boolean | "unknown"
    try {
      answer = probe(m.sha)
    } catch {
      answer = "unknown"
    }
    const status: Status = answer === true ? positive : answer === false ? negative : ("unknown" as Status)
    return { sha: m.sha, shortSha: shortSha(m.sha), iterations: m.iterations, status }
  })
  let positiveCount = 0
  let negativeCount = 0
  let unknown = 0
  let mentions = 0
  for (const check of checks) {
    if (check.status === positive) positiveCount += 1
    else if (check.status === negative) negativeCount += 1
    else unknown += 1
    mentions += check.iterations.length
  }
  return { checks, unique: checks.length, mentions, positive: positiveCount, negative: negativeCount, unknown }
}

/** The caller's exact strings for one Markdown report; no prose is synthesized here. */
export interface RecordReportFormat {
  /** First line, e.g. `# /goal-loop record verification`. */
  readonly title: string
  /** Third column header, e.g. `resolves`. */
  readonly columnHeader: string
  /** Pre-rendered counts line, already using the caller's field names. */
  readonly countsLine: string
  /** The honesty footer paragraph. */
  readonly footer: string
  /** Status label that maps to a "yes" cell. */
  readonly positive: string
  /** Status label that maps to a "no" cell. */
  readonly negative: string
}

/** The minimal view of a sweep the report renderer needs. */
export interface RecordReportInput {
  readonly checks: readonly {
    readonly shortSha: string
    readonly iterations: readonly number[]
    readonly status: string
  }[]
  readonly unique: number
  readonly mentions: number
}

/** Renders the shared Markdown skeleton; blank lines, the gap row and `join("\n")` are identical for all three. */
export function renderRecordReport(
  goal: GoalSnapshot,
  input: RecordReportInput,
  format: RecordReportFormat,
  nowMs: number,
  directory: string,
): string {
  const stamp = stampOf(nowMs)
  const conditionCell = conditionCellOf(goal.condition)
  const statusCell = (status: string): RecordAnswer => recordStatusCell(status, format.positive, format.negative)
  const lines: string[] = [
    format.title,
    "",
    `- Generated: ${stamp}`,
    `- Repository: ${directory}`,
    `- Condition: ${conditionCell}`,
    `- Shas quoted by the record: ${input.unique} unique across ${input.mentions} mention${input.mentions === 1 ? "" : "s"}`,
    "",
    `| sha | quoted at | ${format.columnHeader} |`,
    "| --- | --- | --- |",
  ]
  for (const check of input.checks) {
    lines.push(`| ${check.shortSha} | ${iterationList(check.iterations)} | ${statusCell(check.status)} |`)
  }
  if (input.checks.length === 0) lines.push("| — | — | — |")
  lines.push("", format.countsLine, "", format.footer, "")
  return lines.join("\n")
}

/** The four exact one-line strings a summary needs; `positive`/`negative` name the caller's counts. */
export interface RecordSummaryFormat<Counts extends NeutralCounts = NeutralCounts> {
  readonly none: string
  readonly success: (counts: Counts) => string
  readonly failure: (counts: Counts) => string
  readonly unknown: (counts: Counts) => string
}

/** Shared summary branch: empty → all-good → any negative → any unknown, in that order. */
export function recordSummaryLine<Counts extends NeutralCounts>(counts: Counts, format: RecordSummaryFormat<Counts>): string {
  if (counts.unique === 0) return format.none
  if (counts.negative === 0 && counts.unknown === 0) return format.success(counts)
  if (counts.negative > 0) return format.failure(counts)
  return format.unknown(counts)
}

/** The exact label strings an ack segment needs; glyphs and spacing are shared and identical. */
export interface RecordAckFormat {
  readonly noneAscii: string
  readonly noneUnicode: string
  /** Suffix after `<negative> of <unique> `. */
  readonly negative: string
  /** Suffix after `<unknown> of <unique> `. */
  readonly unknown: string
  /** Suffix after `<positive>/<unique> `. */
  readonly positive: string
}

/** Shared ack glyph/branch logic. Negative > unknown > positive, with every leading space preserved. */
export function recordAckSegment(counts: NeutralCounts, ascii: boolean, format: RecordAckFormat): string {
  const ok = ascii ? "+" : "✓"
  const bad = ascii ? "-" : "✗"
  if (counts.unique === 0) return ascii ? format.noneAscii : format.noneUnicode
  if (counts.negative > 0) return ` (${bad} ${counts.negative} of ${counts.unique} ${format.negative})`
  if (counts.unknown > 0) return ` (! ${counts.unknown} of ${counts.unique} ${format.unknown})`
  return ` (${ok} ${counts.positive}/${counts.unique} ${format.positive})`
}

/** The three yes/no/unknown cell helpers the dossier exporters share, typed to the caller's answer alias. */
export interface RecordCellHelpers<Answer extends string = RecordAnswer> {
  readonly verifyCell: (status: string) => Answer
  readonly reachCell: (status: string) => Answer
  readonly signCell: (status: string) => Answer
}

/** One factory call yields the three typed cell helpers, each keeping its original label pair. */
export function recordCellHelpers<Answer extends string = RecordAnswer>(): RecordCellHelpers<Answer> {
  const cell = (status: string, positive: string, negative: string): Answer =>
    recordStatusCell(status, positive, negative) as Answer
  return {
    verifyCell: (status) => cell(status, "present", "missing"),
    reachCell: (status) => cell(status, "ancestor", "unreached"),
    signCell: (status) => cell(status, "verified", "unverified"),
  }
}
