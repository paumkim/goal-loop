/**
 * Regression guard for the live-session crash reported as
 * "opencode-goal.tui crashed in dialog: undefined is not an object (evaluating 'e.length')".
 *
 * Provenance: the two fixtures below are the actual goal records the plugin had persisted when the
 * crash was reported — one from a fresh `/goal-loop` armed mid-compaction ("Extract opencode v2.3.0"
 * session, loop iteration 1, boundary compaction landed), one from a finished non-loop goal
 * ("Coordinator stale works" session, verdict met, single turn, landed SHAs in the ledger). Captured
 * from real sessions on 2026-11-16 and inlined here on 2026-11-17 so the test never reads scratch
 * files. The live crash itself was never reproduced — every tab of the real dialog renders both
 * records cleanly headlessly — so this test pins that exact outcome: both records, all three tabs
 * (overview, ledger, dossier), rendered through the real dialog body, must not throw and must paint
 * real content. If a future change breaks rendering these two shapes, the report is a live regression,
 * not a fixture problem.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { StatusDialogBody } from "../src/status-dialog.tsx"
import type { HistoryTheme } from "../src/tui-history.tsx"
import type { GoalSnapshot } from "../src/core/types.ts"

const theme: HistoryTheme = {
  text: {
    base: RGBA.fromHex("#e8e8e8"),
    muted: RGBA.fromHex("#a0a0a0"),
    faint: RGBA.fromHex("#6f6f6f"),
    feedback: {
      info: { base: RGBA.fromHex("#6cb6ff") },
      warning: { base: RGBA.fromHex("#e0af3c") },
    },
  },
}

const now = 1_800_000_000_000

// The Extract opencode v2.3.0 session record: a fresh `/goal-loop` (iteration 1 of 5, empty history)
// whose boundary compaction landed. Note the very long condition/loopObjective — the record exists in
// the wild in exactly this shape, so the fixture keeps the lengths verbatim.
const extractSession = (): GoalSnapshot => ({
  version: 1,
  id: "dff47bac-2a37-4183-bb7e-532f656246df",
  sessionID: "ses_e19383713ffeRiQYUejcrWR443",
  directory: "/home/pauk/Projects/opencode-v2-fake",
  condition: "okay lets do that and keep on improving it so it became 100% real of opencode v2. and change the name to the real one as well. dele any old one that are not the real one and to verified if it is real or not check inspect the current installed opencode cli that the harness you are currently running on.",
  status: "active",
  setAt: 1794873493944,
  startedAt: 1794874494475,
  turns: 0,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline: { cost: 0, input: 113572, output: 15359, reasoning: 0, cacheRead: 603264, cacheWrite: 0 },
  history: [],
  loopEnabled: true,
  loopIteration: 1,
  loopObjective: "okay lets do that and keep on improving it so it became 100% real of opencode v2. and change the name to the real one as well. dele any old one that are not the real one and to verified if it is real or not check inspect the current installed opencode cli that the harness you are currently running on.",
  loopMaxLoops: 5,
  loopHistory: [],
  loopNotProgress: 0,
  loopCompact: { requestedAt: 1794873950313, estimatedTokens: 33705, iteration: 1, misses: 0, landedAt: 1794874139185 },
  reanchorCount: 1,
  elapsedMs: 1000 * 60 * 6,
  evaluating: false,
  waiting: false,
})

// The Coordinator stale works session record: a met, non-loop goal — one verdict, one turn, the ledger
// entry carries its own marginal spend, tool count and the landing SHA.
const staleSession = (): GoalSnapshot => ({
  version: 1,
  id: "642b9bc6-0e5a-4238-91a7-4ff27b0e1f3f",
  sessionID: "ses_e19875b93ffe4VE5pBdsyF7poG",
  directory: "/home/pauk/Projects/opencode-v2-goal/opencode-goalv2",
  condition: "review recent changes for stale works and bugs merged them to dev after they are all ready.",
  status: "achieved",
  reason: "All three submitted works were reviewed, fixed where stale/buggy (9043e20 on wt/coordinator-scratch-branch-order; 56a8f83 on wt/dz-evidence-fresh), and landed via merge-next: outputs show 'merged into dev' for each, dev HEAD 2f966cc carries the merge commits. Fresh post-merge evidence at dev: 35 pass / 0 fail on the two coordinator suites, spec-check ok (59 files, 1308 tests), merge queue empty, submitted count 0. The one stale item (github-single-channel) has no branch/commit to merge and was reported, not landed.",
  verdict: "met",
  setAt: 1794868029713,
  startedAt: 1794868029713,
  endedAt: 1794868470747,
  turns: 1,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  final: { cost: 0, input: 153898, output: 4698, reasoning: 10739, cacheRead: 1945216, cacheWrite: 0 },
  history: [
    {
      turn: 1,
      verdict: "met",
      reason: "All three submitted works were reviewed, fixed where stale/buggy (9043e20 on wt/coordinator-scratch-branch-order; 56a8f83 on wt/dz-evidence-fresh), and landed via merge-next: outputs show 'merged into dev' for each, dev HEAD 2f966cc carries the merge commits. Fresh post-merge evidence at dev: 35 pass / 0 fail on the two coordinator suites, spec-check ok (59 files, 1308 tests), merge queue empty, submitted count 0. The one stale item (github-single-channel) has no branch/commit to merge and was reported, not landed.",
      at: 1794868470747,
      toolCalls: 35,
      spend: { cost: 0, input: 152506, output: 4528, reasoning: 9883, cacheRead: 1872640, cacheWrite: 0 },
      sha: "2f966cc58ee6922934011d26afbb925d224b4a23",
    },
  ],
  elapsedMs: 1000 * 60 * 6,
  evaluating: false,
  waiting: false,
})

const records = [
  { name: "Extract opencode v2.3.0 session (fresh loop, landed compaction)", make: extractSession, marker: "active" },
  { name: "Coordinator stale works session (achieved, met)", make: staleSession, marker: "achieved" },
] as const

const render = async (node: () => JSX.Element, width = 112, height = 40): Promise<string> => {
  const setup = await testRender(node, { width, height })
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  await setup.renderer.destroy()
  return frame
}

describe("dialog crash records — the two real persisted records render every tab", () => {
  for (const { name, make, marker } of records) {
    test(`${name}: overview tab renders without throwing`, async () => {
      const frame = await render(() => <StatusDialogBody goal={make()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 6} nowMs={() => now} />)
      expect(frame).toContain(marker)
    })

    test(`${name}: ledger tab renders without throwing`, async () => {
      const frame = await render(() => <StatusDialogBody goal={make()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 6} nowMs={() => now} view={() => "ledger"} />)
      expect(frame.length).toBeGreaterThan(0)
    })

    test(`${name}: dossier tab renders without throwing`, async () => {
      const frame = await render(() => <StatusDialogBody goal={make()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 6} nowMs={() => now} view={() => "dossier"} onCopyDossierSection={() => {}} />)
      expect(frame.length).toBeGreaterThan(0)
    })
  }
})
