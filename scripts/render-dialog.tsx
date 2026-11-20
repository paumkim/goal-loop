/**
 * Headless render of the full `/goal` detail dialog (clamped column + host-chrome layout + scrollbox +
 * StatusDialogBody). Not shipped (scripts/ is not in package.json `files`).
 *
 *   bun --preload @opentui/solid/preload scripts/render-dialog.tsx [--buggy] [--width=N] [--pinned] [--copied] [--achieved] [--pileup]
 *
 * --buggy reproduces the pre-fix configuration (shared scrollbarOptions visible: true, forced horizontal track);
 * the default prints the fixed configuration (auto scrollbar visibility, scrollX off, 3-cell body gutter).
 * --width pins the frame width (default 150, 100 under --pileup) — the host hands the width through, so the floor and the
 * footer tier boundaries can be eyeballed (80 = short hint + compact labels, ~100 = short hint + noun
 * labels, >= ~140 = full key hint). --pinned paints the pin button flipped, --copied paints the copy
 * button acknowledged, --mono prints under reduced color (NO_COLOR set) with ASCII glyphs.
 * --pileup renders a stress frame: a massive goal (long condition/reason/objective) with many live goals in
 * elsewhere (expanded) so alignment and consistency under pile-up can be eyeballed headlessly.
 * The footer is the real DialogFooter, never a hand-painted line. Both arms paint the verify section
 * (the last evaluator.verifyCommand gate's own output — the dialog's proof panel).
 */
import { RGBA, TextAttributes } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { StatusDialogBody } from "../src/status-dialog.tsx"
import { DialogFooter, type HudCardTheme } from "../src/hud-card.tsx"
import { goalGlyph } from "../src/core/format.ts"
import { motionDisabled } from "../src/core/hud.ts"
import type { HistoryTheme } from "../src/tui-history.tsx"
import type { GoalSnapshot } from "../src/core/types.ts"

const buggy = process.argv.includes("--buggy")
const pileup = process.argv.includes("--pileup")
/** --width=/--height=: must parse to a positive finite number; a bare "--width=abc" used to paint a NaN-wide frame silently. */
const positiveFiniteFlag = (name: string, dflt: number): number => {
  const raw = process.argv.slice(2).find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  if (raw === undefined) return dflt
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`render-dialog.tsx: --${name} must be a positive finite number (got "${raw}")`)
    process.exit(2)
  }
  return n
}
const height = positiveFiniteFlag("height", pileup ? 80 : 46)
const width = positiveFiniteFlag("width", pileup ? 100 : 150)
const pinned = process.argv.includes("--pinned")
const copied = process.argv.includes("--copied")
const achieved = process.argv.includes("--achieved")
const mono = process.argv.includes("--mono")
if (mono) process.env.NO_COLOR = "1"
/** --bench=N: render N frames and print avg/min/max ms per frame (renderOnce + captureCharFrame, the same work a keystroke triggers). 0 = skip benching. */
const bench = positiveFiniteFlag("bench", 0)
const now = Date.now()

const theme: HistoryTheme & HudCardTheme = {
  text: {
    base: RGBA.fromHex("#e8e8e8"),
    muted: RGBA.fromHex("#a0a0a0"),
    faint: RGBA.fromHex("#6f6f6f"),
    feedback: {
      info: { base: RGBA.fromHex("#6cb6ff") },
      warning: { base: RGBA.fromHex("#e0af3c") },
      error: { base: RGBA.fromHex("#ff6c6c") },
    },
  },
  border: { base: RGBA.fromHex("#3f3f3f") },
  background: { raised: { high: RGBA.fromHex("#161616") } },
}

const verdicts = [
  "met", "met", "met", "not_met", "met", "not_met", "met", "met", "not_met", "met", "met", "met", "not_met", "met", "met", "met", "not_met", "met", "met", "met", "met", "not_met", "met", "met", "met", "met", "met", "not_met", "met", "met",
] as const

