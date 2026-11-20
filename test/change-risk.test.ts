import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import {
  STRICT_GATE_NOTICE_TITLE,
  classifyChangeRisk,
  collectChangeSetPaths,
  formatStrictGateNotice,
  type ChangeRiskAssessment,
} from "../src/core/change-risk.ts"
import { resolveConfig } from "../src/core/config.ts"
import type { CommitPolicy, GoalSnapshot, Notice, UsageSnapshot } from "../src/core/types.ts"
import { GoalController } from "../src/runtime/controller.ts"
import { GoalStore } from "../src/runtime/store.ts"
import type { Clock, EvaluationRequest, EvaluationResult, StoragePort } from "../src/runtime/ports.ts"

class FakeClock implements Clock {
  t = 1_000_000
  private timers = new Map<number, { at: number; fn: () => void }>()
  private next = 1
  now = () => this.t
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.next++
    this.timers.set(id, { at: this.t + ms, fn })
    return id
  }
  clearTimeout = (id: unknown) => void this.timers.delete(id as number)
}

class MemoryStorage implements StoragePort {
  data = new Map<string, unknown>()
  get = async (key: string) => structuredClone(this.data.get(key))
  set = async (key: string, value: unknown) => void this.data.set(key, structuredClone(value))
  remove = async (key: string) => void this.data.delete(key)
  scan = async ({ prefix }: { prefix: string }) => ({
    entries: [...this.data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) })),
  })
}

const silent = { info() {}, warn() {}, error() {} }

function makeController(dir: string, notices: Notice[]) {
  const storage = new MemoryStorage()
  const store = new GoalStore(storage, () => {})
  let usage: UsageSnapshot | undefined = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  const commit: CommitPolicy = { required: false, branch: "dev", reason: "test" }
  return new GoalController({
    config: resolveConfig({}),
    directory: dir,
    commit,
    clock: new FakeClock(),
    store,
    log: silent,
    newId: (() => {
      let n = 0
      return () => `goal_${++n}`
    })(),
    session: {
      prompt: async () => {},
      synthetic: async () => {},
      usage: async () => usage,
      compact: async () => {},
    },
    evaluator: {
      evaluate: async (_req: EvaluationRequest): Promise<EvaluationResult> => ({ verdict: "not_met", reason: "no" }),
    },
    background: { busy: async () => ({ subagents: 0, shells: 0 }) },
    emitter: {
      changed: (_sid: string, _goal: GoalSnapshot | null) => {},
      notice: (n) => void notices.push(n),
    },
  })
}

function highRiskOnly(a: ChangeRiskAssessment) {
  return a.findings.filter((f) => f.tier === "high").map((f) => f.surface)
}

