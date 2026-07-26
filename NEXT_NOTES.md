# next branch — what's here and what can graduate to main

Working notes for the architecture work on `next`. Each item states its risk profile and
whether it can cherry-pick to `main` independently.

## Landed on next

### 1. `perf: stylesheet-scan property universe` (aeefbaa) — **main-ready, biggest cold-capture win**

`src/modules/styleScan.js` + integration in `styles.js`. Scans the document's stylesheets once
(per style epoch) for the set of CSS properties any rule can touch; per-node snapshots read
only that universe (+ a ~110-prop always-list + the node's inline props) instead of all ~400.

- Measured: cold capture (`cache: 'disabled'`) **1.5×/1.75×/1.9×** faster (Modal/Page/Large
  card-grid scenes). Warm-repeat pipeline unchanged (snapshotCache already amortized it).
- Property reads themselves: 8.6×/9.2× faster (chromium/webkit, 45-prop probe).
- Fallbacks: cross-origin CSS → full reads; shadow-root nodes → full reads; WAAPI keyframe
  props unioned in; rule budget 20k.
- Dead ends measured, do not retry: Typed OM `computedStyleMap()` is ~2× SLOWER than
  enumeration; copying stylesheets into the clone (~0%, see compression experiment).
- Verified: full suite 3 engines + visual baselines byte-green.

### 2. `feat: auto-burst` (88e079d) — **main-ready, but ship notes below**

`burst` becomes tri-state: explicit true/false win; unset auto-enables after 3 captures of
the same element in a 2s sliding window. The old console.warn advice is gone (it now just
does the thing it advertised). Canvas-bearing elements are excluded from auto mode (canvas
pixel draws are invisible to MutationObserver — explicit `burst:true` + `invalidate` still
available there). `captureWithBurst` already flushes `takeRecords()` synchronously before
serving the memo, so DOM mutations can never be missed by timing.

- Measured: repeated captures of a static element ~**300–5000×** (it's a memo hit).
- Ship notes for main: docs must say polling loops get this for free now; CSSOM-only
  mutation apps (insertRule) should pass `burst:false` or `invalidate:true` — same caveat
  the explicit option always had, but now it can engage without opt-in.
- Benchmarks: all `*.benchmark.js` now pin `burst:false` — otherwise they measure the memo.
- Site demo (labs.html Pikachu): needs a redesign when this graduates — its "without burst"
  lane auto-memoizes too now (verified locally: 64ms vs 17ms — only the ~3 warm-up captures
  differ), and its hardcoded blue "full pipeline" ticks lie for polls 4-20. New story:
  "polling speeds up on its own; `burst: true` only skips the warm-up".

### 3. `refactor: per-capture session object` (cc88a5e) — **main-ready**

`src/core/session.js` — `createCaptureSession(policy)` created in captureDOM's first
synchronous tick; the capture never trusts `cache.session` after an await. Removed
rasterizeIframe's save/restore of the global session (redundant now). `cache.session`
remains only as a legacy surface for direct callers (preCache, tests).

- This is the structural cure for the shared-mutable-state race class (#463, the double
  scroll-compensation bug). Follow-up candidate: migrate preCache + styles.js `_resolveCtx`
  fallback off `cache.session`, then delete the global bucket entirely.

## ⚠ Validation lesson (learned the hard way)

**The visual suite (`visual.demos.test.js`) tests the COMPILED `dist/`, not src** —
`snapdomUrl: '/dist/snapdom.mjs'`, and each demo loads `../dist/snapdom.js`. Always run
`npm run compile` before `test:full` when validating a branch, or you're visually testing
whatever was compiled last. This masked a real styleScan regression (22 demos, white text
turning black): the base reset stamped resolved defaults like `-webkit-text-fill-color:
rgb(0,0,0)` that pruned class diffs could no longer override. Fixed in 630c6a4 by pruning
the base reset with the same universe — which also shrinks output CSS.

## Resolved: auto-burst engagement gap (adaptive baseline)

The grid scene wasn't memoizing because `captureWithBurst` pinned `baselineSignature` to
whatever options the FIRST burst-routed call carried; when the polling loop then used
different options, every call was a one-off forever. Fixed: the second consecutive call
with the same new signature adopts it as the baseline and the memo re-engages (measured:
10-poll loop 41.8ms -> 0.1ms on the grid scene). Regression test:
core.capture.autoburst.rebase.test.js. The `state.capturing` guard on markDirty already
handled capture-own live-DOM mutations correctly — that was not the issue.

A second, worse hole surfaced by the visual suite (dimension mismatches, e.g. 644x753
baseline vs 640x512 actual): image and font loads change layout/paint WITHOUT any DOM
mutation, so a memo taken while a subtree <img> was still loading survived the load and
served the short pre-load layout forever. Fixed (6620d4a): pending imgs get load/error
listeners that dirty the state unconditionally (even mid-capture — the in-flight capture
used the stale layout too), and a module-level document.fonts 'loadingdone' epoch is
compared per capture. This closes the resource-load blindness for auto mode; canvas
remains the only excluded case.

Flake triage evidence: with auto-burst force-disabled, d13-svg-pdf-mathjax (0.59%) and
d5-demo-gallery still fail intermittently in isolated runs — those are CDN-font/decode
timing flakes independent of this branch, same family as d-compress.

## Known flake (pre-existing)

`visual.demos.test.js > d-compress` on webkit fails intermittently (~1 in 5 FULL-suite runs,
2.1% pixel mismatch; 6/6 green in isolation). Load-sensitive decode timing; this demo has a
prior history of intermittent blanks (see bench/snapeye-dev.mjs investigation). Options:
per-demo mismatch tolerance bump for webkit, or re-run that harness under load.

## 4. `feat: differential recapture` (burst v2) — **DONE, the ambitious one**

`src/core/diff.js` + dirty-subtree tracking in burst + `composeAndSerialize` extracted from
captureDOM + `applyStyleClass`/`wrapScrolledClone` extracted from prepareClone. When only
subtrees mutated, the retained clone from the last full capture gets just those subtrees
rebuilt (deepClone + pseudo + assets + compress, scoped), spliced, classes regenerated, and
re-serialized. Measured: mutating poll x10 on a 48-card grid **124.7ms -> 25.9ms (4.8x)**,
served 10/10, and the output is **byte-identical** to a full capture of the same DOM state
(that's the test assertion, not pixel-approximate).

Hard-bail conditions (any -> full pipeline, correctness never depends on the diff):
- options: reconcile / clip / embedFonts / filterMode:'remove' / excludeMode:'remove'
- unreadable (cross-origin) CSS, or stylesheets using sibling combinators (+ ~), :has(),
  or CSS counters — those let a mutation change rendering OUTSIDE its subtree
- dirty subtree contains svg/iframe/canvas/video/audio/object/embed/slot/template/picture/style
  or introduces shadow content; dirty root is the capture root or its direct child
- **geometry guard**: if the dirty root's frozen box/margins/display differ from its current
  computed values, the mutation reflowed the neighborhood (frozen sibling min-widths go
  stale) -> full. This is what keeps byte-fidelity honest; found via a real leak where an
  added badge reflowed a grid and sibling min-widths diverged.

## 5. `feat: html-in-canvas engine` (D) — **DONE as quarantined module, platform-blocked**

`src/engines/htmlInCanvas.js` — NOT core: the only core knowledge is a 3-line lazy-import
seam in snapdom.js behind the opt-in `engine: 'canvas'` option (+ one line in context/types).
Model: mounts a live-DOM copy INSIDE a `layoutsubtree` canvas (same document → page CSS
applies, zero snapshotting) with the element's ancestor chain as `display:contents` shells
(selector context + inheritance, no boxes), syncs form state, `ctx.drawElement(...)`.
Null on any doubt → normal pipeline; vector APIs (toRaw/toSvg) lazily run the pipeline.

**Platform findings (verified against flagged Chromium, `--enable-blink-features=CanvasDrawElement`
works in Playwright!):**
- `drawElement` exists and PAINTS PIXEL-PERFECTLY — including **native buttons/inputs**,
  the exact fidelity class the svg pipeline can't reproduce (screenshot proof captured).
- Without `layoutsubtree` it throws; hidden/offscreen mounts skip the paint pass.
- **It currently TAINTS the canvas unconditionally** (even local-only content): no
  getImageData/toBlob → no encodable exports today → the engine's taint probe routes
  everything to the pipeline. The module is future-ready: when Chromium ships same-origin
  readback, `engine:'canvas'` lights up with no code changes.
- Plugin compat rule implemented: any plugins present → pipeline (conservative v1).

## 6. `feat: cache collapse + embedFonts 'auto'` — **DONE, defaults over knobs**

- **cache**: 'disabled' (or false) remains as the debug/testing escape hatch; every legacy
  string ('soft'/'auto'/'full') collapses to the one structural behavior. Rationale:
  per-capture sessions made 'soft' structural, snapshotCache+epoch made 'auto' pointless,
  and 'full' re-shared session maps across captures — the state class the session refactor
  eliminated — while its use case (fast repeats) is served correctly by auto-burst + diff.
  Legacy strings still accepted (no breakage), types document the deprecation.
- **embedFonts**: default `'auto'` — svg-as-image can't see the page's loaded webfonts, so
  not embedding webfont text is silent infidelity; but system-font pages must pay nothing.
  Auto embeds exactly when a used family is document-declared (`document.fonts` pre-gate →
  zero cost on system pages; family-intersection check after collectFontUsage). Explicit
  true/false override. Wired through: capture fontsPhase, Safari pre-step (waits only on
  DECLARED webfont families — unconditional waiting cost ~30ms/capture on WebKit and broke
  memo latency), diff bail is now retained-fontsCSS-based (system pages keep the diff path).
  JS-only FontFace objects (no stylesheet rule) still need `localFonts` — unchanged.
- Visual baselines: unchanged across all 3 engines (no demo shifted).

## 7. Obsolescence + remaining-architecture sweep — **DONE** (7 commits)

- **scroll invalidation** (fix): scroll events produce no mutation records — one
  capture-phase `scroll` listener per burst element closes the stale-memo hole. A sibling
  hole found while designing it: **window resize** (media queries flip with no mutation)
  now bumps the shared env epoch too.
- **cache.session is test-surface only**: preCache no longer touches it; prepareClone and
  styles' `_resolveCtx` fall back to fresh isolated maps. The only remaining readers are
  default parameters serving direct module calls in tests.
- **window.snapdom global removed**: iframe rasterization uses the threaded `context.snap`
  exclusively (main() always sets it).
- **`fast` collapsed**: the idle-sliced non-fast path was pure legacy (allocations +
  latency, no benefit at current capture times). `idle()` is a call-through now; the
  option is accepted and ignored. Benchmarks unchanged (1.18-1.47x vs 2.16.0).
- **invalidation unified**: one style-ENVIRONMENT epoch in styles.js (head mutations +
  font loads + window resize) replaces burst's duplicate head observer and font-epoch
  machinery. Polled, not subscribed — callbacks would root state (leak).
- **diff geometry-reconcile**: layout-rippling mutations (added nodes reflowing a grid) no
  longer bail — one pass compares each retained box's frozen width/height/min-* against
  current computed values and re-styles only the drifted ones. The badge-reflow case now
  serves via diff **byte-equal to full**; mutating-poll stays ~5x.
- **E (worker compress)**: decode+downscale+re-encode moved to an inline OffscreenCanvas
  worker (FileReaderSync for the data URL); sync fallback on any failure (no Worker, CSP,
  engine gap). Visual demos byte-green across engines.
- **picture-resolver dissolved**: the live-DOM mutation dance (swap src, remove <source>,
  undo — visible flicker on the user's page) is gone from the pipeline; lazy placeholders
  resolve on the CLONE in freezeImgSrcset (findLazySrcAttr) and inlineImages fetches them
  like any source. `runPictureResolverBeforeClone` survives only for the back-compat
  plugin export.
- **Evaluated, intentionally NOT done**: (a) reconcile warning stays — embedFonts 'auto'
  removes the webfont-fallback rewrap cause, but system-ui metric drift in svg-as-image
  persists, so the risk is still real; (b) #6 memory (data-URL string duplication) —
  transient peaks only, every alternative (streaming encode, blob URLs) either adds
  complexity or hits the Chromium blob-taint wall; not worth it.

## Not done (assessed, next steps)

- **Worker offload**: only `compress` downsampling qualifies (OffscreenCanvas); svg-as-image
  decode must stay on main. Low priority.
- **Folder reorg by pipeline stage**: deliberately skipped — ~90 test files import src paths
  directly; churn outweighs benefit while the session object already enforces the state
  contract.
