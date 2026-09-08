# SnapDOM architecture notes

SnapDOM captures the rendered state of web apps. Core produces reusable image and canvas
exports; official plugins add HTML, structured context, element maps, PDF and live
recordings. These notes explain the v3 beta pipeline and the constraints behind it.

## Why the pipeline looks like this

The default renderer places cloned HTML inside an SVG `<foreignObject>`, then draws the
SVG data URL onto a canvas for raster exports. This runs in the browser without screen
capture permission or a rendering service.

An SVG loaded as an image has no active scripts or external resource loading, and it has
its own viewport. SnapDOM therefore captures computed styles, resolves media/container
conditions and adopted stylesheets, and embeds assets before rendering. Reusing style
snapshots, deduplicating declarations and rebuilding changed subtrees reduce that work.

## Stages: how far a capture runs (`needs`)

The pipeline is `element → clone → render → exports`. A plugin declares `needs: 'clone'`
or `needs: 'render'`; `result.needs` reports which stage ran. The default is `'render'`.
Core uses the deepest stage requested by attached plugins, so all must request `'clone'`
to skip rendering. See [the plugin contract](./PLUGIN_SPEC.md#how-far-the-pipeline-runs-needs)
and `src/core/stages.js`.

Rendering and ordinary exports use the captured state. They do not reread the live tree
when an older result is exported later. GIF and video plugins deliberately start a new
sequence of live captures when recording begins.

A capture that stops at `'clone'` still pays the cloning cost. It has no render artifact
to memoize, and image exports throw instead of silently recapturing a later state.
Structured-output plugins retain their own snapshots for later exports. The former
`'dom'` stage is unsupported.

Only per-capture plugins may lower the stage. Global registration rejects `'clone'` to
avoid removing images from unrelated captures. Plugins use `assertNeeds` to reject stages
they cannot support.

SnapDOM has two rendering engines: SVG (the default) and `html-in-canvas`. Both consume the
finished clone and CSS assembled by core. The second engine mounts and paints that clone
through the browser's native canvas API. Its successful artifact is a raster canvas, with
no serialized SVG. Unsupported geometry, unavailable/unsafe native paint, or render-boundary
plugin hooks fall back to SVG on the same frozen clone.

`html-in-canvas` remains experimental. It needs a compatible browser with its canvas drawing
flag enabled, a build compiled with `SNAPDOM_CANVAS_ENGINE=1`, and the capture option
`engine: 'html-in-canvas'`. The default build includes SVG only. To test both engines against
the local development version, run `SNAPDOM_CANVAS_ENGINE=1 npm run site`.

## The invalidation matrix (burst/diff correctness)

Reusing a capture depends on tracking changes to the rendered frame. The mechanisms and
exceptions below are implemented in `src/core/burst.js` and the related modules:

| Change class | Mechanism | Where |
|---|---|---|
| DOM mutations (light DOM + open shadow roots) | scoped `MutationObserver`s + synchronous `takeRecords()` flush pre-serve | burst.js `createState` / `trackShadowRoots` |
| Opaque/frame-driven content | iframe, canvas, video/audio, SMIL and known animated-image trees bypass memoization, even with internal `burst: true` | snapdom.js `main` → burst.js `isAutoBurstSafe` |
| `<img>` loads mid-capture | `load`/`error` listeners on pending images (dirty even in-flight) | burst.js `trackPendingImages` |
| Font loads | shared style-environment epoch (`document.fonts` loadingdone/ready) | styles.js `getStyleEnvEpoch` |
| Scroll (no mutation records) | capture-phase listeners across light/open-shadow trees plus synchronous offsets of known scrollers | burst.js `collectScrollNodes` / `renderStateOf` |
| Programmatic form state | input/change events plus synchronous signatures of tracked controls (`value`, selected option, checked/indeterminate) | burst.js `renderStateOf` |
| Hover/focus/active/top-layer/hash state | scoped hover sampling, interaction listeners, root style stamps and synchronous state signature | styles.js + burst.js `renderStateOf` |
| Viewport and media preference changes | shared resize epoch plus synchronous viewport/DPR/orientation and fixed media-query signature | styles.js + burst.js `renderStateOf` |
| Stylesheet DOM changes | document observers bump the style/environment epoch; stylesheet nodes are document-wide regardless of where they are inserted | styles.js `onDomRecords` |
| Adopted stylesheets | sheet identity is sampled for the document and each tracked open shadow root | burst.js `renderStateOf` |
| Same-tick observable changes | document and scoped observer queues are synchronously drained before a memo decision | styles.js `flushStyleInvalidations` + burst.js |
| CSS transitions/animations and WAAPI | `getAnimations()` across light/open-shadow scopes; running targetable light-DOM effects rebuild per frame through diff, ambiguous effects force full capture | burst.js + styles.js `invalidateSnapshotsUnder` |
| Selection capture | bypasses memoization because selection/range state is not a DOM mutation | snapdom.js `main` |
| Canvas pixel draws | bypass memoization because pixels are invisible to DOM observers | snapdom.js `main` → burst.js `isAutoBurstSafe` |
| CSSOM rule edits (`sheet.insertRule`, `rule.style.x = …`) | not automatically observed; use `invalidate: true` to clear style caches as well as the result memo. This also refreshes the set of captured properties when a rule introduces one that was not previously used | snapdom.js `main` → styles.js `invalidateStyleCaches` |
| Plugins with render hooks | impure hooks suspend automatic memoization; pure hooks may memoize, while diff bails whenever it would skip a required lifecycle hook | plugins.js `hasImpureRenderPlugins` + diff.js |
| Function-valued capture policies | `filter`, `exclude`, `excludeStyleProps` and `fallbackURL` bypass memoization even when their function identity is unchanged; applicable style/fallback decisions are reevaluated on each new capture | snapdom.js `main` + styles.js |

Differential-capture tests require byte equality with a full capture of the same DOM
state. `tryDiffCapture` returns `null` when it cannot safely reuse the retained clone,
so core runs a full capture.

<a id="measured-dead-ends--do-not-retry"></a>

## Previous optimization results

Earlier local trials found `computedStyleMap()` roughly twice as slow as property
enumeration, with no useful gain from copying stylesheets or deduplicating inherited
styles. Those measurements describe the tested workloads, not every page or browser.

Other constraints to preserve when changing the pipeline:

- SVG-as-image decoding runs on the main thread; compression downsampling can use a worker.
- Large foreignObject SVGs served through blob URLs can taint Chromium canvases and break raster exports.
- System-font metrics can drift in SVG-as-image. Removing reconciliation warnings or relaxing
  inline-block/flex width guards previously reintroduced text wrapping regressions.
- Document-level selectors cannot rule out pseudo content inside shadow roots. CSS counters
  also require processing in document order.
- Internal file moves require updating tests that import source paths directly.
- Changes to icon-font matcher state must account for its per-capture lifetime and concurrent calls.
- `video-export` already chooses supported MP4/WebM codecs through `MediaRecorder` and uses
  `captureStream(0)` with `requestFrame()` where available. This requests frames explicitly;
  it does not provide deterministic timestamps when capturing takes longer than a frame interval.

## Internal escapes policy

`compress: false` and `burst: true|false` are internal test controls, outside the public API.
Benchmarks and differential byte-equality tests use them to isolate compression or force
the full pipeline; otherwise a repeated-capture benchmark can measure a memo lookup.
`burst: true` cannot override freshness boundaries for selection, opaque/frame-driven
content or function-valued capture policies. The supported public option for forcing a
fresh capture is `invalidate: true`; a changed callback closure does not require it.

## Verifying WebKit changes in real Safari

Playwright WebKit does not reproduce every Safari SVG-as-image issue, including the
#219770 family of blank first draws. Validate changes to those workarounds in real Safari.
Enable **Develop → Allow Remote Automation**, start `safaridriver -p <port>`, and use
WebDriver to run repeated captures and inspect the resulting images. Compare pixels as
well as successful completion; a blank image can still be a valid export.

<a id="testing-landmines"></a>

## Testing notes

- The visual suite compares compiled `dist/`. `scripts/ensure-fresh-dist.mjs`
  (Vitest global setup) rebuilds when source is newer, preventing tests of stale bundles.
- `d13-svg-pdf-mathjax` and `d-compress` have shown intermittent CDN-font/decode failures
  in WebKit. Reproduce a failure in isolation and check asset readiness before classifying it.
- Baselines: `VITE_UPDATE_VISUAL=1` (browser-mode env passthrough), per-engine dirs via
  `BROWSER=webkit|firefox|all`.
