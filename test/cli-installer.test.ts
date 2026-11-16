/**
 * Tests for bin/opencode-goal.mjs — the install/uninstall CLI for the
 * opencode-goal plugin on OpenCode v2.
 *
 * Every test operates on throwaway directories created under the OS temp dir.
 * The real ~/.config/opencode is never touched: scope resolution and home
 * detection are driven by an injected env, never by process.env.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import {
  PLUGIN_PACKAGE,
  PLUGIN_SPEC,
  resolveScope,
  install,
  uninstall,
  status,
  runCli,
} from "../bin/opencode-goal.mjs";

function fakeHome(): string {
  return mkdtempSync(join(tmpdir(), "opencode-goal-test-home-"));
}

function envFor(home: string, xdg?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HOME: home, PATH: process.env.PATH ?? "" };
  if (xdg !== undefined) env.XDG_CONFIG_HOME = xdg;
  return env;
}

function writeGlobalConfig(home: string, file: string, content: string): string {
  const dir = join(home, ".config", "opencode");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, file);
  writeFileSync(p, content);
  return p;
}

const STRICT = `{\n  "$schema": "https://opencode.ai/config.json",\n  "model": "test/model"\n}\n`;

describe("resolveScope (detection)", () => {
  test("global scope uses XDG_CONFIG_HOME when set", () => {
    const home = fakeHome();
    const xdg = join(home, "xdg");
    const r = resolveScope(["--global"], { env: envFor(home, xdg), cwd: home });
    expect(r.dir).toBe(join(xdg, "opencode"));
    expect(r.file).toBe(join(xdg, "opencode", "opencode.jsonc"));
    rmSync(home, { recursive: true, force: true });
  });

  test("global scope falls back to ~/.config/opencode", () => {
    const home = fakeHome();
    const r = resolveScope([], { env: envFor(home), cwd: home });
    expect(r.dir).toBe(join(home, ".config", "opencode"));
    rmSync(home, { recursive: true, force: true });
  });

  test("global prefers an existing opencode.jsonc over opencode.json, else opencode.json, else creates opencode.jsonc", () => {
    const home = fakeHome();
    const both = join(home, ".config", "opencode");
    mkdirSync(both, { recursive: true });
    writeFileSync(join(both, "opencode.json"), "{}");
    writeFileSync(join(both, "opencode.jsonc"), "{}");
    expect(resolveScope([], { env: envFor(home), cwd: home }).file).toBe(join(both, "opencode.jsonc"));
    rmSync(join(both, "opencode.jsonc"));
    expect(resolveScope([], { env: envFor(home), cwd: home }).file).toBe(join(both, "opencode.json"));
    rmSync(join(both, "opencode.json"));
    expect(resolveScope([], { env: envFor(home), cwd: home }).file).toBe(join(both, "opencode.jsonc"));
    rmSync(home, { recursive: true, force: true });
  });

  test("project scope follows v2 discovery: opencode.json, then opencode.jsonc, then .opencode/ variants, first existing wins", () => {
    const home = fakeHome();
    const proj = join(home, "proj");
    mkdirSync(join(proj, ".opencode"), { recursive: true });
    writeFileSync(join(proj, ".opencode", "opencode.jsonc"), "{}");
    expect(resolveScope(["--project"], { env: envFor(home), cwd: proj }).file).toBe(join(proj, ".opencode", "opencode.jsonc"));
    writeFileSync(join(proj, "opencode.json"), "{}");
    expect(resolveScope(["--project"], { env: envFor(home), cwd: proj }).file).toBe(join(proj, "opencode.json"));
    writeFileSync(join(proj, "opencode.jsonc"), "{}");
    // v2 discovery checks opencode.json before opencode.jsonc — first existing wins
    expect(resolveScope(["--project"], { env: envFor(home), cwd: proj }).file).toBe(join(proj, "opencode.json"));
    rmSync(home, { recursive: true, force: true });
  });

  test("project scope with no existing config creates ./opencode.json (the binary's project default)", () => {
    const home = fakeHome();
    const proj = join(home, "proj2");
    mkdirSync(proj, { recursive: true });
    expect(resolveScope(["--project"], { env: envFor(home), cwd: proj }).file).toBe(join(proj, "opencode.json"));
    rmSync(home, { recursive: true, force: true });
  });
});

describe("install", () => {
  test("creates the global config when none exists (skeleton with $schema and plugins entry)", () => {
    const home = fakeHome();
    const r = install([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    const file = join(home, ".config", "opencode", "opencode.jsonc");
    const text = readFileSync(file, "utf8");
    expect(text).toContain(PLUGIN_SPEC);
    expect(text).toContain("$schema");
    expect(r.stdout).toContain("restart opencode");
    rmSync(home, { recursive: true, force: true });
  });

  test("adds the entry to an existing strict-JSON config, preserving unrelated keys", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.json", STRICT);
    const r = install([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    const text = readFileSync(file, "utf8");
    expect(text).toContain('"model": "test/model"');
    expect(text).toContain(PLUGIN_SPEC);
    expect(JSON.parse(text).plugins).toEqual([PLUGIN_SPEC]);
    rmSync(home, { recursive: true, force: true });
  });

  test("preserves comments and trailing commas in a JSONC config", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(
      home,
      "opencode.jsonc",
      `{\n  // user comment\n  "model": "test/model",\n  "plugins": [\n    "some-other-plugin", // trailing comma, keep me\n  ],\n}\n`,
    );
    const r = install([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("// user comment");
    expect(text).toContain("some-other-plugin");
    expect(text).toContain(PLUGIN_SPEC);
    rmSync(home, { recursive: true, force: true });
  });

  test("backs up the original file next to it (timestamped .bak) before writing", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", STRICT.replace("opencode.json", "x"));
    const before = readFileSync(file, "utf8");
    const r = install([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    const baks = readdirSync(join(home, ".config", "opencode")).filter((f) => f.startsWith("opencode.jsonc.") && f.endsWith(".bak"));
    expect(baks.length).toBe(1);
    expect(readFileSync(join(home, ".config", "opencode", baks[0]!), "utf8")).toBe(before);
    rmSync(home, { recursive: true, force: true });
  });

  test("is idempotent: second run is 'already installed', exit 0, file byte-identical", () => {
    const home = fakeHome();
    install([], { env: envFor(home), cwd: home });
    const file = join(home, ".config", "opencode", "opencode.jsonc");
    const first = readFileSync(file, "utf8");
    const r2 = install([], { env: envFor(home), cwd: home });
    expect(r2.code).toBe(0);
    expect(r2.stdout.toLowerCase()).toContain("already installed");
    expect(readFileSync(file, "utf8")).toBe(first);
    rmSync(home, { recursive: true, force: true });
  });

  test("recognises the object form { package: ... } as already installed", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(
      home,
      "opencode.jsonc",
      `{\n  "plugins": [\n    { "package": "${PLUGIN_SPEC}", "options": {} }\n  ]\n}\n`,
    );
    const r = install([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(r.stdout.toLowerCase()).toContain("already installed");
    expect(readFileSync(file, "utf8")).toContain('"options": {}');
    rmSync(home, { recursive: true, force: true });
  });

  test("back-compat: uninstall removes the legacy bare spec installed by v1.1.0", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(
      home,
      "opencode.jsonc",
      `{\n  "model": "test/model",\n  "plugins": [\n    "${PLUGIN_PACKAGE}"\n  ]\n}\n`,
    );
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain(PLUGIN_PACKAGE);
    expect(text).toContain('"model": "test/model"');
    rmSync(home, { recursive: true, force: true });
  });

  test("--dry-run reports but writes nothing (no file, no backup)", () => {
    const home = fakeHome();
    const r = install(["--dry-run"], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(existsSync(join(home, ".config", "opencode", "opencode.jsonc"))).toBe(false);
    rmSync(home, { recursive: true, force: true });
  });

  test("never writes outside the project scope for --project", () => {
    const home = fakeHome();
    const proj = join(home, "proj3");
    mkdirSync(proj, { recursive: true });
    const xdg = join(home, "xdg");
    const r = install(["--project"], { env: envFor(home, xdg), cwd: proj });
    expect(r.code).toBe(0);
    expect(existsSync(join(proj, "opencode.json"))).toBe(true);
    expect(existsSync(join(xdg, "opencode"))).toBe(false);
    expect(existsSync(join(home, ".config", "opencode"))).toBe(false);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("uninstall", () => {
  test("removes exactly the entry install added; unrelated config survives", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", STRICT);
    install([], { env: envFor(home), cwd: home });
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain(PLUGIN_SPEC);
    expect(text).not.toContain(PLUGIN_PACKAGE);
    expect(text).toContain('"model": "test/model"');
    rmSync(home, { recursive: true, force: true });
  });

  test("drops a now-empty plugins array entirely", () => {
    const home = fakeHome();
    writeGlobalConfig(home, "opencode.jsonc", STRICT);
    install([], { env: envFor(home), cwd: home });
    uninstall([], { env: envFor(home), cwd: home });
    const text = readFileSync(join(home, ".config", "opencode", "opencode.jsonc"), "utf8");
    expect(text).not.toContain('"plugins"');
    expect(text).toContain('"model": "test/model"');
    rmSync(home, { recursive: true, force: true });
  });

  test("removes a file that install created from scratch (nothing else left behind)", () => {
    const home = fakeHome();
    install([], { env: envFor(home), cwd: home });
    const file = join(home, ".config", "opencode", "opencode.jsonc");
    expect(existsSync(file)).toBe(true);
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(existsSync(file)).toBe(false);
    rmSync(home, { recursive: true, force: true });
  });

  test("idempotent: uninstall on a not-installed config exits 0 with 'not installed'", () => {
    const home = fakeHome();
    writeGlobalConfig(home, "opencode.jsonc", STRICT);
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(r.stdout.toLowerCase()).toContain("not installed");
    rmSync(home, { recursive: true, force: true });
  });

  test("uninstall backs up the file it modifies", () => {
    const home = fakeHome();
    writeGlobalConfig(home, "opencode.jsonc", STRICT);
    install([], { env: envFor(home), cwd: home });
    const dir = join(home, ".config", "opencode");
    const baksBefore = readdirSync(dir).filter((f) => f.endsWith(".bak")).length;
    uninstall([], { env: envFor(home), cwd: home });
    const baksAfter = readdirSync(dir).filter((f) => f.endsWith(".bak")).length;
    expect(baksAfter).toBeGreaterThan(baksBefore);
    rmSync(home, { recursive: true, force: true });
  });

  test("--restore copies the newest pre-install backup back over the config", () => {
    const home = fakeHome();
    const original = STRICT;
    const file = writeGlobalConfig(home, "opencode.jsonc", original);
    install([], { env: envFor(home), cwd: home });
    // user makes a post-install edit that uninstall would otherwise clobber
    writeFileSync(file, readFileSync(file, "utf8") + "// user edit\n");
    const r = uninstall(["--restore"], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(original);
    rmSync(home, { recursive: true, force: true });
  });

  test("--restore with no backup present fails with a one-line error, exit 1", () => {
    const home = fakeHome();
    writeGlobalConfig(home, "opencode.jsonc", STRICT);
    const r = uninstall(["--restore"], { env: envFor(home), cwd: home });
    expect(r.code).toBe(1);
    expect(r.stderr).not.toContain(" at "); // no stack trace
    expect(r.stderr.split("\n").filter(Boolean).length).toBeLessThanOrEqual(2);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("status", () => {
  test("reports not installed with paths when plugin is absent", () => {
    const home = fakeHome();
    writeGlobalConfig(home, "opencode.jsonc", STRICT);
    const r = status([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(r.stdout.toLowerCase()).toContain("not installed");
    expect(r.stdout).toContain(join(home, ".config", "opencode", "opencode.jsonc"));
    rmSync(home, { recursive: true, force: true });
  });

  test("reports installed after install", () => {
    const home = fakeHome();
    install([], { env: envFor(home), cwd: home });
    const r = status([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(r.stdout.toLowerCase()).toContain("installed");
    expect(r.stdout).not.toContain("not installed");
    rmSync(home, { recursive: true, force: true });
  });
});

describe("runCli (exit codes and messages)", () => {
  test("unknown command exits 2 with a one-line usage error", () => {
    const home = fakeHome();
    const r = runCli(["frobnicate"], { env: envFor(home), cwd: home });
    expect(r.code).toBe(2);
    expect(r.stderr.split("\n").filter(Boolean).length).toBeLessThanOrEqual(2);
    rmSync(home, { recursive: true, force: true });
  });

  test("no arguments defaults to install", () => {
    const home = fakeHome();
    const r = runCli([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(existsSync(join(home, ".config", "opencode", "opencode.jsonc"))).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });

  test("--version prints the version and exits 0", () => {
    const r = runCli(["--version"], { env: envFor(fakeHome()), cwd: tmpdir() });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/1\.1\.0/);
  });
});

describe("uninstall with a missing entry and a pre-install backup", () => {
  test("restores the pre-install config unchanged and exits 0", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", STRICT);
    install([], { env: envFor(home), cwd: home });
    // user (or anything) later rewrites the config: entry gone, unrelated key edited
    const drifted = STRICT.replace("test/model", "test/other");
    writeGlobalConfig(home, "opencode.jsonc", drifted);
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(STRICT); // pre-install bytes restored
    expect(r.stdout).toContain("restored");
    rmSync(home, { recursive: true, force: true });
  });

  test("a fresh safety backup of the drifted state is taken before restoring", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", STRICT);
    install([], { env: envFor(home), cwd: home });
    const drifted = STRICT.replace("test/model", "test/other");
    writeGlobalConfig(home, "opencode.jsonc", drifted);
    uninstall([], { env: envFor(home), cwd: home });
    const dir = join(home, ".config", "opencode");
    const baks = readdirSync(dir).filter((f) => f.endsWith(".bak"));
    // one from install (pre-install) plus one from this uninstall (safety copy of drifted state)
    expect(baks.length).toBeGreaterThanOrEqual(2);
    const safety = baks.map((f) => readFileSync(join(dir, f), "utf8"));
    expect(safety).toContain(drifted); // drifted state preserved in a backup
    rmSync(home, { recursive: true, force: true });
  });

  test("uninstall converges: second run is a clean 'not installed' no-op", () => {
    const home = fakeHome();
    writeGlobalConfig(home, "opencode.jsonc", STRICT);
    install([], { env: envFor(home), cwd: home });
    writeGlobalConfig(home, "opencode.jsonc", STRICT.replace("test/model", "test/other"));
    uninstall([], { env: envFor(home), cwd: home });
    const file = join(home, ".config", "opencode", "opencode.jsonc");
    const before = readFileSync(file, "utf8");
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(r.stdout.toLowerCase()).toContain("not installed");
    expect(readFileSync(file, "utf8")).toBe(before); // untouched on the second run
    rmSync(home, { recursive: true, force: true });
  });

  test("entry missing and only plugin-containing backups exist: no restore, exit 0", () => {
    const home = fakeHome();
    // install created the config from scratch: no pre-install backup is taken
    install([], { env: envFor(home), cwd: home });
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    const r2 = uninstall([], { env: envFor(home), cwd: home });
    expect(r2.code).toBe(0);
    expect(r2.stdout.toLowerCase()).toContain("not installed");
    rmSync(home, { recursive: true, force: true });
  });

  test("config file deleted after install, pre-install backup exists: file restored", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", STRICT);
    install([], { env: envFor(home), cwd: home });
    rmSync(file);
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(STRICT);
    rmSync(home, { recursive: true, force: true });
  });

  test("--dry-run with missing entry and candidate backup writes nothing", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", STRICT);
    install([], { env: envFor(home), cwd: home });
    const drifted = STRICT.replace("test/model", "test/other");
    writeGlobalConfig(home, "opencode.jsonc", drifted);
    const r = uninstall(["--dry-run"], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("dry-run");
    expect(readFileSync(file, "utf8")).toBe(drifted); // untouched
    rmSync(home, { recursive: true, force: true });
  });

  test("entry missing and config already matches pre-install backup: clean no-op", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", STRICT);
    install([], { env: envFor(home), cwd: home });
    // simulate the user having manually emptied the plugins array (entry missing, installed-state backup remains)
    writeGlobalConfig(home, "opencode.jsonc", STRICT); // exactly the pre-install content
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(STRICT);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("uninstall restore: backup chronology (regression)", () => {
  const ORIG = STRICT;
  const DRIFT = STRICT.replace("test/model", "test/other");

  test("a newer plugin-free backup does not shadow the older pre-install original", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", ORIG);
    writeGlobalConfig(home, "opencode.jsonc.2026-01-01-00-00-00Z.bak", ORIG);   // install-time original
    writeGlobalConfig(home, "opencode.jsonc.2026-01-01-00-00-01Z.bak", DRIFT);  // later safety copy of drifted state
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(ORIG); // not clobbered by the newer drifted backup
    expect(r.stdout.toLowerCase()).toContain("not installed");
    rmSync(home, { recursive: true, force: true });
  });

  test("chronology: collision-suffixed backups sort after the plain one of the same second", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", ORIG);
    writeGlobalConfig(home, "opencode.jsonc.2026-01-01-00-00-00Z.bak", ORIG);    // plain: created first
    writeGlobalConfig(home, "opencode.jsonc.2026-01-01-00-00-00Z-2.bak", DRIFT); // collision suffix: created later
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(ORIG);
    expect(r.stdout.toLowerCase()).toContain("not installed");
    rmSync(home, { recursive: true, force: true });
  });

  test("a plugin-containing backup is never a restore candidate, regardless of age", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", ORIG);
    const withPlugin = ORIG.replace('"model": "test/model",', '"model": "test/model",\n  "plugins": ["opencode-goalv2"],');
    writeGlobalConfig(home, "opencode.jsonc.2026-01-01-00-00-00Z.bak", withPlugin); // oldest, but contains the plugin
    writeGlobalConfig(home, "opencode.jsonc.2026-01-01-00-00-01Z.bak", ORIG);       // plugin-free
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(ORIG);
    expect(r.stdout.toLowerCase()).toContain("not installed");
    rmSync(home, { recursive: true, force: true });
  });

  test("restores from the oldest plugin-free backup when older ones carry the plugin", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", DRIFT);
    const withPlugin = ORIG.replace('"model": "test/model",', '"model": "test/model",\n  "plugins": ["opencode-goalv2"],');
    writeGlobalConfig(home, "opencode.jsonc.2026-01-01-00-00-00Z.bak", withPlugin); // oldest, skipped
    writeGlobalConfig(home, "opencode.jsonc.2026-01-01-00-00-01Z.bak", ORIG);       // first plugin-free
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(ORIG);
    expect(r.stdout).toContain("restored");
    rmSync(home, { recursive: true, force: true });
  });
});
