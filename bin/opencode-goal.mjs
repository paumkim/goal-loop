#!/usr/bin/env node
/**
 * opencode-goal — install/uninstall the opencode-goal plugin on OpenCode v2.
 *
 * Mechanism (verified against the installed opencode v2.3.0 binary and the v2
 * plugin docs, 2026-11-15):
 *   OpenCode v2 discovers configured plugins from the `plugins` array in its
 *   config file — `"plugins": ["@el4cteo/opencode-goal"]`. npm package plugins
 *   are installed automatically at startup with Bun and cached in
 *   ~/.cache/opencode/node_modules; server AND TUI entrypoints of the package
 *   are loaded from the one config entry (verified in a live smoke run: the
 *   plugin lists under both Server (`opencode-goal`) and TUI
 *   (`opencode-goal.tui`)). A `<config>/plugins/*.ts` directory of direct
 *   files also auto-loads, but it cannot express the npm package reference and
 *   would not track releases, so this CLI edits the `plugins` array instead.
 *   `opencode plugin add` wraps the same config edit but attaches to the
 *   background service and offers no backup/restore, so we do the edit
 *   ourselves, surgically, on the config file.
 *
 * Config discovery (mirrors the installed binary, v2.3.0):
 *   --global (default): <$XDG_CONFIG_HOME>/opencode/ when set, else
 *     ~/.config/opencode/. Within it opencode.jsonc wins over opencode.json
 *     when both exist; when neither exists, opencode.jsonc is created
 *     (binary default for the global directory).
 *   --project: the current directory's project config. Discovery order is
 *     opencode.json, opencode.jsonc, .opencode/opencode.json,
 *     .opencode/opencode.jsonc — the first existing file wins and is edited;
 *     when none exists, ./opencode.json is created (the binary's project
 *     default).
 *
 * Supported opencode version range: >=2.0.29 (matches package.json engines).
 * The `plugins` array shape is the v2 config contract; v1 used `plugin` and is
 * not supported.
 *
 * Safety rules:
 *   - Every modified file is backed up first, next to the original, as
 *     <file>.<yyyy-MM-DD-HH-mm-ss>Z.bak (never overwritten).
 *   - Only the `plugins` array (and, when empty, the array property) is
 *     edited; all unrelated keys, comments and formatting survive.
 *   - Uninstall removes exactly the entry install added. If the config file
 *     was created by install and nothing but install's skeleton remains, the
 *     file is deleted. `uninstall --restore` copies the newest pre-install
 *     .bak back over the config instead (taking a fresh .bak of the current
 *     state first).
 *   - Uninstall never auto-restores a backup when merely the entry is missing:
 *     the backup is pre-install state and restoring it would silently revert
 *     any post-install edits the user made to unrelated keys. A note points at
 *     --restore instead.
 *   - Never writes outside the selected scope.
 *
 * Zero dependencies; runs on any Node >=18 or Bun. ESM.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

export const PLUGIN_PACKAGE = "@el4cteo/opencode-goal";
const SCHEMA_URL = "https://opencode.ai/config.json";

const VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
})();

class CliError extends Error {}

// ---------------------------------------------------------------------------
// Minimal JSONC parser with source spans (strings, comments, trailing commas).
// Produces { type, start, end, ... } nodes so edits can be surgical.
// ---------------------------------------------------------------------------

function tokenize(text) {
  const tokens = [];
  let i = 0;
  const n = text.length;
  const isWs = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";
  while (i < n) {
    const c = text[i];
    if (isWs(c)) { i++; continue; }
    if (c === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '"') {
      const start = i;
      i++;
      let value = "";
      while (i < n) {
        const ch = text[i];
        if (ch === "\\") {
          value += ch + text[i + 1];
          i += 2;
          continue;
        }
        if (ch === '"') { i++; break; }
        value += ch;
        i++;
      }
      tokens.push({ type: "string", start, end: i, value: decodeString(value) });
      continue;
    }
    if ("{}[]:,".includes(c)) {
      tokens.push({ type: "punct", start: i, end: i + 1, value: c });
      i++;
      continue;
    }
    // literal: number, true, false, null
    const start = i;
    while (i < n && !isWs(text[i]) && !"{}[]:,\"".includes(text[i]) && !(text[i] === "/" && (text[i + 1] === "/" || text[i + 1] === "*"))) {
      i++;
    }
    if (i === start) i++; // defensive: never stall on a stray character
    tokens.push({ type: "literal", start, end: i, value: text.slice(start, i) });
  }
  return tokens;
}

function decodeString(raw) {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

function parseJsonc(text) {
  const tokens = tokenize(text);
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (value) => {
    const t = tokens[pos];
    if (!t || (value !== undefined && t.value !== value)) {
      throw new CliError(`unexpected token at offset ${t?.start ?? text.length}`);
    }
    pos++;
    return t;
  };
  const parseValue = () => {
    const t = peek();
    if (!t) throw new CliError("unexpected end of file");
    if (t.type === "string") { pos++; return { type: "string", start: t.start, end: t.end, value: t.value }; }
    if (t.type === "literal") { pos++; return { type: "literal", start: t.start, end: t.end, value: t.value }; }
    if (t.value === "{") return parseObject();
    if (t.value === "[") return parseArray();
    throw new CliError(`unexpected token '${t.value}' at offset ${t.start}`);
  };
  const parseObject = () => {
    const open = eat("{");
    const properties = [];
    let close = null;
    if (peek()?.value === "}") { close = eat("}"); return { type: "object", start: open.start, end: close.end, properties }; }
    for (;;) {
      const keyTok = peek();
      if (!keyTok || keyTok.type !== "string") throw new CliError(`expected a string key at offset ${keyTok?.start ?? text.length}`);
      pos++;
      eat(":");
      const value = parseValue();
      properties.push({ keyStart: keyTok.start, keyEnd: keyTok.end, key: keyTok.value, value });
      if (peek()?.value === ",") {
        eat(",");
        if (peek()?.value === "}") { close = eat("}"); break; } // trailing comma
        continue;
      }
      close = eat("}");
      break;
    }
    return { type: "object", start: open.start, end: close.end, properties };
  };
  const parseArray = () => {
    const open = eat("[");
    const elements = [];
    let close = null;
    if (peek()?.value === "]") { close = eat("]"); return { type: "array", start: open.start, end: close.end, elements }; }
    for (;;) {
      elements.push(parseValue());
      if (peek()?.value === ",") {
        eat(",");
        if (peek()?.value === "]") { close = eat("]"); break; } // trailing comma
        continue;
      }
      close = eat("]");
      break;
    }
    return { type: "array", start: open.start, end: close.end, elements };
  };
  const root = parseValue();
  if (pos !== tokens.length) throw new CliError(`trailing content at offset ${tokens[pos].start}`);
  return root;
}

function findPluginsProperty(root) {
  if (root.type !== "object") throw new CliError("top-level value is not an object; not touching it");
  return root.properties.find((p) => p.key === "plugins") ?? null;
}

function elementMatchesPackage(el, pkg) {
  if (el.type === "string") return el.value === pkg;
  if (el.type === "object") {
    const p = el.properties.find((pr) => pr.key === "package");
    return p?.value?.type === "string" && p.value.value === pkg;
  }
  return false;
}

/** Insert (or detect) the plugin in the config text. Returns { text, already, created }. */
export function addPluginText(text) {
  const root = parseJsonc(text);
  const prop = findPluginsProperty(root);
  const entry = `"${PLUGIN_PACKAGE}"`;
  if (!prop) {
    const insert = `  "plugins": [\n    ${entry}\n  ],\n  `;
    if (root.properties.length === 0) {
      const empty = text.slice(0, root.start + 1) + `\n${insert.slice(0, -4)}\n` + text.slice(root.end - 1);
      return { text: empty, already: false };
    }
    return { text: text.slice(0, root.start + 1) + "\n" + insert + text.slice(root.start + 1).replace(/^\n/, ""), already: false };
  }
  const arr = prop.value;
  if (arr.type !== "array") throw new CliError(`"plugins" is not an array; not touching it`);
  if (arr.elements.some((el) => elementMatchesPackage(el, PLUGIN_PACKAGE))) return { text, already: true };
  if (arr.elements.length === 0) {
    return { text: text.slice(0, arr.start + 1) + `\n    ${entry}\n  ` + text.slice(arr.end - 1), already: false };
  }
  const lastEl = arr.elements[arr.elements.length - 1];
  return { text: text.slice(0, lastEl.end) + `,\n    ${entry}\n  ` + text.slice(arr.end - 1), already: false };
}

