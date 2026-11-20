/**
 * Tests for the update system in bin/goal-loop.mjs: channel resolution from GitHub,
 * preferences stored in plugins[].options.update, and the surgical rewrite of the plugin pin.
 * Every network call is stubbed through `opts.fetch`; no test touches github.com or the real HOME.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readUpdatePrefs,
  writeUpdatePrefs,
  resolveLatestRef,
  update,
  setChannel,
  setUpdates,
  status,
  runCli,
  install,
  uninstall,
} from "../bin/goal-loop.mjs";

function fakeHome(): { home: string; xdg: string; dir: string; file: string } {
  const home = mkdtempSync(join(tmpdir(), "goal-loop-update-test-"));
  const xdg = join(home, "xdg");
  const dir = join(xdg, "opencode");
  mkdirSync(dir, { recursive: true });
  return { home, xdg, dir, file: join(dir, "opencode.jsonc") };
}

function envFor(home: string, xdg: string): NodeJS.ProcessEnv {
  return { HOME: home, XDG_CONFIG_HOME: xdg, PATH: process.env.PATH ?? "" };
}

function fixture(f: ReturnType<typeof fakeHome>, spec = "github:paumkim/goal-loop#v1.2.0", options?: Record<string, unknown>): void {
  const entry = options === undefined ? JSON.stringify(spec) : JSON.stringify({ package: spec, options });
  writeFileSync(f.file, `{\n  "$schema": "https://opencode.ai/config.json",\n  "model": "test/model",\n  "plugins": [\n    ${entry}\n  ]\n}\n`);
}

/** Route by URL fragment; unknown URLs fail loudly so a typo in the implementation cannot pass. */
function stubFetch(routes: Record<string, unknown>) {
  return async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected URL: ${url}`);
    const value = routes[key];
    if (value instanceof Error) throw value;
    return { ok: true, status: 200, json: async () => value };
  };
}

const releaseRoutes = (tag = "v2.0.0") => ({
  "/tags": [{ name: tag }, { name: "v1.0.0" }, { name: "rescue/dev-0f2d75d" }],
  "/releases/latest": { tag_name: tag, html_url: "https://github.com/paumkim/goal-loop/releases/tag/v2.0.0" },
});
const devRoutes = (sha = "abcdef1234567890abcdef1234567890abcdef12") => ({ "/commits/dev": { sha } });

describe("update preferences (plugins[].options.update)", () => {
  test("defaults to main + auto with no options", () => {
    const f = fakeHome();
    try {
      fixture(f);
      expect(readUpdatePrefs([], { env: envFor(f.home, f.xdg), cwd: f.home })).toEqual({ channel: "main", mode: "auto" });
      expect(existsSync(join(f.dir, "goal-loop.json"))).toBe(false); // no sidecar file
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });

  test("writes and reads channel/mode; invalid values fall back to defaults", () => {
    const f = fakeHome();
    const opts = { env: envFor(f.home, f.xdg), cwd: f.home };
    try {
      fixture(f);
      writeUpdatePrefs([], opts, { channel: "dev", mode: "off" });
      expect(readUpdatePrefs([], opts)).toEqual({ channel: "dev", mode: "off" });
      const text = readFileSync(f.file, "utf8");
      expect(text).toContain('"update":');
      expect(text).toContain('"channel":"dev"');
      expect(text).toContain('"mode":"off"');
      expect(existsSync(join(f.dir, "goal-loop.json"))).toBe(false);
      fixture(f, "github:paumkim/goal-loop#v1.2.0", { update: { channel: "experimental", mode: "sometimes" } });
      expect(readUpdatePrefs([], opts)).toEqual({ channel: "main", mode: "auto" });
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });

  test("unrelated options and config keys survive a preference write", () => {
    const f = fakeHome();
    const opts = { env: envFor(f.home, f.xdg), cwd: f.home };
    try {
      fixture(f, "github:paumkim/goal-loop#v1.2.0", { maxLoops: 7, evaluator: { mode: "independent" } });
      writeUpdatePrefs([], opts, { channel: "dev", mode: "auto" });
      const text = readFileSync(f.file, "utf8");
      expect(text).toContain('"maxLoops":7');
      expect(text).toContain('"evaluator":{"mode":"independent"}');
      expect(text).toContain('"model": "test/model"');
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });
});

describe("channel ref resolution", () => {
  test("main uses the newest semver tag and normalizes the v prefix", async () => {
    const r = await resolveLatestRef("main", { fetch: stubFetch(releaseRoutes("1.3.0")) } as never);
    expect(r).toMatchObject({ channel: "main", ref: "v1.3.0", label: "v1.3.0" });
    expect(r.spec).toBe("github:paumkim/goal-loop#v1.3.0");
  });

  test("main picks the newest semver tag, not merely the newest GitHub Release", async () => {
    const r = await resolveLatestRef("main", {
      fetch: stubFetch({ "/tags": [{ name: "v1.2.0" }, { name: "v1.10.0" }, { name: "v1.9.9" }], "/releases/latest": { tag_name: "v1.2.0" } }),
    } as never);
    expect(r.ref).toBe("v1.10.0");
    expect(r.source).toBe("latest tag");
  });

  test("main falls back to package.json on the raw main branch when no tags or release exist", async () => {
    const r = await resolveLatestRef("main", { fetch: stubFetch({ "/tags": new Error("HTTP 404"), "/releases/latest": new Error("HTTP 404"), "/main/package.json": { version: "1.4.2" } }) } as never);
    expect(r.ref).toBe("v1.4.2");
    expect(r.source).toBe("latest release");
  });

  test("dev pins the latest commit SHA, not a floating branch name", async () => {
    const r = await resolveLatestRef("dev", { fetch: stubFetch(devRoutes("1234567890abcdef1234567890abcdef12345678")) } as never);
    expect(r.channel).toBe("dev");
    expect(r.ref).toBe("1234567890abcdef1234567890abcdef12345678");
    expect(r.label).toBe("1234567");
    expect(r.spec).toBe("github:paumkim/goal-loop#1234567890abcdef1234567890abcdef12345678");
  });

  test("an unusable GitHub response fails closed with a clear error", async () => {
    await expect(resolveLatestRef("dev", { fetch: stubFetch({ "/commits/dev": { sha: "not-a-sha" } }) } as never)).rejects.toThrow("no usable sha");
  });
});

describe("update", () => {
  test("--check reports an available update without touching the config", async () => {
    const f = fakeHome();
    const opts = { env: envFor(f.home, f.xdg), cwd: f.home, fetch: stubFetch(releaseRoutes()) };
    try {
      fixture(f);
      const before = readFileSync(f.file, "utf8");
      const r = await update(["--check"], opts as never);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("update available: v1.2.0 → v2.0.0");
      expect(readFileSync(f.file, "utf8")).toBe(before);
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });

  test("applies the update: rewrites only the pin, keeps options and unrelated keys, backs up the file", async () => {
    const f = fakeHome();
    const opts = { env: envFor(f.home, f.xdg), cwd: f.home, fetch: stubFetch(releaseRoutes()) };
    try {
      fixture(f, "github:paumkim/goal-loop#v1.2.0", { update: { channel: "main", mode: "auto" }, maxLoops: 7 });
      const r = await update([], opts as never);
      expect(r.code).toBe(0);
      const text = readFileSync(f.file, "utf8");
      expect(text).toContain('"package":"github:paumkim/goal-loop#v2.0.0"');
      expect(text).toContain('"maxLoops":7');
      expect(text).toContain('"channel":"main"');
      expect(text).toContain('"model": "test/model"');
      expect(r.stdout).toContain("restart opencode");
      expect(readdirSync(f.dir).filter((n) => n.endsWith(".bak")).length).toBe(1);
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });

  test("an already-current pin is a no-op", async () => {
    const f = fakeHome();
    const opts = { env: envFor(f.home, f.xdg), cwd: f.home, fetch: stubFetch(releaseRoutes("1.2.0")) };
    try {
      fixture(f);
      const before = readFileSync(f.file, "utf8");
      const r = await update([], opts as never);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("up to date");
      expect(readFileSync(f.file, "utf8")).toBe(before);
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });

  test("a network failure is reported and never rewrites the config", async () => {
    const f = fakeHome();
    const opts = { env: envFor(f.home, f.xdg), cwd: f.home, fetch: stubFetch({ "/tags": new Error("offline"), "/releases/latest": new Error("offline"), "/main/package.json": new Error("offline") }) };
    try {
      fixture(f);
      const before = readFileSync(f.file, "utf8");
      const r = await update([], opts as never);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("update check failed");
      expect(readFileSync(f.file, "utf8")).toBe(before);
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });

  test("plugin not installed fails with an instruction instead of creating a duplicate entry", async () => {
    const f = fakeHome();
    const opts = { env: envFor(f.home, f.xdg), cwd: f.home, fetch: stubFetch(releaseRoutes()) };
    try {
      writeFileSync(f.file, '{"model":"test/model"}\n');
      const r = await update([], opts as never);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("goal-loop install");
      expect(readFileSync(f.file, "utf8")).toBe('{"model":"test/model"}\n');
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });
});

describe("channel and update mode", () => {
  test("switching to dev writes the option and pins the dev SHA in one atomic write", async () => {
    const f = fakeHome();
    const opts = { env: envFor(f.home, f.xdg), cwd: f.home, fetch: stubFetch(devRoutes()) };
    try {
      fixture(f);
      const r = await setChannel(["dev"], opts as never);
      expect(r.code).toBe(0);
      const text = readFileSync(f.file, "utf8");
      expect(text).toContain("github:paumkim/goal-loop#abcdef1234567890abcdef1234567890abcdef12");
      expect(readUpdatePrefs([], opts)).toEqual({ channel: "dev", mode: "auto" });
      expect(readdirSync(f.dir).filter((n) => n.endsWith(".bak")).length).toBe(1);
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });

  test("switching back to main pins the stable tag again", async () => {
    const f = fakeHome();
    const opts = { env: envFor(f.home, f.xdg), cwd: f.home, fetch: stubFetch(releaseRoutes("2.1.0")) };
    try {
      fixture(f, "github:paumkim/goal-loop#dev", { update: { channel: "dev", mode: "auto" } });
      const r = await setChannel(["main"], opts as never);
      expect(r.code).toBe(0);
      expect(readFileSync(f.file, "utf8")).toContain("github:paumkim/goal-loop#v2.1.0");
      expect(readUpdatePrefs([], opts).channel).toBe("main");
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });

  test("off disables checks entirely; auto re-enables them", async () => {
    const f = fakeHome();
    const opts = { env: envFor(f.home, f.xdg), cwd: f.home, fetch: stubFetch(releaseRoutes()) };
    try {
      fixture(f);
      expect(setUpdates(["off"], opts).code).toBe(0);
      const r = await update([], opts as never);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("update mode is off");
      expect(readFileSync(f.file, "utf8")).toContain("#v1.2.0");
      expect(setUpdates(["auto"], opts).code).toBe(0);
      expect((await update(["--check"], opts as never)).stdout).toContain("update available");
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });

  test("invalid channel/update-mode values are rejected with code 2", async () => {
    const f = fakeHome();
    const opts = { env: envFor(f.home, f.xdg), cwd: f.home };
    try {
      expect((await setChannel(["beta"], opts as never)).code).toBe(2);
      expect(setUpdates(["maybe"], opts).code).toBe(2);
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });
});

describe("status and runCli", () => {
  test("status reports installed ref, channel and update mode", () => {
    const f = fakeHome();
    const opts = { env: envFor(f.home, f.xdg), cwd: f.home };
    try {
      fixture(f, "github:paumkim/goal-loop#dev", { update: { channel: "dev", mode: "off" } });
      const r = status([], opts);
      expect(r.stdout).toContain("installed: yes (github:paumkim/goal-loop#dev)");
      expect(r.stdout).toContain("channel:  dev");
      expect(r.stdout).toContain("mode:     off");
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });

  test("runCli dispatches update with --check and rejects --check for status", async () => {
    const f = fakeHome();
    const opts = { env: envFor(f.home, f.xdg), cwd: f.home, fetch: stubFetch(releaseRoutes()) };
    try {
      fixture(f);
      const r = await runCli(["update", "--check"], opts as never);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("update available");
      expect((await runCli(["status", "--check"], opts as never)).code).toBe(2);
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });
});

describe("install/uninstall with an updated pin", () => {
  test("install does not stack a second entry when the config carries a newer pin", () => {
    const f = fakeHome();
    const opts = { env: envFor(f.home, f.xdg), cwd: f.home };
    try {
      fixture(f, "github:paumkim/goal-loop#v9.9.9");
      const r = install([], opts);
      expect(r.code).toBe(0);
      expect(r.stdout.toLowerCase()).toContain("already installed");
      expect((readFileSync(f.file, "utf8").match(/github:paumkim\/goal-loop/g) ?? []).length).toBe(1);
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });

  test("uninstall removes a dev-channel SHA pin and its options", () => {
    const f = fakeHome();
    const opts = { env: envFor(f.home, f.xdg), cwd: f.home };
    try {
      fixture(f, "github:paumkim/goal-loop#abcdef1234567890abcdef1234567890abcdef12", { update: { channel: "dev", mode: "auto" } });
      const r = uninstall([], opts);
      expect(r.code).toBe(0);
      expect(readFileSync(f.file, "utf8")).not.toContain("goal-loop");
    } finally { rmSync(f.home, { recursive: true, force: true }); }
  });
});
