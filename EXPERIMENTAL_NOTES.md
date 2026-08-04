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

## Wave 4 — API v3 (findings [21]–[23], [26]–[28], [48])

All landed; suite green per item (chromium; types + lint clean).

- **[21] format unification** — `format` is the one documented name; `type` a silent alias
  when it carries an image-format string (resolved from RAW caller opts in
  normalizeExportOptions). toBlob keeps its svg default unless a codec is asked for.
- **[22] one sizing rule** — width/height absolute win; scale only when neither set; dpr
  multiplies. toCanvas dropped its width×scale multiplication (matched toImg); debugWarn
  when both passed. BREAKING for undocumented reliance — v3 window, announce it.
- **[23] iconFonts session-scoped** — matcher list REPLACED per capture (was append-only
  global forever). Known theoretical edge documented: concurrent captures with different
  iconFonts interleaving (full threading through ~10 ctx-less isIconFont sites not worth it).
- **[27] unified exclude** — selectors and/or predicates (true = exclude) in one option +
  excludeMode; filter/filterMode legacy keep-polarity aliases, composing. Polarity pinned
  by dedicated tests. Split once in createContext — no per-node typeof.
- **[28] result.warnings** — flat {code, message, detail?} log from curated degradation
  branches (image-fallback, raster/canvas clamps, safari-png-fallback, reconcile-risk),
  empty in the common case, capped 50. Memo serves retain it (result object is memoized).
- **[26]+[48] doc/type sync** — d.ts v3, outerTransforms un-inverted, invalidate vs
  auto-burst, CachePolicy deprecation prose, CaptureResult.warnings + engine url caveat,
  PLUGIN_SPEC fast removal, README table rows folded.

Verdict candidates: **all graduate to next** ([22]'s toCanvas behavior change flagged for
the v3 announcement).

## Wave 5 — extensibility (findings [29]–[33], [37], [39], [40], [42])

- **[29] plugin contract vs fast paths** — hasImpureRenderPlugins gates auto-burst and
  diff on plugins with clone/render hooks (a memo serve skipped them; diff dropped their
  subtree work; beforeRender mutated retained state). Export-only plugins keep the
  speedup; `pure: true` opts render plugins back in. The one correctness bug of the audit.
- **[31]+[32] export artifacts + PLUGIN_SPEC v2** — ctx.artifacts (CSS strings) +
  ctx.export.svgString (LAZY decode) on export contexts; html-export stops
  reverse-parsing its own output; spec documents the artifacts surface and the fast-path
  purity contract.
- **[30] animation frame source** — running animations' effect targets become dirty
  roots; the diff path serves each frame with per-frame snapshot invalidation
  (invalidateSnapshotsUnder — animations never bump the epoch). Recording loops stop
  paying the full pipeline for nested animated content; direct-child/heavy/webfont bails
  keep falling back.
- **[42] snapdom.fromString** — SSR/HTML-string input via an owned offscreen mount.
- **[37] evaluated → folded** — a WebCodecs toWebm plugin was written and DISCARDED as a
  duplicate: video-export already covers WebM/MP4 via MediaRecorder. The real delta was
  timing, so video-export upgraded to captureStream(0)+requestFrame explicit frames with
  latency-compensated pacing (the old realtime stream drifted under load).
- **[39] compositor-fed recording (Element/Region Capture)** — designed, NOT implemented:
  needs a user-permission prompt (getDisplayMedia-class), which changes the plugin's UX
  contract. The drift fix + animation diff frames close most of the practical gap;
  revisit if 60fps recording becomes a marketed use case.
- **[40] cooperative cross-origin iframe bridge** — designed, NOT implemented: needs a
  postMessage protocol spec both sides agree on (embed script in the iframe answering
  capture requests via resolveNode). Direction documented; no code until a real consumer.

Verdict candidates: **[29], [31], [32], [42], video-export upgrade graduate to next**;
**[30] keeps experimenting** (newest invalidation semantics; wants real-page mileage).

## Discovery of the wave

`packages/plugins/agent-map.js` already ships a Set-of-Mark export for visual agents
(annotated screenshot + badge→role/name/bbox/state JSON). Wave 6 builds on it instead of
reinventing.

## Wave 6 — AI-agents direction (user directive)

The agent story now has three composable primitives, all in-page (no extension/CDP):

- **toContext() (NEW — packages/plugins/context-export.js)**: the READ half. Compact
  indented outline of structure/roles/visible text/geometry/form state; wrappers
  collapse, hidden content skipped, deterministic output. Token economy asserted in
  tests: a 48-card dashboard stays well under 4k tokens (~4 chars/token). Export-only +
  pure → keeps the memo/diff fast paths.