/** Remove a span plus one adjacent comma (following comma preferred, else preceding). */
function removeSpanWithComma(text, start, end) {
  let i = end;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] === ",") {
    let j = i + 1;
    // swallow the rest of the line's trailing whitespace+newline when the whole line is consumed
    let k = j;
    while (k < text.length && (text[k] === " " || text[k] === "\t")) k++;
    if (text[k] === "\n") j = k + 1;
    return text.slice(0, start) + text.slice(j);
  }
  let p = start;
  while (p > 0 && /\s/.test(text[p - 1])) p--;
  if (text[p - 1] === ",") {
    return text.slice(0, p - 1) + text.slice(end);
  }
  return text.slice(0, start) + text.slice(end);
}

/** Remove the plugin from the config text. Returns { text, removed, emptyRoot, skeletonRoot }. */
export function removePluginText(text) {
  let current = text;
  let removed = false;
  for (;;) {
    const root = parseJsonc(current);
    const prop = findPluginsProperty(root);
    if (!prop || prop.value.type !== "array") break;
    const arr = prop.value;
    const el = arr.elements.find((e) => elementMatchesPackage(e, PLUGIN_PACKAGE));
    if (!el) break;
    removed = true;
    current = removeSpanWithComma(current, el.start, el.end);
  }
  if (!removed) return { text, removed: false, emptyRoot: false, skeletonRoot: false };
  // Drop the plugins property entirely when the array is empty.
  const root = parseJsonc(current);
  const prop = findPluginsProperty(root);
  if (prop && prop.value.type === "array" && prop.value.elements.length === 0) {
    current = removeSpanWithComma(current, prop.keyStart, prop.value.end);
  }
  const finalRoot = parseJsonc(current);
  const remaining = finalRoot.type === "object" ? finalRoot.properties : [];
  const emptyRoot = remaining.length === 0;
  const skeletonRoot =
    remaining.length === 1 &&
    remaining[0].key === "$schema" &&
    remaining[0].value.type === "string" &&
    remaining[0].value.value === SCHEMA_URL;
  return { text: current, removed: true, emptyRoot, skeletonRoot };
}

