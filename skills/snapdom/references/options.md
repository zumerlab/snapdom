# SnapDOM options

Every public option of `snapdom(element, options)` in 3.x, with its default. The shortcuts (`snapdom.toPng(element, options)` and the rest) take the same object. An option that is not listed here does not exist: unknown keys are ignored without an error.

## Contents

- [Size and density](#size-and-density)
- [Output](#output)
- [What is captured](#what-is-captured)
- [Fonts](#fonts)
- [Images and cross-origin resources](#images-and-cross-origin-resources)
- [Root shadows and transforms](#root-shadows-and-transforms)
- [Reuse, cache and long captures](#reuse-cache-and-long-captures)
- [Engine and debugging](#engine-and-debugging)
- [What an export call can override](#what-an-export-call-can-override)
- [Long pages and large outputs](#long-pages-and-large-outputs)
- [Removed since v2](#removed-since-v2)

## Size and density

| Option | Default | Notes |
| --- | --- | --- |
| `scale` | `1` | Multiplies the output size. Applies only when neither `width` nor `height` is set |
| `width`, `height` | unset | Output size in CSS pixels, before `dpr`. Setting one keeps the aspect ratio. They win over `scale` |
| `dpr` | `window.devicePixelRatio` | Pixels per CSS pixel in raster output. `download()` always uses `1` |

A 300 px wide element gives a 300 px image with `dpr: 1`, 600 px with `dpr: 2` or with `scale: 2, dpr: 1`, and 1200 px with `scale: 2, dpr: 2`. For the same file on every screen, set `dpr` yourself.

## Output

| Option | Default | Notes |
| --- | --- | --- |
| `format` | `'png'` | Used by `toBlob()` and `download()`: `'png'`, `'jpg'` / `'jpeg'`, `'webp'`, `'svg'`. `toBlob()` gives SVG unless a format was named on the capture or on the call. `toPng()`, `toJpg()` and `toWebp()` pick their own |
| `type` | unset | Deprecated alias of `format` |
| `quality` | `0.92` | JPG and WebP, 0 to 1 |
| `backgroundColor` | `null`; `'#ffffff'` for JPG and WebP | Any CSS color |
| `filename` | `'snapDOM'` | For `download()`. The extension is added from the format when missing (`'card'` with `jpg` saves `card.jpeg`) |
| `canvas` | unset | An existing `<canvas>` to draw into, instead of a new one per export |

## What is captured

| Option | Default | Notes |
| --- | --- | --- |
| `exclude` | none | A CSS selector, a synchronous predicate `(el) => boolean` where `true` excludes, or an array mixing both |
| `excludeMode` | `'hide'` | `'hide'` leaves an invisible box of the same size; `'remove'` drops the node and layout closes up |
| `filter` | none | Synchronous predicate `(el) => boolean` where `true` keeps the node |
| `filterMode` | `'hide'` | Same two modes, for nodes rejected by `filter` only |
| `clip` | `null` | `'viewport'` (what is on screen now) or `{ x, y, width, height }` in page coordinates. Subtrees outside are skipped, so it is faster than a full capture |
| `captureSelection` | `false` | Paint the user's current text selection into the capture |
| `placeholders` | `true` | Draw a placeholder where an image or cross-origin iframe could not be read; `false` leaves the box empty |
| `plugins` | none | Plugins for this capture; they run before global ones and override them by name |

Order per node: the attribute `data-capture="exclude"`, then `exclude`, then `filter`. The first one that matches decides. `data-capture="placeholder"` replaces an element with a box of its size, with `data-placeholder-text` as its text.

Core masks password fields as the browser shows them. Other field values are captured as typed; use the `redactInputs` plugin or `exclude` to hide them.

## Fonts

| Option | Default | Notes |
| --- | --- | --- |
| `embedFonts` | `'auto'` | `'auto'` embeds the web fonts the element uses and skips the step on system-font content. `true` forces the pass, `false` skips it (web font text then renders with a fallback) |
| `localFonts` | `[]` | `[{ family, src, weight?, style?, stretchPct? }]`: font files given directly, no discovery |
| `iconFonts` | `[]` | Extra icon font families, as strings or RegExp. Icon glyphs are drawn as images, apart from `embedFonts` |
| `excludeFonts` | unset | `{ families?, domains?, subsets? }` to skip |
| `fontStylesheetDomains` | `[]` | Extra hosts whose cross-origin font stylesheets may be fetched |

Fonts are embedded as they are on the page: wait for `document.fonts.ready` before capturing, because a capture cannot fix a layout measured with the wrong font. Fonts added only through JavaScript (`new FontFace`) may need `localFonts`.

## Images and cross-origin resources

SnapDOM reads and embeds every image, background and font itself. A browser hands a script the bytes of a cross-origin resource only when its server sends `Access-Control-Allow-Origin`. Without it, the capture still resolves and the image becomes a placeholder, with an `image-fallback` entry in `result.warnings`.

| Option | Default | Notes |
| --- | --- | --- |
| `useProxy` | `''` | Sends every cross-origin request through a proxy you run. Forms: `'https://proxy.example/?url='` (URL appended, encoded), a template with `{url}` (encoded) or `{urlRaw}`, or a base ending in `/` |
| `fallbackURL` | unset | A URL, or `({ width, height, src, element }) => string \| Promise<string>`, fetched in place of an `<img>` that failed. Covers `<img>` only, not CSS backgrounds |

```js
const PROXY = 'https://image-proxy.example.workers.dev/?url=';
const result = await snapdom(map, {
  fallbackURL: ({ src }) => PROXY + encodeURIComponent(src)
});
for (const w of result.warnings) console.log(w.code, w.message);
```

A proxy sees every URL it fetches; run your own and list the hosts it may reach. A proxy does not give access to cross-origin iframe documents. Guide: https://snapdom.dev/how-to/capture-cross-origin-images/

## Root shadows and transforms

| Option | Default | Notes |
| --- | --- | --- |
| `outerShadows` | `false` | `false` strips the root element's own box-shadow, text-shadow, outline and `drop-shadow()` so the image ends at the box. `true` keeps them and widens the image. `'subtree'` also widens it for shadows that descendants cast past the root |
| `outerTransforms` | `true` | `true` keeps the root's rotation, scale and skew. `false` removes the rotation. Translation is always normalized |
| `reconcile` | `false` | Measures the clone against the live layout and pins boxes that differ. Costs one extra layout; try it when text wraps differently in the capture |
| `excludeStyleProps` | unset | RegExp or `(prop) => boolean` of computed properties to skip, for example `/^--/` on pages with thousands of custom properties |

## Reuse, cache and long captures

Repeat captures of an unchanged element are served from memory automatically, and DOM changes invalidate that on their own. There is nothing to turn on.

| Option | Default | Notes |
| --- | --- | --- |
| `cache` | `'soft'` | Resource and style caches. `'disabled'` or `false` empties and bypasses them; a debugging switch, not a tuning one |
| `invalidate` | `false` | One fresh capture after a change the browser reports to nobody, mainly stylesheet edits through CSSOM (`sheet.insertRule()`, `rule.style.color = ...`) |
| `fast` | `true` | `true` clones in one task. `false` yields to the page about every frame during a long capture, so it keeps painting and taking input. `'auto'` is experimental |

A function passed as `filter`, `exclude`, `excludeStyleProps` or `fallbackURL` runs again on every new capture, so it can read current application state.

`snapdom.preCapture()`, called once at setup with no arguments, learns which control starts which capture and prepares it when the pointer or focus reaches that control later. It is optional.

## Engine and debugging

| Option | Default | Notes |
| --- | --- | --- |
| `engine` | `'svg'` | `'html-in-canvas'` paints the clone with the browser's `drawElementImage()` (Chrome 157 and newer) and silently uses SVG everywhere else and for captures it cannot paint (`body` / `html` roots, `clip`, `width` / `height`, `outerShadows`, transformed ancestors). It is slower than SVG. After a native capture, `url` and `toRaw()` are a PNG data URL and `toBlob()` defaults to PNG |
| `debug` | `false` | Console output with a `[SnapDOM]` prefix. Off, nothing is logged and `result.warnings` carries the same information |

## What an export call can override

`result.toPng(options)` and the other export methods take the output options again for that export only: `width`, `height`, `scale`, `dpr`, `backgroundColor`, `quality`, `format`, `filename`, `canvas`, and `crop` on `toCanvas()`. Everything in "What is captured" and "Fonts" was decided at capture time and cannot change afterwards.

```js
const result = await snapdom(card);
const thumb = await result.toJpg({ width: 320, dpr: 1, quality: 0.8 });
const print = await result.toBlob({ format: 'png', scale: 3, dpr: 1 });
```

## Long pages and large outputs

Capture the wrapper, or `document.documentElement` for the whole document. Content below the fold is included.

`download()` and `toBlob()` in PNG or JPEG write files larger than the browser's canvas limit at full size (PNG needs `CompressionStream`; JPEG stops at 65,535 px per side). `toCanvas()`, `toPng()`, `toJpg()` and `toWebp()` use one canvas and scale down past 16,384 px per side in Safari or 32,767 px in Chrome and Firefox. To get separate canvases, rasterize windows of one capture:

```js
const capture = await snapdom(article);
const { contentX, contentY, w0, h0 } = capture.meta;
const pieceHeight = 4000; // CSS px

for (let y = 0; y < h0; y += pieceHeight) {
  const canvas = await capture.toCanvas({
    scale: 2,
    dpr: 1,
    crop: { x: contentX, y: contentY + y, width: w0, height: Math.min(pieceHeight, h0 - y) }
  });
  // save or upload this piece
}
```

`result.meta` holds the capture geometry: `w0` / `h0` (the element's box), `contentX` / `contentY` (where it sits inside the rendered area) and `vbW` / `vbH` (that area, shadows included). `crop` uses those coordinates; `clip` uses page coordinates.

## Removed since v2

| v2 | v3 |
| --- | --- |
| `preCache()` and `@zumer/snapdom/preCache` | Removed. Reuse is automatic; `snapdom.preCapture()` is a different, optional tool |
| `burst`, `compress`, `resolvePicturePlaceholders`, `pictureResolver` | Not public options. Remove them |
| `cache: 'auto'` / `'full'` | Accepted and treated as `'soft'` |
| `width: 200, scale: 2` gave 400 px | `width` wins: pass `width: 400` |
| Web fonts were opt-in | `embedFonts: 'auto'` |
| `require()` | No CommonJS build |
| `toImg()` | Still works; `toSvg()` is the name to use |

Full migration table: https://github.com/zumerlab/snapdom#migrating-from-v2