const baseGoal: GoalSnapshot = {
  version: 1,
  id: "goal_dialog",
  sessionID: "ses_dialog",
  directory: "/tmp/dialog",
  condition:
    "keep the terminal tui display of the goal plugin beautiful and legible as it shows the goal histories, with no rough edges, no inconsistent scrolling, and consistent spacing across every section of the dialog",
  status: achieved ? "achieved" : "paused",
  reason: achieved
    ? undefined
    : "Loop paused: two consecutive iterations without tool use. Send a message to resume, or /goal-loop clear.",
  setAt: now - 1000 * 60 * 40,
  startedAt: now - 1000 * 60 * 40,
  turns: 1,
  stall: 1,
  retries: 0,
  checkins: 0,
  baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  history: verdicts.map((verdict, index) => ({ turn: index + 1, verdict, reason: verdict === "met" ? "done" : "not yet", at: now - 1000 * 60 * (40 - index) })),
  loopEnabled: true,
  loopIteration: 4,
  loopObjective: "keep improving the terminal tui display of this current plugin how it shows the goal histories be creative",
  loopMaxLoops: 5,
  loopHistory: [
    {
      version: 1,
      condition: "creative rework of the /goal detail dialog history display",
      summary:
        "Achieved: creative rework of the /goal detail dialog's history display, merged to dev (wt/goal-history-tui, commits 842acd4 + d184815; dev HEAD 5e71c89). New in src/tui-history.tsx + pure helpers src/core/history.ts: progress caption (v3 of at most 5 · 2 complete) with 18-cell block bar (no zero-divide), iteration rail with per-iteration wall time and verdict mix, summaries wrapped on a │-prefixed faint line indented under the rail.",
      reason: "met",
      turns: 1,
      toolCalls: 2,
      endedAt: now - 1000 * 60 * 21,
    },
    {
      version: 2,
      condition: "non-looped goals render the verdict trail and a compact history block",
      summary:
        "Iteration achieved (evaluator: met): non-looped goals now render a compact history block in the /goal dialog — bold last-verdict glyph (info/faint/warning) + last <verdict> (turn N) · <turns> evaluated turns · counts · elapsed; fresh goals degrade to no verdicts yet; shared verdict trail below it.",
      reason: "met",
      turns: 1,
      toolCalls: 0,
      endedAt: now - 1000 * 60 * 8,
    },
    {
      version: 3,
      condition: "loop rail rows gain relative ended <ago> timestamps and the paused now row shows stall/retries diagnostics",
      summary:
        "Iteration achieved (evaluator: met): loop rail rows now show relative ended <ago> timestamps and the paused now row shows stall/retries diagnostics from the snapshot; new pure helpers relativeTime and pauseDiagnostics with unit tests; scripts/render-history.tsx prints four frames; rail rows updated in LoopSection with a reactive nowMs() getter wired to the dialog minute-resolution signal; docs freshness gate passed after the refresh commit.",
      reason: "met",
      turns: 1,
      toolCalls: 0,
      endedAt: now - 1000 * 20,
    },
  ],
  loopNotProgress: 0,
  elapsedMs: 1000 * 120,
  evaluating: false,
  waiting: false,
  spend: { cost: 0.9, input: 742_000, output: 2_100, reasoning: 0, cacheRead: 739_000, cacheWrite: 0 },
  lastVerify: { command: "bun run check", code: 0, tail: "spec-check: ok (44 files, 907 tests match SPEC.md)\nok: loaded TUI plugin", at: now - 1000 * 60 * 4 },
}

const pileupOthers: GoalSnapshot[] = Array.from({ length: 12 }, (_, i) => ({
  version: 1,
  id: `goal_other_${i}`,
  sessionID: `ses_other_${i}_abcdefgh`,
  directory: "/tmp/dialog",
  condition: `Another goal number ${i + 1} with a fairly long condition text that describes what this session is trying to accomplish in detail ${i}`,
  status: (i % 3 === 0 ? "paused" : "active") as GoalSnapshot["status"],
  setAt: now - 1000 * 60 * (i + 5),
  startedAt: now - 1000 * 60 * (i + 5),
  turns: i + 2,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  history: [],
  loopEnabled: i % 2 === 0,
  loopIteration: i % 2 === 0 ? i + 1 : undefined,
  loopMaxLoops: i % 2 === 0 ? 10 : undefined,
  elapsedMs: 1000 * 60 * (i + 1),
  evaluating: false,
  waiting: false,
}))