- **toAgentMap() (already existed)**: the ACT half — annotated screenshot + bbox map.
- **Verification contract (documented, not built — it already held)**: captures of an
  unchanged DOM are byte-identical (the diff engine's own test oracle), so agents hash
  result.url before/after an action to answer "did the UI change?" without visual
  diffing; result.warnings is the degradation check before trusting a capture.

docs/llms-full.txt carries the FOR AI AGENTS section wiring the three together.
**MCP server: recipe documented, package NOT built** — it's a thin wrapper over the
three calls; building it belongs with a real consumer (and a transport decision), not
in this wave.

Verdict candidates: **contextExport + docs graduate to next**; MCP package stays a
documented direction.

## Wave 7 — survival

- **ARCHITECTURE.md** (tracked): why-the-pipeline prose, the invalidation matrix, the
  measured dead-ends registry (including three new ones from this branch), the internal
  escapes policy with its promotion trigger, the real-Safari verification method, and
  the testing landmines (dist-stale guard, known flakes).
- **Invalidation matrix in code**: burst.js's module header is now the wiring's single
  source of truth (each change class → mechanism → symbol); ARCHITECTURE.md carries the
  prose mirror.
- Final sweep: last `fast: true` in gif-export removed.

## Branch close (2026-07-28)

- **Gates**: 108 test files / 853 tests green on chromium+firefox; webkit green after
  one platform-tolerance fix (WebKit's canvas.toBlob can't encode webp — test uses jpeg).
- **Benchmark vs pre-wave-1 baseline**: complex scenes 3.8→3.2 / 11.9→10.0 /
  32.9→27.1 ms (~15-18% faster), simple/warm unchanged, mutating-poll unchanged.
- **All 49 audited findings dispositioned**: implemented, folded into existing code, or
  explicitly discarded with evidence above. Panel verdict stands: no rewrite —
  `experimental` is `next` plus the closed gaps.

## Comparative benchmark — 2.23.1 vs next vs experimental (2026-07-29)

Same browser session, same DOM per scenario, medians. Harness + branch builds live in
`bench/dist-compare/` (gitignored; README explains how to re-run). Cold = cache
disabled + burst/compress pinned off; defaults = what users actually get.

| scenario | 2.23.1 | next | experimental | exp vs main |
|---|---|---|---|---|
| cold simple 400x300 | 0.8ms | 0.6ms | 0.6ms | 1.33× |
| cold complex 24 cards | 15.6ms | 8.3ms | 8.1ms | 1.93× |
| cold complex 48 cards | 29.2ms | 16.0ms | 15.1ms | 1.93× |
| cold framework page (48 cards + svg icons + Tailwind-ish reset) | 67.5ms | 41.9ms | **29.5ms** | **2.29×** |
| warm repeat ×20 (defaults) | 75.5ms | 0.1ms | 0.1ms | ~755× (memo) |
| mutating poll ×20 (defaults) | 555ms | 244.8ms | 243.7ms | 2.28× |
| animated poll ×10 (defaults) | 37.6ms | 36.7ms | **13.0ms** | **2.89×** |

Reading: `next`'s wins over 2.23.1 are styleScan + auto-burst + diff (1.8-1.9× cold,
memo ∞, 2.3× mutating). `experimental`'s wins over `next` appear exactly where its
wave-1/wave-5 work aims: framework CSS pages (pseudo selector gate + SVG snapshot skip:
**1.42× over next**) and animated content (diff frame source: **2.82× over next** —
next pays the full pipeline every animated frame). Bare-DOM scenes are parity with next,
as expected: the test runner page has no framework CSS to prune.

Bundle sizes (minified): 153KB (2.23.1) → 165KB (next) → 174KB (experimental).

## Fidelity matrix — main vs next vs experimental (2026-08-03)

Speed was measured; fidelity was not. `bench/dist-compare/compare.fidelity.harness.js`
closes that: each scenario is a PORT of the regression test that shipped with the fix
(asserts copied, not invented), run against all three dists in one browser session.

| scenario | main | next | experimental |
|---|---|---|---|
| CSS `open-quote`/`close-quote` resolve to authored glyphs | FAIL | FAIL | PASS |
| authored `::marker` survives as a scoped rule | FAIL | FAIL | PASS |
| authored `::first-line` survives as a scoped rule | FAIL | FAIL | PASS |
| `@media` frozen to the live viewport | FAIL | FAIL | PASS |
| `@container` not degraded into `@supports` | PASS | PASS | PASS |
| open modal `<dialog>`: backdrop + paint order | FAIL | FAIL | PASS |
| image `<object>` inlined instead of blank | FAIL | FAIL | PASS |
| `background-attachment:fixed` freezes the viewport slice | FAIL | FAIL | PASS |

