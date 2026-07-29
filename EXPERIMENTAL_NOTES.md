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

## Wave 2 — minimal code (findings [14]–[20], [24], [25], [46])

All landed, suite green after each item (chromium; counts shift because tests of deleted
machinery were migrated/removed with it).

- **pictureResolver live-mutation machinery deleted** (~165 lines): the 'back-compat
  plugin export' it survived for never existed on any entry point. Four pure URL helpers
  kept; `pictureResolver` option object gone from context/types/FEATURES; llms-full.txt
  no longer advertises a plugin import that would throw. Tests migrated to the clone-path
  contract (freezeImgSrcset).
- **cache.session global deleted** — createCaptureSession builds fresh maps; four module
  default params allocate their own; burstAdvice → module-local WeakMap in burst.js;
  ~13 test files migrated. The #463 race class is unrepresentable now.
- **idle() retired** — runIdle is a bare microtask boundary; the two sync idle-wrapped
  blocks in composeAndSerialize unwrapped to straight-line code.
- **helpers dedup** — second isIconFont (divergence trap) deleted; one shared
  SUPPORTED_IMAGE_MIME regex.
- **preCache re-scoped as network prefetch** — cache/cacheOpt/applyCachePolicy gone,
  embedFonts 'auto' with capture's declared-family gate, Safari attempts 3→1, honest types.
- **doc drift purged** — safariWarmupAttempts (EN/CN/docs-site), opt-in burst prose,
  `fast` rows, checkBurstAdvice comments, inverted JSDoc defaults.

Verdict candidates: **all graduate to next** (they close next's own declared follow-ups).

## Wave 3 — fidelity (findings [7]–[13])

All seven landed; wave close: **3 engines green (chromium/webkit/firefox, 830 tests)**.
Every fix is gated to cost zero when the feature is absent.

- **[7] open-quote/close-quote** — painted as LITERAL keyword text; now resolved from
  computed `quotes` (first pair, typographic fallback for Chromium's 'auto').
- **[10]+[11] ::marker / ::first-line** — were silently discarded; styleScan now collects
  their selectors and matching elements get an attribute-keyed scoped rule
  (`[data-sd-pN]::marker{…}`) with only the props differing from the element. Diff path
  bails when such rules exist (attribute-keyed rules can't splice byte-faithfully).
- **[8] @media frozen to the live viewport** — shadow CSS + kept light-DOM <style> clones
  re-evaluated conditions against the SVG's own tiny viewport. resolveMediaQueries inlines
  matching blocks / drops the rest at extraction (CSSOM on the SOURCE sheet). Bonus: two
  latent scope-leak bugs in rewriteShadowCSS closed (first-rule-in-@media escape, author
  :where() selectors skipping the scope wrap).
- **[9] top-layer** — open :modal/:popover-open clones lift to end-of-root (paint order)
  with a synthesized ::backdrop (fixed inset:0 resolves against the svg viewport).
  backdrop-filter doesn't ride along (#457); rgba dim is the portable part.
- **[13] <object>/<embed>** — image-typed embeds become inlined <img> (fallback children
  dropped — both painted before), same-origin documents reuse the iframe rasterizer, rest
  falls through honestly with a warn.
- **[12] background-attachment:fixed** — the viewport slice the user saw is frozen into
  element-local px (cover/%/px resolved against the real viewport, intrinsic dims decoded
  from the inlined data URL); transformed-ancestor/iOS cases match live degradation.

Verdict candidates: **[7], [8], [10], [11], [13] graduate to next**; **[9] and [12] keep
experimenting** (top-layer ordering approximates call order by document order; fixed-bg
compensation is the newest math — both deserve real-page mileage before graduating).
