#!/usr/bin/env node
/**
 * goal-loop — install/uninstall the goal-loop plugin on OpenCode v2.
 *
 * Mechanism (verified against the installed opencode v2.3.0 binary and the v2
 * plugin docs, 2026-11-15):
 *   OpenCode v2 discovers configured plugins from the `plugins` array in its
 *   config file — `"plugins": ["github:paumkim/goal-loop#v1.2.0"]`.
 *   Git package specifiers resolve from the remote via Bun and are cached in
 *   ~/.cache/opencode/npm/git-opencode-goalv2-<hash>/ ; the GitHub release is the
 *   canonical distribution channel for this package. A `<config>/plugins/*.ts`
 *   directory of direct files also auto-loads, but it cannot express this
 *   reference and would not track releases, so this CLI edits the `plugins`
 *   array instead. `opencode plugin add` wraps the same config edit but
 *   attaches to the background service and offers no backup/restore, so we do
 *   the edit ourselves, surgically, on the config file.
 *   Back-compat: PLUGIN_PACKAGE ("opencode-goalv2") is what older installers
 *   wrote, and installs from before the repository rename carry
 *   github:paumkim/opencode-goalv2#v<tag>. Uninstall and status match all of them,
 *   and install migrates the pre-rename specifier to the current one; an install
 *   made by an old version therefore uninstalls and upgrades cleanly.
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
 *   - Uninstall removes exactly the entry install added. If the entry is missing
 *     but an install-time original exists (the OLDEST backup whose parsed
 *     content provably lacks the plugin), uninstall restores that pre-install
 *     config unchanged (taking a fresh safety backup of the current state
 *     first), and is a clean no-op when the config already matches it.
 *     Uninstall never auto-restores a backup containing the plugin. If the
 *     nothing but install's skeleton remains in the config file, the file is
 *     deleted (the message reports the skeleton, not who created it). `uninstall --restore` copies that same
 *     pre-install backup back over the config on demand (also taking a fresh
 *     safety backup of the current state first).
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
  renameSync,
  statSync,
  constants,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join, resolve, dirname, isAbsolute, basename } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

const PKG = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  } catch {
    return {};
  }
})();

export const PLUGIN_PACKAGE = "opencode-goalv2"; // legacy spec; kept for uninstall/status back-compat
// A standalone copy (installed by install.sh) has no package.json next to it, so the
// version is baked in here too. test/cli-installer.test.ts pins both to be equal.
const FALLBACK_VERSION = "1.2.0";
const VERSION = typeof PKG.version === "string" ? PKG.version : FALLBACK_VERSION;
export const PLUGIN_SPEC = `github:paumkim/goal-loop#v${VERSION}`;
const SPECS = [PLUGIN_SPEC, PLUGIN_PACKAGE];
// The repository was renamed from opencode-goalv2 to goal-loop after v1.1.0. Configs the
// old installer wrote still carry the old slug (GitHub redirects that URL, so those
// installs keep working). Uninstall/status must recognise them, and install migrates them
// in place instead of stacking a second entry next to the old one.
const LEGACY_REPO_SPEC = /^github:paumkim\/opencode-goalv2(?:#.*)?$/;
// Any pin from the current repository slug — stable tag, floating `dev`, or a pinned commit SHA.
// Update/channel/status must recognize all three; install/uninstall keep their narrower matchers.
const CURRENT_REPO_SPEC = /^github:paumkim\/goal-loop(?:#.*)?$/;
const SCHEMA_URL = "https://opencode.ai/config.json";

// ---- update preferences & channels ---------------------------------------------------------------
const GITHUB_API = "https://api.github.com/repos/paumkim/goal-loop";
const GITHUB_RAW = "https://raw.githubusercontent.com/paumkim/goal-loop";
const CHANNELS = ["main", "dev"];
const UPDATE_MODES = ["auto", "off"];
const DEFAULT_UPDATE_TIMEOUT_MS = 8000;
const DEFAULT_PREFS = Object.freeze({ channel: "main", mode: "auto" });
const SEMVER_REF = /^v?\d+\.\d+\.\d+/;
const SHA_REF = /^[0-9a-f]{7,40}$/;

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
    if (t.type === "literal") {
      if (!/^(-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?|true|false|null)$/.test(t.value)) {
        throw new CliError(`invalid literal '${t.value}' at offset ${t.start}`);
      }
      pos++;
      return { type: "literal", start: t.start, end: t.end, value: t.value };
    }
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
  const matches = root.properties.filter((p) => p.key === "plugins");
  if (matches.length > 1) {
    throw new CliError(`duplicate "plugins" keys at offsets ${matches.map((m) => m.keyStart).join(", ")}; refusing to edit`);
  }
  return matches[0] ?? null;
}

function elementMatchesSpec(el, spec) {
  if (el.type === "string") return el.value === spec;
  if (el.type === "object") {
    const p = el.properties.find((pr) => pr.key === "package");
    return p?.value?.type === "string" && p.value.value === spec;
  }
  return false;
}

/** The spec string an entry carries, or null when the element is off-contract. */
function entrySpec(el) {
  if (el.type === "string") return el.value;
  if (el.type === "object") {
    const p = el.properties.find((pr) => pr.key === "package");
    return p?.value?.type === "string" ? p.value.value : null;
  }
  return null;
}

function isLegacyRepoEntry(el) {
  const spec = entrySpec(el);
  return spec !== null && LEGACY_REPO_SPEC.test(spec);
}

function matchesPluginEntry(el) {
  return SPECS.some((spec) => elementMatchesSpec(el, spec));
}

/** True when the parsed config carries an entry from the pre-rename repository slug. */
function hasLegacyRepoEntry(text) {
  try {
    const root = parseJsonc(text);
    const prop = findPluginsProperty(root);
    return prop?.value?.type === "array" && prop.value.elements.some(isLegacyRepoEntry);
  } catch {
    return false;
  }
}

/**
 * Split the span between an array's last element (or `[`) and `]` into the
 * comment/comma material to keep and the newline+indent that sits on the
 * `]` line. Comments between the last element and `]` must survive (line 40),
 * so the insertion preserves `head` verbatim instead of deleting it.
 */
