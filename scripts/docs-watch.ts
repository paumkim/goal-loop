#!/usr/bin/env bun
/**
 * docs-watch: zero-dependency watcher + changelog generator for the docs site.
 *
 * What it does
 *   once   Scan the watched paths, log any working-tree changes to .docs-watch.log,
 *          re-derive each docs page's "Last updated" stamp from git history, and
 *          regenerate the table in docs/changelog.html. Safe to run any time.
 *   watch  Same as `once` at startup, then re-scans (debounced) whenever a watched
 *          file, directory, or .git/index changes. Event-driven (inotify via fs.watch),
 *          no polling loop. Designed to be idle-quiet and cheap.
 *   log    Print the last 50 lines of .docs-watch.log.
 *
 * What it does not do
 *   - No network, no dependencies, no build step. docs/ stays static HTML/CSS/JS.
 *   - It never invents dates. Stamps and commit rows come from `git log` only.
 *   - It does not commit anything. Commit the regenerated files yourself.
 *
 * Files it writes (the only ones)
 *   .docs-watch-state.json   path -> mtimeMs/size snapshot (gitignored)
 *   .docs-watch.log          one line per detected change (gitignored via *.log)
 *   docs/changelog.html      rows between <!-- changes:start --> / <!-- changes:end -->
 *   docs/<page>.html         the date inside <span class="stamp">...</span>
 *
 * Why git for the stamp: the stamp promises "last commit that touched this page",
 * so it must come from git, not from file mtimes or the wall clock.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

const WATCH_PATHS = ["docs", "src", "scripts", "README.md"];
const LOG = ".docs-watch.log";
const STATE = ".docs-watch-state.json";
const CHANGE_START = "<!-- changes:start -->";
const CHANGE_END = "<!-- changes:end -->";
const LOG_MAX = 500;

const git = (args: string[]): string =>
  execFileSync("git", args, {
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const repoRoot = (): string => git(["rev-parse", "--show-toplevel"]);

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const stampFor = (pageRel: string): string =>
  git(["log", "-1", "--format=%cd", "--date=format:%Y-%m-%d %H:%M UTC", "--", pageRel]) || "unknown";

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
};

const watchedFiles = (root: string): string[] => {
  const files: string[] = [];
  for (const p of WATCH_PATHS) {
    const full = join(root, p);
    if (!existsSync(full)) continue;
    const st = statSync(full);
    if (st.isDirectory()) files.push(...walk(full));
    else if (st.isFile()) files.push(full);
  }
  return files;
};

const loadState = (root: string): Record<string, string> => {
  const p = join(root, STATE);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
};

const saveState = (root: string, files: string[]): void => {
  const state: Record<string, string> = {};
  for (const f of files) {
    try {
      const st = statSync(f);
      state[relative(root, f)] = `${st.mtimeMs}:${st.size}`;
    } catch {
      /* file vanished mid-scan */
    }
  }
  writeFileSync(join(root, STATE), JSON.stringify(state, null, 0));
};

const appendLog = (root: string, lines: string[]): void => {
  if (!lines.length) return;
  const p = join(root, LOG);
  const existing = existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean) : [];
  const merged = [...existing, ...lines].slice(-LOG_MAX);
  writeFileSync(p, merged.join("\n") + "\n");
};

/** Rewrite the date inside every <span class="stamp"> in docs/*.html. Returns pages touched. */
const restampPages = (root: string): string[] => {
  const touched: string[] = [];
  const docsDir = join(root, "docs");
  for (const name of readdirSync(docsDir)) {
    if (!name.endsWith(".html")) continue;
    const pageRel = `docs/${name}`;
    const full = join(docsDir, name);
    const html = readFileSync(full, "utf8");
    const stamp = stampFor(pageRel);
    const next = html.replace(
      /(<span class="stamp">)[^<]*(<\/span>)/,
      `$1${stamp}$2`,
    );
    if (next !== html) {
      writeFileSync(full, next);
      touched.push(pageRel);
    }
  }
  return touched;
};