// ---------------------------------------------------------------------------
// Scope resolution (see header for the discovery rules mirrored from v2.3.0)
// ---------------------------------------------------------------------------

export function resolveScope(args, opts = {}) {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.homedir ?? env.HOME ?? homedir();
  const project = args.includes("--project");
  const global = args.includes("--global");
  if (project && global) throw new CliError("--global and --project are mutually exclusive");
  if (project) {
    const candidates = [
      join(cwd, "opencode.json"),
      join(cwd, "opencode.jsonc"),
      join(cwd, ".opencode", "opencode.json"),
      join(cwd, ".opencode", "opencode.jsonc"),
    ];
    for (const c of candidates) if (existsSync(c)) return { scope: "project", dir: cwd, file: c };
    return { scope: "project", dir: cwd, file: candidates[0] };
  }
  const xdg = env.XDG_CONFIG_HOME;
  const dir = xdg ? join(xdg, "opencode") : join(home, ".config", "opencode");
  const json = join(dir, "opencode.json");
  const jsonc = join(dir, "opencode.jsonc");
  if (existsSync(jsonc)) return { scope: "global", dir, file: jsonc };
  if (existsSync(json)) return { scope: "global", dir, file: json };
  return { scope: "global", dir, file: jsonc };
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

function backupFile(file) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + "Z";
  let dest = `${file}.${stamp}.bak`;
  let n = 2;
  while (existsSync(dest)) dest = `${file}.${stamp}-${n++}.bak`;
  copyFileSync(file, dest);
  return dest;
}

