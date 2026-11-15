import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCRIPT = join(import.meta.dir, "..", "scripts", "docs-watch.ts")

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
}

let dir: string

const git = (args: string[], date?: string) =>
  execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd: dir,
    env: date ? { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : GIT_ENV,
    encoding: "utf8",
  })

const run = (cmd: string) =>
  spawnSync("bun", [SCRIPT, cmd], { cwd: dir, encoding: "utf8", env: GIT_ENV })

const page = (stamp: string) =>
  `<!doctype html><html><body><p>content</p><footer>Last updated: <span class="stamp">${stamp}</span></footer></body></html>\n`

const changelog = `<!doctype html><html><body>
<table><tbody>
<!-- changes:start -->
<!-- changes:end -->
</tbody></table>
<footer>Last updated: <span class="stamp">1999-01-01 00:00 UTC</span></footer>
</body></html>
`

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "docs-watch-test-"))
  git(["init", "-q", "-b", "dev"])
  mkdirSync(join(dir, "docs"), { recursive: true })
  writeFileSync(join(dir, "docs", "page.html"), page("1999-01-01 00:00 UTC"))
  writeFileSync(join(dir, "docs", "changelog.html"), changelog)
  git(["add", "-A"])
  git(["commit", "-q", "-m", "initial docs"], "2026-11-01T10:00:00+00:00")
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("docs-watch check", () => {
  test("fails when a stamp trails the last content commit", () => {
    const result = run("check")
    expect(result.status).toBe(1)
    const out = `${result.stdout}\n${result.stderr}`
    expect(out).toContain("docs freshness check failed")
    expect(out).toContain("docs/page.html")
  })

  test("passes after a restamp refresh commit, then fails again on a content change", () => {
    // Regenerate stamps + changelog from history and commit as the refresh commit.
    expect(run("once").status).toBe(0)
    git(["add", "-A"])
    git(["commit", "-q", "-m", "docs: refresh stamps and changelog"], "2026-11-02T10:00:00+00:00")
    const fresh = run("check")
    expect(fresh.status).toBe(0)
    expect(`${fresh.stdout}`).toContain("docs freshness check passed")

    // A docs content change without a restamp must fail the gate again.
    writeFileSync(join(dir, "docs", "page.html"), page(readFileSync(join(dir, "docs", "page.html"), "utf8").match(/<span class="stamp">([^<]*)<\/span>/)![1] as string).replace("content", "content edited"))
    git(["add", "-A"])
    git(["commit", "-q", "-m", "docs: edit page"], "2026-11-03T10:00:00+00:00")
    const stale = run("check")
    expect(stale.status).toBe(1)
    const out = `${stale.stdout}\n${stale.stderr}`
    expect(out).toContain("docs/page.html")
    expect(out).toContain("docs/changelog.html")

    // Restamp again; the gate goes green.
    expect(run("once").status).toBe(0)
    git(["add", "-A"])
    git(["commit", "-q", "-m", "docs: refresh stamps and changelog"], "2026-11-04T10:00:00+00:00")
    expect(run("check").status).toBe(0)
  })

  test("the refresh commit itself does not trip the anchor", () => {
    expect(run("once").status).toBe(0)
    git(["add", "-A"])
    git(["commit", "-q", "-m", "docs: refresh stamps and changelog"], "2026-11-02T10:00:00+00:00")
    // Stamp must reflect the initial docs commit (2026-11-01), not the refresh commit.
    const html = readFileSync(join(dir, "docs", "page.html"), "utf8")
    expect(html).toContain("2026-11-01 10:00 UTC")
    // Re-running the check in a clean tree passes.
    expect(run("check").status).toBe(0)
  })
})