function splitClosingBracketSpan(inner) {
  const indentM = inner.match(/(\r?\n[ \t]*)$/);
  const head = indentM ? inner.slice(0, -indentM[1].length) : inner;
  const bracketLine = indentM ? indentM[1] : "\n  ";
  return { head, bracketLine };
}

/** True when `head` (text between the last element and `]`) carries no top-level comma. Comments are stripped before the check. */
function headCarriesComma(head) {
  const noBlock = head.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock.replace(/\/\/[^\n]*/g, "").includes(",");
}

/**
 * Add a `plugins` property to an object that has none, matching the file's existing
 * indentation. The old insertion always prepended two spaces to the following line, so a
 * config that already had keys (`{$schema}` was the common case) came back with its first
 * key indented four spaces — valid JSONC, but drift uninstall then had to undo.
 */
function insertPluginsProperty(text, root, entry, eol) {
  const first = root.properties[0];
  const afterOpen = root.start + 1;
  const lineStart = text.lastIndexOf("\n", first.keyStart - 1) + 1;
  if (lineStart > afterOpen) {
    const indent = text.slice(lineStart, first.keyStart);
    const block = `${indent}"plugins": [${eol}${indent}  ${entry}${eol}${indent}],${eol}`;
    return text.slice(0, lineStart) + block + text.slice(lineStart);
  }
  // First property shares the opening brace's line: start a fresh line at the default indent.
  const rest = text.slice(afterOpen).replace(/^[ \t]*/, "");
  return text.slice(0, afterOpen) + `${eol}  "plugins": [${eol}    ${entry}${eol}  ],${eol}  ` + rest;
}

/** Insert (or detect) the plugin in the config text. Returns { text, already }. `spec` lets update/channel add a non-default pin. */
export function addPluginText(text, spec = PLUGIN_SPEC) {
  const root = parseJsonc(text);
  const prop = findPluginsProperty(root);
  const entry = JSON.stringify(spec);
  if (!prop) {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const insert = `  "plugins": [${eol}    ${entry}${eol}  ],${eol}  `;
    if (root.properties.length === 0) {
      const empty = text.slice(0, root.start + 1) + `${eol}${insert.slice(0, -(eol.length + 3))}${eol}` + text.slice(root.end - 1);
      return { text: empty, already: false };
    }
    return { text: insertPluginsProperty(text, root, entry, eol), already: false };
  }
  const arr = prop.value;
  if (arr.type !== "array") throw new CliError(`"plugins" is not an array; not touching it`);
  // Any pin from this repo counts as installed — the standalone CLI's baked version can lag
  // an updated config, and a second entry would load the plugin twice.
  if (arr.elements.some((el) => matchesPluginEntry(el) || matchesGoalLoopEntry(el))) return { text, already: true };
  if (arr.elements.length === 0) {
    const inner = text.slice(arr.start + 1, arr.end - 1);
    const kept = inner.trim();
    if (kept) {
      // preserve comments between [ and ]: keep them on the entry line
      const { bracketLine } = splitClosingBracketSpan(inner);
      return { text: text.slice(0, arr.start + 1) + `\n    ${entry} ${kept}` + bracketLine + text.slice(arr.end - 1), already: false };
    }
    return { text: text.slice(0, arr.start + 1) + `\n    ${entry}\n  ` + text.slice(arr.end - 1), already: false };
  }
  const lastEl = arr.elements[arr.elements.length - 1];
  const inner = text.slice(lastEl.end, arr.end - 1);
  const { head, bracketLine } = splitClosingBracketSpan(inner);
  // add the separating comma right after the last element when the head has none (comment-only), then re-emit the head verbatim
  return { text: text.slice(0, lastEl.end) + (headCarriesComma(head) ? "" : ",") + head + `\n    ${entry}` + bracketLine + text.slice(arr.end - 1), already: false };
}

/** Remove a span plus one adjacent comma (following comma preferred, else preceding). */
function removeSpanWithComma(text, start, end) {
  let i = end;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] === ",") {
    let j = i + 1;
    // swallow the rest of the line's trailing whitespace (including CR for CRLF) plus the line ending when the whole line is consumed
    let k = j;
    while (k < text.length && (text[k] === " " || text[k] === "\t")) k++;
    if (text[k] === "\r" && text[k + 1] === "\n") j = k + 2; // CRLF line ending
    else if (text[k] === "\n" || text[k] === "\r") j = k + 1; // LF or lone CR line ending
    return text.slice(0, start) + text.slice(j);
  }
  let p = start;
  while (p > 0 && /\s/.test(text[p - 1])) p--;
  if (text[p - 1] === ",") {
    return text.slice(0, p - 1) + text.slice(end);
  }
  return text.slice(0, start) + text.slice(end);
}

/**
 * Remove a property that owns its line, indentation included. Passing the key offset to
 * `removeSpanWithComma` left that line's indent stranded in front of the next line (a
 * two-space shift per uninstall). When the key is the first thing on its line, start the
 * removal at the line's beginning instead; inline properties keep the old behavior.
 */
function removePropertySpan(text, keyStart, valueEnd) {
  const lineStart = text.lastIndexOf("\n", keyStart - 1) + 1;
  const prefix = text.slice(lineStart, keyStart);
  const ownsLine = lineStart < keyStart && /^[ \t]*$/.test(prefix);
  return removeSpanWithComma(text, ownsLine ? lineStart : keyStart, valueEnd);
}

/** Offset of the first comma outside a comment in `region`, or -1. Separators between array elements live here. */
function firstSeparatorComma(region) {
  let i = 0;
  while (i < region.length) {
    const c = region[i];
    if (c === "/" && region[i + 1] === "/") {
      const nl = region.indexOf("\n", i);
      i = nl === -1 ? region.length : nl;
      continue;
    }
    if (c === "/" && region[i + 1] === "*") {
      const close = region.indexOf("*/", i + 2);
      i = close === -1 ? region.length : close + 2;
      continue;
    }
    if (c === ",") return i;
    i++;
  }
  return -1;
}

