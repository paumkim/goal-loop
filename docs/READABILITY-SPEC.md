# Docs Readability Redesign Spec

## Interpretation
Improve the static docs site (`docs/`) for comfortable reading and easy step-by-step following, without breaking its build-free/static nature, relative-link structure, or existing content/meaning.

User-reported issues to address:
- Text is too small (body, headings, code/tables as needed).
- Content/tables are clamped/truncated, making information hard to read.
- Instructions are hard to follow; needs clearer step-by-step guidance.
- On wide desktop the layout feels boxed/compacted (content width too constrained for the overall experience).
- Commands/code must be copy-paste friendly.

## Acceptance Criteria

### Typography & comfort
1. Base body text is increased for comfortable reading (desktop): `--fs-body` >= `1.0625rem` (17px equivalent) with comfortable line-height (>= 1.7) and readable paragraph spacing.
2. Heading scale is readable and clear (`h1/h2/h3` sizes/spacing improved where needed) without harming hierarchy.
3. Code and table text are readable (no overly tiny code in blocks/tables); `pre code` and inline code remain legible.

### Layout & wide-desktop readability
4. Main reading column is less cramped on wide desktops while preserving readable line length: increase effective content measure/width (e.g. `--measure` and/or `main` max-width) so prose and docs content no longer feel overly boxed/compacted.
5. Wide/table-heavy pages (e.g. `main.wide`) can use available space appropriately on large screens without forcing excessive horizontal boxing.
6. Layout remains responsive and usable on tablet/mobile (no regressions to nav/sidebar/TOC behavior).

### Tables & truncation
7. Tables no longer feel clamped/truncated in normal reading: remove or relax harmful constraints (especially `td pre { max-width: 24rem ... }` and similar truncation/clamping behaviors) so table content, examples, and wrapped code are readable.
8. `.tablewrap` continues to allow horizontal scrolling when truly necessary, but content is not unnecessarily compressed/truncated.

### Instructions & step-by-step guidance
9. Instruction-heavy sections are easier to follow with clearer step-by-step presentation (e.g. styled ordered steps/step blocks, improved spacing/visual grouping) on key pages such as install/usage guidance, without changing factual instructions.
10. Visual hierarchy makes commands, options, and actions easier to scan.

### Copy-paste friendly commands/code
11. Command/code blocks are easy to select and copy-paste (sufficient padding, no obstructive overlays, readable wrapping/scroll behavior).
12. Copy affordance remains available and usable for code blocks; table code examples are copy-paste friendly (do not hide necessary copy affordance in a way that harms usability, or otherwise ensure easy selection/copy).

### Scope & integrity
13. Changes are limited to static docs assets/content needed for readability/design (`docs/*`, and this spec if included); no build system added; relative links and site structure preserved.
14. Existing pages remain functional (navigation, theme toggle, search, copy buttons, anchors) with improved readability.

## Verification Plan

### Automated/static checks
- `grep`/inspection confirms updated typography/layout/table/code CSS values (body size, measure/main widths, relaxed table/pre constraints).
- `bun scripts/docs-watch.ts check` status considered if relevant; at minimum ensure HTML/CSS/JS edits are syntactically sane and pages reference existing assets.
- Open/serve locally is possible (`docs/index.html` static).

### Visual/render verification (required for visual change)
- Produce visual evidence via headless browser/screenshot or rendered HTML snapshot of key pages at desktop width (wide) and a narrower width:
  - `docs/index.html` (landing/FAQ)
  - `docs/install.html` (step-by-step/instructions/code)
  - `docs/config.html` (large tables/code examples)
- Evidence should show: larger/more readable text, wider/less boxed content on desktop, tables not cramped/truncated, and code blocks/copy controls readable and copy-paste friendly.
- Capture at least one wide-desktop viewport (e.g. ~1440px or 1600px wide) to demonstrate reduced boxing/compaction.

### Manual/observable checks
- Verify code blocks can be selected and copied (copy button works; text selectable).
- Verify tables in config/install display content without aggressive truncation; horizontal scroll only when needed.
- Verify steps/instructions are visually clearer and easier to follow.