describe("change-risk classifier", () => {
  test("empty change set is low risk with no findings", () => {
    const a = classifyChangeRisk([])
    expect(a.tier).toBe("low")
    expect(a.highRisk).toBe(false)
    expect(a.findings).toHaveLength(0)
    expect(a.surfaces).toEqual([])
  })

  test("labels deps changes as a high-risk sensitive surface", () => {
    const a = classifyChangeRisk(["package.json", "bun.lock", "go.mod", "requirements.txt", "sub/pyproject.toml"])
    expect(a.highRisk).toBe(true)
    expect(highRiskOnly(a)).toContain("deps")
    const deps = a.findings.find((f) => f.surface === "deps")
    expect(deps?.tier).toBe("high")
    expect(deps?.paths).toContain("package.json")
    expect(deps?.paths).toContain("bun.lock")
  })

  test("labels auth changes as a high-risk sensitive surface", () => {
    const a = classifyChangeRisk(["src/auth/login.ts", "config/credentials.json", "middleware/jwt.ts", "api/session.ts"])
    expect(a.highRisk).toBe(true)
    expect(highRiskOnly(a)).toContain("auth")
    expect(a.findings.find((f) => f.surface === "auth")?.tier).toBe("high")
  })

  test("labels migrations as a high-risk sensitive surface", () => {
    const a = classifyChangeRisk([
      "db/migrations/001_init.sql",
      "prisma/migrations/20261120_add_users/migration.sql",
      "alembic/versions/abc123.py",
    ])
    expect(a.highRisk).toBe(true)
    expect(highRiskOnly(a)).toContain("migrations")
    expect(a.findings.find((f) => f.surface === "migrations")?.tier).toBe("high")
  })

  test("labels CI/release changes as a high-risk sensitive surface", () => {
    const a = classifyChangeRisk([
      ".github/workflows/ci.yml",
      ".gitlab-ci.yml",
      "Jenkinsfile",
      ".circleci/config.yml",
      "scripts/release.sh",
      ".changeset/config.json",
    ])
    expect(a.highRisk).toBe(true)
    expect(highRiskOnly(a)).toContain("ci-release")
    expect(a.findings.find((f) => f.surface === "ci-release")?.tier).toBe("high")
  })

  test("labels data paths as a high-risk sensitive surface", () => {
    const a = classifyChangeRisk(["data/seeds/users.json", "fixtures/orders.json", "backups/prod.dump", "storage/app.sqlite"])
    expect(a.highRisk).toBe(true)
    expect(highRiskOnly(a)).toContain("data")
    expect(a.findings.find((f) => f.surface === "data")?.tier).toBe("high")
  })

  test("labels multiple sensitive surfaces in one change set", () => {
    const a = classifyChangeRisk(["package.json", "src/auth/session.ts", "db/migrations/002.sql", ".github/workflows/release.yml", "data/seed.sql"])
    expect(a.highRisk).toBe(true)
    expect(a.tier).toBe("high")
    expect(a.surfaces).toEqual(["deps", "auth", "migrations", "ci-release", "data"])
  })

  test("non-sensitive paths do not trigger strict-gate tiers", () => {
    const a = classifyChangeRisk(["src/runtime/controller.ts", "README.md", "docs/guide.md", "test/foo.test.ts"])
    expect(a.highRisk).toBe(false)
    expect(a.tier).toBe("low")
    expect(a.findings).toHaveLength(0)
  })

  test("formatStrictGateNotice reports high-risk surfaces and stricter gates", () => {
    const a = classifyChangeRisk(["package.json", "src/auth/login.ts"])
    const body = formatStrictGateNotice(a)
    expect(body).toContain("High-risk sensitive surfaces detected")
    expect(body).toContain("stricter gates apply")
    expect(body).toContain("deps")
    expect(body).toContain("auth")
    expect(body).toContain("[high]")
  })

  test("collectChangeSetPaths is best-effort and returns an array", () => {
    const paths = collectChangeSetPaths(process.cwd())
    expect(Array.isArray(paths)).toBe(true)
  })
})

describe("controller strict-gate notice for high-risk tiers", () => {
  async function withTempGitRepo(run: (dir: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "goal-risk-"))
    try {
      execFileSync("git", ["init", "-q"], { cwd: dir })
      execFileSync("git", ["config", "user.email", "test@test"], { cwd: dir })
      execFileSync("git", ["config", "user.name", "test"], { cwd: dir })
      await writeFile(join(dir, "README.md"), "init\n")
      execFileSync("git", ["add", "README.md"], { cwd: dir })
      execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })
      await run(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  test("surfaces a strict-gate notice when arming a goal in a directory with high-risk changes", async () => {
    await withTempGitRepo(async (dir) => {
      await writeFile(join(dir, "package.json"), "{\"name\":\"x\"}\n")
      await mkdir(join(dir, ".github", "workflows"), { recursive: true })
      await writeFile(join(dir, ".github", "workflows", "ci.yml"), "name: ci\n")
      const notices: Notice[] = []
      const controller = makeController(dir, notices)
      await controller.set({ sessionID: "ses_risk", condition: "do work", delivery: "none" } as any)
      const strict = notices.filter((n) => n.title === STRICT_GATE_NOTICE_TITLE)
      expect(strict.length).toBeGreaterThan(0)
      expect(strict[0]!.kind).toBe("set")
      expect(strict[0]!.level).toBe("warning")
      expect(strict[0]!.message).toContain("High-risk sensitive surfaces detected")
      expect(strict[0]!.message).toContain("deps")
      expect(strict[0]!.message).toContain("ci-release")
    })
  })

  test("does not surface a strict-gate notice when the change set has no high-risk sensitive surfaces", async () => {
    await withTempGitRepo(async (dir) => {
      await writeFile(join(dir, "notes.txt"), "hello\n")
      const notices: Notice[] = []
      const controller = makeController(dir, notices)
      await controller.set({ sessionID: "ses_safe", condition: "do work", delivery: "none" } as any)
      const strict = notices.filter((n) => n.title === STRICT_GATE_NOTICE_TITLE)
      expect(strict).toHaveLength(0)
      expect(notices.some((n) => n.kind === "set" && n.level === "info")).toBe(true)
    })
  })
})
