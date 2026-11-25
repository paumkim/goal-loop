/**
 * wiring-audit: repeatable, read-only check that the plugin's documented controls are actually connected.
 *
 * It is deliberately mechanical: every check is a source-level assertion with a concrete file and pattern,
 * so a future edit that disconnects a toggle, a command or a keybinding fails this script instead of silently
 * shipping. It covers the two failure modes the shadow audit found:
 *   1. a control defined but never consumed (dead wiring), and
 *   2. a control whose ON branch works but whose OFF branch does not (one-sided wiring), e.g. the mirror flag.
 *
 * Run: bun scripts/wiring-audit.ts
 * Exit 0 = every check passed; exit 1 = at least one check failed (details on stdout).
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8")
const walk = (rel: string, out: string[] = []): string[] => {
  for (const name of readdirSync(join(ROOT, rel))) {
    const full = join(rel, name)
    if (statSync(join(ROOT, full)).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

interface Check {
  readonly id: string
  readonly ok: boolean
  readonly detail: string
}
const checks: Check[] = []
const check = (id: string, ok: boolean, detail: string): void => {
  checks.push({ id, ok, detail })
}
/** A pattern must occur in a named file at least `min` times. */
const pattern = (id: string, file: string, re: RegExp, min = 1): void => {
  const src = read(file)
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`)
  const count = (src.match(global) ?? []).length
  check(id, count >= min, `${file}: ${count} match(es) of ${re}; need >= ${min}`)
}

// ---- 1. every documented GoalConfig field has at least one consumer outside config.ts -----------------
const CONFIG_FIELDS = [
  "mode", "model", "inheritModel", "maxTranscriptChars", "maxOutputTokens", "timeoutMs",
  "verifyCommand", "verifyTimeoutMs", "verifyChecks", "verifyProfile", "verifyConcurrency", "consensus",
  "maxTurns", "stallTurns", "checkinMinutes", "maxIdleCheckins", "maxRetries", "maxConditionChars",
  "systemReminder", "compactAtTokens", "compactOnLoopIteration", "maxLoops", "maxLoopSummaryTokens",
  "learning", "update", "commit",
] as const

const consumerSources = walk("src").filter((f) => f !== "src/core/config.ts")
const consumerText = consumerSources.map(read).join("\n")
const zeroFields = CONFIG_FIELDS.filter((field) => !new RegExp(`\\b${field}\\b`).test(consumerText))
check("config-fields-consumed", zeroFields.length === 0,
  zeroFields.length ? `no consumer for: ${zeroFields.join(", ")}` : `${CONFIG_FIELDS.length}/${CONFIG_FIELDS.length} fields have a consumer`)

// Nested fields that are easy to parse but easy to forget to honor.
pattern("learning-enabled-guard", "src/runtime/controller.ts", /if \(!learning\?\.enabled\) return undefined/)
pattern("learning-path-consumer", "src/runtime/controller.ts", /typeof learning\.path === "string"/)
pattern("update-channel-consumer", "src/index.ts", /config\.update\.channel/)
pattern("update-mode-consumer", "src/index.ts", /config\.update\.mode !== "auto"/, 2)
pattern("commit-enabled-off", "src/core/git.ts", /if \(!request\.enabled\) return \{ required: false/)

// ---- 2. every toggle's OFF branch is reachable --------------------------------------------------------
pattern("maxTurns-zero-disables", "src/runtime/controller.ts", /config\.maxTurns > 0/, 2)
pattern("stallTurns-zero-disables", "src/runtime/controller.ts", /config\.stallTurns > 0/, 2)
pattern("maxRetries-zero-disables", "src/runtime/controller.ts", /config\.maxRetries > 0/, 2)
pattern("compactAtTokens-zero-disables", "src/runtime/controller.ts", /compactAtTokens > 0/)
pattern("compact-on-loop-off", "src/runtime/compactor.ts", /if \(!config\.compactOnLoopIteration\) return \{ requested: false, reason: "disabled" \}/)
pattern("system-reminder-on", "src/hooks.ts", /if \(config\.systemReminder\)/)
pattern("consensus-two-branch", "src/runtime/evaluator.ts", /this\.config\.consensus !== 2/)

// The fixed defect: the mirror flag must gate BOTH the server write and the TUI read.
pattern("mirror-flag-stops-writes", "src/index.ts", /OPENCODE_GOAL_MIRROR !== "0"/)
pattern("mirror-flag-stops-reads", "src/tui.tsx", /OPENCODE_GOAL_MIRROR === "0" \? undefined : createGoalMirror\(\)/)
pattern("mirror-read-is-optional", "src/tui.tsx", /goalMirror\?\.read\(/)

// ---- 3. command + RPC surface parity ------------------------------------------------------------------
pattern("command-goal-registered", "src/index.ts", /addCommand\("goal"/)
pattern("command-loop-registered", "src/index.ts", /addCommand\("goal-loop"/)
pattern("command-reset-context-registered", "src/index.ts", /name: "reset-context"/)
pattern("command-dispatched", "src/index.ts", /await controller\.command\(\{/)

for (const method of ["get", "list", "status", "clear"] as const) {
  pattern(`rpc-${method}-declared`, "src/rpc.ts", new RegExp(`\\b${method}: \\{`))
  pattern(`rpc-${method}-handled`, "src/rpc-handlers.ts", new RegExp(`const ${method} = `))
}
pattern("rpc-registered-at-startup", "src/index.ts", /ctx\.rpc\.register\(GoalRpc, createRpcHandlers/)
pattern("rpc-changed-event-emitted", "src/index.ts", /rpc\.events\.emit\("changed"/)
pattern("rpc-notice-event-emitted", "src/index.ts", /rpc\.events\.emit\("notice"/)

// ---- 4. status-dialog keymap is defined and mounted ----------------------------------------------------
const dialogKeys = read("src/core/dialog-keys.ts")
const binds = [...dialogKeys.matchAll(/bind: "([^"]+)"/g)].map((m) => m[1]!)
const expectedBinds = ["p", "x", "c", "r", "up", "down", "pageup", "pagedown", "home", "end"]
const missingBinds = expectedBinds.filter((b) => !binds.includes(b))
check("dialog-core-binds-defined", missingBinds.length === 0,
  missingBinds.length ? `missing: ${missingBinds.join(", ")}` : `${expectedBinds.length}/${expectedBinds.length} core binds`)
pattern("dialog-keymap-mounted", "src/tui.tsx", /commands: dialogStatusCommands\(\{/)

// Optional chords must be absent when their host dep is absent and present when it is wired.
// Digit chords are generated (`bind: String(row)`), the other two are literals.
for (const [chord, dep, patternText] of [
  ["1", "transcriptFor", "bind: String(row)"],
  ["m", "foreignMoreVisible", 'bind: "m"'],
  ["t", "toggleView", 'bind: "t"'],
] as const) {
  const has = dialogKeys.includes(patternText)
  check(`dialog-chord-${chord}`, has, `"${chord}" present when ${dep} is wired via ${patternText}: ${has}`)
}

// ---- 5. env surface is documented in both public docs -------------------------------------------------
const allSrcText = walk("src").map(read).join("\n")
const envNames = new Set(allSrcText.match(/OPENCODE_GOAL_[A-Z0-9_]+/g) ?? [])
for (const [id, file] of [["env-documented-readme", "README.md"], ["env-documented-config", "docs/config.html"]] as const) {
  const doc = read(file)
  const missing = [...envNames].filter((name) => !doc.includes(name))
  check(id, missing.length === 0, missing.length ? `undocumented: ${missing.join(", ")}` : `${envNames.size}/${envNames.size} vars documented`)
}

// ---- report -------------------------------------------------------------------------------------------
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.id.padEnd(34)} ${c.detail}`)
const failed = checks.filter((c) => !c.ok).length
console.log(`\nwiring-audit: ${checks.length - failed}/${checks.length} checks passed`)
if (failed > 0) process.exit(1)
