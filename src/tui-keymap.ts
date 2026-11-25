/**
 * Global palette/keymap commands for the goal UI. Extracted from the TUI composition root: the
 * command table is configuration, and every dependency is passed in explicitly.
 */
import { buildLoopDossier } from "./core/dossier.ts"
import { hudArmEnabled } from "./core/hud.ts"
import type { GoalSnapshot } from "./core/types.ts"
import type { GoalSnapshotCacheEntry } from "./core/entries.ts"

type CopyWhat = "condition" | "reason" | "summary" | "verify" | "dossier" | "section" | "attestation" | "tally"
type Command = { id: string; title: string; group: string; palette: true; enabled: () => boolean; run: () => void | Promise<void> | false }

export interface KeymapDeps {
  readonly addLayer: (factory: () => { mode: "global"; commands: Command[] }) => void
  readonly live: (sessionID: string | undefined) => GoalSnapshot | undefined
  readonly currentSession: () => string | undefined
  readonly entries: () => Readonly<Record<string, GoalSnapshotCacheEntry>>
  readonly statusDialogOpen: () => boolean
  readonly setContextOpen: (value: boolean) => void
  readonly setHudSession: (value: string | undefined | ((prev: string | undefined) => string | undefined)) => void
  readonly togglePin: (sessionID: string | undefined) => void
  readonly copyToClipboard: (text: string, sessionID: string, what?: CopyWhat) => void
  readonly requestStatus: () => void
  readonly requestClearGoal: (sessionID: string | undefined) => void
  readonly runDossierAction: (action: (sessionID: string | undefined, goal: GoalSnapshot | null | undefined) => unknown) => void
  readonly exportDossier: (sessionID: string | undefined, goal: GoalSnapshot | null | undefined) => void
  readonly verifyRecordAction: (sessionID: string | undefined, goal: GoalSnapshot | null | undefined) => unknown
  readonly reachRecordAction: (sessionID: string | undefined, goal: GoalSnapshot | null | undefined) => unknown
  readonly signRecordAction: (sessionID: string | undefined, goal: GoalSnapshot | null | undefined) => unknown
  readonly sealRecordAction: (sessionID: string | undefined, goal: GoalSnapshot | null | undefined) => unknown
  readonly attestSealedDossierAction: (sessionID: string | undefined) => void
  readonly reviewRecordAction: (sessionID: string | undefined, goal: GoalSnapshot | null | undefined) => void
  readonly spendLedgerAction: (sessionID: string | undefined, goal: GoalSnapshot | null | undefined) => void
  readonly dossierIndexAction: (sessionID: string | undefined) => void
}

/** Mount the global palette/keymap layer. */
export function registerGlobalKeymap(deps: KeymapDeps): void {
  const { addLayer, live, currentSession, entries, statusDialogOpen, setContextOpen, setHudSession, togglePin, copyToClipboard, requestStatus, requestClearGoal, runDossierAction, exportDossier, verifyRecordAction, reachRecordAction, signRecordAction, sealRecordAction, attestSealedDossierAction, reviewRecordAction, spendLedgerAction, dossierIndexAction } = deps
  addLayer(() => ({
      mode: "global",
      commands: [
        {
          id: "goal.status",
          title: "Goal: show status",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => requestStatus(),
        },
        {
          id: "goal.clear",
          title: "Goal: clear",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession())),
          run: () => requestClearGoal(currentSession()),
        },
        {
          id: "goal.loop.status",
          title: "Goal loop: show status",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession())?.loopEnabled),
          run: () => requestStatus(),
        },
        {
          id: "goal.hud.toggle",
          title: "Goal HUD: toggle card",
          group: "Goal",
          palette: true,
          enabled: () => hudArmEnabled(Boolean(live(currentSession())), statusDialogOpen()),
          run: () => {
            // Same effect as clicking the pill: toggle the compact card for the current session.
            // No-op while the status dialog owns the screen — arming the card behind the modal
            // would paint it beneath the dialog and re-arm its Esc layer.
            try {
              if (statusDialogOpen()) return
              const sessionID = currentSession()
              setContextOpen(false)
              setHudSession((current) => (sessionID && current === sessionID ? undefined : sessionID))
            } catch {}
          },
        },
        {
          id: "goal.pin.toggle",
          title: "Goal: toggle pinned condition",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession())),
          run: () => { try { togglePin(currentSession()) } catch {} },
        },
        {
          id: "goal.condition.copy",
          title: "Goal: copy condition",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal?.condition),
          run: () => {
            try {
              const sessionID = currentSession()
              const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal
              if (goal?.condition && sessionID) copyToClipboard(goal.condition, sessionID)
            } catch {}
          },
        },
        {
          id: "goal.reason.copy",
          title: "Goal: copy evaluator reason",
          group: "Goal",
          palette: true,
          enabled: () => Boolean((live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal)?.reason),
          run: () => {
            try {
              const sessionID = currentSession()
              const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal
              if (goal?.reason && sessionID) copyToClipboard(goal.reason, sessionID, "reason")
            } catch {}
          },
        },
        {
          id: "goal.summary.copy",
          title: "Goal: copy latest loop summary",
          group: "Goal",
          palette: true,
          enabled: () => Boolean((live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal)?.loopHistory?.at(-1)?.summary),
          run: () => {
            try {
              const sessionID = currentSession()
              const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal
              const summary = goal?.loopHistory?.at(-1)?.summary
              if (summary && sessionID) copyToClipboard(summary, sessionID, "summary")
            } catch {}
          },
        },
        {
          id: "goal.dossier.copy",
          title: "Goal: copy loop dossier (markdown)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => {
            try {
              const sessionID = currentSession()
              const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal
              if (goal && sessionID) copyToClipboard(buildLoopDossier(goal, Date.now()), sessionID, "dossier")
            } catch {}
          },
        },
        {
          id: "goal.dossier.export",
          title: "Goal: export loop dossier (markdown file)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => runDossierAction(exportDossier),
        },
        {
          id: "goal.dossier.verify",
          title: "Goal: verify the record (shas + markdown report)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => runDossierAction(verifyRecordAction),
        },
        {
          id: "goal.dossier.reach",
          title: "Goal: verify the record reaches HEAD (shas + markdown report)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => runDossierAction(reachRecordAction),
        },
        {
          id: "goal.dossier.sign",
          title: "Goal: verify the record's signatures (shas + markdown report)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => runDossierAction(signRecordAction),
        },
        {
          id: "goal.dossier.seal",
          title: "Goal: seal the dossier with a fresh attestation (file)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => runDossierAction(sealRecordAction),
        },
        {
          id: "goal.dossier.attest",
          title: "Goal: attest a sealed dossier against HEAD (drift report)",
          group: "Goal",
          palette: true,
          enabled: () => true,
          run: () => {
            try {
              attestSealedDossierAction(currentSession())
            } catch {}
          },
        },
        {
          id: "goal.dossier.review",
          title: "Goal: review the dossier in one file (every question git can answer)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => runDossierAction(reviewRecordAction),
        },
        {
          id: "goal.dossier.spend",
          title: "Goal: export the spend ledger (markdown report)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => runDossierAction(spendLedgerAction),
        },
        {
          id: "goal.dossier.index",
          title: "Goal: index the exported dossier artifacts (markdown)",
          group: "Goal",
          palette: true,
          enabled: () => true,
          run: () => {
            try {
              dossierIndexAction(currentSession())
            } catch {}
          },
        },
        {
          id: "goal.loop.clear",
          title: "Goal loop: clear",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession())?.loopEnabled),
          run: () => requestClearGoal(currentSession()),
        },
      ],
    }))
}
