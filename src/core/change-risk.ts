import { collectChangedPaths } from "./changed-paths.ts"

export type RiskTier = "low" | "medium" | "high"
export type SensitiveSurface = "deps" | "auth" | "migrations" | "ci-release" | "data"

export interface ChangeRiskFinding {
  readonly surface: SensitiveSurface
  readonly tier: RiskTier
  readonly paths: readonly string[]
}

export interface ChangeRiskAssessment {
  /** Overall tier: highest tier among findings, or "low" when no sensitive surface is present. */
  readonly tier: RiskTier
  /** True when any finding is high-risk (strict-gate trigger). */
  readonly highRisk: boolean
  readonly findings: readonly ChangeRiskFinding[]
  /** Sensitive surfaces detected (stable order). */
  readonly surfaces: readonly SensitiveSurface[]
}

const SURFACE_ORDER: readonly SensitiveSurface[] = ["deps", "auth", "migrations", "ci-release", "data"]

/** Per-surface risk tier. All specified sensitive surfaces are treated as high-risk for strict gating. */
const SURFACE_TIER: Readonly<Record<SensitiveSurface, RiskTier>> = {
  deps: "high",
  auth: "high",
  migrations: "high",
  "ci-release": "high",
  data: "high",
}

const TIER_RANK: Readonly<Record<RiskTier, number>> = { low: 0, medium: 1, high: 2 }

function maxTier(a: RiskTier, b: RiskTier): RiskTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b
}

function norm(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "").trim()
}

function base(path: string): string {
  const n = norm(path)
  const i = n.lastIndexOf("/")
  return i === -1 ? n : n.slice(i + 1)
}

function segments(path: string): string[] {
  return norm(path).toLowerCase().split("/").filter(Boolean)
}

const DEP_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "bun.lock",
  "bun.lockb",
  "cargo.toml",
  "cargo.lock",
  "go.mod",
  "go.sum",
  "gemfile",
  "gemfile.lock",
  "pipfile",
  "pipfile.lock",
  "poetry.lock",
  "uv.lock",
  "composer.json",
  "composer.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "packages.lock.json",
  "directory.packages.props",
  "nuget.config",
  "packages.config",
  ".tool-versions",
])

function isDepsPath(path: string): boolean {
  const b = base(path).toLowerCase()
  if (DEP_BASENAMES.has(b)) return true
  if (/^requirements([.-].+)?\.txt$/i.test(b) || /^requirements.*\.in$/i.test(b)) return true
  if (/\.csproj$/i.test(b) || /\.fsproj$/i.test(b) || /\.vbproj$/i.test(b)) return true
  if (/pyproject\.toml$/i.test(b)) return true
  const segs = segments(path)
  if (segs.includes("vendor") && (b.endsWith(".lock") || b.endsWith(".sum") || b === "modules.txt")) return true
  return false
}

const AUTH_SEGMENT = /^(auth|authentication|authorization|authorize|oauth2?|sso|saml|login|logout|signin|signout|signup|session|sessions|jwt|jwks|credential|credentials|passwd|password|passwords|secret|secrets|token|tokens|apikey|api-key|acl|rbac|permissions?|mfa|2fa|otp)(\..*)?$/i

function isAuthPath(path: string): boolean {
  const segs = segments(path)
  if (segs.some((s) => AUTH_SEGMENT.test(s))) return true
  const b = base(path).toLowerCase()
  return /(^|[._-])(auth|login|oauth|jwt|session|credential|password|secret|token|permission)([._-]|$)/i.test(b)
}

function isMigrationPath(path: string): boolean {
  const segs = segments(path)
  if (segs.some((s) => /^(migrations?|migrate|alembic|flyway|liquibase|dbmate)$/i.test(s))) return true
  // prisma/migrations, db/migrate, supabase/migrations etc.
  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i]!
    const c = segs[i + 1]!
    if ((a === "db" || a === "prisma" || a === "supabase" || a === "drizzle") && /^(migrations?|migrate)$/i.test(c)) return true
  }
  return false
}