const changelogRows = (root: string): string => {
  const rows: Array<{ when: string; what: string; source: string }> = [];
  try {
    const out = git([
      "log",
      "--format=%cd\t%s",
      "--date=format:%Y-%m-%d %H:%M UTC",
      "-30",
      "--",
      "docs/",
      "README.md",
      "src/",
      "scripts/",
    ]);
    for (const line of out.split("\n").filter(Boolean)) {
      const [when, ...rest] = line.split("\t");
      rows.push({ when: when ?? "", what: rest.join("\t"), source: "commit" });
    }
  } catch {
    /* not a git repo or no history: commit rows just stay empty */
  }
  // The HTML table is a pure function of git history so the committed page never
  // drifts. Working-tree (uncommitted) changes live in LOG and are shown by
  // `bun scripts/docs-watch.ts log`; they stay out of the committed HTML.
  rows.sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
  return rows
    .map(
      (r) =>
        `<tr><td><code>${esc(r.when)}</code></td><td>${esc(r.what)}</td><td>${esc(r.source)}</td></tr>`,
    )
    .join("\n");
};

const renderChangelog = (root: string): boolean => {
  const page = join(root, "docs", "changelog.html");
  if (!existsSync(page)) return false;
  const html = readFileSync(page, "utf8");
  const start = html.indexOf(CHANGE_START);
  const end = html.indexOf(CHANGE_END);
  if (start === -1 || end === -1 || end < start) return false;
  const rows = changelogRows(root);
  const next = `${html.slice(0, start + CHANGE_START.length)}\n${rows}\n${html.slice(end)}`;
  if (next !== html) writeFileSync(page, next);
  return true;
};

const scan = (root: string, opts: { quiet?: boolean } = {}): void => {
  const files = watchedFiles(root);
  const statePath = join(root, STATE);
  const firstRun = !existsSync(statePath);
  const prev = loadState(root);
  const now: Record<string, string> = {};
  for (const f of files) {
    try {
      const st = statSync(f);
      now[relative(root, f)] = `${st.mtimeMs}:${st.size}`;
    } catch {
      /* vanished */
    }
  }
  const lines: string[] = [];
  const iso = new Date().toISOString();
  if (firstRun) {
    // Baseline snapshot: log one line, not one per file.
    lines.push(`${iso}\tbaseline\t${Object.keys(now).length} files watched`);
  } else {
    for (const [rel, sig] of Object.entries(now)) {
      if (!(rel in prev)) lines.push(`${iso}\tadded\t${rel}`);
      else if (prev[rel] !== sig) lines.push(`${iso}\tmodified\t${rel}`);
    }
    for (const rel of Object.keys(prev)) {
      if (!(rel in now)) lines.push(`${iso}\tremoved\t${rel}`);
    }
  }
  appendLog(root, lines);
  const restamped = restampPages(root);
  renderChangelog(root);
  saveState(root, files);
  if (!opts.quiet) {
    for (const l of lines) console.log(l);
    if (restamped.length) console.log(`stamped: ${restamped.join(", ")}`);
    if (!lines.length && !restamped.length) console.log("no changes");
  }
};

const watchDirs = (root: string): string[] => {
  const dirs: string[] = [];
  for (const p of WATCH_PATHS) {
    const full = join(root, p);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) {
      dirs.push(full);
      for (const f of walk(full)) dirs.push(dirname(f));
    }
  }
  return [...new Set(dirs)];
};

const main = (): void => {
  const cmd = process.argv[2] ?? "once";
  const root = repoRoot();

  if (cmd === "log") {
    const p = join(root, LOG);
    if (!existsSync(p)) return console.log("(no log yet)");
    process.stdout.write(readFileSync(p, "utf8").split("\n").filter(Boolean).slice(-50).join("\n") + "\n");
    return;
  }

  if (cmd === "once") return scan(root);

  if (cmd === "watch") {
    scan(root, { quiet: true });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const trigger = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => scan(root, { quiet: true }), 300);
    };
    for (const d of watchDirs(root)) watch(d, { persistent: true }, trigger);
    for (const f of ["README.md", ".git/index"]) {
      const full = join(root, f);
      if (existsSync(full)) watch(full, { persistent: true }, trigger);
    }
    console.log(`docs-watch: watching ${watchDirs(root).length} dirs + git index; Ctrl-C to stop`);
    return; // never resolves; the watchers keep the process alive
  }

  console.error("usage: bun scripts/docs-watch.ts once|watch|log");
  process.exit(2);
};

main();
