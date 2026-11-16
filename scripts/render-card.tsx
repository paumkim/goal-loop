/**
 * Headless render of the compact HUD card — the ambient "jump row" surface. Mounts the real
 * HudCard (not painted mock rows) so the frames stay honest. Not shipped (scripts/ is not in
 * package.json `files`).
 *
 *   bun --preload @opentui/solid/preload scripts/render-card.tsx
 *
 * Frames: the active loop (terminal 80 -> the 64-cell card at the 80-column floor), the achieved
 * state, the clamp-floor card at width 52 — the case the spend row's degradation ladder exists
 * for (its dollar figure used to clip mid-figure there) — and three failure-first arms: the hot
 * loop (a boundary compaction pending 2/4 misses, amber border + remediation row), the stuck loop
 * (3 failed turns in a row), and the loudly failed goal. The failure-first contract is the card's
 * whole reason to exist: each arm paints the exact remediation, never a vague warning.
 * --mono prints the same arms under reduced color (NO_COLOR set); glyphs demote to ASCII.
 */
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { HudCard, type HudCardTheme } from "../src/hud-card.tsx"
import type { GoalSnapshot, Verdict } from "../src/core/types.ts"

const mono = process.argv.includes("--mono")
if (mono) process.env.NO_COLOR = "1"
const theme: HudCardTheme = {
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

const now = 1_800_000_000_000
const verdicts = (list: Verdict[]): GoalSnapshot["history"] =>
  list.map((verdict, index) => ({ turn: index + 1, verdict, reason: verdict === "met" ? "done" : "not yet", at: now - 1000 * 60 * (list.length - index), toolCalls: verdict === "met" ? 4 : 2 }))
const base: GoalSnapshot = {
  version: 1,
  id: "goal_card",
  sessionID: "ses_card",
  directory: "/tmp/card",
  stall: 0,
  condition: "make every loop iteration visible at a glance in the /goal dialog",
  status: "active",
  startedAt: now - 1000 * 60 * 42,
  setAt: now - 1000 * 60 * 42,
  turns: 31,
  elapsedMs: 1000 * 60 * 42,
  retries: 0,
  checkins: 0,
  baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  history: verdicts(["met", "not_met", "met", "met", "not_met", "met", "met"]),
  spend: { input: 1_480_000, output: 2_100, reasoning: 0, cacheRead: 739_000, cacheWrite: 0, cost: 0.9 },
  contextSize: 512_000,
  compactAtTokens: 900_000,
  evaluating: false,
  waiting: false,
}
const mount = async (name: string, goal: GoalSnapshot, terminal: number, width?: number) => {
  const setup = await testRender(
    () => (
      <HudCard
        goal={goal}
        theme={theme}
        elapsedMs={() => 1000 * 60 * 42}
        nowMs={() => now}
        onClose={() => {}}
        onDetails={() => {}}
        onClear={() => {}}
        onCopyCondition={() => {}}
        onTogglePin={() => {}}
        width={width}
        mono={mono}
      />
    ),
    { width: terminal, height: 12 },
  )
  await setup.renderOnce()
  console.log(mono ? name.replace("=== ", "=== ") + " · mono" : name)
  console.log(setup.captureCharFrame())
  await setup.renderer.destroy()
}

const pendingCompact = { requestedAt: now - 1000 * 60 * 7, estimatedTokens: 512_000, iteration: 31, misses: 2 }
await mount("=== card · active loop (terminal 80 -> 64-cell card) ===", base, 80)
await mount("=== card · achieved ===", { ...base, status: "achieved" }, 80)
await mount("=== card · width 52 (clamp floor, spend ladder) ===", base, 64, 52)
await mount("=== card · running hot (compaction pending 2/4) ===", { ...base, loopCompact: pendingCompact }, 80)
await mount("=== card · stuck on retries (3 failed turns) ===", { ...base, retries: 3 }, 80)
await mount("=== card · failed (loud stop) ===", { ...base, status: "failed", failureLabel: "provider error" }, 80)
process.exit(0)
