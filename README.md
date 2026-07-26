<p align="center">
  <a href="https://snapdom.dev">
    <img src="https://raw.githubusercontent.com/zumerlab/snapdom/main/docs/assets/newhero.png" width="80%">
  </a>
</p>

<p align="center">
 <a href="https://snapdom.dev">
    <img alt="Website" src="https://img.shields.io/badge/Website-snapdom.dev-2ea44f?style=flat-square">
  </a>
  <a href="https://www.npmjs.com/package/@zumer/snapdom">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@zumer/snapdom?style=flat-square&label=Version">
  </a>
  <a href="https://www.npmjs.com/package/@zumer/snapdom">
    <img alt="NPM weekly downloads" src="https://img.shields.io/npm/dw/@zumer/snapdom?style=flat-square&label=Downloads">
  </a>
  <a href="https://github.com/zumerlab/snapdom/graphs/contributors">
    <img alt="GitHub contributors" src="https://img.shields.io/github/contributors/zumerlab/snapdom?style=flat-square&label=Contributors">
  </a>
  <a href="https://github.com/zumerlab/snapdom/stargazers">
    <img alt="GitHub stars" src="https://img.shields.io/github/stars/zumerlab/snapdom?style=flat-square&label=Stars">
  </a>
  <a href="https://github.com/zumerlab/snapdom/network/members">
    <img alt="GitHub forks" src="https://img.shields.io/github/forks/zumerlab/snapdom?style=flat-square&label=Forks">
  </a>
  <a href="https://github.com/sponsors/tinchox5">
    <img alt="Sponsor tinchox5" src="https://img.shields.io/github/sponsors/tinchox5?style=flat-square&label=Sponsor">
  </a>

  <a href="https://github.com/zumerlab/snapdom/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/zumerlab/snapdom?style=flat-square">
  </a>
</p>

<p align="center">English | <a href="README_CN.md">简体中文</a></p>

# SnapDOM

**SnapDOM** is a next-generation **DOM Capture Engine** — the fast, modern alternative to **html2canvas**, **dom-to-image**, and **html-to-image**.  
It converts any DOM subtree into a self-contained representation that can be exported to SVG, PNG, JPG, WebP, Canvas, Blob, or **any custom format** through plugins — ultra-fast, modular, extensible, and dependency-free.

