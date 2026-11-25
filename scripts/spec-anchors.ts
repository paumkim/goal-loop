#!/usr/bin/env bun
/**
 * spec-anchors: keep SPEC.md's per-slug workstream notes append-only and conflict-free.
 *
 * SPEC.md carries one region (`<!-- per-slug-workstreams:start/end -->`) with exactly one
 * balanced anchor per lease slug:
 *
 *   <!-- workstream:<slug>:start -->
 *   ... that lease's prose ...
 *   <!-- workstream:<slug>:end -->
 *
 * A lease only ever writes its own block, so parallel commits touch disjoint lines and a rebase
 * onto the latest dev (see `merge-next --wait`) lands them without a hand-resolved SPEC conflict.
 *
 * Commands
 *   ensure <slug>            insert an empty anchor for <slug> (idempotent)
 *   append <slug> <file>     replace the content of <slug>'s block with <file>'s text
 *   list                     print every anchored slug
 *   check                    exit 1 on a missing region, unbalanced markers or duplicate slugs
 *
 * Pure helpers are exported for `test/spec-anchors.test.ts`; I/O lives in main().
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SPEC = join(ROOT, "SPEC.md");

export const REGION_START = "<!-- per-slug-workstreams:start -->";
export const REGION_END = "<!-- per-slug-workstreams:end -->";
const startOf = (slug: string) => `<!-- workstream:${slug}:start -->`;
const endOf = (slug: string) => `<!-- workstream:${slug}:end -->`;

/** Insert an empty anchor for `slug` just before the region end. Idempotent. */
export function ensureAnchor(spec: string, slug: string): string {
  if (!slug || /[^A-Za-z0-9._-]/.test(slug)) throw new Error(`invalid slug: ${slug}`);
  const regionStart = spec.indexOf(REGION_START);
  const regionEnd = spec.indexOf(REGION_END);
  if (regionStart === -1 || regionEnd === -1 || regionEnd < regionStart) {
    throw new Error("SPEC.md is missing the per-slug-workstreams region");
  }
  if (spec.includes(startOf(slug))) return spec;
  const block = `${startOf(slug)}\n${endOf(slug)}\n`;
  return `${spec.slice(0, regionEnd)}${block}${spec.slice(regionEnd)}`;
}

/** Replace only `slug`'s block content with `content`. Throws when the anchor is absent. */
export function appendAnchor(spec: string, slug: string, content: string): string {
  const start = spec.indexOf(startOf(slug));
  const end = spec.indexOf(endOf(slug));
  if (start === -1 || end === -1 || end < start) throw new Error(`no anchor for slug: ${slug}`);
  const bodyStart = start + startOf(slug).length;
  const body = content.endsWith("\n") ? content : `${content}\n`;
  return `${spec.slice(0, bodyStart)}\n\n${body}${spec.slice(end)}`;
}

/** Every slug that has a balanced start/end pair inside the region. */
export function listAnchors(spec: string): string[] {
  const regionStart = spec.indexOf(REGION_START);
  const regionEnd = spec.indexOf(REGION_END);
  if (regionStart === -1 || regionEnd < regionStart) return [];
  const region = spec.slice(regionStart, regionEnd === -1 ? spec.length : regionEnd);
  const slugs = new Set<string>();
  for (const match of region.matchAll(/<!-- workstream:([^:]+):start -->/g)) {
    const slug = match[1]!;
    if (region.includes(`<!-- workstream:${slug}:end -->`)) slugs.add(slug);
  }
  return [...slugs];
}

/** Human-readable problems with the anchor region; empty when valid. */
export function validateAnchors(spec: string): string[] {
  const regionStart = spec.indexOf(REGION_START);
  const regionEnd = spec.indexOf(REGION_END);
  const problems: string[] = [];
  if (regionStart === -1) problems.push("missing per-slug-workstreams region start");
  if (regionEnd === -1) problems.push("missing per-slug-workstreams region end");
  if (problems.length) return problems;
  if (regionEnd! < regionStart!) problems.push("per-slug-workstreams region markers are inverted");
  const region = spec.slice(regionStart!, regionEnd!);
  const starts = [...region.matchAll(/<!-- workstream:([^:]+):start -->/g)].map((m) => m[1]!);
  const ends = [...region.matchAll(/<!-- workstream:([^:]+):end -->/g)].map((m) => m[1]!);
  if (starts.length !== ends.length) problems.push(`unbalanced anchors: ${starts.length} start vs ${ends.length} end`);
  if (new Set(starts).size !== starts.length) problems.push("duplicate workstream slug anchors");
  for (const slug of starts) {
    if (!ends.includes(slug)) problems.push(`anchor ${slug} has no end marker`);
  }
  return problems;
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  const spec = readFileSync(SPEC, "utf8");
  switch (command) {
    case "ensure": {
      const slug = rest[0];
      if (!slug) throw new Error("usage: spec-anchors ensure <slug>");
      const next = ensureAnchor(spec, slug);
      if (next !== spec) writeFileSync(SPEC, next);
      console.log(next === spec ? `spec-anchors: anchor ${slug} already present` : `spec-anchors: added anchor ${slug}`);
      return;
    }
    case "append": {
      const [slug, file] = rest;
      if (!slug || !file) throw new Error("usage: spec-anchors append <slug> <file>");
      const content = readFileSync(file, "utf8");
      writeFileSync(SPEC, appendAnchor(spec, slug, content));
      console.log(`spec-anchors: wrote block ${slug}`);
      return;
    }
    case "list":
      for (const slug of listAnchors(spec)) console.log(slug);
      return;
    case "check": {
      const problems = validateAnchors(spec);
      if (problems.length) {
        console.error(`spec-anchors: ${problems.join("; ")}`);
        process.exit(1);
      }
      console.log(`spec-anchors: ok (${listAnchors(spec).length} anchors)`);
      return;
    }
    default:
      throw new Error("usage: spec-anchors <ensure|append|list|check> ...");
  }
}

if (import.meta.main) main();
