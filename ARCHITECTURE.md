# snapdom architecture notes

Durable engineering knowledge that outlives branch working files. If you are about to
"simplify" something listed here, read its entry first — most of it was learned the
hard way and several alternatives were **measured and rejected**.

## Why the pipeline looks like this

The only dependency-free, permissionless way to rasterize arbitrary HTML in a browser
is svg-as-image (`<foreignObject>` in an `<svg>` data URL drawn to a canvas). An svg
data URL is an **inert document**: no script (so `adoptedStyleSheets` can't exist
there), no network (so every asset must inline as a data URL), and its own viewport
(so copied `@media`/container conditions would mis-evaluate — snapdom resolves them at
capture time). Those three facts force capture-time computed-style resolution, which
forces the clone + per-node snapshot design. A 2026 from-scratch redesign (evaluated
by an adversarial architecture panel) re-derives this same pipeline; the wins are in
doing *less* of it (property-universe pruning, class dedup, differential recapture),
not in doing something else.

## The invalidation matrix (burst/diff correctness)

The memoization engine must observe every way a rendered frame can change. The
authoritative wiring lives in `src/core/burst.js` (this table names each mechanism):

| Change class | Mechanism | Where |
|---|---|---|
| DOM mutations (subtree) | scoped `MutationObserver` + `takeRecords()` flush pre-serve | burst.js `createState` / `captureWithBurst` |
| `<video>` frames | `timeupdate`/`seeked` listeners per tracked video | burst.js `trackVideos` |
| `<img>` loads mid-capture | `load`/`error` listeners on pending images (dirty even in-flight) | burst.js `trackPendingImages` |
| Font loads | shared style-environment epoch (`document.fonts` loadingdone/ready) | styles.js `getStyleEnvEpoch` |
| Scroll (no mutation records) | capture-phase `scroll` listener per burst element | burst.js |
| Window resize (media queries flip) | resize listener bumps the env epoch | styles.js |
| `<head>` CSS changes | head `MutationObserver` bumps the env epoch | styles.js |
| Same-tick style injection | synchronous `takeRecords()` drain at capture start | styles.js `flushStyleInvalidations`, called from prepareClone |
| CSS/WAAPI animations (no records) | `getAnimations({subtree})` per capture: memo never serves/stores while running; targeted subtrees become dirty roots for the diff path with per-frame snapshot invalidation | burst.js + styles.js `invalidateSnapshotsUnder` |
| Canvas pixel draws | **excluded** — invisible to every observer; `invalidate: true` is the documented escape | context.js |
| Plugins with render hooks | suspend auto memo/diff unless `pure: true` | plugins.js `hasImpureRenderPlugins` |

The differential path's correctness oracle is **byte equality** with a full capture of
the same DOM state (not pixel similarity) — `tryDiffCapture` returns null on ANY doubt.
This is also a public contract: agents hash `result.url` to detect UI change.

## Measured dead ends — do NOT retry

- **Typed OM `computedStyleMap()`**: ~2× SLOWER than enumeration.
- **Copying stylesheets into the clone** instead of inlining styles: ~0% gain.
- **Inherited-styles dedup**: ~0%.
- **Native compression inside foreignObject**: impossible.
- **Worker offload beyond compress downsampling**: svg-as-image decode must stay on main.
- **Folder reorg by pipeline stage**: ~100 test files import src paths directly; internal
  paths aren't semver surface, so the option never expires — permanently not worth it.
- **Removing the reconcile warning**: system-ui metric drift in svg-as-image persists.
- **Blob URLs for big payloads**: Chromium taints the canvas on foreignObject-svg from
  blob: URLs — breaks every raster export.
- **Materializing system-ui fonts / softening inline-block+flex freeze guards**
  (text-rewrap family): tried, regressed, reverted.
- **Pseudo-recursion subtree skip via `querySelector`**: shadow-root pseudo content is
  invisible to document selector gates — would silently drop shadow pseudos. CSS
  counters additionally force document-order sequential processing.
- **Threading iconFonts matchers through every isIconFont site**: ~10 sites, several
  without ctx access; replaced-per-capture list covers the real leak, the residual
  concurrent-capture edge is documented at the declaration.
- **A separate WebCodecs toWebm plugin**: duplicate of video-export; MediaRecorder
  already picks WebM/MP4 per browser — the deterministic-timing win lives in
  `captureStream(0)` + `requestFrame()`, which video-export now uses.

## Internal escapes policy

`compress: false` and `burst: true|false` are **functional but undocumented** — types
and README don't mention them. They exist because benchmarks and the diff byte-equality
tests need deterministic full-pipeline runs (without `burst:false` a benchmark measures
the memo — the historical "342×" mistake). Promotion trigger: if a real user need
appears that `invalidate: true` can't serve, document them then; don't pre-announce.

## Verifying WebKit changes in REAL Safari

Playwright WebKit does **not** reproduce the #219770 family (svg-as-image blank first
draw). A green `test:webkit` run proves nothing about those quirks. Use:

- **SnapEye harness**: `bench/snapeye-dev.mjs` (untracked; requires the sibling
  `../snapeye` repo) — serves capture loops, writes every blob to `.snapeye/`; complete
  captures are byte-identical, so any size outlier is a blank frame.
- **safaridriver**: `safaridriver -p <port>` (Develop → Allow Remote Automation) + plain
  WebDriver curl calls to run JS/DOM checks in real Safari.

## Testing landmines

- The visual suite pixel-diffs **compiled `dist/`**, not src. `scripts/ensure-fresh-dist.mjs`
  (vitest globalSetup) recompiles automatically when src is newer — never remove it; a
  stale dist once masked a real regression as false-green.
- `d13-svg-pdf-mathjax` and `d-compress` (webkit) are known intermittent CDN-font/decode
  flakes (~0.5-2% mismatch, pass in isolation). Re-run before treating as regressions.
- Baselines: `VITE_UPDATE_VISUAL=1` (browser-mode env passthrough), per-engine dirs via
  `BROWSER=webkit|firefox|all`.
