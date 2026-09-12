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

**SnapDOM** is a next-generation **DOM Capture Engine**: the fast, modern alternative to **html2canvas**, **dom-to-image**, and **html-to-image**.  
It converts any DOM subtree into a self-contained representation that can be exported to SVG, PNG, JPG, WebP, Canvas, Blob, or **any custom format** through plugins. Ultra-fast, modular, extensible, and dependency-free.

> 📖 **[Documentation, guides & live demos → snapdom.dev](https://snapdom.dev)**

## Features

Full DOM capture with embedded styles, pseudo-elements and fonts; export to SVG, PNG, JPG, WebP, `canvas` or Blob. Ultra fast, dependency-free, and 100% based on standard Web APIs.

👉 **See the complete technical feature list in [FEATURES.md](FEATURES.md).**

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

- [Quick Start](#quick-start)
- [Features](#features)
- [Website & Live Demos](#website--live-demos)
- [Installation](#installation)
- [Build Outputs](#build-outputs)
- [Usage](#usage)
- [Documentation](#documentation): full API, Options, Plugins & Cache reference on [snapdom.dev/docs](https://snapdom.dev/docs/)
- [Limitations](#limitations)
- [Performance Benchmarks](#performance-benchmarks)
- [Development](#development)
- [Contributors](#contributors)
- [Sponsors](#sponsors)
- [Show your support](#show-your-support)
- [Acknowledgments](#acknowledgments)
- [License](#license)

## Installation

### NPM / Yarn (stable)

```bash
npm i @zumer/snapdom
yarn add @zumer/snapdom
```

### NPM / Yarn (dev builds)

The `@dev` tag is independent of `@latest` and can point to an older build.
Check the published versions before choosing a development build:

```bash
npm view @zumer/snapdom dist-tags
```

Install `@dev` only when its listed version is the one you intend to test:

```bash
npm i @zumer/snapdom@dev
yarn add @zumer/snapdom@dev
```

`@dev` does not identify the v3 beta. Until v3 is published, use its local checkout;
when a beta is available, install its explicit version or announced tag.


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
```

**Official plugins** live in their own package:
```bash
npm install @zumer/snapdom-plugins
```
```js
import { filter } from '@zumer/snapdom-plugins/filter';
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
- SnapDOM relies on Canvas, which enforces strict CORS policies. The browser's rendering engine is more permissive for on‑screen display.

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

The full reference lives on **[snapdom.dev/docs](https://snapdom.dev/docs/)**, kept there so it stays in sync and searchable:

- **[API reference](https://snapdom.dev/docs/api/)**: the `snapdom()` reusable object, shortcut methods, and exporter-specific options.
- **[Options](https://snapdom.dev/docs/options/)**: every capture option (`scale`, `dpr`, `embedFonts`, `useProxy`, `exclude`/`filter`, `compress`, `outerTransforms`, `outerShadows`, `cache`…) explained with examples.
- **[Plugins](https://snapdom.dev/docs/plugins/)**: build, register and ship custom plugins and export formats. Browse community plugins on the [plugins page](https://snapdom.dev/plugins.html).
- **[Cache & preCache](https://snapdom.dev/docs/cache/)**: control caching between captures and preload resources.

Popular guides: **[convert HTML to PNG](https://snapdom.dev/how-to/html-to-png/)** · **[tile a full-page capture](https://snapdom.dev/blog/huge-page-mosaic/)** · **[run SnapDOM from Playwright or Puppeteer](https://snapdom.dev/blog/dom-capture-boundaries/)** · **[how SnapDOM captures the DOM](https://snapdom.dev/blog/painting-without-canvas/)**

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
| `embedFonts` | `boolean` | `false` | Inline `@font-face` so text renders with your real fonts |
| `iconFonts` | `string \| RegExp \| array` | `[]` | Icon font families (always embedded) |
| `localFonts` | `array` | `[]` | Explicit fonts: `{ family, src, weight?, style? }` |
| `excludeFonts` | `object` | none | Skip fonts by family / domain / subset |
| `exclude` | `string[]` | `[]` | CSS selectors to leave out of the capture |
| `filter` | `(el) => boolean` | `null` | Keep-predicate (return `false` to drop a node) |
| `excludeMode` / `filterMode` | `'hide' \| 'remove'` | `'hide'` | How excluded nodes are handled |
| `clip` | `'viewport' \| {x, y, width, height}` | `null` | Capture only a region; offscreen content is pruned |
| `compress` | `boolean` | `true` | Downsample inlined images to their visible resolution |
| `useProxy` | `string` | `''` | CORS proxy prefix for cross-origin images |
| `fallbackURL` | `string \| fn` | none | Fallback image for broken `<img>` |
| `cache` | `'soft' \| 'auto' \| 'full' \| 'disabled'` | `'soft'` | Cache policy between captures |
| `outerTransforms` | `boolean` | `true` | Keep root translate/rotate in the output |
| `outerShadows` | `boolean` | `false` | Expand bounds to include root shadows/blur/outline |
| `fast` | `boolean` | `true` | Skip idle delays for faster capture |
| `reconcile` | `boolean` | `false` | Measure the clone against the live DOM and pin any diverging box to its real size. Fixes rare text re-wrap/layout drift at the cost of roughly doubling capture time. snapdom warns once (`console.warn`) if it detects a capture that could benefit from it |
| `burst` | `boolean` | `false` | Memoizes repeated captures of this element via a scoped MutationObserver, so an unchanged repeat skips the pipeline entirely. Without it, snapdom warns once if the same element is captured 3+ times within 2s |
| `invalidate` | `boolean` | `false` | With `burst: true`, forces a fresh capture for changes automatic tracking can't see (canvas draws, programmatic CSSOM edits) |
| `plugins` | `array` | none | Per-capture plugins (override globals by name) |

📖 **[Full API & every option, explained with examples → snapdom.dev/docs](https://snapdom.dev/docs/)**

## Limitations

* External images should be CORS-accessible (use `useProxy` option for handling CORS denied)
* When WebP format is used on Safari, it will fallback to PNG rendering (verified on Safari 26.5: `canvas.toDataURL('image/webp')` returns PNG). `download()` keeps the `.webp` filename, so the saved file carries PNG bytes.
* `@font-face` CSS rule is well supported. Fonts registered from JavaScript with `FontFace()` are *not* embedded automatically: list them in the `localFonts` option (`{ family, src }`), or use the workaround in [`#43`](https://github.com/zumerlab/snapdom/issues/43)
* **Safari**: captures with `embedFonts` or background/mask images run slower due to [WebKit #219770](https://bugs.webkit.org/show_bug.cgi?id=219770) (font decode timing). SnapDOM waits for the fonts the element actually uses and verifies the first canvas draw, so there is nothing to configure.
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
<a href="https://github.com/ninecc" title="ninecc"><img src="https://avatars.githubusercontent.com/u/18310590?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="ninecc"/></a>
<a href="https://github.com/17biubiu" title="17biubiu"><img src="https://avatars.githubusercontent.com/u/13295895?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="17biubiu"/></a>
<a href="https://github.com/av01d" title="av01d"><img src="https://avatars.githubusercontent.com/u/6247646?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="av01d"/></a>
<a href="https://github.com/CHOYSEN" title="CHOYSEN"><img src="https://avatars.githubusercontent.com/u/25995358?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="CHOYSEN"/></a>
<a href="https://github.com/pedrocateexte" title="pedrocateexte"><img src="https://avatars.githubusercontent.com/u/207524750?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="pedrocateexte"/></a>
<a href="https://github.com/claude" title="claude"><img src="https://avatars.githubusercontent.com/u/81847?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="claude"/></a>
<a href="https://github.com/domialex" title="domialex"><img src="https://avatars.githubusercontent.com/u/4694217?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="domialex"/></a>
<a href="https://github.com/stypr" title="stypr"><img src="https://avatars.githubusercontent.com/u/6625978?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="stypr"/></a>
<a href="https://github.com/mon-jai" title="mon-jai"><img src="https://avatars.githubusercontent.com/u/91261297?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="mon-jai"/></a>
<a href="https://github.com/puneetdixit200" title="puneetdixit200"><img src="https://avatars.githubusercontent.com/u/236133619?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="puneetdixit200"/></a>
<a href="https://github.com/RexSkz" title="RexSkz"><img src="https://avatars.githubusercontent.com/u/27483702?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="RexSkz"/></a>
<a href="https://github.com/RinZ27" title="RinZ27"><img src="https://avatars.githubusercontent.com/u/222222878?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="RinZ27"/></a>
<a href="https://github.com/sharuzzaman" title="sharuzzaman"><img src="https://avatars.githubusercontent.com/u/7421941?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="sharuzzaman"/></a>
<a href="https://github.com/simon1uo" title="simon1uo"><img src="https://avatars.githubusercontent.com/u/60037549?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="simon1uo"/></a>
<a href="https://github.com/titoBouzout" title="titoBouzout"><img src="https://avatars.githubusercontent.com/u/64156?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="titoBouzout"/></a>
<a href="https://github.com/ZiuChen" title="ZiuChen"><img src="https://avatars.githubusercontent.com/u/64892985?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="ZiuChen"/></a>
<a href="https://github.com/adajoy" title="adajoy"><img src="https://avatars.githubusercontent.com/u/26210079?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="adajoy"/></a>
</p>
<!-- CONTRIBUTORS:END -->

## Sponsors

Special thanks to [@megaphonecolin](https://github.com/megaphonecolin), [@sdraper69](https://github.com/sdraper69), [@reynaldichernando](https://github.com/reynaldichernando), [@gamma-app](https://github.com/gamma-app), [@jrjohnson](https://github.com/jrjohnson), and [@ryanander](https://github.com/ryanander) for supporting this project!

If you'd like to support this project too, you can [become a sponsor](https://github.com/sponsors/tinchox5).

## Show your support

If SnapDOM saved you time, a ⭐ on GitHub helps other developers find it. That's the whole ask.

Shipping something built with SnapDOM? Add the badge to your README:

[![Built with SnapDOM](https://img.shields.io/badge/built%20with-SnapDOM-blue)](https://snapdom.dev)

```md
[![Built with SnapDOM](https://img.shields.io/badge/built%20with-SnapDOM-blue)](https://snapdom.dev)
```

### Projects using SnapDOM

SnapDOM runs in production across 250+ public repositories ([GitHub dependents graph](https://github.com/zumerlab/snapdom/network/dependents)). A few notable ones, each verified from its own `package.json`:

- [LobeHub](https://github.com/lobehub/lobehub): platform for operating AI agents
- [Trilium Notes](https://github.com/TriliumNext/Trilium): hierarchical personal knowledge base
- [Sealos](https://github.com/labring/sealos): AI-native cloud operating system
- [Tencent tmagic-editor](https://github.com/Tencent/tmagic-editor): low-code page editor
- [Playroom](https://github.com/seek-oss/playroom): JSX design tool by SEEK
- [GPT-Vis](https://github.com/antvis/GPT-Vis): AI-friendly data viz by Ant Group's AntV
- [Rabby Wallet](https://github.com/RabbyHub/Rabby): browser wallet for EVM chains
- [uMap](https://github.com/umap-project/umap): OpenStreetMap map builder
- [ListenBrainz](https://github.com/metabrainz/listenbrainz-server): music tracker by MetaBrainz
- [Mind Elixir](https://github.com/SSShooter/mind-elixir-core): mind-map core; recommends SnapDOM for image export
- [Kong UI Components](https://github.com/Kong/public-ui-components): Kong's dashboard renderer exports PDFs with SnapDOM
- [SnapDIFF](https://zumerlab.com/snapdiff/): in-browser visual regression testing *(by Zumerlab)*

See the full gallery at **[snapdom.dev/made-with](https://snapdom.dev/made-with/)**. Shipping SnapDOM? [Open a PR](https://github.com/zumerlab/snapdom/pulls) to add your project. Real, verifiable projects only.

## Acknowledgments

Thanks to [Anthropic](https://claude.com/contact-sales/claude-for-oss) and [OpenAI](https://openai.com/form/codex-for-oss/) for supporting my open-source work by providing premium access to Claude and ChatGPT.

## License

MIT © Zumerlab


## 🌐 Web Resources & Interactive Index
- [ROYAL GARDEN MATCH 2](https://mindworld-ko.pages.dev/royal-garden-match-2.html)
- [TILEMAN IO](https://themindconvert.web.app/tileman-io.html)
- [CATEGORY CONTROLLER59](https://learnquest-ru.pages.dev/category-controller59.html)
- [DOGS VS ALIENS](https://mindconvertpt.pages.dev/dogs-vs-aliens.html)
- [CATEGORY LOGIC538](https://studyarcade-vi.pages.dev/category-logic538.html)
- [MATH CROSSWORD PUZZLE GENIUS EDITION](https://mindconvert.pages.dev/math-crossword-puzzle-genius-edition.html)
- [NOOB SAVING FRIENDS](https://brainquestsjp.pages.dev/noob-saving-friends.html)
- [BLOCK DIGGER](https://mindconvert.pages.dev/block-digger.html)
- [CATEGORY CONTROLLER 2](https://mindconvert.pages.dev/category-controller-2.html)
- [SQUID CHALLENGE PLAY TO SURVIVE](https://mindconvert.pages.dev/squid-challenge-play-to-survive.html)
- [POLICE STATION](https://mindconvertes.pages.dev/police-station.html)
- [KRAKAX COM](https://mindconvert.pages.dev/krakax-com.html)
- [SCARY BABY YELLOW GAME](https://studyquest-ja.pages.dev/scary-baby-yellow-game.html)
- [CAR PARKING SIMULATOR](https://theeduquestgarden-ko.pages.dev/car-parking-simulator.html)
- [BOARD KINGS BOARD DICE](https://studyarcade-vi.pages.dev/board-kings-board-dice.html)
- [CATEGORY POOL17](https://eduquest-ko.pages.dev/category-pool17.html)
- [THEO MORINIS MAGICAL RESORT](https://mindconvert.pages.dev/theo-morinis-magical-resort.html)
- [BOAT MANIA](https://smartquest-es.pages.dev/boat-mania.html)
- [INDEX4](https://mindconvert.netlify.app/index4.html)
- [CATEGORY THINKY 2](https://mindconvertfr.pages.dev/category-thinky-2.html)
- [WORM HUNT](https://brainquestsjp.pages.dev/worm-hunt.html)
- [SHANGHAI CHEF](https://mindconvertfr.pages.dev/shanghai-chef.html)
- [DOLLYS RESTAURANT ORGANIZING](https://mindconvert.pages.dev/dollys-restaurant-organizing.html)
- [FRUIT JAM](https://learnplay-pt.pages.dev/fruit-jam.html)
- [KLONDIKE SOLITAIRE](https://brainquestsjp.pages.dev/klondike-solitaire.html)
- [CATEGORY CASUAL 6](https://studyquest-ja.pages.dev/category-casual-6.html)
- [INDEX17](https://learnquest-ru.pages.dev/index17.html)
- [CATEGORY MONSTER206](https://skillquest-en.pages.dev/category-monster206.html)
- [CATEGORY FARMING](https://eduplay-es.pages.dev/category-farming.html)
- [CELEBRITIES GET READY FOR CHRISTMAS](https://mindconvertfr.pages.dev/celebrities-get-ready-for-christmas.html)
- [CUBE CONNECT](https://studyquest-ja.pages.dev/cube-connect.html)
- [WORDS MATCH](https://eduquest-ko.pages.dev/words-match.html)
- [FISH LOVE PINS](https://skillquest-en.pages.dev/fish-love-pins.html)
- [CATEGORY TURN BASED30](https://studyquest-ja.pages.dev/category-turn-based30.html)
- [MINETAP MERGE CLICKER](https://eduquest-ko.pages.dev/minetap-merge-clicker.html)
- [MAGIC BUBBLES](https://brainquestsjp.pages.dev/magic-bubbles.html)
- [PHONE CASE DIY RUN](https://mindquest-zh.pages.dev/phone-case-diy-run.html)
- [TILE HEXA SORT](https://learnplay-pt.pages.dev/tile-hexa-sort.html)
- [FISH MASTER GO FISH](https://eduquest-ko.pages.dev/fish-master-go-fish.html)
- [CATEGORY LOVE12](https://skillquest-en.pages.dev/category-love12.html)
- [COOKING EMPIRE](https://eduquest-ko.pages.dev/cooking-empire.html)
- [CATEGORY DISCORD](https://playandlearn-fr.pages.dev/category-discord.html)
- [INDEX39](https://mindconvert.pages.dev/index39.html)
- [COSMO PET STARRY CARE](https://eduquest-ko.pages.dev/cosmo-pet-starry-care.html)
- [CATEGORY BATTLE ROYALE GAMES](https://mindconvertes.pages.dev/category-battle-royale-games.html)
- [HIDDEN OBJECT EMILYS CASE](https://thelearningarcades.pages.dev/hidden-object-emilys-case.html)
- [INDEX7](https://mindconvert.pages.dev/index7.html)
- [CITY BANANA MAN AGENT](https://mindquest-zh.pages.dev/city-banana-man-agent.html)
- [LINK COLOR PICTURES](https://mindconvertpt.pages.dev/link-color-pictures.html)
- [ANIMAL SORT CUTE PUZZLE GAME](https://mindconvertfr.pages.dev/animal-sort-cute-puzzle-game.html)
- [8 BALL POOL BILLIARDS MULTIPLAYER](https://mindquest-zh.pages.dev/8-ball-pool-billiards-multiplayer.html)
- [CATEGORY MOBILE2 112](https://thebrainquests9.pages.dev/category-mobile2-112.html)
- [RICH CHOICE RUN](https://mindconvertfr.pages.dev/rich-choice-run.html)
- [COOKING STORIES FUN CAFE GAME](https://mindconvertfr.pages.dev/cooking-stories-fun-cafe-game.html)
- [INDEX20](https://eduplay-es.pages.dev/index20.html)
- [MATCH MASTERS](https://mindconvertfr.pages.dev/match-masters.html)
- [PAINT ROLLER](https://thestudyarcades9.pages.dev/paint-roller.html)
- [CATEGORY RUNNING](https://studyarcade-vi.pages.dev/category-running.html)
- [GIANT WANTED MONSTER](https://mindconvertpt.pages.dev/giant-wanted-monster.html)
- [PIXEL BLAST](https://brainquestsjp.pages.dev/pixel-blast.html)
- [ITALIAN ANIMAL ALCHEMY BRAINROT](https://eduquest-ko.pages.dev/italian-animal-alchemy-brainrot.html)
- [WORM HUNT](https://mindconvertfr.pages.dev/worm-hunt.html)
- [SORT GAME TOY SORT](https://thelearnplays9.pages.dev/sort-game-toy-sort.html)
- [CATEGORY COLLECT566](https://mindconvert.pages.dev/category-collect566.html)
- [CATEGORY MOUSE1 697](https://themindfactorys.pages.dev/category-mouse1-697.html)
- [FREECELL](https://mindconvertpt.pages.dev/freecell.html)
- [JAIL PRISON VAN POLICE GAME](https://brainquest-hi.pages.dev/jail-prison-van-police-game.html)
- [HOLE DEFENSE](https://thelearnplays9.pages.dev/hole-defense.html)
- [CATEGORY CUTE62](https://mindconvertfr.pages.dev/category-cute62.html)
- [CATEGORY INTERSTELLARNETWORK](https://theeduquests9.pages.dev/category-interstellarnetwork.html)
- [MAHJONG ADVENTURE WORLD QUEST](https://mindconvertfr.pages.dev/mahjong-adventure-world-quest.html)
- [BELOTE 3IN1](https://mindconvert.pages.dev/belote-3in1.html)
- [BUILDING MODS FOR MINECRAFT](https://brainquest-hi.pages.dev/building-mods-for-minecraft.html)
- [IS IT RIGHT](https://brainquestsjp.pages.dev/is-it-right.html)
- [STRAWBERRY SHORTCAKE BOARDGAMES](https://thestudyquests9.pages.dev/strawberry-shortcake-boardgames.html)
- [CATEGORY CASUAL 9](https://thelearnplays9.pages.dev/category-casual-9.html)
- [ITALIAN BRAINROT QUIZ](https://themindquests9.pages.dev/italian-brainrot-quiz.html)
- [WAVE ROAD 3D](https://brainquestsjp.pages.dev/wave-road-3d.html)
- [CATEGORY BIKE 2](https://thelearningarcades.pages.dev/category-bike-2.html)
- [CATEGORY SANDBOX40](https://mindconvertes.pages.dev/category-sandbox40.html)
- [FANTASY MATH NUMBER](https://thestudyarcades9.pages.dev/fantasy-math-number.html)
- [LOL FUNNY DANCE](https://brainquestsjp.pages.dev/lol-funny-dance.html)
- [LOST PUPPY RESCUE AND CARE](https://brainquest-hi.pages.dev/lost-puppy-rescue-and-care.html)
- [CATEGORY MAKEUP](https://eduplay-es.pages.dev/category-makeup.html)
- [ANIMATION COLORING ALPHABET LORE](https://theeduquests9.pages.dev/animation-coloring-alphabet-lore.html)
- [TRIAL XTREME](https://themindfactorys.pages.dev/trial-xtreme.html)
- [BUBBLE MATCH MERGE](https://brainquestsjp.pages.dev/bubble-match-merge.html)
- [PHONE CASE DIY RUN](https://theknowledgequests9.pages.dev/phone-case-diy-run.html)
- [CATEGORY MATCH 3](https://mindconvertfr.pages.dev/category-match-3.html)
- [POPCORN FUN FACTORY](https://thestudyquests9.pages.dev/popcorn-fun-factory.html)
- [OMEGA LAYERS](https://theknowledgequests9.pages.dev/omega-layers.html)
- [RUN NOW](https://theknowledgequests9.pages.dev/run-now.html)
- [DESTRUCTION OF STICKMAN ZOMBIE](https://studyquest-ja.pages.dev/destruction-of-stickman-zombie.html)
- [INCREDIBLE PRINCESSES AND VILLAINS PUZZLE](https://brainquestsjp.pages.dev/incredible-princesses-and-villains-puzzle.html)
- [FARM BLAST](https://mindconvert.pages.dev/farm-blast.html)
- [COCKTAILZ](https://thestudyarcades-vi.pages.dev/cocktailz.html)
- [OBBY ESCAPE BARRYS JAIL PARKOUR](https://brainquestsjp.pages.dev/obby-escape-barrys-jail-parkour.html)
- [BACKGAMMON DUEL](https://mindconvertfr.pages.dev/backgammon-duel.html)
- [ROYAL PIN](https://mindconvert.pages.dev/royal-pin.html)
- [JAILBREAK ASSAULT](https://theknowledgequests9.pages.dev/jailbreak-assault.html)
- [UNSCREW WOOD PUZZLE](https://thestudyquests9.pages.dev/unscrew-wood-puzzle.html)
- [CATEGORY BUSINESS137](https://thelearnplays-pt.pages.dev/category-business137.html)
- [PUSHOVER 3D](https://skillquest-en.pages.dev/pushover-3d.html)
- [EASTER GLAMPING TRIP](https://theeduquests9.pages.dev/easter-glamping-trip.html)
- [MOTO RACE CITY](https://brainquestsjp.pages.dev/moto-race-city.html)
- [WOODEN BOLTS AND NUTS](https://mindquest-zh.pages.dev/wooden-bolts-and-nuts.html)
- [SORT MY PARKING AREA](https://learnplay-pt.pages.dev/sort-my-parking-area.html)
- [OCEAN POP](https://brainquestsjp.pages.dev/ocean-pop.html)
- [FURY OF THE STEAMPUNK PRINCESS](https://eduquest-ko.pages.dev/fury-of-the-steampunk-princess.html)
- [CATEGORY MATCH 3117](https://thelearningarcades.pages.dev/category-match-3117.html)
- [CATEGORY SIMULATION](https://brainquest-hi.pages.dev/category-simulation.html)
- [SISYPHUS SIMULATOR](https://mindconvertfr.pages.dev/sisyphus-simulator.html)
- [OBBY PRISON CRAFT ESCAPE](https://mindconvertfr.pages.dev/obby-prison-craft-escape.html)
- [IDLE INVENTOR](https://playandlearn-fr.pages.dev/idle-inventor.html)
- [CATEGORY MAHJONG 2](https://eduplay-es.pages.dev/category-mahjong-2.html)
- [COLOR NONOGRAM PUZZLE](https://mindquest-zh.pages.dev/color-nonogram-puzzle.html)
- [OBBY SURVIVE PARKOUR](https://eduquest-ko.pages.dev/obby-survive-parkour.html)
- [NUMBER TUBES](https://brainquestses.pages.dev/number-tubes.html)
- [TUNG TUNG SAHUR IN GEOMETRY DASH](https://mindquest-zh.pages.dev/tung-tung-sahur-in-geometry-dash.html)
- [CATEGORY BATTLE ROYALE25](https://thelearningarcades-en.pages.dev/category-battle-royale25.html)
- [INDEX5](https://eduquest-ko.pages.dev/index5.html)
- [BBQ STACK RUN](https://thestudyarcades9.pages.dev/bbq-stack-run.html)
- [CATEGORY SOLITAIRE27](https://learnplay-pt.pages.dev/category-solitaire27.html)
- [TUNG SAHUR BOTS CHASE ROOM](https://thelearningarcades-en.pages.dev/tung-sahur-bots-chase-room.html)
- [OHPEACH IT](https://themindfactorys.pages.dev/ohpeach-it.html)
- [3D MAZE CONTROL](https://mindconvertfr.pages.dev/3d-maze-control.html)
- [OUTSIDE](https://brainquestsjp.pages.dev/outside.html)
- [RAGDOLL MEGA DUNK](https://skillquest-en.pages.dev/ragdoll-mega-dunk.html)
- [BUBBLE SHOOTER WILD WEST](https://mindconvertfr.pages.dev/bubble-shooter-wild-west.html)
- [ANIMAL KLOTSKI](https://thestudyarcades-vi.pages.dev/animal-klotski.html)
