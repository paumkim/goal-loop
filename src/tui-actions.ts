/**
 * Dossier/receipt actions shared by the status dialog and the palette. Kept out of the TUI setup
 * function: these actions depend only on toasts and the renderer's clipboard, not on view state.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { exportLoopDossier } from "./core/dossier-export.ts"
import { gitCatFileProbe, verifyRecord, verifyReportMarkdown, verifySummaryLine, type VerifyOutcome } from "./core/verify-record.ts"
import { gitAncestorProbe, reachRecord, reachReportMarkdown, reachSummaryLine, type ReachOutcome } from "./core/reach-record.ts"
import { gitSignProbe, signRecord, signReportMarkdown, signSummaryLine, type SignOutcome } from "./core/sign-record.ts"
import { exportSealedDossier, sealSummaryLine, type SealOutcome } from "./core/dossier-seal.ts"
import { exportReview, reviewSummaryLine } from "./core/dossier-review.ts"
import { exportSpendLedger, spendSummaryLine } from "./core/spend-ledger.ts"
import { exportDossierIndex, dossierIndexSummaryLine } from "./core/dossier-index.ts"
import { sealedDossierCandidates, attestSealedDossier, attestationReportMarkdown, attestSummaryLine, selectNewestSealedDossier } from "./core/dossier-attest.ts"
import type { GoalSnapshot } from "./core/types.ts"

type ToastOptions = { title: string; message: string; variant?: "info" | "success" | "warning" | "error"; sessionID?: string; duration?: number }

export interface DossierActionDeps {
  readonly copyToClipboard: (report: string) => boolean
  readonly safeToast: (options: ToastOptions) => void
  readonly toastError: (title: string, error: unknown, sessionID?: string, detail?: string) => void
}

export function createDossierActions(deps: DossierActionDeps) {
  const { safeToast, toastError } = deps
  const copyReport = (report: string): boolean => {
    try {
      return deps.copyToClipboard(report)
    } catch {
      return false
    }
  }
    const exportDossier = (sessionID: string | undefined, goal: GoalSnapshot | null | undefined) => {
      if (!goal || !sessionID) return
      try {
        const result = exportLoopDossier(goal, Date.now(), process.cwd())
        safeToast({ title: "dossier exported", message: result.path, variant: "success", duration: 5_000, sessionID })
      } catch (error) {
        toastError("export failed", error, sessionID)
      }
    }
    // The record, on trial: sweep every sha the ledger quotes against the repository at the host's cwd, copy the Markdown verification report, toast the outcome. The dialog row paints the same counts through its in-place ack. Unknown is never folded into missing; a sweep that cannot probe (no git, not a repository) comes back all-unknown and says so.
    const verifyRecordAction = (sessionID: string | undefined, goal: GoalSnapshot | null | undefined): VerifyOutcome | undefined => {
      if (!goal || !sessionID) return undefined
      try {
        const directory = process.cwd()
        const verification = verifyRecord(goal, gitCatFileProbe(directory))
        const report = verifyReportMarkdown(goal, verification, Date.now(), directory)
        const copied = copyReport(report)
        const summary = verifySummaryLine(verification)
        const title = verification.missing > 0 ? "record does not verify" : verification.unknown > 0 ? "record unverifiable" : verification.unique === 0 ? "nothing to verify" : "record verified"
        const variant = verification.missing > 0 ? "error" : verification.unknown > 0 ? "warning" : "success"
        safeToast({ title, message: copied ? summary : `${summary} · clipboard unavailable`, variant, duration: 6_000, sessionID })
        return verification
      } catch (error) {
        toastError("verify failed", error, sessionID)
        return undefined
      }
    }
    // The record, in reach: ask whether every sha the ledger quotes is an ancestor of HEAD at the host's cwd, copy the Markdown ancestry report, toast the outcome. The dialog row paints the same counts through its in-place ack. Not on this line is not misconduct (another branch, a rewrite, a record that predates the merge); unknown is never folded into no; a sweep that cannot probe comes back all-unknown and says so.
    const reachRecordAction = (sessionID: string | undefined, goal: GoalSnapshot | null | undefined): ReachOutcome | undefined => {
      if (!goal || !sessionID) return undefined
      try {
        const directory = process.cwd()
        const reach = reachRecord(goal, gitAncestorProbe(directory))
        const report = reachReportMarkdown(goal, reach, Date.now(), directory)
        const copied = copyReport(report)
        const summary = reachSummaryLine(reach)
        const title = reach.unreached > 0 ? "record does not reach HEAD" : reach.unknown > 0 ? "record unverifiable" : reach.unique === 0 ? "nothing to place" : "record reaches HEAD"
        const variant = reach.unreached > 0 || reach.unknown > 0 ? "warning" : "success"
        safeToast({ title, message: copied ? summary : `${summary} · clipboard unavailable`, variant, duration: 6_000, sessionID })
        return reach
      } catch (error) {
        toastError("reach check failed", error, sessionID)
        return undefined
      }
    }
    // The record, under seal: ask whether git verifies a signature on every sha the ledger quotes at the host's cwd, copy the Markdown signature report, toast the outcome. The dialog row paints the same counts through its in-place ack. Not signed is not misconduct (git decides by its own rules against the keys it trusts here; most commits are unsigned); unknown is never folded into not signed; a sweep that cannot probe comes back all-unknown and says so.
    const signRecordAction = (sessionID: string | undefined, goal: GoalSnapshot | null | undefined): SignOutcome | undefined => {
      if (!goal || !sessionID) return undefined
      try {
        const directory = process.cwd()
        const sign = signRecord(goal, gitSignProbe(directory))
        const report = signReportMarkdown(goal, sign, Date.now(), directory)
        const copied = copyReport(report)
        const summary = signSummaryLine(sign)
        const title = sign.unverified > 0 ? "record not under seal" : sign.unknown > 0 ? "record unverifiable" : sign.unique === 0 ? "nothing to attest" : "record under seal"
        const variant = sign.unverified > 0 || sign.unknown > 0 ? "warning" : "success"
        safeToast({ title, message: copied ? summary : `${summary} · clipboard unavailable`, variant, duration: 6_000, sessionID })
        return sign
      } catch (error) {
        toastError("sign check failed", error, sessionID)
        return undefined
      }
    }
    // The sealed dossier, on trial again: re-probe every sha named in the newest `goal-dossier-sealed-*.md` in the host's cwd against the repository here, copy the Markdown drift report, toast the outcome. This answers what the counterparty holding the file asks later: is what the file attested still true. Drift means git flipped a yes to a no since sealing — an error is never the right variant for that (the repository moved, or the seal was made elsewhere; that is information, not misconduct). No file, an unsealed file, and an unparsable appendix are named as such; `unknown` is never folded into `regressed`.
    const attestSealedDossierAction = (sessionID: string | undefined) => {
      try {
        const directory = process.cwd()
        let candidates: { name: string; mtimeMs: number }[]
        try {
          candidates = sealedDossierCandidates(readdirSync(directory), (name) => {
            try {
              return statSync(join(directory, name)).mtimeMs
            } catch {
              return 0
            }
          })
        } catch (error) {
          toastError("attest failed", error, sessionID, `cannot read ${directory}`)
          return
        }
        const newest = selectNewestSealedDossier(candidates)
        if (!newest) {
          safeToast({ title: "no sealed dossier", message: `no goal-dossier-sealed-*.md in ${directory} — seal one first with goal.dossier.seal`, variant: "warning", duration: 6_000, sessionID })
          return
        }
        let markdown: string
        try {
          markdown = readFileSync(join(directory, newest), "utf8")
        } catch (error) {
          toastError("attest failed", error, sessionID, `cannot read ${newest}`)
          return
        }
        const result = attestSealedDossier(markdown, directory)
        if (result.kind === "unsealed") {
          safeToast({ title: "not a sealed dossier", message: `${newest} carries no attestation appendix`, variant: "warning", duration: 6_000, sessionID })
          return
        }
        if (result.kind === "unparsable") {
          safeToast({ title: "attestation unreadable", message: `${newest}: the appendix heading is present but no row parses`, variant: "warning", duration: 6_000, sessionID })
          return
        }
        const report = attestationReportMarkdown(result, Date.now(), directory, newest)
        const copied = copyReport(report)
        const summary = attestSummaryLine(result)
        const title = result.regressed > 0 ? "attestation drifted" : result.unknown > 0 ? "attestation unverifiable" : result.unique === 0 ? "nothing to attest" : "attestation holds"
        const variant = result.regressed > 0 || result.unknown > 0 ? "warning" : "success"
        safeToast({ title, message: copied ? summary : `${summary} · clipboard unavailable`, variant, duration: 6_000, sessionID })
      } catch (error) {
        toastError("attest failed", error, sessionID)
      }
    }
    // The review, in one file: run all three sweeps (existence, ancestry, the seal) against the repository at the host's cwd and write one O_EXCL file — the record's own bytes, then a combined appendix whose rows carry every answer git gave, per sha, with one verdict column. This is the artifact a reviewer opens cold; the standalone verify/reach/sign reports remain available one question at a time. Gaps and unknowns toast a warning, never an error: the appendix says what git answered, and git's thresholds differ across machines and time — information is not accusation.
    const reviewRecordAction = (sessionID: string | undefined, goal: GoalSnapshot | null | undefined) => {
      if (!goal || !sessionID) return
      try {
        const result = exportReview(goal, Date.now(), process.cwd())
        const summary = reviewSummaryLine(result)
        const title = result.unique === 0 ? "nothing to review" : result.gaps > 0 ? "review written with gaps" : result.unknown > 0 ? "review unverifiable" : "review written"
        const variant = result.gaps > 0 || result.unknown > 0 ? "warning" : "success"
        safeToast({ title, message: `${result.path} · ${summary}`, variant, duration: 6_000, sessionID })
      } catch (error) {
        toastError("review failed", error, sessionID)
      }
    }
    // The spend story, one file: write one O_EXCL markdown spend report — one row per landed loop iteration (the harness's usage delta: cost, tokens in/out/reasoning, cache read/write, tool calls, sha), then totals over exactly the measured iterations, then an honesty footer. Partial measurement says so and never reads as $0.00; an unmeasured iteration renders —. This is the artifact for capacity retros and evaluator cost audits; the dossier remains the whole-record story.
    const spendLedgerAction = (sessionID: string | undefined, goal: GoalSnapshot | null | undefined) => {
      if (!goal || !sessionID) return
      try {
        const result = exportSpendLedger(goal, Date.now(), process.cwd())
        const summary = spendSummaryLine(result)
        const title = result.iterations === 0 ? "nothing to report" : result.measured < result.iterations ? "spend ledger written (partial)" : "spend ledger written"
        const variant = result.iterations === 0 || result.measured < result.iterations ? "warning" : "success"
        safeToast({ title, message: `${result.path} · ${summary}`, variant, duration: 6_000, sessionID })
      } catch (error) {
        toastError("spend report failed", error, sessionID)
      }
    }
    // The record, sealed: run all three sweeps (existence, ancestry, the seal) against the repository at the host's cwd and write the sealed dossier — the record's own bytes plus a freshly probed attestation appendix — as one O_EXCL file. Never overwrites; a failed write says so instead of failing silently. Gaps and unknowns toast a warning, never an error: the appendix says what git answered, and git's thresholds differ across machines and time — information is not accusation.
    const sealRecordAction = (sessionID: string | undefined, goal: GoalSnapshot | null | undefined): SealOutcome | undefined => {
      if (!goal || !sessionID) return undefined
      try {
        const result = exportSealedDossier(goal, Date.now(), process.cwd())
        const summary = sealSummaryLine(result)
        const title = result.unique === 0 ? "nothing to seal" : result.clean === result.unique ? "record sealed" : "record sealed with gaps"
        const variant = result.clean === result.unique ? "success" : "warning"
        safeToast({ title, message: `${result.path} · ${summary}`, variant, duration: 6_000, sessionID })
        return result
      } catch (error) {
        toastError("seal failed", error, sessionID)
        return undefined
      }
    }
    // The inventory, one file: scan the host's cwd for the dossier family's exported artifacts (goal-dossier-*.md, goal-dossier-review-*.md, goal-dossier-sealed-*.md, goal-spend-ledger-*.md, and previous goal-dossier-index-*.md files) and write ONE O_EXCL markdown index — file name, kind, bytes (UTF-8), sha256 — then totals, then an honesty footer. The index inventories; it does not verify. A previous index is listed as kind index; the index being written never lists itself. Enabled always: it reads files, not the record.
    const dossierIndexAction = (sessionID: string | undefined) => {
      try {
        const result = exportDossierIndex(Date.now(), process.cwd())
        const summary = dossierIndexSummaryLine(result)
        const title = result.artifacts === 0 ? "no artifacts found" : result.skipped > 0 ? "index written with gaps" : "dossier index written"
        const variant = result.artifacts === 0 || result.skipped > 0 ? "warning" : "success"
        safeToast({ title, message: `${result.path} · ${summary}`, variant, duration: 6_000, sessionID })
      } catch (error) {
        toastError("index failed", error, sessionID)
      }
    }
  return { exportDossier, verifyRecordAction, reachRecordAction, signRecordAction, attestSealedDossierAction, reviewRecordAction, spendLedgerAction, sealRecordAction, dossierIndexAction }
}
