/**
 * Precompiles the TUI entry to dist/tui.js.
 *
 * OpenCode compiles plugin JSX with OpenTUI's Solid transform, but that transform skips every file under
 * node_modules, so an installed package must ship already-compiled Solid output. Host-provided modules stay
 * external: OpenCode rewrites them to its own runtime instances at load time.
 *
 *   bun scripts/build.ts                     # write dist/tui.js
 *   bun scripts/build.ts --check             # fail when the committed artifact is stale; never repairs it
 *   bun scripts/build.ts --check --target X  # compare against X instead (tests)
 *
 * `--check` exists because `bun run check` used to rebuild the artifact without ever comparing it to the
 * committed copy: a stale dist/tui.js (committed TUI behind src/tui.tsx) passed every gate and shipped. The
 * check captures the artifact's bytes first, builds, compares, and puts the artifact back on a mismatch, so
 * a failed check leaves the tree exactly as it was and `bun run compile` stays the only repair.
 */
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import path from "node:path"
const root = path.resolve(import.meta.dir, "..")
const args = process.argv.slice(2)
const check = args.includes("--check")
const targetArg = args.indexOf("--target")
const artifact = path.join(root, "dist", "tui.js")
// The comparison target: the artifact itself unless a test points somewhere else.
const outFile = targetArg >= 0 ? path.resolve(args[targetArg + 1] ?? artifact) : artifact
// Captured before the build: a comparison against what the build just wrote proves nothing, and the
// artifact must be restorable so a failed check does not leave a half-updated tree behind.
const before = check ? await Bun.file(artifact).text().catch(() => undefined) : undefined
const compared = check ? (outFile === artifact ? before : await Bun.file(outFile).text().catch(() => undefined)) : undefined
/** A path fit for a message: repo-relative inside the checkout, absolute outside it (tests point at temp files). */
const label = (file: string): string => {
  const relative = path.relative(root, file)
  return relative.startsWith("..") ? file : relative
}
const result = await Bun.build({
  entrypoints: [path.join(root, "src", "tui.tsx")],
  outdir: path.join(root, "dist"),
  target: "bun",
  format: "esm",
  external: ["@opencode/plugin", "@opencode/plugin/*", "@opentui/*", "solid-js", "solid-js/*"],
  plugins: [createSolidTransformPlugin({ moduleName: "@opentui/solid" })],
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  if (check && before !== undefined) await Bun.write(artifact, before)
  process.exit(1)
}
// Bun writes module-path comments relative to the outdir, so a build from a worktree emits
// `// ../../node_modules/...` while a build from the repo root emits `// node_modules/...`.
// Normalize to outdir-independent paths so the artifact is byte-stable no matter where it is built.
const built = await Bun.file(artifact).text()
const normalized = built.replace(/^\/\/ (?:[.\/]*\/)*node_modules\//gm, "// node_modules/")
if (check) {
  // Restore first: whether the bytes match or not, the check owns no writes to the artifact.
  if (before !== undefined) await Bun.write(artifact, before)
  if (compared === undefined) {
    console.error(`FAIL: ${label(outFile)} is missing; run \`bun run compile\` and commit it`)
    process.exit(1)
  }
  if (compared !== normalized) {
    console.error(
      `FAIL: ${label(outFile)} is stale — a fresh build of src/tui.tsx differs (on disk ${compared.length} bytes, fresh ${normalized.length} bytes)`,
    )
    console.error("fix: bun run compile, then commit dist/tui.js")
    process.exit(1)
  }
  console.log(`ok: ${label(outFile)} matches a fresh build`)
  process.exit(0)
}
await Bun.write(artifact, normalized)
for (const output of result.outputs) console.log(`built ${path.relative(root, output.path)} (${output.size} bytes)`)
await Bun.write(
  path.join(root, "dist", "tui.d.ts"),
  'import type { Definition } from "@opencode/plugin/tui/plugin"\ndeclare const plugin: Definition\nexport default plugin\n',
)
