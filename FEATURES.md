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

- **Computed-style inlining** — every node's full computed style is snapshotted and deduplicated into generated CSS classes to keep output compact. Authored inline styles are replaced with computed values so stylesheet `!important` still wins.
- **Preserved details** — text-decoration longhands (line/color/style/thickness, underline-offset, skip-ink), `-webkit-text-stroke` + `paint-order`, and (when embedding fonts) font-feature/variation/kerning/variant/optical-sizing settings.
- **`counter()` / `counters()`** — a full CSS counter resolver (counter-reset with nesting, counter-increment, counter-set, and counter-style formatting), used in pseudo-element `content`.
- **`-webkit-line-clamp` & `text-overflow: ellipsis`** — baked into real text (with `…`) because Firefox and Safari don't honor them inside `<foreignObject>`.
- **Transforms** — base and individual `translate`/`rotate`/`scale` are read into a total matrix with origin-aware bounding-box math (see the `outerTransforms` option).
- **Shadows, blur & outline bleed** — box-shadow, filter blur, drop-shadow and outline expand the viewBox when `outerShadows` is on; otherwise root shadows are visually stripped (see `outerShadows`).
- **Masks, backgrounds & border-image** — see [Images & backgrounds](#images--backgrounds).
- **Custom scrollbars** — `::-webkit-scrollbar` rules are injected so custom scrollbar styling appears.
- **`excludeStyleProps`** — skip properties from the snapshot by RegExp or predicate (e.g. drop all CSS variables).

## Images & backgrounds

- **`<img>` inlining** — resolves `currentSrc`/`src`, fetches to a data URL, caches, and ensures dimensions (batched to respect HTTP/1.1 connection limits). SVG `<image href>` is inlined too.
- **Backgrounds & masks** — inlines `url()` layers in `background-image` (and the `background` shorthand), `mask` / `-webkit-mask*`, and `border-image`, preserving multi-layer values and layout longhands (position, size, repeat, origin, clip, blend-mode, composite…). Supports `background-clip: text`.
- **`<picture>` & lazy images** — resolves `<picture>` sources and common lazy attributes (`data-src`, `data-lazy-src`, `data-original`, `data-hi-res-src`, `data-srcset`, …) to real URLs before cloning.
- **CORS / proxy** — a non-throwing fetch layer with in-flight deduplication, an error cache, timeouts, and inferred credentials. `useProxy` accepts flexible templates (`{url}`, `{urlRaw}`, `?url=` suffix, and more); already-proxied and `data:`/`blob:` URLs are skipped.
- **Failure fallbacks** — a configurable `fallbackURL` (string or callback), then a placeholder box, then a hidden spacer.
- **`compress`** — perceptual downsampling of inlined rasters to their visible resolution (display box × scale × dpr), preserving the source codec and never upscaling. On by default; set `compress: false` to embed verbatim.
- **Decode-size guard** — SVG raster size is clamped to safe limits (max 16384px per side, ~268M px area) and downscaled with a warning if exceeded.

## Fonts & icon fonts

- **`@font-face` embedding** (`embedFonts`) — scans document (and iframe) stylesheets and embeds only the `@font-face` rules for the families/weights/styles/stretch **actually used**, intersected with the **used unicode codepoints**, keeping payloads small. Supports near-weight matching and synthetic-italic fallback.
- **Icon fonts** — auto-detects Font Awesome, Material Icons / Symbols, Ionicons, Glyphicons, Feather, Bootstrap Icons, Remix, Heroicons, Layui and Lucide (plus a heuristic), and renders glyphs (including ligature icons) to images. Extend detection via the `iconFonts` option or `window.__SNAPDOM_ICON_FONTS__`.
- **`localFonts`** — supply your own fonts as `{ family, src, weight?, style?, stretchPct? }` to fetch and embed.
- **`excludeFonts`** — exclude by `{ families?, domains?, subsets? }`.
- **Cross-origin stylesheets** — gated by `fontStylesheetDomains` (plus known math libraries like KaTeX/MathJax).
- **`preCache`** — preloads images, background images and fonts before capture; defaults to `embedFonts: true` and `cache: 'full'`.

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
| `fast` | `true` | Skip idle delay for speed |
| `scale` | `1` | Output scale multiplier |
| `exclude` | `[]` | CSS selectors to exclude |
| `excludeMode` | `'hide'` | `'hide'` (spacer) or `'remove'` |
| `filter` | `null` | Node predicate `(node) => boolean` |
| `filterMode` | `'hide'` | `'hide'` or `'remove'` |
| `placeholders` | `true` | Show placeholders for failed images / cross-origin iframes |
| `embedFonts` | `false` | Embed matched `@font-face` |
| `iconFonts` | `[]` | Extra icon-font names/regexes |
| `localFonts` | `[]` | User font descriptors |
| `excludeFonts` | `undefined` | `{ families, domains, subsets }` |
| `fontStylesheetDomains` | `[]` | Extra cross-origin CSS domains |
| `fallbackURL` | `undefined` | Fallback image URL or callback |
| `cache` | `'soft'` | `disabled` / `soft` / `auto` / `full` |
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
| `compress` | `true` | Perceptual raster downsampling |
| `safariWarmupAttempts` | `3` | Safari warmup iterations (1–3) |
| `excludeStyleProps` | `null` | RegExp/predicate to skip style props |
| `resolvePicturePlaceholders` | `true` | Built-in `<picture>` / lazy resolver |
| `pictureResolver` | `{}` | `{ timeout, concurrency, resolveLazySrc, silent }` |
| `plugins` | — | Per-capture plugin list (local-first) |

## Plugin system

Plugins are plain objects with lifecycle hooks, registered globally (`snapdom.plugins(...)`, deduped by `name`) or per-capture (`{ plugins: [...] }`, where locals override globals by name).

- **Hooks** (in order): `beforeSnap → beforeClone → afterClone → beforeRender → afterRender → beforeExport → afterExport → afterSnap`.
- **Custom exporters** — a plugin's `defineExports` can add or override export formats; each becomes a `to<Name>()` helper on the result object and gets the same export pipeline as core formats.
- **Accepted forms** — plain object, `[factory, options]`, `{ plugin, options }`, or a factory function.

See [`PLUGIN_SPEC.md`](PLUGIN_SPEC.md) and [`CONTRIBUTING_PLUGINS.md`](CONTRIBUTING_PLUGINS.md).

## Caching & preCache

- **Buckets** — FIFO evicting maps for `image`, `background`, `resource`, `baseStyle` and `defaultStyle`; `WeakMap`s for computed styles and layout measurement hints; a `Set` for fonts; and a per-session bucket.
- **Policies** (`cache` option):
  - `disabled` — clear all caches every capture.
  - `soft` (default) — reset session style/node maps, keep persistent caches.
  - `auto` — reset style/node maps only, keep the style cache too.
  - `full` — keep everything.
- **Invalidation** — a MutationObserver on the DOM and `<head>` plus font `loadingdone`/`ready` events bump a style-snapshot epoch, so stale snapshots are dropped automatically.
- **`preCache`** — warm the caches ahead of time (defaults to `cache: 'full'`).

## Cross-browser handling

- **Safari warmup** — works around [WebKit #219770](https://bugs.webkit.org/show_bug.cgi?id=219770) (the first canvas draw with an embedded-font SVG is blank) by running small pre-captures + `drawImage` to prime the pipeline when fonts are embedded or the element has background/mask/canvas content. Configurable via `safariWarmupAttempts`.
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
