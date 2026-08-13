# SnapDOM — Features

A complete technical overview of what **SnapDOM** captures, embeds and exports. SnapDOM serializes a DOM subtree into a self-contained SVG (via `<foreignObject>`) and rasterizes it to your target format — ultra-fast, dependency-free, and 100% based on standard Web APIs.

> 📖 Full API, options and guides: **[snapdom.dev/docs](https://snapdom.dev/docs/)**
>
> 🌐 简体中文: **[FEATURES_CN.md](FEATURES_CN.md)**

## Table of Contents

- [Capture & clone](#capture--clone)
- [Styles](#styles)
- [Images & backgrounds](#images--backgrounds)
- [Fonts & icon fonts](#fonts--icon-fonts)
- [Export formats](#export-formats)
- [Options](#options)
- [Plugin system](#plugin-system)
- [Caching & preCache](#caching--precache)
- [Cross-browser handling](#cross-browser-handling)
- [Node-level control attributes](#node-level-control-attributes)

## Capture & clone

Deep node-by-node clone that snapshots the computed style of every node, preserving what the browser actually renders.

- **Shadow DOM** — traverses `shadowRoot`, extracts and scopes its CSS, seeds the required CSS custom properties, and resolves `<slot>` content via `assignedNodes({ flatten: true })` (slotted subtrees are marked to avoid double-cloning).
- **Same-origin iframes** — rasterized inline (fonts read from the iframe's own document). Cross-origin iframes can't be read, so they render as a striped placeholder (or a hidden spacer when `placeholders` is off).
- **`<canvas>`** — snapshotted to a PNG `<img>` (with Safari-safe retries), preserving intrinsic and CSS box size.
- **`<video>`** — current frame drawn to an image; falls back to the `poster`; honors `object-fit: contain`.
- **`<audio controls>`** — replaced with a drawn player mock sized to the element.
- **Form control state** — `<input>` `value` / `checked` / `indeterminate`, `<textarea>` value, and `<select>` selection are preserved. State attributes (`disabled`, `required`, `readonly`, `min`, `max`, `pattern`, `aria-invalid`) are copied so `:disabled`, `:required`, `:read-only`, `:invalid` and `:in-range` styles render. `::placeholder` color is preserved. Firefox checkboxes/radios get a drawn replacement.
- **`<img>`** — `srcset` is frozen, pre-transform dimensions recorded, px sizes frozen when the author used `%`/`auto`, and `object-fit` / `object-position` preserved.
- **SVG** — paint properties (fill, stroke and its longhands, opacity variants, fill/clip rule, markers, visibility, display) copied as inline styles; external `<defs>` / `<symbol>` referenced by `<use>` are inlined so `var()` resolves at the use site.
- **Scroll position** — scrolled containers are reproduced by translating their inner content and clipping overflow; fixed/absolute descendants are adjusted, and sticky headers/footers are frozen in place.
- **Skipped by design** — `meta`, `script`, `noscript`, `title`, `link`, `template`, the SnapDOM sandbox, and nested `<foreignObject>`.

Non-renderable content is handled gracefully: invalid XML control characters are stripped, `content-visibility` is forced visible so off-screen content is captured, and root margins are neutralized.

## Styles

- **Computed-style inlining** — each node's computed style is snapshotted and deduplicated into generated CSS classes to keep output compact. Authored inline styles are replaced with computed values so stylesheet `!important` still wins.
- **Scanned property universe** — one pass over the document's author styles yields the set of properties the page can actually touch, so the per-node snapshot reads on the order of 50 properties instead of ~400. Same pass derives per-pseudo selector gates, replacing three `getComputedStyle` resolutions per node with one `matches()`. Both memoized per document and style epoch.
- **Preserved details** — text-decoration longhands (line/color/style/thickness, underline-offset, skip-ink), `-webkit-text-stroke` + `paint-order`, and (when embedding fonts) font-feature/variation/kerning/variant/optical-sizing settings.
- **`counter()` / `counters()`** — a full CSS counter resolver (counter-reset with nesting, counter-increment, counter-set, and counter-style formatting), used in pseudo-element `content`.
- **`-webkit-line-clamp` & `text-overflow: ellipsis`** — baked into real text (with `…`) because Firefox and Safari don't honor them inside `<foreignObject>`.
- **Transforms** — base and individual `translate`/`rotate`/`scale` are read into a total matrix with origin-aware bounding-box math (see the `outerTransforms` option).
- **Shadows, blur & outline bleed** — box-shadow, filter blur, drop-shadow and outline expand the viewBox when `outerShadows` is on; otherwise root shadows are visually stripped (see `outerShadows`).
- **Masks, backgrounds & border-image** — see [Images & backgrounds](#images--backgrounds).
- **Custom scrollbars** — `::-webkit-scrollbar` rules are injected so custom scrollbar styling appears.
- **`excludeStyleProps`** — skip properties from the snapshot by RegExp or predicate (e.g. drop all CSS variables).
- **`reconcile`** — mounts the styled clone off-screen, measures every node against its live counterpart, and pins only the boxes whose size diverges to their real value. Fixes rare text re-wrap/layout drift at the cost of roughly doubling capture time; off by default. snapdom warns once (`console.warn`) if it detects a capture that used width-softening on elements known to sometimes need it.

## Images & backgrounds

- **`<img>` inlining** — resolves `currentSrc`/`src`, fetches to a data URL, caches, and ensures dimensions (batched to respect HTTP/1.1 connection limits). SVG `<image href>` is inlined too.
- **Backgrounds & masks** — inlines `url()` layers in `background-image` (and the `background` shorthand), `mask` / `-webkit-mask*`, and `border-image`, preserving multi-layer values and layout longhands (position, size, repeat, origin, clip, blend-mode, composite…). Supports `background-clip: text`.
- **`<picture>` & lazy images** — resolves `<picture>` sources and common lazy attributes (`data-src`, `data-lazy-src`, `data-original`, `data-hi-res-src`, `data-srcset`, …) to real URLs before cloning.
- **CORS / proxy** — a non-throwing fetch layer with in-flight deduplication, an error cache, timeouts, and inferred credentials. `useProxy` accepts flexible templates (`{url}`, `{urlRaw}`, `?url=` suffix, and more); already-proxied and `data:`/`blob:` URLs are skipped.
- **Failure fallbacks** — a configurable `fallbackURL` (string or callback), then a placeholder box, then a hidden spacer.
- **Perceptual downsampling** — inlined rasters are resampled to their visible resolution (display box × scale × dpr), preserving the source codec and never upscaling, and the result is adopted only when it is actually smaller. Engine behavior, not an option: the pixels discarded are ones the output cannot show.
- **`image-set()` / `-webkit-image-set()`** — in `background-image` and pseudo-element `content`, the candidate matching the live device pixel ratio is inlined (not just whichever `url()` appears first).
- **Decode-size guard** — SVG raster size is clamped to safe limits (max 16384px per side, ~268M px area) and downscaled with a warning if exceeded.

## Fonts & icon fonts

- **`@font-face` embedding** (`embedFonts`) — scans document (and iframe) stylesheets and embeds only the `@font-face` rules for the families/weights/styles/stretch **actually used**, intersected with the **used unicode codepoints**, keeping payloads small. Supports near-weight matching and synthetic-italic fallback.
- **Icon fonts** — auto-detects Font Awesome, Material Icons / Symbols, Ionicons, Glyphicons, Feather, Bootstrap Icons, Remix, Heroicons, Layui and Lucide (plus a heuristic), and renders glyphs (including ligature icons) to images. Extend detection via the `iconFonts` option or `window.__SNAPDOM_ICON_FONTS__`.
- **`localFonts`** — supply your own fonts as `{ family, src, weight?, style?, stretchPct? }` to fetch and embed.
- **`excludeFonts`** — exclude by `{ families?, domains?, subsets? }`.
- **Cross-origin stylesheets** — gated by `fontStylesheetDomains` (plus known math libraries like KaTeX/MathJax).
- **`preCache`** — preloads images, background images and fonts before capture; `embedFonts` defaults to `'auto'`, the same semantics as capture.

## Export formats

A `snapdom(el)` call returns a reusable result object; capture once, export many times.

| Method | Returns |
|---|---|
| `toRaw()` | Raw `data:image/svg+xml` URL |
| `toSvg()` / `toImg()` | SVG `HTMLImageElement` |
| `toCanvas()` | `HTMLCanvasElement` |
| `toBlob()` | `Blob` (SVG text blob or rasterized) |
| `toPng()` | PNG image |
| `toJpg()` | JPG image (white background) |
| `toWebp()` | WebP image |
| `download()` | Triggers a file download |

The same methods exist as one-shot static shortcuts (`snapdom.toPng(el)`, `snapdom.download(el)`, …). Lossy formats (JPEG/WebP) auto-flatten transparency to white. Downloads use the Web Share API on iOS. Exports run through a serial per-session queue with `beforeExport` / `afterExport` / `afterSnap` hooks.

## Options

Defaults as normalized in `src/core/context.js`.

| Option | Default | Behavior |
|---|---|---|
| `debug` | `false` | Debug warnings |
| `scale` | `1` | Output scale multiplier. Applies only when neither `width` nor `height` is set |
| `exclude` | `[]` | Selectors and/or predicates `(el) => true` (true excludes), in any mix |
| `excludeMode` | `'hide'` | `'hide'` (spacer) or `'remove'` |
| `filter` | `null` | Node predicate `(node) => boolean` |
| `filterMode` | `'hide'` | `'hide'` or `'remove'` |
| `placeholders` | `true` | Show placeholders for failed images / cross-origin iframes |
| `embedFonts` | `'auto'` | Embed matched `@font-face`. `'auto'` embeds only when the element uses families the document declares; `true`/`false` force it |
| `iconFonts` | `[]` | Extra icon-font names/regexes |
| `localFonts` | `[]` | User font descriptors |
| `excludeFonts` | `undefined` | `{ families, domains, subsets }` |
| `fontStylesheetDomains` | `[]` | Extra cross-origin CSS domains |
| `fallbackURL` | `undefined` | Fallback image URL or callback |
| `cache` | `'soft'` | `soft` (structural default) or `disabled` (debug/testing escape). `auto` / `full` are accepted as legacy aliases and map to `soft` |
| `useProxy` | `''` | CORS proxy template/base |
| `width` | `null` | Output width (aspect-preserving) |
| `height` | `null` | Output height |
| `format` | `'png'` | `png` / `jpg`→`jpeg` / `webp` / `svg` |
| `type` | `'svg'` | Output type `svg` / `img` / `canvas` / `blob` |
| `quality` | `0.92` | Lossy encode quality |
| `dpr` | `devicePixelRatio \|\| 1` | Device pixel ratio |
| `backgroundColor` | `null` (`#ffffff` for jpeg/webp) | Flatten background |
| `filename` | `'snapDOM'` | Download filename base |
| `outerTransforms` | `true` | Normalize root translate/rotate vs. expand bbox for transforms |
| `outerShadows` | `false` | Strip root shadows vs. expand bleed for shadows/blur/outline |
| `clip` | `null` | Capture a region only: `'viewport'` (what the user currently sees) or `{x,y,width,height}` in page coordinates. Offscreen subtrees are pruned before styling and inlining, so it is faster than a full capture |
| `engine` | `'svg'` | `'canvas'` opts into the experimental WICG canvas-place-element engine. Not in the published bundle (see below); falls back to the svg pipeline whenever it is unavailable |
| `reconcile` | `false` | Measure the clone against the live DOM and pin diverging boxes to their real size (roughly doubles capture time) |
| `invalidate` | `false` | Force one fresh, non-memoized capture — for changes automatic tracking can't see (canvas pixel draws, programmatic CSSOM edits) |
| `excludeStyleProps` | `null` | RegExp/predicate to skip style props |
| `plugins` | — | Per-capture plugin list (local-first) |

## Plugin system

Plugins are plain objects with lifecycle hooks, registered globally (`snapdom.plugins(...)`, deduped by `name`) or per-capture (`{ plugins: [...] }`, where locals override globals by name).

- **Hooks** (in order): `beforeSnap → beforeClone → afterClone → beforeRender → afterRender → beforeExport → afterExport → afterSnap`.
- **Custom exporters** — a plugin's `defineExports` can add or override export formats; each becomes a `to<Name>()` helper on the result object and gets the same export pipeline as core formats.
- **Accepted forms** — plain object, `[factory, options]`, `{ plugin, options }`, or a factory function.
- **How far the capture runs** (`needs`) — a plugin declares `'dom'` (live page only, no clone), `'clone'` (frozen tree, no pixels) or `'render'` (default: the whole pipeline). The capture runs to the deepest stage any attached plugin declares, so a capture with no plugins is unchanged. Below `'render'` there is no image: `url` and every export throw, naming the plugin, and `result.needs` reports what ran. Worth it because the clone is ~89% of a capture — a plugin that only reads the live page (a semantic export) can skip it.

See [`PLUGIN_SPEC.md`](PLUGIN_SPEC.md) and [`CONTRIBUTING_PLUGINS.md`](CONTRIBUTING_PLUGINS.md).

## Caching & preCache

- **Buckets** — FIFO evicting maps for `image`, `background`, `resource`, `baseStyle` and `defaultStyle`; `WeakMap`s for computed styles and layout measurement hints; a `Set` for fonts; and a per-session bucket.
- **Policies** (`cache` option) — caching is structural in v3, not a knob:
  - `soft` (default) — per-capture sessions plus content-keyed persistent caches.
  - `disabled` — opts out of every cache. A debug/testing escape, not a tuning option.
  - `auto` / `full` — accepted for v2 compatibility and silently mapped to `soft`.
- **Invalidation** — a MutationObserver on the DOM and `<head>` plus font `loadingdone`/`ready` events bump a style epoch, so stale snapshots are dropped automatically. CSSOM edits (`sheet.insertRule`, `rule.style.x = …`) change no DOM node and are invisible to every observer: `invalidate: true` purges the epoch-scoped caches for exactly that case.
- **`preCache`** — warm the caches ahead of time. `embedFonts` defaults to `'auto'`, same semantics as capture; it takes no cache policy.
- **Repeat-capture memoization** — engine behavior, no option: capture the same element a few times and snapdom memoizes automatically (scoped `MutationObserver` + video/image/font/scroll/resize/head-CSS/animation tracking); when only subtrees changed, a differential recapture rebuilds just those, byte-identical to a full capture. Pass `invalidate: true` to force one fresh capture after changes automatic tracking can't see (canvas pixel draws, programmatic CSSOM edits).

## Cross-browser handling

- **Safari verified draw** — works around [WebKit #219770](https://bugs.webkit.org/show_bug.cgi?id=219770) (the first canvas draw with an embedded-font SVG is blank) at draw time: `toCanvas` probe-draws until ink appears (bounded), so captures wait exactly as long as WebKit needs. No warmup pass, no configuration.
- **Safari canvas** — box-shadow is rewritten to an SVG drop-shadow, and image compositing is awaited before drawing.
- **Firefox** — checkboxes and radios get drawn replacements.
- **iOS** — `download()` falls back to the Web Share API.

## Node-level control attributes

Fine-grained control directly in your markup:

- `data-capture="exclude"` — drop this node (per `excludeMode`).
- `data-capture="placeholder"` + `data-placeholder-text` — render a placeholder box instead of the node.
- `data-snapdom-sandbox` / `#snapdom-sandbox` — skipped entirely.

---

Want the full API and every option with examples? → **[snapdom.dev/docs](https://snapdom.dev/docs/)**