function isCiReleasePath(path: string): boolean {
  const n = norm(path).toLowerCase()
  const b = base(path).toLowerCase()
  if (n.includes(".github/workflows/") || n.includes(".github/actions/")) return true
  if (b === "jenkinsfile" || b.startsWith("jenkinsfile.")) return true
  if (b === ".gitlab-ci.yml" || b === ".gitlab-ci.yaml" || b.startsWith(".gitlab-ci")) return true
  if (n.includes(".circleci/") || n.includes(".buildkite/")) return true
  if (/^azure-pipelines/i.test(b) || /^\.travis/i.test(b) || /^appveyor/i.test(b) || /^\.drone/i.test(b) || /^\.woodpecker/i.test(b)) return true
  if (n.includes("/.changeset/") || n.includes("/.changesets/")) return true
  if (/^\.releaserc/i.test(b) || /^release[-_.]/i.test(b) || /^publish[-_.]/i.test(b)) return true
  const segs = segments(path)
  if (segs.includes("release") && (segs.includes("scripts") || segs.includes("ci") || segs.includes(".github") || b.includes("release"))) return true
  if (segs.some((s) => s === "releases") && (b.endsWith(".yml") || b.endsWith(".yaml") || b.endsWith(".ts") || b.endsWith(".js") || b.endsWith(".sh"))) return true
  if (segs.includes("ci") && (b.endsWith(".yml") || b.endsWith(".yaml") || b.endsWith(".sh") || b.endsWith(".ts") || b.endsWith(".js"))) return true
  return false
}

function isDataPath(path: string): boolean {
  const segs = segments(path)
  const b = base(path).toLowerCase()
  if (segs.some((s) => /^(data|database|datastore|datasets?|seeds?|seeders?|fixtures?|backups?|snapshots?|dumps?)$/i.test(s))) return true
  if (segs.includes("db") && !segs.some((s) => /^(migrations?|migrate)$/i.test(s))) {
    // db/ as a data/storage directory (not db/migrate which is migrations)
    // treat db/data-like usage as data path, but avoid generic "db" in source names; require it be a directory segment context
    const idx = segs.indexOf("db")
    if (idx !== -1 && idx < segs.length - 1) return true
  }
  if (/\.(sqlite|sqlite3|db|dump|sql\.gz|bak)$/i.test(b)) return true
  return false
}

const SURFACE_MATCHERS: Readonly<Record<SensitiveSurface, (path: string) => boolean>> = {
  deps: isDepsPath,
  auth: isAuthPath,
  migrations: isMigrationPath,
  "ci-release": isCiReleasePath,
  data: isDataPath,
}

/**
 * Classify a change set (file paths) by sensitive surfaces and risk tier.
 * Pure and deterministic: no I/O.
 */
export function classifyChangeRisk(paths: readonly string[]): ChangeRiskAssessment {
  const bySurface = new Map<SensitiveSurface, string[]>()
  for (const raw of paths) {
    const path = norm(raw)
    if (!path) continue
    for (const surface of SURFACE_ORDER) {
      if (!SURFACE_MATCHERS[surface](path)) continue
      const arr = bySurface.get(surface) ?? []
      arr.push(path)
      bySurface.set(surface, arr)
    }
  }
  const findings: ChangeRiskFinding[] = []
  let tier: RiskTier = "low"
  for (const surface of SURFACE_ORDER) {
    const matched = bySurface.get(surface)
    if (!matched || matched.length === 0) continue
    const st = SURFACE_TIER[surface]
    tier = maxTier(tier, st)
    findings.push({ surface, tier: st, paths: [...matched] })
  }
  const surfaces = findings.map((f) => f.surface)
  const highRisk = findings.some((f) => f.tier === "high")
  return { tier, highRisk, findings, surfaces }
}

/** Format a strict-gate notice body for a high-risk assessment. */
export function formatStrictGateNotice(assessment: ChangeRiskAssessment): string {
  if (!assessment.highRisk || assessment.findings.length === 0) return "No high-risk sensitive surfaces detected."
  const parts = assessment.findings
    .filter((f) => f.tier === "high")
    .map((f) => {
      const count = f.paths.length
      const sample = f.paths.slice(0, 3).join(", ")
      const more = count > 3 ? `, +${count - 3} more` : ""
      return `${f.surface} [${f.tier}] (${count}): ${sample}${more}`
    })
  return `High-risk sensitive surfaces detected; stricter gates apply before merge/landing.\n${parts.join("\n")}`
}

/** Notice title for a high-risk strict-gate surface event. */
export const STRICT_GATE_NOTICE_TITLE = "Strict gate: high-risk change set"

/** Best-effort collection of changed paths in a git working directory (working tree/index + commits ahead of base). */
export function collectChangeSetPaths(directory: string): string[] {
  return collectChangedPaths(directory, { untrackedFiles: "all", bestEffort: true })
}