function listBackups(file) {
  const dir = resolve(file, "..");
  const base = file.slice(dir.length + 1);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.`) && f.endsWith(".bak"))
    .map((f) => join(dir, f))
    .sort();
}

// ---------------------------------------------------------------------------
// Commands — each returns { code, stdout, stderr }
// ---------------------------------------------------------------------------

const skeleton = () =>
  `{\n  "$schema": "${SCHEMA_URL}",\n  "plugins": [\n    "${PLUGIN_PACKAGE}"\n  ]\n}\n`;

export function install(args, opts = {}) {
  const dryRun = args.includes("--dry-run");
  const scope = resolveScope(args, opts);
  const { file } = scope;
  const out = [];
  if (!existsSync(file)) {
    if (!dryRun) {
      mkdirSync(scope.dir === file ? "." : scopeDirOf(file), { recursive: true });
      writeFileSync(file, skeleton());
    }
    out.push(dryRun
      ? `dry-run: would create ${file} with ${PLUGIN_PACKAGE}`
      : `installed ${PLUGIN_PACKAGE} in ${file} (created); restart opencode`);
    return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
  }
  const text = readFileSync(file, "utf8");
  const result = addPluginText(text);
  if (result.already) {
    out.push(`already installed (${file}); nothing to do`);
    return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
  }
  if (!dryRun) {
    const bak = backupFile(file);
    writeFileSync(file, result.text);
    out.push(`installed ${PLUGIN_PACKAGE} in ${file}; restart opencode (backup: ${bak})`);
  } else {
    out.push(`dry-run: would add ${PLUGIN_PACKAGE} to ${file}`);
  }
  return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
}

function scopeDirOf(file) {
  const idx = file.lastIndexOf("/");
  return idx === -1 ? "." : file.slice(0, idx);
}

export function uninstall(args, opts = {}) {
  const dryRun = args.includes("--dry-run");
  const restore = args.includes("--restore");
  const scope = resolveScope(args, opts);
  const { file } = scope;
  const out = [];

  if (restore) {
    const baks = listBackups(file);
    if (baks.length === 0) return { code: 1, stdout: "", stderr: `opencode-goal: no backup found for ${file}\n` };
    const newest = baks[baks.length - 1];
    if (!dryRun) {
      if (existsSync(file)) backupFile(file); // keep a safety copy of the current state
      else mkdirSync(scopeDirOf(file), { recursive: true });
      copyFileSync(newest, file);
    }
    out.push(dryRun
      ? `dry-run: would restore ${newest} over ${file}`
      : `restored ${newest} over ${file}`);
    return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
  }

  if (!existsSync(file)) {
    out.push(`not installed (no config at ${file})`);
    const baks = listBackups(file);
    if (baks.length > 0) out.push(`note: pre-install backups exist; run with --restore to put ${baks[baks.length - 1]} back`);
    return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
  }

  const text = readFileSync(file, "utf8");
  const result = removePluginText(text);
  if (!result.removed) {
    out.push(`not installed (${file}); nothing to do`);
    const baks = listBackups(file);
    if (baks.length > 0) out.push(`note: pre-install backups exist; run with --restore to put ${baks[baks.length - 1]} back`);
    return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
  }
  if (!dryRun) {
    const bak = backupFile(file);
    if (result.emptyRoot || result.skeletonRoot) {
      unlinkSync(file);
      out.push(`removed ${PLUGIN_PACKAGE}; deleted ${file} (created by install); restart opencode (backup: ${bak})`);
    } else {
      writeFileSync(file, result.text);
      out.push(`removed ${PLUGIN_PACKAGE} from ${file}; restart opencode (backup: ${bak})`);
    }
  } else {
    out.push(`dry-run: would remove ${PLUGIN_PACKAGE} from ${file}`);
  }
  return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
}

export function status(args, opts = {}) {
  const scope = resolveScope(args, opts);
  const { file } = scope;
  const out = [`scope:    ${scope.scope}`, `config:   ${file}`];
  let installed = false;
  if (existsSync(file)) {
    try {
      const root = parseJsonc(readFileSync(file, "utf8"));
      const prop = findPluginsProperty(root);
      if (prop?.value?.type === "array") {
        installed = prop.value.elements.some((el) => elementMatchesPackage(el, PLUGIN_PACKAGE));
      }
    } catch (err) {
      if (err instanceof CliError) return { code: 1, stdout: "", stderr: `opencode-goal: cannot parse ${file}: ${err.message}\n` };
      throw err;
    }
  } else {
    out.push(`config:   (does not exist)`);
  }
  out.push(installed ? `installed: yes (${PLUGIN_PACKAGE})` : "not installed");
  try {
    const v = spawnSync("opencode", ["--version"], { encoding: "utf8", timeout: 5000 });
    if (v.status === 0 && v.stdout) out.push(`opencode: ${v.stdout.trim()}`);
    else out.push(`opencode: not found on PATH`);
  } catch {
    out.push(`opencode: not found on PATH`);
  }
  return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
}

export function runCli(argv, opts = {}) {
  const args = [...argv];
  if (args.includes("--help") || args.includes("-h")) {
    return { code: 0, stdout: usage(), stderr: "" };
  }
  if (args.includes("--version") || args.includes("-v")) {
    return { code: 0, stdout: `opencode-goal ${VERSION}\n`, stderr: "" };
  }
  const flags = new Set(["--global", "--project", "--dry-run", "--restore"]);
  const unknownFlag = args.find((a) => a.startsWith("--") && !flags.has(a));
  if (unknownFlag) return { code: 2, stdout: "", stderr: `opencode-goal: unknown flag ${unknownFlag} (try: opencode-goal --help)\n` };
  const positional = args.filter((a) => !a.startsWith("--"));
  const cmd = positional[0] ?? "install";
  if (positional.length > 1) return { code: 2, stdout: "", stderr: `opencode-goal: unexpected argument ${positional[1]} (try: opencode-goal --help)\n` };
  if (!["install", "uninstall", "status"].includes(cmd)) {
    return { code: 2, stdout: "", stderr: `opencode-goal: unknown command '${cmd}' (try: opencode-goal --help)\n` };
  }
  if (args.includes("--restore") && cmd !== "uninstall") {
    return { code: 2, stdout: "", stderr: `opencode-goal: --restore only applies to uninstall\n` };
  }
  try {
    if (cmd === "install") return install(args, opts);
    if (cmd === "uninstall") return uninstall(args, opts);
    return status(args, opts);
  } catch (err) {
    if (err instanceof CliError) return { code: 1, stdout: "", stderr: `opencode-goal: ${err.message}\n` };
    const message = err instanceof Error ? err.message : String(err);
    return { code: 1, stdout: "", stderr: `opencode-goal: ${message}\n` };
  }
}

function usage() {
  return [
    "opencode-goal — manage the opencode-goal plugin (OpenCode v2)",
    "",
    "usage:",
    "  opencode-goal [install] [--global|--project] [--dry-run]",
    "  opencode-goal uninstall [--global|--project] [--dry-run] [--restore]",
    "  opencode-goal status    [--global|--project]",
    "",
    "  --global    per-machine config (default): $XDG_CONFIG_HOME/opencode or ~/.config/opencode",
    "  --project   the current directory's project config (opencode.json[c] or .opencode/opencode.json[c])",
    "  --dry-run   print what would change; write nothing",
    "  --restore   uninstall only: copy the newest pre-install .bak back over the config",
    "",
  ].join("\n");
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(new URL(import.meta.url).pathname);
  } catch {
    return resolve(entry) === resolve(new URL(import.meta.url).pathname);
  }
})();

if (isMain) {
  const result = runCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
