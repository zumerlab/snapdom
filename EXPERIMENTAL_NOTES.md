# experimental branch — lab notes

Bolder sibling of `next` (branched from it 2026-07-28). Same graduation model as
NEXT_NOTES → main: each item below states its verdict — **graduate to next**, **keep
experimenting**, or **discarded (with evidence)**. Source roadmap: 49 adversarially-verified
findings from the 67-agent principles audit (details in the session's findings-detail.md).

## Wave 0 — guardrails

- **dist-stale guard** (`scripts/ensure-fresh-dist.mjs`, vitest globalSetup): the visual
  suite tests compiled dist/; a stale build already masked a real styleScan regression
  once. Now any vitest run recompiles automatically when src is newer than dist.
  Verdict candidate: **graduate to next** (zero-cost, closes a demonstrated false-green).
- **.claude/CLAUDE.md tracked** + real-Safari verification method documented in it
  (SnapEye harness + safaridriver fallback; Playwright WebKit does not reproduce #219770).
  Verdict candidate: **graduate to next**.

## Wave 1 — speed hot-path (findings [0]–[6] of the principles audit)

All six landed, gated per item by the full suite; wave close: 3 engines green
(chromium/webkit/firefox 828 tests), benchmark **complex-node scenes 3.8→3.1ms /
11.9→9.9ms / 32.9→27.5ms (~16-20% faster cold-ish), warm scenes unchanged**, and the
Safari font item verified on REAL Safari via safaridriver (webfont capture paints,
28941 ink px, 2 captures byte-consistent, 124ms).

- **[0] selector-gated pseudo probe** — styleScan collects ::before/::after/::first-letter
  selectors; one matches() replaces 3 per-node style resolutions in pseudo.js AND
  collectFontUsage. Also fixed a pre-existing same-tick staleness window (style injected
  in the capture tick missed the async epoch bump) with flushStyleInvalidations().
- **[1] CSSVar part-3 deleted** — per-node fresh gCS + inline color stamping was redundant
  with the snapshot class; SVG keeps currentColor via 'color' in SVG_PAINT_PROPS. Output
  SVGs shrink ~25 bytes/node on authored-color pages.
- **[2] NO_DEFAULTS_TAGS skip the snapshot** — their style key was always discarded; only
  the ~10-read bg/mask probe remains (masks apply to SVG shapes — kept accurate).
- **[3] isInSvgTemplate memoized per epoch** — was O(depth) × 3 calls per SVG element.
- **[4] promise-churn cut** — inlineAllStyles sync (never awaited anything), one ctx per
  capture, direct Promise.all child cloning; idleCallback shim deleted. NOT done: pseudo
  recursion restructure — CSS counters force document-order awaits, and a subtree
  querySelector skip would miss shadow-root pseudo content (gates can't see shadow sheets).
- **[5] one sanitize walk** — 3 TreeWalkers merged; deepClone's per-attr ROB-3 strip
  deleted (redundant with the finished-clone sanitize both serialization paths run).
  NOT done: merging tag collection into the walk (runs before ligature/img fallbacks
  mutate the tree — tag set would go stale).
- **[6] Safari font walk threaded** — pre-step's collectFontUsage result reused by
  fontsPhase (not in clip mode); the pre-clone wait position untouched (rewrap landmine).
  ✅ verified in real Safari.

Verdict candidates: **all graduate to next** ([0] and [5] with their listed NOT-done caveats).
