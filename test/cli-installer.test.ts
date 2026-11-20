/**
 * Tests for bin/goal-loop.mjs — the install/uninstall CLI for the
 * goal-loop plugin on OpenCode v2.
 *
 * Every test operates on throwaway directories created under the OS temp dir.
 * The real ~/.config/opencode is never touched: scope resolution and home
 * detection are driven by an injected env, never by process.env.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, chmodSync, statSync, symlinkSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, isAbsolute } from "node:path";
import {
  PLUGIN_PACKAGE,
  PLUGIN_SPEC,
  resolveScope,
  install,
  uninstall,
  status,
  runCli,
  probeOpencodeVersion,
} from "../bin/goal-loop.mjs";

function fakeHome(): string {
  return mkdtempSync(join(tmpdir(), "goal-loop-test-home-"));
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

  test("--restore copies the install-time original back over the config", () => {
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

  test("--restore copies the install-time original, never a newer drifted plugin-free backup", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", STRICT);
    install([], { env: envFor(home), cwd: home });
    // user rewrites the config: plugin entry gone, unrelated key edited
    const drifted = STRICT.replace("test/model", "test/other");
    writeGlobalConfig(home, "opencode.jsonc", drifted);
    // uninstall takes a drifted plugin-free safety backup as the newest backup, then restores the original
    const u = uninstall([], { env: envFor(home), cwd: home });
    expect(u.code).toBe(0);
    // --restore must converge on the install-time original (STRICT bytes),
    // not on the drifted plugin-free bytes, even though they are newer
    const r = uninstall(["--restore"], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(STRICT);
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
  test("unknown command exits 2 with a one-line usage error", async () => {
    const home = fakeHome();
    const r = await runCli(["frobnicate"], { env: envFor(home), cwd: home });
    expect(r.code).toBe(2);
    expect(r.stderr.split("\n").filter(Boolean).length).toBeLessThanOrEqual(2);
    rmSync(home, { recursive: true, force: true });
  });

  test("no arguments defaults to install", async () => {
    const home = fakeHome();
    const r = await runCli([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(existsSync(join(home, ".config", "opencode", "opencode.jsonc"))).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });

  test("--version prints the version and exits 0", async () => {
    const r = await runCli(["--version"], { env: envFor(fakeHome()), cwd: tmpdir() });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/\d+\.\d+\.\d+/);
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
    writeGlobalConfig(home, "opencode.jsonc", STRICT);
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

describe("PLUGIN_SPEC pins the package version (regression)", () => {
  test("PLUGIN_SPEC is github:paumkim/goal-loop#v<package.json version>", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PLUGIN_SPEC).toBe(`github:paumkim/goal-loop#v${pkg.version}`);
  });
});

describe("install preserves comments between the last element and ] (regression)", () => {
  test("a comment after the last element survives install", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", `{\n  "plugins": [\n    "some-other-plugin", // production plugin, do not remove\n    // audit note\n  ],\n}\n`);
    const r = install([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("production plugin, do not remove");
    expect(text).toContain("audit note");
    expect(text).toContain(PLUGIN_SPEC);
    // the result must still parse as JSONC and report the plugin installed
    const s = status([], { env: envFor(home), cwd: home });
    expect(s.stdout.toLowerCase()).toContain("installed");
    rmSync(home, { recursive: true, force: true });
  });

  test("a comment-only empty plugins array survives install", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", `{\n  "plugins": [ /* keep this comment */ ],\n}\n`);
    const r = install([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("keep this comment");
    rmSync(home, { recursive: true, force: true });
  });

  test("a comment with no comma after the last element still yields a valid config", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", `{\n  "plugins": [\n    "some-other-plugin" /* trailing comment, no comma */\n  ]\n}\n`);
    const r = install([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("trailing comment, no comma");
    const s = status([], { env: envFor(home), cwd: home });
    expect(s.stdout.toLowerCase()).toContain("installed");
    rmSync(home, { recursive: true, force: true });
  });
});

describe("writeFileAtomic keeps file modes and symlinks (regression)", () => {
  test("a 0600 config stays 0600 across install", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", STRICT);
    chmodSync(file, 0o600);
    install([], { env: envFor(home), cwd: home });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    rmSync(home, { recursive: true, force: true });
  });

  test("a 0600 config stays 0600 across uninstall", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", STRICT);
    install([], { env: envFor(home), cwd: home });
    chmodSync(file, 0o600);
    uninstall([], { env: envFor(home), cwd: home });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    rmSync(home, { recursive: true, force: true });
  });

  test("a symlinked config is edited through the link, not replaced", () => {
    const home = fakeHome();
    const xdg = join(home, "xdg");
    mkdirSync(join(xdg, "opencode"), { recursive: true });
    const dotfiles = join(home, "dotfiles");
    mkdirSync(dotfiles, { recursive: true });
    const target = join(dotfiles, "opencode.jsonc");
    writeFileSync(target, STRICT);
    chmodSync(target, 0o600);
    const link = join(xdg, "opencode", "opencode.jsonc");
    symlinkSync(target, link);
    const r = install([], { env: envFor(home, xdg), cwd: home });
    expect(r.code).toBe(0);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    const text = readFileSync(target, "utf8");
    expect(text).toContain(PLUGIN_SPEC);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("backup chronology rejects foreign backups (regression)", () => {
  test("a stray .bak with an invalid stamp never shadows the real pre-install original", () => {
    const home = fakeHome();
    const proj = join(home, "proj");
    mkdirSync(proj, { recursive: true });
    const file = join(proj, "opencode.json");
    writeFileSync(file, '{"model":"drift"}\n');
    writeFileSync(`${file}.1999-99-99-00-00-00Z.bak`, '{"model":"FOREIGN-INVALID-MONTH"}\n'); // \d range-invalid
    writeFileSync(`${file}.mine.bak`, '{"model":"FOREIGN-SHAPE"}\n');                        // not the backupFile format
    writeFileSync(`${file}.2026-01-01-00-00-00Z.bak`, '{"model":"ORIGINAL"}\n');
    const r = uninstall(["--project"], { env: envFor(home), cwd: proj });
    expect(r.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe('{"model":"ORIGINAL"}\n');
    rmSync(home, { recursive: true, force: true });
  });

  test("a backup whose plugins value is a string (off-contract) is never an auto-restore candidate", () => {
    const home = fakeHome();
    const proj = join(home, "proj");
    mkdirSync(proj, { recursive: true });
    const file = join(proj, "opencode.json");
    writeFileSync(file, '{"model":"drift"}\n'); // entry missing, plugins string form in the backup
    writeFileSync(`${file}.2026-01-01-00-00-00Z.bak`, '{"plugins":"github:paumkim/opencode-goalv2#v1.1.0"}\n');
    const r = uninstall(["--project"], { env: envFor(home), cwd: proj });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("restored");
    expect(readFileSync(file, "utf8")).toBe('{"model":"drift"}\n');
    rmSync(home, { recursive: true, force: true });
  });

  test("the backup taken during install captures the exact bytes of the parsed edit base", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", STRICT);
    const before = readFileSync(file, "utf8");
    const r = install([], { env: envFor(home), cwd: home });
    const m = r.stdout.match(/backup: ([^)]+)\)/);
    expect(m).not.toBeNull();
    expect(readFileSync(m?.[1] ?? "", "utf8")).toBe(before);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("JSONC validation is strict about literals and duplicate keys (regression)", () => {
  test("an invalid literal fails with exit 1 instead of round-tripping silently", () => {
    const home = fakeHome();
    writeGlobalConfig(home, "opencode.jsonc", '{"model": nul}\n');
    const r = status([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("invalid literal");
    rmSync(home, { recursive: true, force: true });
  });

  test('a duplicate "plugins" key is refused, not silently first-wins', async () => {
    const home = fakeHome();
    writeGlobalConfig(home, "opencode.jsonc", '{\n  "plugins": ["a"],\n  "plugins": ["b"]\n}\n');
    // via the CLI entrypoint: caught, one-line error, exit 1, nothing written
    const r = await runCli(["install"], { env: envFor(home), cwd: home });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('duplicate "plugins"');
    // as a library call: addPluginText throws CliError instead of editing the first array
    expect(() => install([], { env: envFor(home), cwd: home })).toThrow('duplicate "plugins"');
    rmSync(home, { recursive: true, force: true });
  });

  test("CRLF configs lose no content when the entry line is removed", () => {
    const home = fakeHome();
    const crlf = '{\r\n  "model": "x",\r\n  "plugins": [\r\n    "github:paumkim/opencode-goalv2#v1.1.0",\r\n    "keep"\r\n  ]\r\n}\r\n';
    const file = writeGlobalConfig(home, "opencode.jsonc", crlf);
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("keep");
    expect(text).not.toContain("\r\r");
    expect(text.split("\n").every((l) => !l.endsWith("\r\r"))).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("scope resolution is cwd-proof (regression)", () => {
  test("an empty HOME falls back to the OS home directory instead of CWD", () => {
    const r = resolveScope([], { env: { HOME: "", PATH: "/usr/bin" }, cwd: "/tmp/elsewhere" });
    expect(isAbsolute(r.dir)).toBe(true);
    expect(join(r.dir).endsWith(join(".config", "opencode"))).toBe(true);
  });

  test("a non-absolute XDG_CONFIG_HOME is ignored, never resolved against CWD", () => {
    const home = fakeHome();
    const r = resolveScope([], { env: { HOME: home, XDG_CONFIG_HOME: "rel/dir", PATH: "/usr/bin" }, cwd: home });
    expect(r.dir).toBe(join(home, ".config", "opencode"));
    rmSync(home, { recursive: true, force: true });
  });
});

describe("--restore reporting (regression)", () => {
  test("the success message names the safety backup of the pre-restore state", () => {
    const home = fakeHome();
    writeGlobalConfig(home, "opencode.jsonc", STRICT);
    writeGlobalConfig(home, "opencode.jsonc.2026-01-01-00-00-00Z.bak", STRICT); // plugin-free pre-install original
    const r = uninstall(["--restore"], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("backup of the pre-restore state:");
    rmSync(home, { recursive: true, force: true });
  });
});

describe("writeFileAtomic syncs before the rename (regression)", () => {
  test("the atomic write fsyncs the temp file before renameSync", () => {
    const src = readFileSync(new URL("../bin/goal-loop.mjs", import.meta.url), "utf8");
    const start = src.indexOf("function writeFileAtomic");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = src.indexOf("\n}\n", start);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    const fsync = body.indexOf("fsyncSync(");
    const rename = body.indexOf("renameSync(");
    expect(fsync).toBeGreaterThanOrEqual(0); // the durable-write step exists
    expect(rename).toBeGreaterThanOrEqual(0);
    expect(fsync).toBeLessThan(rename); // durability is established BEFORE the rename publishes the bytes
  });
});

describe("status prints exactly one config line (regression)", () => {
  test("a missing config yields one 'config:' line naming the path and '(does not exist)'", () => {
    const home = fakeHome();
    const r = status([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    const lines = r.stdout.split("\n").filter((l) => l.startsWith("config:"));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(join(home, ".config", "opencode"));
    expect(lines[0]).toContain("(does not exist)");
    rmSync(home, { recursive: true, force: true });
  });

  test("an existing config yields one 'config:' line with the path and no '(does not exist)'", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(home, "opencode.jsonc", STRICT);
    const r = status([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    const lines = r.stdout.split("\n").filter((l) => l.startsWith("config:"));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(file);
    expect(lines[0]).not.toContain("(does not exist)");
    rmSync(home, { recursive: true, force: true });
  });
});

describe("uninstall delete message claims only what it observed (regression)", () => {
  test("deleting an install-skeleton config reports the skeleton, not its provenance", () => {
    const home = fakeHome();
    install([], { env: envFor(home), cwd: home }); // fresh home -> install writes its skeleton
    const { file } = resolveScope([], { env: envFor(home), cwd: home });
    expect(existsSync(file)).toBe(true);
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("(only install's skeleton remained)");
    expect(r.stdout).not.toContain("created by install");
    expect(existsSync(file)).toBe(false);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("status classifies the opencode probe honestly (regression)", () => {
  test("probeOpencodeVersion maps ENOENT, timeout, spawn errors, exit codes, signals and success", () => {
    expect(probeOpencodeVersion({ error: { code: "ENOENT" } } as never)).toBe("not found on PATH");
    expect(probeOpencodeVersion({ error: { code: "ETIMEDOUT" } } as never)).toContain("timed out");
    expect(probeOpencodeVersion({ error: { code: "EACCES" } } as never)).toContain("failed to run");
    expect(probeOpencodeVersion({ status: 3, signal: null, stdout: "" } as never)).toBe("--version exited with code 3");
    expect(probeOpencodeVersion({ status: null, signal: "SIGTERM" } as never)).toContain("SIGTERM");
    expect(probeOpencodeVersion({ status: 0, stdout: "opencode 2.0.29\n" } as never)).toBe("opencode 2.0.29");
  });

  test("a non-zero opencode shim is reported as an exit code, never as 'not found on PATH'", () => {
    const home = fakeHome();
    const bin = join(home, "bin");
    mkdirSync(bin, { recursive: true });
    const shim = join(bin, "opencode");
    writeFileSync(shim, "#!/bin/sh\nexit 3\n");
    chmodSync(shim, 0o755);
    const saved = process.env.PATH;
    process.env.PATH = bin;
    try {
      const r = status([], { env: envFor(home), cwd: home });
      expect(r.stdout).toContain("exited with code 3");
      expect(r.stdout).not.toContain("not found on PATH");
    } finally {
      process.env.PATH = saved;
    }
    rmSync(home, { recursive: true, force: true });
  });

  test("no opencode on PATH is reported as not found", () => {
    const home = fakeHome();
    const empty = join(home, "empty-path");
    mkdirSync(empty, { recursive: true });
    const saved = process.env.PATH;
    process.env.PATH = empty;
    try {
      const r = status([], { env: envFor(home), cwd: home });
      expect(r.stdout).toContain("opencode: not found on PATH");
    } finally {
      process.env.PATH = saved;
    }
    rmSync(home, { recursive: true, force: true });
  });
});

describe("bin/goal-loop.d.mts stays in sync with goal-loop.mjs (regression)", () => {
  test("the declarations declare every export of the .mjs and carry no stale value extras", async () => {
    const mjs = readFileSync(new URL("../bin/goal-loop.mjs", import.meta.url), "utf8");
    const dts = readFileSync(new URL("../bin/goal-loop.d.mts", import.meta.url), "utf8");

    // Runtime truth: what a consumer importing the .mjs actually observes.
    const ns = await import("../bin/goal-loop.mjs");
    const runtimeExports = Object.keys(ns).sort();

    // Value declarations the .d.mts publishes. Interfaces and type aliases are
    // supporting types for those values, not value exports, and are
    // deliberately out of the comparison.
    const declared = new Set<string>();
    for (const m of dts.matchAll(/^export\s+(?:declare\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      declared.add(m[1]!);
    }
    expect(declared.size).toBeGreaterThan(0);

    // Exact set equality in both directions: every real export is declared,
    // and every declared value export actually exists — nothing missing,
    // nothing stale.
    expect([...declared].sort()).toEqual(runtimeExports);

    // Source scan as a second leg: every `export ...` the .mjs text publishes
    // (line-anchored, so comments and calls cannot false-positive) appears as
    // a value declaration in the .d.mts.
    const mjsExports = [...mjs.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]!);
    expect(mjsExports.length).toBeGreaterThan(0);
    for (const name of mjsExports) {
      expect(dts).toMatch(new RegExp(`^export\\s+(?:declare\\s+)?(?:const|let|var|function|class)\\s+${name}\\b`, "m"));
    }
  });
});

describe("goal-loop identity", () => {
  test("--help names goal-loop and all six commands", async () => {
    const r = await runCli(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("goal-loop — install and remove the goal-loop plugin for OpenCode v2");
    expect(r.stdout).toContain("goal-loop [install]");
    expect(r.stdout).toContain("goal-loop uninstall");
    expect(r.stdout).toContain("goal-loop status");
    expect(r.stdout).toContain("goal-loop update");
    expect(r.stdout).toContain("goal-loop channel");
    expect(r.stdout).toContain("goal-loop updates");
    expect(r.stdout).not.toContain("opencode-goal ");
  });
  test("--version prints the goal-loop name and package.json's version", async () => {
    const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
    const r = await runCli(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`goal-loop ${pkg.version}\n`);
  });
  test("the baked-in FALLBACK_VERSION equals package.json's version (standalone installs)", async () => {
    const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
    const src = readFileSync(new URL("../bin/goal-loop.mjs", import.meta.url), "utf8");
    const match = src.match(/const FALLBACK_VERSION = "([^"]+)"/);
    expect(match?.[1]).toBe(pkg.version);
  });
  test("--self is only accepted by uninstall", async () => {
    const r = await runCli(["--self"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--self only applies to uninstall");
  });
});

describe("uninstall --self removes the CLI script (and only a real goal-loop script)", () => {
  const scriptFor = (dir: string, body: string): string => {
    const file = join(dir, "goal-loop");
    writeFileSync(file, body);
    return file;
  };
  const cliBody = (): string =>
    readFileSync(new URL("../bin/goal-loop.mjs", import.meta.url), "utf8");
  test("--self deletes the running script after removing the plugin entry", () => {
    const home = fakeHome();
    install([], { env: envFor(home), cwd: home });
    const script = scriptFor(home, cliBody());
    const r = uninstall(["--self"], { env: envFor(home), cwd: home, selfPath: script });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`deleted ${script}`);
    expect(existsSync(script)).toBe(false);
    rmSync(home, { recursive: true, force: true });
  });
  test("--self --dry-run names the script and deletes nothing", () => {
    const home = fakeHome();
    install([], { env: envFor(home), cwd: home });
    const script = scriptFor(home, cliBody());
    const r = uninstall(["--self", "--dry-run"], { env: envFor(home), cwd: home, selfPath: script });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`dry-run: would delete ${script}`);
    expect(existsSync(script)).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });
  test("--self refuses a file that is not the goal-loop CLI", () => {
    const home = fakeHome();
    const script = scriptFor(home, "#!/bin/sh\necho not the cli\n");
    const r = uninstall(["--self"], { env: envFor(home), cwd: home, selfPath: script });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("self-removal skipped");
    expect(existsSync(script)).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("install.sh (the GitHub one-liner)", () => {
  const installer = new URL("../install.sh", import.meta.url).pathname;
  test("installs the CLI into GOAL_LOOP_BIN_DIR from a local source, no network", () => {
    const home = fakeHome();
    const binDir = join(home, "bin");
    const r = spawnSync("sh", [installer], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home,
        GOAL_LOOP_BIN_DIR: binDir,
        GOAL_LOOP_SOURCE: new URL("../bin/goal-loop.mjs", import.meta.url).pathname,
        GOAL_LOOP_NO_RUN: "1",
      },
    });
    expect(r.status).toBe(0);
    const target = join(binDir, "goal-loop");
    expect(existsSync(target)).toBe(true);
    expect(statSync(target).mode & 0o111).not.toBe(0);
    const version = spawnSync(process.execPath, [target, "--version"], { encoding: "utf8" });
    expect(version.stdout.trim()).toMatch(/^goal-loop \d+\.\d+\.\d+$/);
    rmSync(home, { recursive: true, force: true });
  });
  test("is executable and carries the documented GitHub one-liner", () => {
    const file = new URL("../install.sh", import.meta.url).pathname;
    expect(statSync(file).mode & 0o111).not.toBe(0);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("curl -fsSL https://raw.githubusercontent.com/paumkim/goal-loop/main/install.sh | sh");
    expect(text).toContain("goal-loop uninstall --self");
  });
});

describe("install/uninstall round-trips byte-for-byte (formatting fidelity)", () => {
  test("a comment after the last plugin, an inline block comment and CRLF all survive a round trip", () => {
    const home = fakeHome();
    const original =
      '{\r\n  // my settings\r\n  "$schema": "https://opencode.ai/config.json",\r\n  "model": "x", /* keep me */\r\n  "plugins": [\r\n    "some-other-plugin" // trailing comment\r\n  ],\r\n}\r\n';
    const file = writeGlobalConfig(home, "opencode.jsonc", original);
    install([], { env: envFor(home), cwd: home });
    expect(readFileSync(file, "utf8")).toContain(PLUGIN_SPEC);
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(original);
    rmSync(home, { recursive: true, force: true });
  });

  test("the plugin entry inserted before the first key does not shift that key's indentation", () => {
    const home = fakeHome();
    const original = '{\n  "$schema": "https://opencode.ai/config.json",\n  "model": "x"\n}\n';
    const file = writeGlobalConfig(home, "opencode.jsonc", original);
    install([], { env: envFor(home), cwd: home });
    const installed = readFileSync(file, "utf8");
    expect(installed).toContain('\n  "$schema"');
    expect(installed).not.toContain('\n    "$schema"');
    uninstall([], { env: envFor(home), cwd: home });
    expect(readFileSync(file, "utf8")).toBe(original);
    rmSync(home, { recursive: true, force: true });
  });

  test("a pre-existing $schema-only config is restored on uninstall, not deleted", () => {
    const home = fakeHome();
    const original = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
    const file = writeGlobalConfig(home, "opencode.jsonc", original);
    install([], { env: envFor(home), cwd: home });
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(original);
    rmSync(home, { recursive: true, force: true });
  });

  test("a pre-existing empty object config is restored on uninstall, not deleted", () => {
    const home = fakeHome();
    const original = "{}\n";
    const file = writeGlobalConfig(home, "opencode.jsonc", original);
    install([], { env: envFor(home), cwd: home });
    uninstall([], { env: envFor(home), cwd: home });
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(original);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("pre-rename repository slug (opencode-goalv2 → goal-loop)", () => {
  const OLD = "github:paumkim/opencode-goalv2#v1.1.0";

  test("install migrates an old specifier in place instead of stacking a second entry", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(
      home,
      "opencode.jsonc",
      `{\n  "model": "test/model",\n  "plugins": [\n    "${OLD}"\n  ]\n}\n`,
    );
    const r = install([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("replaced the pre-rename");
    const text = readFileSync(file, "utf8");
    expect(text).toContain(PLUGIN_SPEC);
    expect(text).not.toContain(OLD);
    expect(JSON.parse(text).plugins).toEqual([PLUGIN_SPEC]);
    rmSync(home, { recursive: true, force: true });
  });

  test("install collapses a config that carries both the old and the new specifier", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(
      home,
      "opencode.jsonc",
      `{\n  "plugins": [\n    "${OLD}",\n    "${PLUGIN_SPEC}"\n  ]\n}\n`,
    );
    install([], { env: envFor(home), cwd: home });
    const text = readFileSync(file, "utf8");
    expect(JSON.parse(text).plugins).toEqual([PLUGIN_SPEC]);
    rmSync(home, { recursive: true, force: true });
  });

  test("uninstall removes a config written by the pre-rename installer", () => {
    const home = fakeHome();
    const file = writeGlobalConfig(
      home,
      "opencode.jsonc",
      `{\n  "model": "test/model",\n  "plugins": [\n    "${OLD}"\n  ]\n}\n`,
    );
    const r = uninstall([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain("opencode-goalv2");
    expect(text).toContain('"model": "test/model"');
    rmSync(home, { recursive: true, force: true });
  });

  test("status reports a pre-rename install and asks for an update", () => {
    const home = fakeHome();
    writeGlobalConfig(home, "opencode.jsonc", `{\n  "plugins": ["${OLD}"]\n}\n`);
    const r = status([], { env: envFor(home), cwd: home });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("installed: yes (pre-rename");
    expect(r.stdout).toContain("goal-loop install");
    rmSync(home, { recursive: true, force: true });
  });
});