/**
 * Remove the last element of a non-empty array together with the separator comma install
 * added, keeping any comment that sat between the previous element and the new entry.
 * `removeSpanWithComma` cannot do this: when a comment follows the separator comma it
 * finds neither an adjacent comma nor a preceding one, and uninstall left `"other",` plus a
 * blank line behind — drift that up to now survived every strict-JSON test because those
 * configs have no comments. Only the last element needs this path; a non-last element
 * keeps the separator and drops its following comma (the adjacent-comma branch).
 */
function removeLastElement(text, arr, el) {
  const idx = arr.elements.indexOf(el);
  const prev = idx > 0 && idx === arr.elements.length - 1 ? arr.elements[idx - 1] : undefined;
  if (!prev) return removeSpanWithComma(text, el.start, el.end);
  // The newline+indent immediately before the entry is install's insertion whitespace.
  let wsStart = el.start;
  while (wsStart > prev.end && (text[wsStart - 1] === " " || text[wsStart - 1] === "\t")) wsStart--;
  if (text[wsStart - 1] === "\n" && text[wsStart - 2] === "\r") wsStart -= 2;
  else if (text[wsStart - 1] === "\n" || text[wsStart - 1] === "\r") wsStart--;
  const region = text.slice(prev.end, wsStart);
  const comma = firstSeparatorComma(region);
  const kept = comma === -1 ? region : region.slice(0, comma) + region.slice(comma + 1);
  return text.slice(0, prev.end) + kept + text.slice(el.end);
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
    const el = arr.elements.find((element) => matchesPluginEntry(element) || isLegacyRepoEntry(element) || matchesGoalLoopEntry(element));
    if (!el) break;
    removed = true;
    current = removeLastElement(current, arr, el);
  }
  if (!removed) return { text, removed: false, emptyRoot: false, skeletonRoot: false };
  // Drop the plugins property entirely when the array is empty.
  const root = parseJsonc(current);
  const prop = findPluginsProperty(root);
  if (prop && prop.value.type === "array" && prop.value.elements.length === 0) {
    current = removePropertySpan(current, prop.keyStart, prop.value.end);
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
  const home = opts.homedir ?? (env.HOME || undefined) ?? homedir(); // empty HOME falls back like unset
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
  const dir = xdg && isAbsolute(xdg) ? join(xdg, "opencode") : join(home, ".config", "opencode"); // non-absolute XDG is ignored (XDG spec), never resolved against CWD
  const json = join(dir, "opencode.json");
  const jsonc = join(dir, "opencode.jsonc");
  if (existsSync(jsonc)) return { scope: "global", dir, file: jsonc };
  if (existsSync(json)) return { scope: "global", dir, file: json };
  return { scope: "global", dir, file: jsonc };
}

/**
 * Write a file atomically: temp file in the same directory, then rename into place.
 * Operates on the realpath when the file exists (a symlinked config is replaced
 * atomically through the link rather than the link itself being replaced) and
 * preserves the existing file's mode (a 0600 config stays 0600).
 */