> 📖 **[Documentation, guides & live demos → snapdom.dev](https://snapdom.dev)**

## Features

Full DOM capture with embedded styles, pseudo-elements and fonts; export to SVG, PNG, JPG, WebP, `canvas` or Blob — ultra fast, dependency-free, and 100% based on standard Web APIs.

👉 **See the complete technical feature list in [FEATURES.md](FEATURES.md).**

## 🚀 What's new in v3

v3 is a ground-up rework of the capture engine. **Your v2 code runs unchanged** — every option is still accepted — but what happens underneath is radically different:

**It's much faster, everywhere.**
- **First captures are up to 2× faster.** A one-time stylesheet scan tells the engine which CSS properties your page can actually use, so the per-node style snapshot reads ~50 properties instead of ~400 — the single biggest cost in any DOM capture.
- **Repeat captures are effectively free.** Capture the same element a few times and snapdom starts memoizing automatically: unchanged repeats return instantly, and when something *does* change, a **differential recapture** rebuilds only the mutated subtrees (~5× faster on mutating dashboards) with **byte-identical** output to a full capture.
- Invalidation is automatic and complete: DOM mutations, `<video>` frames, image and font loads, scroll, viewport resizes, `<head>` CSS changes, and CSS/WAAPI animations are all tracked. No API to learn, nothing to configure.

**It's more faithful, by default.**
- **Web fonts embed automatically** (`embedFonts: 'auto'`). The SVG your capture rasterizes from can't see the page's loaded fonts — v2 silently rendered webfont text with fallback metrics unless you opted in. v3 detects webfont usage and embeds exactly what's needed; system-font pages pay nothing.
- **Safari, rewritten.** The hidden triple pre-capture warm-up is gone — replaced by a verified draw that waits exactly as long as WebKit needs (first captures ~2× faster). And `toSvg()` now returns actual **vector SVG** on Safari instead of silently rasterizing to PNG.
- **Concurrent captures are fully isolated.** `Promise.all` over multiple captures can no longer cross-contaminate state — an entire class of race conditions is structurally impossible now.
- Outputs are smaller too: up to **27% lighter SVGs** from the same content.

**It's simpler.**
Options that required tuning knowledge tuned themselves out of the API: `burst` engages on its own, `cache` collapsed to a single debug switch, `fast` is obsolete. The best option is the one you never have to read about.

**And it's ready for what's next.**
An experimental `engine: 'canvas'` renders through the browser's own painter via the WICG canvas-place-element API (Chrome flag) — native form controls pixel-perfect, zero SVG quirks — and falls back seamlessly until browsers ship it fully.

## Website & Live Demos

[https://snapdom.dev](https://snapdom.dev)


## Quick Start

**Capture any DOM element to PNG in one line:**

```js
import { snapdom } from '@zumer/snapdom';

const img = await snapdom.toPng(document.querySelector('#card'));
document.body.appendChild(img);
```

**Reusable capture** (one clone, multiple exports):

```js
const result = await snapdom(document.querySelector('#card'));
await result.toPng();      // → HTMLImageElement
await result.toSvg();      // → SVG as Image
await result.download({ format: 'jpg', filename: 'card.jpg' });
```

---

## Table of Contents

- [What's new in v3](#-whats-new-in-v3)
- [Quick Start](#quick-start)
- [Features](#features)
- [Website & Live Demos](#website--live-demos)
- [Installation](#installation)
- [Build Outputs](#build-outputs)
- [Usage](#usage)
- [Documentation](#documentation) — full API, Options, Plugins & Cache reference on [snapdom.dev/docs](https://snapdom.dev/docs/)
- [Limitations](#limitations)
- [Performance Benchmarks](#performance-benchmarks)
- [Development](#development)
- [Contributors](#contributors)
- [Sponsors](#sponsors)
- [Show your support](#show-your-support)
- [License](#license)

## Installation

### NPM / Yarn (stable)

```bash
npm i @zumer/snapdom
yarn add @zumer/snapdom
```

### NPM / Yarn (dev builds)

For early access to new features and fixes:

```bash
npm i @zumer/snapdom@dev
yarn add @zumer/snapdom@dev
```

⚠️ The `@dev` tag usually includes improvements before they reach production, but may be less stable.


### CDN (stable)

```html
<!-- Minified build -->
<script src="https://unpkg.com/@zumer/snapdom/dist/snapdom.js"></script>

<!-- Minified ES Module build -->
<script type="module">
  import { snapdom } from "https://unpkg.com/@zumer/snapdom/dist/snapdom.mjs";
</script>
```

### CDN (dev builds)

```html
<!-- Minified build (dev) -->
<script src="https://unpkg.com/@zumer/snapdom@dev/dist/snapdom.js"></script>

<!-- Minified ES Module build (dev) -->
<script type="module">
  import { snapdom } from "https://unpkg.com/@zumer/snapdom@dev/dist/snapdom.mjs";
</script>
```

## Build Outputs

| Variant | File | Use case |
|---------|------|----------|
| **ESM** (tree-shakeable) | `dist/snapdom.mjs` | Bundlers (Vite, webpack), `import` |
| **IIFE** (global) | `dist/snapdom.js` | Script tag, legacy `require` |

**Bundler (npm):**
```js
import { snapdom } from '@zumer/snapdom';  // → dist/snapdom.mjs
```

**Script tag (CDN):**
```html
<script src="https://unpkg.com/@zumer/snapdom/dist/snapdom.js"></script>
<script> snapdom.toPng(document.body).then(img => document.body.appendChild(img)); </script>
```

**Subpath imports** (lighter bundle if you only need one):
```js
import { preCache } from '@zumer/snapdom/preCache';
import { plugins } from '@zumer/snapdom/plugins';
```


## Usage

| Pattern | When to use |
|---------|-------------|
| **Reusable** `snapdom(el)` | One clone → many exports (PNG + JPG + download). |
| **Shortcuts** `snapdom.toPng(el)` | Single export, less code. |

### Reusable capture

Capture once, export many times (no re-clone):

```js
const el = document.querySelector('#target');
const result = await snapdom(el);

const img = await result.toPng();
document.body.appendChild(img);
await result.download({ format: 'jpg', filename: 'my-capture.jpg' });
```

### One-step shortcuts

Direct export when you need a single format:

```js
const png = await snapdom.toPng(el);
const blob = await snapdom.toBlob(el);
document.body.appendChild(png);
```

## CORS & External Resources

When capturing elements that reference **external stylesheets** (e.g., Google Fonts, Font Awesome, or any CDN‑hosted CSS), you **must** ensure that the resources are served with proper CORS headers. Otherwise, the captured image may lack the expected fonts or icons, even though they render correctly in the browser.

### Why is this needed?

- Browsers block JavaScript (including SnapDOM) from reading the binary data of cross‑origin fonts or images unless the server explicitly allows it via `Access-Control-Allow-Origin`.
- SnapDOM relies on Canvas, which enforces strict CORS policies — unlike the browser's rendering engine, which is more permissive for on‑screen display.

### How to fix it

Add the `crossorigin="anonymous"` attribute to the `<link>` tag when loading external stylesheets:

```html
<link
  rel="stylesheet"
  href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css"
  crossorigin="anonymous"
/>
```

> **Note**: If you are hosting the fonts or assets **on the same origin** as your page (e.g., using a local server like `http://localhost`), you **do not** need to add `crossorigin` – the browser treats them as same‑origin and allows full access.

## Documentation

The full reference lives on **[snapdom.dev/docs](https://snapdom.dev/docs/)** — kept there so it stays in sync and searchable:

- **[API reference](https://snapdom.dev/docs/api/)** — the `snapdom()` reusable object, shortcut methods, and exporter-specific options.
- **[Options](https://snapdom.dev/docs/options/)** — every capture option (`scale`, `dpr`, `embedFonts`, `useProxy`, `exclude`/`filter`, `compress`, `outerTransforms`, `outerShadows`, `cache`…) explained with examples.
- **[Plugins](https://snapdom.dev/docs/plugins/)** — build, register and ship custom plugins and export formats. Browse community plugins on the [plugins page](https://snapdom.dev/plugins.html).
- **[Cache & preCache](https://snapdom.dev/docs/cache/)** — control caching between captures and preload resources.

### API at a glance

`snapdom(el, options?)` returns a reusable object (`toPng`, `toSvg`, `toCanvas`, `toBlob`, `toJpg`, `toWebp`, `download`, `url`). For single exports, use the shortcuts:

| Method | Description |
| ------------------------------ | --------------------------------- |
| `snapdom.toSvg(el, options?)`  | Returns an SVG `HTMLImageElement` |
| `snapdom.toCanvas(el, options?)` | Returns a `Canvas`              |
| `snapdom.toBlob(el, options?)` | Returns an SVG or raster `Blob`   |
| `snapdom.toPng(el, options?)`  | Returns a PNG image               |
| `snapdom.toJpg(el, options?)`  | Returns a JPG image               |
| `snapdom.toWebp(el, options?)` | Returns a WebP image              |
| `snapdom.download(el, options?)` | Triggers a download             |

### Options at a glance

All options are optional and can be passed to `snapdom(el, options)` or any shortcut method.

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `scale` | `number` | `1` | Output scale multiplier |
| `dpr` | `number` | `devicePixelRatio` | Pixel density of the rasterized output |
| `width` / `height` | `number` | `null` | Target output size (keeps aspect ratio if only one is set) |
| `backgroundColor` | `string` | `null` (`#ffffff` for JPEG/WebP) | Background fill |
| `quality` | `number` | `0.92` | JPEG/WebP quality (0–1) |
| `format` | `'png' \| 'jpeg' \| 'webp' \| 'svg'` | `'png'` | Format for `download()` |
| `type` | `string` | `'svg'` | Blob type for `toBlob()` (`'png'`, `'jpeg'`…) |
| `filename` | `string` | `'snapDOM'` | Download filename |
| `embedFonts` | `boolean \| 'auto'` | `'auto'` | `'auto'` embeds web fonts only when the capture actually uses them (system-font pages skip the pass entirely). `true` forces the embed; `false` disables it |
| `iconFonts` | `string \| RegExp \| array` | `[]` | Icon font families (always embedded) |
| `localFonts` | `array` | `[]` | Explicit fonts: `{ family, src, weight?, style? }` — also the path for JS-registered `FontFace` objects |
| `excludeFonts` | `object` | — | Skip fonts by family / domain / subset |
| `fontStylesheetDomains` | `string[]` | — | Extra cross-origin domains to fetch font CSS from |
| `exclude` | `string[]` | `[]` | CSS selectors to leave out of the capture |
| `filter` | `(el) => boolean` | `null` | Keep-predicate (return `false` to drop a node) |
| `excludeMode` / `filterMode` | `'hide' \| 'remove'` | `'hide'` | How excluded nodes are handled |
| `clip` | `'viewport' \| {x, y, width, height}` | `null` | Capture only a region; offscreen content is pruned |
| `compress` | `boolean` | `true` | Downsample inlined images to their visible resolution (runs in a worker when available) |
| `useProxy` | `string` | `''` | CORS proxy prefix for cross-origin images |
| `fallbackURL` | `string \| fn` | — | Fallback image for broken `<img>` |
| `placeholders` | `boolean` | `true` | Show sized placeholders for resources that fail to load |
| `resolvePicturePlaceholders` | `boolean` | `true` | Resolve lazy-load placeholders (`data-src`…) and `<picture>` sources on the clone |
| `burst` | `boolean` | *auto* | Memoized repeat captures. Unset, it **auto-enables** after 3 captures of the same element within 2s; mutations, media, image/font loads, scroll, resize and animations invalidate automatically. `true` skips the warm-up; `false` opts out. Canvas-bearing elements never auto-enable |
| `invalidate` | `boolean` | `false` | With burst active, forces one fresh capture for changes automatic tracking can't see (canvas pixel draws, programmatic CSSOM edits) |
| `reconcile` | `boolean` | `false` | Measure the clone against the live DOM and pin any diverging box to its real size. Fixes rare text re-wrap/layout drift at roughly 2× capture time |
| `outerTransforms` | `boolean` | `true` | Keep root translate/rotate in the output |
| `outerShadows` | `boolean` | `false` | Expand bounds to include root shadows/blur/outline |
| `excludeStyleProps` | `RegExp \| fn` | — | Skip matching CSS properties when snapshotting (e.g. `/^--/`) |
| `cache` | `'disabled'` | *(structural)* | `'disabled'` (or `false`) opts out of every cache — a debug/testing switch. The legacy `'soft'`/`'auto'`/`'full'` strings are still accepted and map to the default behavior |
| `plugins` | `array` | — | Per-capture plugins (override globals by name) |
| `engine` | `'svg' \| 'canvas'` | `'svg'` | **Experimental**: `'canvas'` renders raster exports through the WICG canvas-place-element API when the browser supports it (native painter — form controls pixel-perfect); falls back to the SVG pipeline automatically |
| `debug` | `boolean` | `false` | Verbose diagnostics via `console.warn` |
| `fast` | `boolean` | — | **Obsolete** — accepted and ignored (the deferred-work path it controlled was removed) |

📖 **[Full API & every option, explained with examples → snapdom.dev/docs](https://snapdom.dev/docs/)**

## Limitations

* External images should be CORS-accessible (use `useProxy` option for handling CORS denied)
* When WebP format is used on Safari, it will fallback to PNG rendering.
* `@font-face` CSS rule is well supported, but if need to use JS `FontFace()`, see this workaround [`#43`](https://github.com/zumerlab/snapdom/issues/43)
* **Safari**: captures with `embedFonts` or background/mask images run slower due to [WebKit #219770](https://bugs.webkit.org/show_bug.cgi?id=219770) (font decode timing). SnapDOM does pre-captures + `drawImage` to prime the pipeline; configurable via `safariWarmupAttempts` (default 3).
* **Custom scrollbar styles** (`::-webkit-scrollbar`): Applied only when the element has *not* been scrolled. When scrolled, the viewport content is captured without the scrollbar.


## Performance Benchmarks

**Setup.** Vitest benchmarks on Chromium, repo tests. Hardware may affect results.
Values are **average capture time (ms)** → lower is better.

### Simple elements

| Scenario                 | SnapDOM current | SnapDOM v1.9.9 | html2canvas | html-to-image |
| ------------------------ | --------------- | -------------- | ----------- | ------------- |
| Small (200×100)          | **0.5 ms**      | 0.8 ms         | 67.7 ms     | 3.1 ms        |
| Modal (400×300)          | **0.5 ms**      | 0.8 ms         | 75.5 ms     | 3.6 ms        |
| Page View (1200×800)     | **0.5 ms**      | 0.8 ms         | 114.2 ms    | 3.3 ms        |
| Large Scroll (2000×1500) | **0.5 ms**      | 0.8 ms         | 186.3 ms    | 3.2 ms        |
| Very Large (4000×2000)   | **0.5 ms**      | 0.9 ms         | 425.9 ms    | 3.3 ms        |


### Complex elements

| Scenario                 | SnapDOM current | SnapDOM v1.9.9 | html2canvas | html-to-image |
| ------------------------ | --------------- | -------------- | ----------- | ------------- |
| Small (200×100)          | **1.6 ms**      | 3.3 ms         | 68.0 ms     | 14.3 ms       |
| Modal (400×300)          | **2.9 ms**      | 6.8 ms         | 87.5 ms     | 34.8 ms       |
| Page View (1200×800)     | **17.5 ms**     | 50.2 ms        | 178.0 ms    | 429.0 ms      |
| Large Scroll (2000×1500) | **54.0 ms**     | 201.8 ms       | 735.2 ms    | 984.2 ms      |
| Very Large (4000×2000)   | **171.4 ms**    | 453.7 ms       | 1,800.4 ms  | 2,611.9 ms    |


### Run the benchmarks

```sh
git clone https://github.com/zumerlab/snapdom.git
cd snapdom
npm install
npm run test:benchmark
```


## Development

**Source layout:**
- `src/api/` – Public API (`snapdom`, `preCache`)
- `src/core/` – Capture pipeline, clone, prepare, plugins
- `src/modules/` – Images, fonts, pseudo-elements, backgrounds, SVG
- `src/exporters/` – toPng, toSvg, toBlob, etc.
- `dist/` – Build output (`snapdom.js`, `snapdom.mjs`, `preCache.mjs`, `plugins.mjs`)

**Build:**
```sh
git clone https://github.com/zumerlab/snapdom.git
cd snapdom
git checkout dev
npm install
npm run compile
```

**Test:**
```sh
npx playwright install   # Required for browser tests
npm test
npm run test:benchmark
```

For detailed guidelines, see [CONTRIBUTING](https://github.com/zumerlab/snapdom/blob/main/CONTRIBUTING.md).


## Contributors

<!-- CONTRIBUTORS:START -->
<p>
<a href="https://github.com/tinchox5" title="tinchox5"><img src="https://avatars.githubusercontent.com/u/11557901?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="tinchox5"/></a>
<a href="https://github.com/pdufour" title="pdufour"><img src="https://avatars.githubusercontent.com/u/1239145?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="pdufour"/></a>
<a href="https://github.com/FlavioLimaMindera" title="FlavioLimaMindera"><img src="https://avatars.githubusercontent.com/u/96424442?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="FlavioLimaMindera"/></a>
<a href="https://github.com/Jarvis2018" title="Jarvis2018"><img src="https://avatars.githubusercontent.com/u/36788851?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="Jarvis2018"/></a>
<a href="https://github.com/tarwin" title="tarwin"><img src="https://avatars.githubusercontent.com/u/646149?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="tarwin"/></a>
<a href="https://github.com/Amyuan23" title="Amyuan23"><img src="https://avatars.githubusercontent.com/u/25892910?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="Amyuan23"/></a>
<a href="https://github.com/kohaiy" title="kohaiy"><img src="https://avatars.githubusercontent.com/u/15622127?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="kohaiy"/></a>
<a href="https://github.com/airamhr9" title="airamhr9"><img src="https://avatars.githubusercontent.com/u/57371081?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="airamhr9"/></a>
<a href="https://github.com/jswhisperer" title="jswhisperer"><img src="https://avatars.githubusercontent.com/u/1177690?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="jswhisperer"/></a>
<a href="https://github.com/K1ender" title="K1ender"><img src="https://avatars.githubusercontent.com/u/146767945?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="K1ender"/></a>
<a href="https://github.com/mosuzi" title="mosuzi"><img src="https://avatars.githubusercontent.com/u/43341701?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="mosuzi"/></a>
<a href="https://github.com/17biubiu" title="17biubiu"><img src="https://avatars.githubusercontent.com/u/13295895?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="17biubiu"/></a>
<a href="https://github.com/av01d" title="av01d"><img src="https://avatars.githubusercontent.com/u/6247646?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="av01d"/></a>
<a href="https://github.com/CHOYSEN" title="CHOYSEN"><img src="https://avatars.githubusercontent.com/u/25995358?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="CHOYSEN"/></a>
<a href="https://github.com/pedrocateexte" title="pedrocateexte"><img src="https://avatars.githubusercontent.com/u/207524750?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="pedrocateexte"/></a>
<a href="https://github.com/claude" title="claude"><img src="https://avatars.githubusercontent.com/u/81847?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="claude"/></a>
<a href="https://github.com/domialex" title="domialex"><img src="https://avatars.githubusercontent.com/u/4694217?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="domialex"/></a>
<a href="https://github.com/elliots" title="elliots"><img src="https://avatars.githubusercontent.com/u/622455?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="elliots"/></a>
<a href="https://github.com/stypr" title="stypr"><img src="https://avatars.githubusercontent.com/u/6625978?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="stypr"/></a>
<a href="https://github.com/mon-jai" title="mon-jai"><img src="https://avatars.githubusercontent.com/u/91261297?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="mon-jai"/></a>
<a href="https://github.com/puneetdixit200" title="puneetdixit200"><img src="https://avatars.githubusercontent.com/u/236133619?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="puneetdixit200"/></a>
<a href="https://github.com/RinZ27" title="RinZ27"><img src="https://avatars.githubusercontent.com/u/222222878?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="RinZ27"/></a>
<a href="https://github.com/sharuzzaman" title="sharuzzaman"><img src="https://avatars.githubusercontent.com/u/7421941?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="sharuzzaman"/></a>
<a href="https://github.com/simon1uo" title="simon1uo"><img src="https://avatars.githubusercontent.com/u/60037549?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="simon1uo"/></a>
<a href="https://github.com/titoBouzout" title="titoBouzout"><img src="https://avatars.githubusercontent.com/u/64156?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="titoBouzout"/></a>
<a href="https://github.com/ZiuChen" title="ZiuChen"><img src="https://avatars.githubusercontent.com/u/64892985?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="ZiuChen"/></a>
<a href="https://github.com/adajoy" title="adajoy"><img src="https://avatars.githubusercontent.com/u/26210079?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="adajoy"/></a>
<a href="https://github.com/hjl12345" title="hjl12345"><img src="https://avatars.githubusercontent.com/u/170017602?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="hjl12345"/></a>
</p>
<!-- CONTRIBUTORS:END -->

## Sponsors

Special thanks to [@megaphonecolin](https://github.com/megaphonecolin), [@sdraper69](https://github.com/sdraper69), [@reynaldichernando](https://github.com/reynaldichernando), [@gamma-app](https://github.com/gamma-app), [@jrjohnson](https://github.com/jrjohnson), and [@ryanander](https://github.com/ryanander) for supporting this project!

If you'd like to support this project too, you can [become a sponsor](https://github.com/sponsors/tinchox5).

## Show your support

If SnapDOM saved you time, a ⭐ on GitHub helps other developers find it — that's the whole ask.

Shipping something built with SnapDOM? Add the badge to your README:

[![Built with SnapDOM](https://img.shields.io/badge/built%20with-SnapDOM-blue)](https://snapdom.dev)

```md
[![Built with SnapDOM](https://img.shields.io/badge/built%20with-SnapDOM-blue)](https://snapdom.dev)
```

### Projects using SnapDOM

SnapDOM runs in production across 290+ public repositories ([GitHub dependents graph](https://github.com/zumerlab/snapdom/network/dependents)). A few notable ones, each verified from its own `package.json`:

- [LobeHub](https://github.com/lobehub/lobehub) — platform for operating AI agents
- [Trilium Notes](https://github.com/TriliumNext/Trilium) — hierarchical personal knowledge base
- [Sealos](https://github.com/labring/sealos) — AI-native cloud operating system
- [Tencent tmagic-editor](https://github.com/Tencent/tmagic-editor) — low-code page editor
- [Playroom](https://github.com/seek-oss/playroom) — JSX design tool by SEEK
- [GPT-Vis](https://github.com/antvis/GPT-Vis) — AI-friendly data viz by Ant Group's AntV
- [Rabby Wallet](https://github.com/RabbyHub/Rabby) — browser wallet for EVM chains
- [uMap](https://github.com/umap-project/umap) — OpenStreetMap map builder
- [ListenBrainz](https://github.com/metabrainz/listenbrainz-server) — music tracker by MetaBrainz
- [SnapDIFF](https://zumerlab.com/snapdiff/) — in-browser visual regression testing *(by Zumerlab)*

See the full gallery at **[snapdom.dev/made-with](https://snapdom.dev/made-with/)**. Shipping SnapDOM? [Open a PR](https://github.com/zumerlab/snapdom/pulls) to add your project — real, verifiable projects only.

## License

MIT © Zumerlab