const goal: GoalSnapshot = pileup
  ? {
      ...baseGoal,
      condition:
        "improve the terminal tui dialog display on detail view when goals are starting to pile up. " +
        "This is a very long massive goal condition that keeps going and going with lots of detail about layout consistency, spacing, alignment, truncation, wrapping behavior, and how the dialog should look when there are many goals running simultaneously across different sessions in the same directory and each goal has its own long objective and history and the elsewhere section becomes very crowded and the detail view starts breaking visually with inconsistent design patterns throughout the terminal tui interface. ".repeat(3),
      reason:
        "Last evaluator said: " +
        "this is a detailed reason that explains what is still missing and what needs to be done next in great detail so the row must stay consistent while the text wraps across many lines. ".repeat(3),
      loopObjective:
        "A very long objective that also wraps and takes up space: " +
        "keep improving everything about the detail dialog so it remains consistent and readable when content piles up. ".repeat(4),
      turns: 15,
    }
  : baseGoal

const others: readonly GoalSnapshot[] = pileup
  ? pileupOthers
  : [{ ...baseGoal, sessionID: "ses_render_foreign", id: "goal_render_foreign", condition: "ship the release notes before friday" }]

const sessionLabel = (id: string): string => {
  if (id === "ses_render_foreign") return "brisk-falcon"
  if (pileup) return `session-${id.split("_")[2] ?? id}`
  return id
}

const setup = await testRender(
  () => (
    <box width={width} height={height} flexDirection="column" paddingLeft={1} paddingRight={1} paddingBottom={0} paddingTop={0} gap={1}>
      <box flexDirection="row" justifyContent="space-between" gap={2} flexShrink={0}>
        <text attributes={TextAttributes.BOLD} fg={theme.text.base}>
          {goalGlyph(motionDisabled(process.env))} /goal · loop
        </text>
        <text fg={theme.text.muted} flexShrink={0}>
          esc
        </text>
      </box>
      <scrollbox
        flexGrow={1}
        stickyScroll={false}
        {...(buggy
          ? { scrollbarOptions: { visible: true }, contentOptions: { minHeight: 0 } }
          : { scrollX: false, contentOptions: { minHeight: 0 } })}
      >
        <StatusDialogBody
          goal={goal}
          fallback="no cached goal snapshot"
          theme={theme}
          elapsedMs={() => 1000 * 120}
          nowMs={() => now}
          mono={mono}
          onCopyCondition={() => {}}
          onCopyReason={() => {}}
          onCopySummary={() => {}}
          onCopyAttestation={() => {}}
          onCopyTally={() => {}}
          onCopyVerify={() => {}}
          onViewTranscript={() => {}}
          others={others}
          sessionLabel={sessionLabel}
          expandedOthers={pileup ? () => true : undefined}
        />
      </scrollbox>
      <DialogFooter
        theme={theme}
        pinned={() => pinned}
        copied={() => copied}
        mono={mono}
        onCopy={() => {}}
        onTogglePin={() => {}}
        onClear={() => {}}
      />
    </box>
  ),
  { width, height },
)
await setup.renderOnce()
if (bench > 0) {
  const times: number[] = []
  for (let frame = 0; frame < bench; frame++) {
    const started = performance.now()
    await setup.renderOnce()
    setup.captureCharFrame()
    times.push(performance.now() - started)
  }
  const total = times.reduce((sum, ms) => sum + ms, 0)
  console.log(`bench: ${bench} frames · avg ${(total / times.length).toFixed(2)}ms · min ${Math.min(...times).toFixed(2)}ms · max ${Math.max(...times).toFixed(2)}ms`)
  process.exit(0)
}
console.log(buggy ? "=== buggy scrollbox configuration ===" : "=== fixed scrollbox configuration ===")
console.log(setup.captureCharFrame())
process.exit(0)
