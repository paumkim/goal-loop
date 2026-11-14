# SPEC — docs/ site redesign (opencode-goalv2)

Status: in progress. Goal: polished, modern docs site, ultra-wide desktop → tablet.

## Interpretation
Static, build-free docs site. Keep the 7 pages, their relative links, SEARCH_INDEX,
.foot credit block, stamp spans, skip link, sticky header, sidebar nav, "On this page"
TOC, dark/light theming, visible focus outlines, and the [data-theme="dark"] toggle.
Reuse and EXTEND styles.css variables (--ink, --bg, --panel, --acc, --line, --mono, ...);
do not fork the system. No frameworks, no build step, no images, no external assets.

## Design
- Extended variable set: fluid type scale via clamp() (h1 ~32px → body 16px → small 13px),
  spacing scale, radii, hairline borders + subtle glow, gradient accents for hero/headings only.
- Dark-first premium GitHub-adjacent look: deep navy ink background, one restrained accent (--acc),
  high-contrast text, 1px hairlines, minimal glow. Light theme equally polished.
- Layout: .layout grid caps measure (~72ch content) and centers on ≥1600px; three-column
  sidebar/content/TOC at ≥1200px; TOC drops below/hides at 900–1200px; sidebar narrows;
  single column at 600–900px with horizontally scrollable pill nav (tap targets ≥44px);
  tables and pre scroll inside containers; footer stacks cleanly.
- Micro-interactions: hover states, focus-visible rings, prefers-reduced-motion respected.
- Code blocks: polished chrome (header bar via pre::before label + copy button already in JS).
- Tables: zebra + hover. Cards: refined borders. Chips: consistent accent usage.
- architecture.html (state machine / diagram) is the visual centerpiece: styled .box/.arrow flow.

## Acceptance criteria
1. All 7 pages render from filesystem (file://) with no console errors, no horizontal scroll
   at 1600/1280/1024/834/768 widths.
2. Footer credits byte-identical; stamp spans untouched; SEARCH_INDEX untouched;
   relative links untouched; skip link, header, sidebar, TOC, theme toggle all present.
3. styles.css extended (not replaced): original variable names kept, new ones added.
4. Dark + light themes both verified via toggle; focus-visible outlines visible.
5. bun run check passes.
6. Screenshots at each breakpoint for every page (or representative pages + all pages at 1280).

## Verification
- Playwright headless chromium: screenshot each page at 1600/1280/1024/834/768, dark and light,
  assert document.scrollingElement.scrollWidth <= innerWidth, footer text present, toggle flips theme.
- bun run check.
- Per-file diff summary reported.