function writeFileAtomic(file, contents) {
  let target = file;
  try {
    target = realpathSync(file); // the bytes live there; keep the user's symlink intact
  } catch {
    // file does not exist yet: write at the given path (parent dir is created by the caller)
  }
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    let mode;
    try {
      mode = statSync(target).mode & 0o7777;
    } catch {
      mode = undefined;
    }
    // Open, write, fsync, close BEFORE the rename: the rename must not make
    // the new bytes visible on disk before they are durable.
    const fd = mode === undefined ? openSync(tmp, "w") : openSync(tmp, "w", mode);
    try {
      writeSync(fd, contents);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(tmp, target);
    } catch (err) {
      try { unlinkSync(tmp); } catch { /* best effort; do not mask the rename error */ }
      throw err;
    }
  } catch (err) {
    // open/write/fsync threw: the tmp may exist and be half-written — remove it
    try { unlinkSync(tmp); } catch { /* tmp may never have been created */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

/**
 * Back up a file next to the original, <file>.<stamp>[-N].bak, never overwritten.
 * When `contents` is given (the exact bytes that were parsed as the edit base),
 * the backup is written from them instead of re-copying the live file — the
 * backup then matches the pre-edit state byte-for-byte even if another process
 * edits the file in between. Exclusive creation (COPYFILE_EXCL/wx) closes the
 * existsSync→copy race.
 */
function backupFile(file, contents) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + "Z";
  let dest = `${file}.${stamp}.bak`;
  let n = 2;
  for (;;) {
    try {
      if (contents !== undefined) writeFileSync(dest, contents, { flag: "wx" });
      else copyFileSync(file, dest, constants.COPYFILE_EXCL);
      return dest;
    } catch (err) {
      if (err && err.code === "EEXIST") {
        dest = `${file}.${stamp}-${n++}.bak`;
        continue;
      }
      throw err;
    }
  }
}

// Stamp exactly as backupFile emits: <file>.<yyyy-MM-DD-HH-mm-ss>Z[-N].bak — collision suffix -N sorts AFTER the plain backup of the same second.
// Foreign <base>.*.bak files that do not match this exact, range-checked shape are never restore candidates.
const DATE_STAMP = String.raw`\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])-(?:[01]\d|2[0-3])-[0-5]\d-[0-5]\d`;
const BACKUP_NAME = String.raw`${DATE_STAMP}Z(?:-(\d+))?\.bak$`;
const backupChronologyKey = (f) => {
  const m = f.match(new RegExp(`\\.(${DATE_STAMP})Z(?:-(\\d+))?\\.bak$`));
  return m ? [m[1], m[2] ? Number(m[2]) : 0] : null;
};
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function compareBackupsChronologically(a, b) {
  const [ta, ia] = backupChronologyKey(a) ?? ["9999", 0];
  const [tb, ib] = backupChronologyKey(b) ?? ["9999", 0];
  return ta < tb ? -1 : ta > tb ? 1 : ia - ib;
}

function listBackups(file) {
  const dir = resolve(file, "..");
  const base = file.slice(dir.length + 1);
  if (!existsSync(dir)) return [];
  const re = new RegExp(`^${escapeRegExp(base)}\\.${BACKUP_NAME}`);
  return readdirSync(dir)
    .filter((f) => re.test(f)) // exactly the format backupFile emits; foreign backups never match
    .map((f) => join(dir, f))
    .sort(compareBackupsChronologically); // ascending by true creation time
}

/** True when the parsed backup provably lacks the plugin (the install-time original). Null = unverifiable, do not trust it. */
function backupPluginFree(bak) {
  try {
    const root = parseJsonc(readFileSync(bak, "utf8"));
    const prop = findPluginsProperty(root);
    if (!prop) return true; // parsed, no plugins key at all
    if (prop.value.type !== "array") return null; // unverifiable, never auto-restore
    return !prop.value.elements.some((el) => matchesPluginEntry(el) || matchesGoalLoopEntry(el));
  } catch {
    return null; // unparseable backup — never restore from it
  }
}

/**
 * The install-time original: the OLDEST backup whose content provably lacks the
 * plugin. Safety copies taken during a restore are also plugin-free, so the
 * newest-plugin-free rule used to let a restore rewrite the pre-install config
 * with drifted bytes on a later run. Oldest-first makes repeated runs converge:
 * once the config matches the pre-install original, further uninstalls are a
 * clean no-op. Never a backup containing the plugin.
 */
function preInstallBackup(file) {
  const baks = listBackups(file); // oldest first
  for (const bak of baks) {
    if (backupPluginFree(bak) === true) return bak;
  }
  return undefined;
}

/** Shared outcome for "nothing to remove" (file missing or entry missing). See header for the restore rule. */
function missingEntryOutcome(file, dryRun) {
  const out = [];
  const candidate = preInstallBackup(file);
  if (candidate) {
    if (existsSync(file)) {
      if (readFileSync(file, "utf8") === readFileSync(candidate, "utf8")) {
        out.push(`not installed (${file}); config already matches the pre-install backup`);
        return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
      }
    }
    if (!dryRun) {
      let safety = null;
      if (existsSync(file)) safety = backupFile(file); // never clobber: keep the drifted state
      else mkdirSync(scopeDirOf(file), { recursive: true });
      copyFileSync(candidate, file); // the pre-install config, byte for byte
      out.push(`entry was missing; restored the pre-install config from ${candidate} over ${file}${safety ? ` (backup of the current state: ${safety})` : ""}; restart opencode`);
    } else {
      out.push(`dry-run: entry was missing; would restore ${candidate} over ${file}`);
    }
    return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
  }
  if (!existsSync(file)) out.push(`not installed (no config at ${file})`);
  else out.push(`not installed (${file}); nothing to do`);
  const baks = listBackups(file);
  if (baks.length > 0) out.push(`note: backups exist (they contain the plugin entry); --restore puts the pre-install backup back over the config`);
  return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
}

// ---------------------------------------------------------------------------
// Commands — each returns { code, stdout, stderr }
// ---------------------------------------------------------------------------

const skeleton = (spec = PLUGIN_SPEC) =>
  `{\n  "$schema": "${SCHEMA_URL}",\n  "plugins": [\n    ${JSON.stringify(spec)}\n  ]\n}\n`;

export function install(args, opts = {}) {
  const dryRun = args.includes("--dry-run");
  const scope = resolveScope(args, opts);
  const { file } = scope;
  const out = [];
  if (!existsSync(file)) {
    if (!dryRun) {
      mkdirSync(scopeDirOf(file), { recursive: true });
      writeFileAtomic(file, skeleton());
    }
    out.push(dryRun
      ? `dry-run: would create ${file} with ${PLUGIN_SPEC}`
      : `installed ${PLUGIN_SPEC} in ${file} (created); restart opencode`);
    return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
  }
  const text = readFileSync(file, "utf8");
  // A config written by the pre-rename installer carries the old repository slug. Replace
  // it in place: leaving it means the old tag keeps loading, adding the new spec next to
  // it means two copies of the plugin.
  const migrating = hasLegacyRepoEntry(text);
  const result = addPluginText(migrating ? removePluginText(text).text : text);
  if (result.already && !migrating) {
    out.push(`already installed (${file}); nothing to do`);
    return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
  }
  if (!dryRun) {
    const bak = backupFile(file, text); // bytes identical to the edit base
    writeFileAtomic(file, result.text);
    out.push(migrating
      ? `updated ${file}: replaced the pre-rename github:paumkim/opencode-goalv2 specifier with ${PLUGIN_SPEC}; restart opencode (backup: ${bak})`
      : `installed ${PLUGIN_SPEC} in ${file}; restart opencode (backup: ${bak})`);
  } else {
    out.push(migrating
      ? `dry-run: would replace the pre-rename github:paumkim/opencode-goalv2 specifier with ${PLUGIN_SPEC} in ${file}`
      : `dry-run: would add ${PLUGIN_SPEC} to ${file}`);
  }
  return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
}

function scopeDirOf(file) {
  return dirname(file);
}

export function uninstall(args, opts = {}) {
  const self = args.includes("--self");
  const base = uninstallEntry(args, opts);
  if (!self) return base;
  const dryRun = args.includes("--dry-run");
  const out = [base.stdout.replace(/\n$/, "")];
  if (base.code !== 0 && base.stderr) return base;
  const script = selfScriptPath(opts.selfPath ?? process.argv[1]);
  if (!script) {
    out.push(`self-removal skipped: ${opts.selfPath ?? process.argv[1] ?? "no script path"} is not the goal-loop script; remove it yourself`);
  } else if (!dryRun) {
    unlinkSync(script);
    out.push(`deleted ${script} (goal-loop CLI removed)`);
  } else {
    out.push(`dry-run: would delete ${script}`);
  }
  return { code: base.code, stdout: out.filter(Boolean).join("\n") + "\n", stderr: "" };
}
/** The real path of the running CLI when it is a goal-loop script, else null. */
function selfScriptPath(entry) {
  if (!entry) return null;
  let real = entry;
  try {
    real = realpathSync(entry);
  } catch {
    return null;
  }
  const name = basename(real);
  if (name !== "goal-loop" && name !== "goal-loop.mjs") return null;
  try {
    return readFileSync(real, "utf8").includes("goal-loop — install/uninstall the goal-loop plugin") ? real : null;
  } catch {
    return null;
  }
}
/** Dry-run counterpart of the skeleton branch: says whether the file would be restored or deleted. */
function dryRunSkeletonLine(result, file, original) {
  if (!result.emptyRoot && !result.skeletonRoot) return `dry-run: would remove ${PLUGIN_SPEC} from ${file}`;
  if (original) return `dry-run: entry was the last thing in ${file}; would restore ${original} over it`;
  return `dry-run: entry was the last thing in ${file}; would delete it (only install's skeleton remained)`;
}

function uninstallEntry(args, opts = {}) {
  const dryRun = args.includes("--dry-run");
  const restore = args.includes("--restore");
  const scope = resolveScope(args, opts);
  const { file } = scope;
  const out = [];

  if (restore) {
    const candidate = preInstallBackup(file);
    if (!candidate) return { code: 1, stdout: "", stderr: `goal-loop: no pre-install (plugin-free) backup found for ${file}\n` };
    if (!dryRun) {
      const safety = existsSync(file) ? backupFile(file) : null; // keep a safety copy of the current state
      if (!safety) mkdirSync(scopeDirOf(file), { recursive: true });
      copyFileSync(candidate, file); // the pre-install config, byte for byte
      out.push(`restored ${candidate} over ${file}${safety ? ` (backup of the pre-restore state: ${safety})` : ""}`);
      return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
    }
    out.push(`dry-run: would restore ${candidate} over ${file}`);
    return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
  }

  if (!existsSync(file)) return missingEntryOutcome(file, dryRun);

  const text = readFileSync(file, "utf8");
  const result = removePluginText(text);
  if (!result.removed) return missingEntryOutcome(file, dryRun);
  // A plugin-free backup proves the file existed before install (install only backs up
  // existing files). When the surgical removal reduces the file to install's skeleton or
  // to nothing, the user's original file must come back — deleting it would take a
  // `$schema`-only or `{}` config the user created. When no such backup exists, install
  // created the file and deleting it is the correct undo.
  const original = result.emptyRoot || result.skeletonRoot ? preInstallBackup(file) : undefined;
  if (!dryRun) {
    const bak = backupFile(file, text); // bytes identical to the edit base
    if (result.emptyRoot || result.skeletonRoot) {
      if (original) {
        copyFileSync(original, file); // the pre-install config, byte for byte
        out.push(`removed ${PLUGIN_SPEC}; restored the pre-install config ${original} over ${file}; restart opencode (backup: ${bak})`);
      } else {
        unlinkSync(file);
        out.push(`removed ${PLUGIN_SPEC}; deleted ${file} (only install's skeleton remained); restart opencode (backup: ${bak})`);
      }
    } else {
      writeFileAtomic(file, result.text);
      out.push(`removed ${PLUGIN_SPEC} from ${file}; restart opencode (backup: ${bak})`);
    }
  } else {
    out.push(dryRunSkeletonLine(result, file, original));
  }
  return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
}

/**
 * Classify a spawnSync("opencode", ["--version"]) result into one line of prose.
 * A non-zero exit, an error other than ENOENT, and a timeout are distinct
 * states — collapsing them into "not found on PATH" hides real failures.
 */
export function probeOpencodeVersion(v) {
  if (v.error) {
    const e = v.error;
    const code = e && typeof e === "object" && "code" in e ? String(e.code) : "";
    if (code === "ENOENT") return "not found on PATH";
    if (code === "ETIMEDOUT") return "--version timed out";
    return `failed to run (${code || (e instanceof Error ? e.message : String(e))})`;
  }
  if (v.signal) return `--version killed by signal ${v.signal}`;
  if (v.status === 0 && v.stdout && String(v.stdout).trim()) return String(v.stdout).trim();
  if (v.status === 0) return "--version produced no output";
  if (typeof v.status === "number") return `--version exited with code ${v.status}`;
  return "--version outcome unknown";
}

// ---------------------------------------------------------------------------
// Updates: preferences, ref resolution and config pin rewrite
// ---------------------------------------------------------------------------

// ---- update preferences (stored in plugins[].options.update — one source of truth) ---------------

/** True for any pin from the current repo (tag, branch or SHA) — unlike matchesPluginEntry, which pins one exact spec. */
function matchesGoalLoopEntry(el) {
  const spec = entrySpec(el);
  return spec !== null && CURRENT_REPO_SPEC.test(spec);
}

const normalizePrefs = (raw) => ({
  channel: CHANNELS.includes(raw?.channel) ? raw.channel : DEFAULT_PREFS.channel,
  mode: UPDATE_MODES.includes(raw?.mode) ? raw.mode : DEFAULT_PREFS.mode,
});

/** Materialize a parsed JSONC value node as plain JSON data (options may hold arbitrary user settings). */
function plainValue(node) {
  if (!node) return undefined;
  if (node.type === "string") return node.value;
  if (node.type === "literal") {
    if (node.value === "true") return true;
    if (node.value === "false") return false;
    if (node.value === "null") return null;
    const n = Number(node.value);
    return Number.isFinite(n) ? n : node.value;
  }
  if (node.type === "array") return node.elements.map(plainValue);
  if (node.type === "object") {
    const out = {};
    for (const prop of node.properties) out[prop.key] = plainValue(prop.value);
    return out;
  }
  return undefined;
}

/** Read the goal-loop plugin entry: its pin, its options, and the update preferences nested in them. */
function readPluginState(args, opts) {
  const scope = resolveScope(args, opts);
  const empty = { scope, text: null, el: null, spec: null, ref: null, channel: null, options: {}, prefs: { ...DEFAULT_PREFS } };
  if (!existsSync(scope.file)) return empty;
  const text = readFileSync(scope.file, "utf8");
  const root = parseJsonc(text);
  const prop = findPluginsProperty(root);
  const el = prop?.value?.type === "array"
    ? prop.value.elements.find((e) => matchesPluginEntry(e) || matchesGoalLoopEntry(e) || isLegacyRepoEntry(e))
    : undefined;
  if (!el) return { ...empty, text };
  let spec = null;
  let options = {};
  if (el.type === "string") spec = el.value;
  else if (el.type === "object") {
    const pkg = el.properties.find((pr) => pr.key === "package" && pr.value.type === "string");
    if (pkg) spec = pkg.value.value;
    const optionsProp = el.properties.find((pr) => pr.key === "options" && pr.value.type === "object");
    if (optionsProp) options = plainValue(optionsProp.value);
  }
  const ref = spec && spec.includes("#") ? spec.slice(spec.indexOf("#") + 1) : null;
  const channel = ref === null ? null
    : SEMVER_REF.test(ref) ? "main"
    : ref === "dev" || SHA_REF.test(ref) ? "dev"
    : null;
  return { scope, text, el, spec, ref, channel, options, prefs: normalizePrefs(options?.update) };
}

/** Locate the goal-loop entry in already-parsed config text (used after addPluginText creates one). */
function findGoalLoopNode(text) {
  const root = parseJsonc(text);
  const prop = findPluginsProperty(root);
  return prop?.value?.type === "array"
    ? prop.value.elements.find((el) => matchesPluginEntry(el) || matchesGoalLoopEntry(el)) ?? null
    : null;
}

/** Replace the whole plugin entry with a canonical object form; everything outside the entry is byte-identical. */
function writePluginState(state, { spec, options }) {
  let text = state.text;
  let el = state.el;
  if (!el) {
    text = addPluginText(text, spec).text;
    el = findGoalLoopNode(text);
  }
  const replacement = JSON.stringify({ package: spec, options });
  return text.slice(0, el.start) + replacement + text.slice(el.end);
}

/** Backup + atomic write of a rewritten config. Returns the backup path for the success message. */
function commitStateChange(state, spec, options) {
  const bak = backupFile(state.scope.file, state.text);
  writeFileAtomic(state.scope.file, writePluginState(state, { spec, options }));
  return bak;
}

export function readUpdatePrefs(args, opts = {}) {
  return opts.prefs ? normalizePrefs(opts.prefs) : readPluginState(args, opts).prefs;
}

export function writeUpdatePrefs(args, opts, prefs) {
  const state = readPluginState(args, opts);
  if (!state.spec) throw new CliError(`goal-loop is not installed in ${state.scope.file}; run 'goal-loop install' first`);
  const bak = commitStateChange(state, state.spec, { ...state.options, update: normalizePrefs(prefs) });
  return { file: state.scope.file, backup: bak };
}

/** JSON GET with a user agent and a hard timeout. `opts.fetch` is injectable so tests never hit the network. */
async function fetchJson(url, opts) {
  const impl = opts.fetch ?? globalThis.fetch;
  if (typeof impl !== "function") throw new Error("no fetch implementation available");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS);
  try {
    const response = await impl(url, {
      headers: { "User-Agent": `goal-loop/${VERSION}`, Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Numeric semver compare for tag names (`v` prefix optional); non-numeric tails are ignored. */
function compareSemver(a, b) {
  const parts = (s) => s.replace(/^v/, "").split(".").map((p) => Number.parseInt(p, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Resolve the ref each channel means right now:
 *   main -> the newest semver tag (fallbacks: latest GitHub Release, package.json on main)
 *   dev  -> the latest commit SHA on dev (pinned, so a restart always re-fetches a new build)
 * A tag list is primary because releases are pushed manually and can lag the newest stable tag.
 */
export async function resolveLatestRef(channel, opts = {}) {
  if (channel === "dev") {
    const url = `${GITHUB_API}/commits/dev`;
    const data = await fetchJson(url, opts);
    const sha = typeof data?.sha === "string" ? data.sha : "";
    if (!SHA_REF.test(sha)) throw new Error("the dev commit response carried no usable sha");
    const short = sha.slice(0, 7);
    return { channel, ref: sha, label: short, spec: `github:paumkim/goal-loop#${sha}`, source: "dev commit", url };
  }
  let tag = "";
  let source = "latest tag";
  let url = `${GITHUB_API}/tags`;
  try {
    const data = await fetchJson(url, opts);
    const names = Array.isArray(data) ? data.map((t) => (typeof t?.name === "string" ? t.name : "")).filter((n) => SEMVER_REF.test(n)) : [];
    tag = names.length > 0 ? names.sort(compareSemver).at(-1) ?? "" : "";
  } catch {
    // Older repos may have no tag listing available; try the release below.
  }
  if (!tag) {
    source = "latest release";
    url = `${GITHUB_API}/releases/latest`;
    try {
      const data = await fetchJson(url, opts);
      tag = typeof data?.tag_name === "string" ? data.tag_name : "";
    } catch {
      // Tags are pushed manually; a repo with no Release still has a version on main.
    }
  }
  if (!tag) {
    url = `${GITHUB_RAW}/main/package.json`;
    const data = await fetchJson(url, opts);
    const version = typeof data?.version === "string" ? data.version : "";
    if (!SEMVER_REF.test(version)) throw new Error("could not resolve the latest stable version from GitHub");
    tag = version;
  }
  const ref = tag.startsWith("v") ? tag : `v${tag}`;
  return { channel: "main", ref, label: ref, spec: `github:paumkim/goal-loop#${ref}`, source, url };
}

/**
 * Check GitHub for the channel's current ref and, unless --check/--dry-run, rewrite the config pin.
 * Network failures are reported, never thrown: a bare /goal-loop must not break the user's turn.
 */
export async function update(args, opts = {}) {
  const checkOnly = args.includes("--check");
  const dryRun = args.includes("--dry-run");
  const prefs = opts.prefs ?? readUpdatePrefs(args, opts);
  try {
    if (prefs.mode === "off") {
      return { code: 0, stdout: `update mode is off (channel ${prefs.channel}); nothing was checked; enable with 'goal-loop updates auto'\n`, stderr: "" };
    }
    const state = readPluginState(args, opts);
    if (!state.spec) {
      return { code: 1, stdout: "", stderr: `goal-loop: plugin is not installed in ${state.scope.file}; run 'goal-loop install' first\n` };
    }
    const latest = await resolveLatestRef(prefs.channel, opts);
    const current = state.ref ?? state.spec;
    if (state.spec === latest.spec) {
      return { code: 0, stdout: `up to date: ${prefs.channel} @ ${current} (${latest.source})\n`, stderr: "" };
    }
    if (checkOnly) {
      return { code: 0, stdout: `update available: ${current} → ${latest.label} (channel ${prefs.channel}); run 'goal-loop update' to apply\n`, stderr: "" };
    }
    if (dryRun) {
      return { code: 0, stdout: `dry-run: would update ${state.scope.file} from ${current} to ${latest.label} (channel ${prefs.channel})\n`, stderr: "" };
    }
    const bak = commitStateChange(state, latest.spec, state.options);
    return { code: 0, stdout: `updated ${state.scope.file}: ${current} → ${latest.label} (channel ${prefs.channel}, ${latest.source}); restart opencode (backup: ${bak})\n`, stderr: "" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { code: 1, stdout: "", stderr: `goal-loop: update check failed: ${message}\n` };
  }
}

/** Persist the channel preference and move the installed pin to that channel in one atomic write. */
export async function setChannel(args, opts = {}) {
  const requested = args.find((a) => a === "main" || a === "dev");
  if (!requested) return { code: 2, stdout: "", stderr: "goal-loop: channel must be 'main' or 'dev'\n" };
  const prefs = { ...readUpdatePrefs(args, opts), channel: requested };
  if (args.includes("--dry-run")) {
    const result = await update(args, { ...opts, prefs });
    return { ...result, stdout: `channel: ${requested}\n${result.stdout}` };
  }
  try {
    const state = readPluginState(args, opts);
    if (!state.spec) return { code: 1, stdout: "", stderr: `goal-loop: plugin is not installed in ${state.scope.file}; run 'goal-loop install' first\n` };
    const latest = await resolveLatestRef(requested, opts);
    const options = { ...state.options, update: prefs };
    const bak = commitStateChange(state, latest.spec, options);
    return {
      code: 0,
      stdout: `channel: ${requested}\nupdated ${state.scope.file}: ${state.ref ?? state.spec} → ${latest.label} (${latest.source}); restart opencode (backup: ${bak})\n`,
      stderr: "",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { code: 1, stdout: "", stderr: `goal-loop: channel switch failed: ${message}\n` };
  }
}

/** Turn automatic update checks on or off for the selected scope. */
export function setUpdates(args, opts = {}) {
  const requested = args.find((a) => a === "auto" || a === "off");
  if (!requested) return { code: 2, stdout: "", stderr: "goal-loop: updates must be 'auto' or 'off'\n" };
  const prefs = { ...readUpdatePrefs(args, opts), mode: requested };
  if (args.includes("--dry-run")) {
    return { code: 0, stdout: `dry-run: would set update mode to '${requested}' (channel ${prefs.channel})\n`, stderr: "" };
  }
  writeUpdatePrefs(args, opts, prefs);
  return { code: 0, stdout: `updates: ${requested} (channel ${prefs.channel}); bare /goal-loop now ${requested === "off" ? "shows status only" : "checks for updates"}\n`, stderr: "" };
}

export function status(args, opts = {}) {
  const scope = resolveScope(args, opts);
  const { file } = scope;
  const out = [`scope:    ${scope.scope}`];
  let installed = false;
  let legacy = false;
  if (existsSync(file)) {
    out.push(`config:   ${file}`);
    try {
      const root = parseJsonc(readFileSync(file, "utf8"));
      const prop = findPluginsProperty(root);
      if (prop?.value?.type === "array") {
        installed = prop.value.elements.some((el) => matchesPluginEntry(el) || matchesGoalLoopEntry(el));
        legacy = prop.value.elements.some(isLegacyRepoEntry);
      }
    } catch (err) {
      if (err instanceof CliError) return { code: 1, stdout: "", stderr: `goal-loop: cannot parse ${file}: ${err.message}\n` };
      throw err;
    }
  } else {
    out.push(`config:   ${file} (does not exist)`);
  }
  if (installed) out.push(`installed: yes (${readPluginState(args, opts).spec ?? PLUGIN_SPEC})`);
  else if (legacy) out.push("installed: yes (pre-rename github:paumkim/opencode-goalv2 specifier; run `goal-loop install` to update it)");
  else out.push("not installed");
  const prefs = readUpdatePrefs(args, opts);
  out.push(`channel:  ${prefs.channel}`);
  out.push(`mode:     ${prefs.mode}`);
  try {
    const v = spawnSync("opencode", ["--version"], { encoding: "utf8", timeout: 5000 });
    out.push(`opencode: ${probeOpencodeVersion(v)}`);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : String(err);
    out.push(`opencode: failed to run (${code})`);
  }
  return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
}

// Host-label rename goal-loop owns. Duplicated here (instead of importing src/core/opencode-labels.ts)
// because install.sh ships this CLI as a single dependency-free file; test/opencode-labels.test.ts
// pins these constants to the core module so the two cannot drift.
const HOST_LABEL_FILE = "packages/tui/src/routes/session/index.tsx";
const LABEL_FROM = '? "Provider compaction"';
const LABEL_TO = '? "Context Cleared"';

/** Where the host TUI source lives: arg, env override, then the usual local clone. */
function resolveHostLabelFile(args, opts) {
  // Direct calls pass [path, --flags]; runCli passes ["patch-host", path, --flags]. Drop the command
  // name so a bare `goal-loop patch-host` reaches the env/default path instead of treating "patch-host"
  // as a file.
  const positional = args.filter((a) => !a.startsWith("--") && a !== "patch-host");
  const arg = positional[0];
  if (arg) return resolve(arg);
  const env = opts.env ?? process.env;
  if (env.GOAL_LOOP_OPENCODE_TUI) return resolve(env.GOAL_LOOP_OPENCODE_TUI);
  const home = opts.homedir ?? env.HOME ?? homedir();
  return join(home, "Projects", "opencode", HOST_LABEL_FILE);
}

/**
 * Re-apply the "Context Cleared" rename to a local OpenCode checkout. Literal string swap, not a
 * line-number patch: upstream refactors move the line but keep the text. Backs up before writing and
 * is idempotent, so running it after every upstream update is safe.
 */
export function patchHost(args, opts = {}) {
  const dryRun = args.includes("--dry-run");
  const file = resolveHostLabelFile(args, opts);
  if (!existsSync(file)) {
    return { code: 1, stdout: "", stderr: `goal-loop: no host TUI source at ${file}\n` };
  }
  const before = readFileSync(file, "utf8");
  const parts = before.split(LABEL_FROM);
  const replacements = parts.length - 1;
  if (replacements === 0) {
    if (before.includes(LABEL_TO)) {
      return { code: 0, stdout: `already patched (${file}); nothing to do\n`, stderr: "" };
    }
    return { code: 1, stdout: "", stderr: `goal-loop: host label not found in ${file} (upstream moved it)\n` };
  }
  if (dryRun) {
    return { code: 0, stdout: `dry-run: would replace "Provider compaction" with "Context Cleared" in ${file} (${replacements})\n`, stderr: "" };
  }
  const bak = backupFile(file, before);
  writeFileAtomic(file, parts.join(LABEL_TO));
  return {
    code: 0,
    stdout: `renamed "Provider compaction" to "Context Cleared" in ${file} (${replacements}; backup: ${bak}); rebuild opencode to see it\n`,
    stderr: "",
  };
}

export async function runCli(argv, opts = {}) {
  const args = [...argv];
  if (args.includes("--help") || args.includes("-h")) {
    return { code: 0, stdout: usage(), stderr: "" };
  }
  if (args.includes("--version") || args.includes("-v")) {
    return { code: 0, stdout: `goal-loop ${VERSION}\n`, stderr: "" };
  }
  const flags = new Set(["--global", "--project", "--dry-run", "--restore", "--self", "--check"]);
  const unknownFlag = args.find((a) => a.startsWith("--") && !flags.has(a));
  if (unknownFlag) return { code: 2, stdout: "", stderr: `goal-loop: unknown flag ${unknownFlag} (try: goal-loop --help)\n` };
  const positional = args.filter((a) => !a.startsWith("--"));
  const cmd = positional[0] ?? "install";
  const wantsArg = cmd === "channel" || cmd === "updates" || cmd === "patch-host";
  if (positional.length > (wantsArg ? 2 : 1)) {
    return { code: 2, stdout: "", stderr: `goal-loop: unexpected argument ${positional[wantsArg ? 2 : 1]} (try: goal-loop --help)\n` };
  }
  if (!["install", "uninstall", "status", "update", "channel", "updates", "patch-host"].includes(cmd)) {
    return { code: 2, stdout: "", stderr: `goal-loop: unknown command '${cmd}' (try: goal-loop --help)\n` };
  }
  if (args.includes("--restore") && cmd !== "uninstall") {
    return { code: 2, stdout: "", stderr: `goal-loop: --restore only applies to uninstall\n` };
  }
  if (args.includes("--self") && cmd !== "uninstall") {
    return { code: 2, stdout: "", stderr: `goal-loop: --self only applies to uninstall\n` };
  }
  if (args.includes("--check") && cmd !== "update" && cmd !== "channel") {
    return { code: 2, stdout: "", stderr: `goal-loop: --check only applies to update and channel\n` };
  }
  try {
    if (cmd === "install") return install(args, opts);
    if (cmd === "uninstall") return uninstall(args, opts);
    if (cmd === "status") return status(args, opts);
    if (cmd === "update") return await update(args, opts);
    if (cmd === "channel") return await setChannel(args, opts);
    if (cmd === "patch-host") return patchHost(args, opts);
    return setUpdates(args, opts);
  } catch (err) {
    if (err instanceof CliError) return { code: 1, stdout: "", stderr: `goal-loop: ${err.message}\n` };
    const message = err instanceof Error ? err.message : String(err);
    return { code: 1, stdout: "", stderr: `goal-loop: ${message}\n` };
  }
}

function usage() {
  return [
    "goal-loop — install and remove the goal-loop plugin for OpenCode v2",
    "",
    "usage:",
    "  goal-loop [install] [--global|--project] [--dry-run]",
    "  goal-loop uninstall [--global|--project] [--dry-run] [--restore|--self]",
    "  goal-loop status    [--global|--project]",
    "  goal-loop update    [--check|--dry-run] [--global|--project]",
    "  goal-loop channel   <main|dev> [--dry-run] [--global|--project]",
    "  goal-loop updates   <auto|off> [--dry-run] [--global|--project]",
    "  goal-loop patch-host [path] [--dry-run]",
    "",
    "  main   newest stable release tag from GitHub (default)",
    "  dev    latest dev commit — fast, may break things",
    "  off    never check for updates; bare /goal-loop stays a status request",
    "  --check     report whether an update exists; do not change the config",
    "  --global    per-machine config (default): $XDG_CONFIG_HOME/opencode or ~/.config/opencode",
    "  --project   the current directory's project config (opencode.json[c] or .opencode/opencode.json[c])",
    "  --dry-run   print what would change; write nothing",
    "  --restore   uninstall only: copy the pre-install .bak back over the config",
    "  --self      uninstall only: also delete the goal-loop CLI script itself",
    "  patch-host  re-apply goal-loop's host-label renames after an upstream OpenCode update",
    "              (path defaults to $GOAL_LOOP_OPENCODE_TUI or ~/Projects/opencode; backs up first)",
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
  const result = await runCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