`next` is fidelity-identical to `main`: all of its 35 commits are speed and API work.
Every fidelity gain in this branch is `experimental`-only.

**Cross-engine (2026-08-03).** The matrix is byte-identical on chromium, webkit and
firefox — every FAIL/PASS above holds on all three, so none of these gaps is an engine
quirk. Full suite on `experimental`: 871 passed / 3 skipped on each engine
(`BROWSER=webkit|firefox npx vitest run --browser.headless`). Speed medians (ms):

| scenario | chromium m/n/e | webkit m/n/e | firefox m/n/e |
|---|---|---|---|
| cold complex 48 cards | 29 / 16 / 15 | 30 / 15 / 15 | 34 / 18 / 17 |
| cold framework page | 68 / 41 / 29 | 66 / 38 / 27 | 79 / 47 / 34 |
| warm repeat ×20 | 73 / 0 / 0 | 88 / 0 / 0 | 140 / 0 / 0 |
| mutating poll ×20 | 556 / 240 / 240 | 550 / 115 / 112 | 663 / 246 / 245 |
| animated poll ×10 | 38 / 36 / 13 | 43 / 42 / 11 | 75 / 71 / 15 |

The ranking never changes engine to engine; the margins are widest on firefox (animated
poll 5.0× vs main, 4.7× vs next). Caveat that still stands: Playwright's webkit does not
reproduce the real-Safari quirks (#219770 et al) — SnapEye in Safari proper remains the
only verification for those.

## Hardening pass — what shipped, what did not (2026-08-03)

Every fix below was reproduced by executing a repro FIRST, and every regression test was
checked to fail with the fix reverted. Suite: 884 passing on chromium, webkit and firefox.

| # | Fix | Axis | New in branch | File |
|---|---|---|---|---|
| B1 | auto-burst blind to typed form state, ancestor theme attrs, shadow `<canvas>` | fidelity | yes | `core/burst.js` |
| B2 | diff reconcile false drift on any fractional box | speed+fidelity | yes | `core/diff.js` |
| B3 | CSS-nested pseudo rules gated out of existence | fidelity | yes | `modules/styleScan.js` |
| B4 | `:focus`/`:checked` never invalidated the snapshot cache | fidelity | yes | `modules/styles.js` |
| B5 | `@media` nested in a nesting rule leaked into the SVG | fidelity | yes | `utils/clone.helpers.js` |
| B9 | `exclude` did not redact the semantic export | fidelity | partly | `plugins/context-export.js` |
| S1 | emoji split by the ellipsis bake → `URIError`, whole capture rejected | fidelity | no | `modules/lineClamp.js` |
| S2 | fonts cache key ignored `usedCodepoints` → wrong subset served | fidelity | no | `modules/fonts.js` |
| S4 | pseudo preflight could not see `@import`-ed rules | fidelity | no | `modules/pseudo.js` |
| S6 | `exclude` hide-spacer hardcoded `inline-block` → phantom line box | fidelity | no | `core/clone.js` |
| S3a | CSS mask on `::before`/`::after` dropped → masked icons captured as solid rectangles | fidelity | no | `modules/pseudo.js` |
| S3b | `useProxy` never reached pseudo backgrounds (`map` passed the layer index as options) | fidelity | no | `modules/pseudo.js` |
| S5 | a scrolled same-origin iframe was captured from the top of its document | fidelity | no | `utils/clone.helpers.js` |

**Claimed but NOT reproduced — deliberately left alone.** Each was attempted with a real
repro and an in-run control; none registered, so no code was added for them:

- *B2's asset destruction.* Two scenes with an inline-authored remote background kept every
  inlined `data:` URL through the reconcile (`rawUrl.diff === 0`).
- *B4's iframe half.* A `<style>` edit inside a same-origin iframe DID reach the next
  capture (first frame 3964 green px, second 3966 red px).
- *B8, backdrop-filter on the diff path.* Could not get the diff path to serve at all in
  this scene (`servedViaDiff:false` in every arm, including the no-backdrop control), so
  the measurement proved nothing either way. A bail was NOT added on an unverified symptom.
- *S4's rule-budget half.* A 1201-rule sheet with the pseudo rule last still returned
  `preflight:true`.

**Shadow DOM in auto-burst — closed.** A `MutationObserver` with `subtree:true` does not
cross a shadow boundary, so every web component's internal updates were invisible and auto
mode served pre-update frames indefinitely. `trackShadowRoots` gives each open root its own
observer feeding the same `markDirty`, and RE-SCANS before serving, which is what closes the
case the first attempt could not: a root attached after the memo was taken produces no
mutation record anywhere, so it can only be found by looking.

Cost of that per-capture scan, measured (median memo serve):

| nodes | memo serve |
|---|---|
| 300 | 0.1 ms |
| 2 000 | 0.3 ms |
| 8 000 | 1.0 ms |

Accepted deliberately: it is the same order as the `trackVideos`/`trackPendingImages` walks
already done per capture, and it buys correctness on a memo that replaces a ~100ms pipeline.
Closed roots remain unobservable by anyone — that stays `invalidate: true` territory.

**B8 (backdrop-filter on the diff path) — refuted, not a bug.** The earlier attempt was
inconclusive because the diff path never actually served: the scene had the card as a
DIRECT child of the root (an automatic bail), and the warm-up captures used different
options than the measured one, which makes the capture a one-off. With both fixed
(`served:1` in every arm), the frosted card reads 0 sharp stripe transitions on the diff
path and 0 on the full pipeline, while the no-backdrop control reads 24 on both — the blur
is present either way. Pinned by a regression test that asserts the diff path ran AND that
the metric can tell frosted from plain.

**Method note that cost real time twice:** a scene too small hides a reconcile regression
(3 columns × 40 rows showed no delta from the B2 fix; the 48-card grid shows 16×), and a
scene depending on system fonts is not portable (the S2 pipeline test passed on chromium
and firefox and failed on webkit, which lacks Georgia — it is now a unit test).

## Release blockers B1 + B2, fixed (2026-08-03)

From the 36-agent hardening hunt. Both were regressions this branch introduced, both on
the DEFAULT path (auto-burst engages with no options after 3 captures).

**B1 — auto-burst served stale frames.** Three inputs change what renders while producing
no mutation record inside the captured subtree, so the scoped MutationObserver was blind
to all three. Measured before the fix (`default` vs the same page with `burst:false`):

| input | default path | `burst:false` |
|---|---|---|
| user types into an `<input>` | never sees the value | sees it |
| `data-theme` set on `<html>` (custom property) | never sees the new bg | sees it |
| `<canvas>` inside a shadow root | auto-burst engages | n/a |

The canvas one falsified an invariant the file documents: the guard excluding
canvas-bearing elements used `element.querySelector('canvas')`, which stops at a shadow
boundary — exactly the charting web components the guard exists to protect.

Fixes in `burst.js`: capture-phase `input`/`change` listeners (same trick the scroll
listener already uses, since `value`/`checked` are properties, not attributes); an
`ancestorSig` comparison gated on `getStyleEpoch()` so a static page pays one integer
compare and only walks the ancestor chain when something changed somewhere; and a
shadow-piercing `hasCanvas`. The INVALIDATION MATRIX comment now lists all three.

**B2 — the diff reconcile had a permanent false positive.** `getStyleKey` rounds frozen
widths UP to the next 1/16px (so a shrink-to-fit box cannot re-wrap), and `diff.js`
compared that rounded value against a raw `getComputedStyle` string. Instrumented from
inside the real reconcile loop:

```
w=640 (620/3 = 206.666… per column):  279 of 282 nodes "drifted", all on width
                                      live=206.672px  frozen=206.6875px
w=632 (612/3 = 204 exactly):            0 of 282
```

So every fractional flex/grid track — i.e. most real layouts — re-ran `inlineAllStyles`
over the entire retained tree on every differential frame. Fixed by comparing lengths with
the rounding step as tolerance (`sameFrozenLength`), since genuine layout drift is orders
of magnitude larger than 1/16px.

**Speed, same harness as the branch benchmark above, medians, chromium:**

| scenario | before | after |
|---|---|---|
| mutating poll ×20 (defaults) | 240.6 ms | **15.2 ms** (15.8×) |
| animated poll ×10 (defaults) | 13.2 ms | **7.3 ms** (1.8×) |

Everything else unchanged. Note for future measurement: a 3-column × 40-row scene showed
NO time difference from this fix — the reconcile only dominates once the retained tree is
large. Do not conclude "no effect" from a small scene.

Not reproduced, and therefore not fixed: the report also claimed the reconcile re-run
destroys inlined `data:` URLs via `normalizeInlineStyleToComputed`. Two attempts with an
inline-authored remote background kept all assets (`rawUrl.diff === 0`). Left alone.

Still open from the same hunt: general shadow-DOM content updates (not just canvas) are
invisible to auto-burst. Piercing observers into shadow roots does not close it — a root
attached after the last full capture is never observed — so it needs a design, not a patch.

## Reverse regression sweep (2026-08-03)

The fidelity matrix above is biased by construction: its scenarios come from this
branch's own `fix(fidelity)` commits, so it only asks "does experimental fix what it
claims?". It never asks "what did experimental BREAK that main got right?". Two sweeps
were run to answer that.

**1. main's own test suite against experimental's source.** 78 of main's 753 tests fail.
Classified, every one is expected:

| cause | tests | example |
|---|---|---|
| internal signature change (session cache threaded as an argument) | 56 | `deepClone(node, options)` → `Cannot read properties of undefined (reading 'styleMap')` |
| deliberate v3 API surface change | 21 | `cache: 'full'` no longer exists; `fast` removed; iconFonts per-capture; burst advice warning deleted |
| work relocated, same observable result | 1 | `resolveCSSVars` baseline fallback (fb9dfe8) |

The last one was the only value assertion rather than a TypeError, so it was checked
end-to-end: a class-driven `color: var(--x)` still reaches the capture on main, next AND
experimental. The commit's claim (the style snapshot already carries class-driven values)
holds; the unit test failed because the work moved, and this branch already replaced it
with a pipeline-level test. **Zero behavior regressions in the 78.**

**2. Pixel diff on neutral scenes.** 20 scenes written from ordinary web CSS (flex, grid,
shadows, gradients, transforms, stacking, overflow, tables, form controls, text metrics,
filters, clip-path, object-fit, lists, text-shadow, baselines, scroll containers,
pseudo-elements, inline SVG) — chosen from no branch's commit list. Each is captured by
main and by experimental, rasterized, and compared pixel by pixel.
`bench/dist-compare/compare.regression.harness.js`.

Result on chromium, webkit and firefox alike: **all 20 differ by 0 pixels** (maxDelta 0).
Two positive controls taken from the fidelity matrix DO register (object 64-66%, marker
0.6-3.7%), so the harness is demonstrably able to fail — the zeros mean something. Note
the first `<object>` control was a 1×1 transparent PNG and read 0%: a markup-level
difference with no visual consequence. Controls have to be visible to be controls.

Limit: 20 synthetic scenes are not a real site. This raises confidence that experimental
does not silently change ordinary rendering; it does not prove absence of regressions.

### Cross-engine report: the font demos are NOT a bug (2026-08-03, don't re-investigate)

`npm run report:cross` (72 demos, chromium as reference) shows median divergence 3.45%
(webkit) / 4.17% (firefox), with the font demos among the worst: `d22-font-face-manual-woff2`
17/28%, `d20-google-fonts-link-variable` 8/26%. Reading the baselines by eye suggested
firefox was dropping the bold weight and collapsing the 600/900 variable axis. **That
reading was wrong.** Measured instead (`bench/dist-compare/compare.varfont.harness.js`,
same font-size, only the weight axis varying):

| weight | live width | captured ink width | captured ink mass |
|---|---|---|---|
| 300 | 237.1 | 234 | 1467 |
| 600 | 247.7 | 246 | 2171 |
| 900 | 259.3 | 258 | 2794 (chromium) / 2810 (firefox) |

Firefox tracks chromium to within a pixel on every axis step, live AND through the
capture. The `cross-diffs/*.png` images settle it: the red is spread evenly over every
glyph of every line (and over the dashed border), which is the signature of per-engine
text rasterization, not of a lost weight. A second hypothesis — that the baseline was
recorded with the font fallen back to `system-ui` — is also dead: system-ui scales its
own weights (217/235/254) in both engines.

Lesson worth keeping: on an image that is almost entirely glyphs, hinting differences
touch ~25% of the pixels. A high mismatch ratio on a text-heavy demo is not evidence of
anything by itself — look at the diff image before forming a theory.

Two defects found while building the matrix, both fixed here:

- **`@container` misread as `@supports`** (`resolveMediaQueries` dispatched on the shape
  `conditionText !== undefined`, which `CSSContainerRule` also has). Unnamed containers
  evaluated true unconditionally, named ones dropped. Regression introduced by the @media
  freeze commit; `main`/`next` pass only because they never rewrote the rule at all.
- **`::marker`/`::first-line` fix was dead code in the common case.** `shouldProcessPseudos`
  gates the whole pseudo pass on a needle list that never learned about `::marker` /
  `::first-line`, so a page whose only author pseudo is a marker skipped the pass —
  the fix's own tests passed only because a sibling test left a `::before` in the
  document. Adding an unrelated `.decoy::before` anywhere flipped it back on. Needles
  added; the regression test now asserts on a private iframe document so no stray
  `::before` on the test page can mask it again.
