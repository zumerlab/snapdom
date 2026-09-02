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

v3 is a ground-up rework of the capture engine. The API shape is the same and v2 call sites keep working, but this is a **major release with real behavior changes**. Read [Migrating from v2](#migrating-from-v2) before upgrading a production capture.

**It's much faster, everywhere.**
- **First captures are up to 2× faster.** A one-time stylesheet scan tells the engine which CSS properties your page can actually use, so the per-node style snapshot reads ~50 properties instead of ~400 — the single biggest cost in any DOM capture.
- **Repeat captures are effectively free.** Capture the same element a few times and snapdom starts memoizing automatically: unchanged repeats return instantly, and when something *does* change, a **differential recapture** rebuilds only the mutated subtrees (~5× faster on mutating dashboards) with **byte-identical** output to a full capture.
- Invalidation is automatic and complete: DOM mutations, `<video>` frames, image and font loads, scroll, viewport resizes, `<head>` CSS changes, and CSS/WAAPI animations are all tracked. No API to learn, nothing to configure. Inlined images are also downsampled to their visible resolution automatically (codec-preserving, worker-offloaded).

**It's more faithful, by default.**
- **Web fonts embed automatically** (`embedFonts: 'auto'`). The SVG your capture rasterizes from can't see the page's loaded fonts — v2 silently rendered webfont text with fallback metrics unless you opted in. v3 detects webfont usage and embeds exactly what's needed; system-font pages pay nothing.
- **Safari, rewritten.** The hidden triple pre-capture warm-up is gone — replaced by a verified draw that waits exactly as long as WebKit needs (first captures ~2× faster). And `toSvg()` now returns actual **vector SVG** on Safari instead of silently rasterizing to PNG.
- **Per-capture state is isolated.** The mutable module-level session that caused cross-capture races is gone: state lives on a session object threaded through the pipeline, so that class of bug is structurally unrepresentable. `iconFonts` was the last exception and is now compiled per capture too, so concurrent captures with different lists no longer interleave.
- Outputs are smaller too: up to **27% lighter SVGs** from the same content.

**It's simpler.**
Options that required tuning knowledge tuned themselves out of the API: repeat-capture memoization and image compression are simply how the engine works now, `cache` collapsed to a single debug switch, and `fast` is gone. The best option is the one you never have to read about.

**And it's ready for what's next.**
An experimental `engine: 'canvas'` renders through the browser's own painter via the WICG canvas-place-element API (Chrome flag): native form controls pixel-perfect, zero SVG quirks. It is a peer of the default SVG engine, not a shortcut around it: both take the same finished clone, so plugins, `exclude` and `reconcile` apply either way. Chromium currently taints the canvas unconditionally, so there is no readback and every capture falls through to the normal pipeline; the engine is therefore **excluded from the published bundle** rather than shipped as bytes that cannot run. Build it in with `SNAPDOM_CANVAS_ENGINE=1 npm run compile`.

## Migrating from v2

Most v2 call sites keep working, and unknown options are ignored rather than rejected. These behaviors changed:

| Change | What to do |
| --- | --- |
| `embedFonts` defaults to `'auto'` (was off). Webfont text now embeds instead of rendering with fallback metrics. | Nothing, unless you relied on the fallback rendering: pass `embedFonts: false`. |
| `cache` collapsed to `'soft'` (default) and `'disabled'`. `'auto'` / `'full'` are accepted and silently mapped to `'soft'`. | Drop the option, or use `cache: 'disabled'` for debugging. |
| `fast` was removed. | Delete it; its behavior is now unconditional. |
| Repeat captures of the same element memoize automatically after three captures in a 2s window, and mutations trigger a differential recapture. | Nothing normally. For sources no observer can see (`sheet.insertRule()`, direct `rule.style.x` edits, canvas pixel draws) pass `invalidate: true`. |
| Inlined raster images are downsampled to their visible resolution by default. | Nothing. This preserves the source codec and never upscales. |
| **`width`/`height` now win over `scale`.** v2 multiplied them together (`{ width: 800, scale: 2 }` rasterized 1600px wide); v3 treats `width`/`height` as the absolute output size and applies `scale` only when neither is set. This also fixes v2's inconsistency where `toCanvas` multiplied by `scale` but `toImg`/`toSvg` ignored it. | If you relied on the product, pass the final size directly (`width: 1600`). |
| Plugins with a render hook suspend auto-memoization unless they declare `pure: true`. | Add `pure: true` if your hooks are deterministic and idempotent. |
| **`filter` and `filterMode` were removed and are no longer applied.** They were a second door to the same decision as `exclude`/`excludeMode`, with the opposite polarity (return true to KEEP). Passing one logs a warning rather than failing silently, because a redaction option that quietly stops redacting is the worst possible outcome. | Flip the predicate: `filter: el => keep(el)` becomes `exclude: el => !keep(el)`. `filterMode` becomes `excludeMode`. |
| Input values the browser paints in the clear (`email`, `tel`, `cc-*`, `one-time-code`) are now captured as-is. Core only masks `type="password"`, where the control already paints bullets so the mask costs no fidelity. | Add the `redactInputs` plugin from `@zumer/snapdom-plugins` if you want the old redaction. |

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
- [Migrating from v2](#migrating-from-v2)
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
| **CJS** | `dist/snapdom.cjs` | `require('@zumer/snapdom')` |
| **IIFE** (global) | `dist/snapdom.js` | Script tag, `window.snapdom` |

**Bundler (npm):**
```js
import { snapdom } from '@zumer/snapdom';  // → dist/snapdom.mjs
```

**Script tag (CDN):**
```html
<script src="https://unpkg.com/@zumer/snapdom/dist/snapdom.js"></script>
<script> snapdom.toPng(document.body).then(img => document.body.appendChild(img)); </script>
```

**Subpath imports** (the same single runtime, re-exported for convenience — one plugin registry, one cache, whichever path you import from):
```js
import { preCache } from '@zumer/snapdom/preCache';
import { registerPlugins, clearPlugins, getGlobalPlugins } from '@zumer/snapdom/plugins';
```
The plugin API is also exported from the root, and `snapdom.plugins(...)` registers globally:
```js
import { snapdom, registerPlugins } from '@zumer/snapdom';
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

The full reference lives on **[snapdom.dev/docs](https://snapdom.dev/docs/)**:

- **[API reference](https://snapdom.dev/docs/api/)** — the `snapdom()` reusable object, shortcut methods, and exporter-specific options.
- **[Options](https://snapdom.dev/docs/options/)** — every capture option (`scale`, `dpr`, `embedFonts`, `useProxy`, `exclude`, `compress`, `outerTransforms`, `outerShadows`, `cache`…) explained with examples.
- **[Plugins](https://snapdom.dev/docs/plugins/)** — build, register and ship custom plugins and export formats. Browse community plugins on the [plugins page](https://snapdom.dev/plugins.html).
- **[Cache & preCache](https://snapdom.dev/docs/cache/)** — control caching between captures and preload resources.

### API at a glance

`snapdom(el, options?)` returns a reusable object (`toPng`, `toSvg`, `toCanvas`, `toBlob`, `toJpg`, `toWebp`, `download`, `to(name)`, `toRaw()`, `url`, `meta`, `warnings`, `needs`). `meta` is the frozen render geometry (viewBox size, logical capture box, exact `contentX`/`contentY` origin, resolved clip window) that document exporters need to place things over the image. For single exports, use the shortcuts:

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
| `scale` | `number` | `1` | Output scale multiplier (applies only when neither `width` nor `height` is set — those are the absolute output size and win) |
| `dpr` | `number` | `devicePixelRatio` | Pixel density of the rasterized output |
| `width` / `height` | `number` | `null` | Target output size (keeps aspect ratio if only one is set) |
| `backgroundColor` | `string` | `null` (`#ffffff` for JPEG/WebP) | Background fill |
| `quality` | `number` | `0.92` | JPEG/WebP quality (0–1) |
| `format` | `'png' \| 'jpeg' \| 'webp' \| 'svg'` | `'png'` | Output format for every exporter (`toBlob()` defaults to `'svg'` unless you ask for a codec) |
| `filename` | `string` | `'snapDOM'` | Download filename |
| `embedFonts` | `boolean \| 'auto'` | `'auto'` | `'auto'` embeds web fonts only when the capture actually uses them (system-font pages skip the pass entirely). `true` forces the embed; `false` disables it |
| `iconFonts` | `string \| RegExp \| array` | `[]` | Icon font families (always embedded) |
| `localFonts` | `array` | `[]` | Explicit fonts: `{ family, src, weight?, style? }` — also the path for JS-registered `FontFace` objects |
| `excludeFonts` | `object` | — | Skip fonts by family / domain / subset |
| `fontStylesheetDomains` | `string[]` | — | Extra cross-origin domains to fetch font CSS from |
| `exclude` | `string \| (el) => boolean \| array of both` | `[]` | Nodes to leave out: selectors and/or predicates (return `true` to exclude) |
| `excludeMode` | `'hide' \| 'remove'` | `'hide'` | How excluded nodes leave (`hide` keeps layout via an invisible spacer) |
| `clip` | `'viewport' \| {x, y, width, height}` | `null` | Capture only a region; offscreen content is pruned |
| `useProxy` | `string` | `''` | CORS proxy prefix for cross-origin images |
| `fallbackURL` | `string \| fn` | — | Fallback image for broken `<img>` |
| `placeholders` | `boolean` | `true` | Show sized placeholders for resources that fail to load |
| `resolvePicturePlaceholders` | `boolean` | `true` | Resolve lazy-load placeholders (`data-src`…) and `<picture>` sources on the clone |
| `invalidate` | `boolean` | `false` | Forces one fresh (non-memoized) capture for changes automatic tracking can't see (canvas pixel draws, programmatic CSSOM edits) |
| `reconcile` | `boolean` | `false` | Measure the clone against the live DOM and pin any diverging box to its real size. Fixes rare text re-wrap/layout drift at roughly 2× capture time |
| `outerTransforms` | `boolean` | `true` | Keep root translate/rotate in the output |
| `outerShadows` | `boolean` | `false` | Expand bounds to include root shadows/blur/outline |
| `excludeStyleProps` | `RegExp \| fn` | — | Skip matching CSS properties when snapshotting (e.g. `/^--/`) |
| `cache` | `'disabled'` | *(structural)* | `'disabled'` (or `false`) opts out of every cache — a debug/testing switch. The legacy `'soft'`/`'auto'`/`'full'` strings are still accepted and map to the default behavior |
| `plugins` | `array` | — | Per-capture plugins (override globals by name). A plugin may declare `needs: 'clone' \| 'render'`, how far the capture has to run. Default `'render'`: the full pipeline. At `'clone'` there is no image and every export throws; `result.needs` says what ran |
| `engine` | `'svg' \| 'canvas'` | `'svg'` | **Experimental**: `'canvas'` renders raster exports through the WICG canvas-place-element API when the browser supports it (native painter, form controls pixel-perfect); falls back to the SVG pipeline automatically. Chromium taints the canvas today, so the engine is left out of the published bundle: build it in with `SNAPDOM_CANVAS_ENGINE=1 npm run compile` |
| `debug` | `boolean` | `false` | Verbose diagnostics via `console.warn` |

📖 **[Full API & every option, explained with examples → snapdom.dev/docs](https://snapdom.dev/docs/)**

## Limitations

* External images should be CORS-accessible (use `useProxy` option for handling CORS denied)
* When WebP format is used on Safari, it will fallback to PNG rendering.
* `@font-face` CSS rule is well supported, but if need to use JS `FontFace()`, see this workaround [`#43`](https://github.com/zumerlab/snapdom/issues/43)
* **Safari**: the first canvas draw of an SVG carrying embedded fonts or images can be blank ([WebKit #219770](https://bugs.webkit.org/show_bug.cgi?id=219770)). SnapDOM handles it at draw time with a verified-draw ink probe — no warmup, no knob; first captures just take a few extra frames when WebKit needs them.
* **Custom scrollbar styles** (`::-webkit-scrollbar`): Applied only when the element has *not* been scrolled. When scrolled, the viewport content is captured without the scrollbar.


## Performance Benchmarks

Every library here is timed to the **same finish line — a PNG data URL** — with its own
defaults, at scale 1, on a pinned version. That rule is the whole point: SnapDOM's `toRaw`
returns an SVG url and skips rasterization and encoding, and on a large scene that step is
roughly half the total cost. Comparing it against someone else's finished PNG is how a table
comes out flattering whoever published it.

**Setup.** Chromium via Playwright, headless, DPR 1, Apple Silicon. The steady-state table is
the **median of four full runs**; the scene rows are one run each of their benchmark file. All
in milliseconds — lower is better. Absolute values move with your CPU and browser; the ratios
are the part worth quoting.

> **Run it yourself:** [snapdom.dev/compare/live](https://snapdom.dev/compare/live/) runs this
> exact comparison in your own browser — same adapters, same scenes, same oracle — and prints
> a table you can paste into an issue. The SnapDOM row is labelled with the version it loaded:
> the published lab runs the published package, so until the v3 beta is on npm those rows are
> v2, and the numbers below need the lab served by `npm run site`, which loads the local build.

### Steady state — re-capturing the same element

| Library | Complex card | Table, 500 rows | Simple node (1200×800) |
| --- | --- | --- | --- |
| **SnapDOM** | **10.0** | **130.1** | **11.1** |
| domlens.js 0.1.0 | 17.4 | 194.1 | 133.4 |
| modern-screenshot 4.7.0 | 30.5 | 579.9 | 12.2 |
| dom-to-image-more 3.10.2 | 30.4 | 683.9 | 16.9 |
| html-to-image 1.11.13 | 50.2 | 1,443.1 | 17.1 |
| html2canvas 1.4.1 | 82.5 | 365.0 | 89.2 |
| @renoun/screenshot 0.3.3 | 145.5 | 641.6 | 77.5 |
| dom-to-image 2.6.0 | 154.9 | 1,041.5 | 131.7 |
| dom-to-image-modern 1.0.2 | 156.5 | 928.2 | 129.6 |

SnapDOM is first in all three. The big table is a 1.49× lead over domlens; the previous table
had it at 1.05×, and the one before that had domlens ahead by 1.05×. Of the 53 ms the cell moved
this time, about 25 are the harness route (rule 1 below: SnapDOM's arm no longer pays an `<img>`
load no other arm paid) and the rest is code — the identity-share gate and the narrowed
inline-style pass. The simple node is the cell to read with care: 11.1 against
modern-screenshot's 12.2 is 1.10×, but the scene has almost nothing to capture (SnapDOM's
pipeline is 0.3 ms of it) and mostly prices the ~9.5 ms PNG encode everyone shares, so the
order can still flip between runs. The complex card is 1.74×.

### Real-world scenes

| Scene | SnapDOM | Next fastest | Rest of the field |
| --- | --- | --- | --- |
| CSS-heavy page — 10k author rules, 240 class-styled cards | **125.4** | domlens 137.8 | modern-screenshot 288.3 · dom-to-image-more 344.3 · html-to-image 586.1 |
| Shadow DOM — 150 open roots, 3 levels, ~3k nodes | **12.0** | domlens 65.3 | modern-screenshot 104.2 · html2canvas 140.0 · dom-to-image-more 168.1 · html-to-image 646.1 |
| Web fonts — article with Inter 400/700 + mono spans | **10.7** | modern-screenshot 23.1 | dom-to-image-more 25.0 · html-to-image 41.5 |
| Image grid — 40 same-origin PNGs fetched over HTTP | **52.1** | dom-to-image-more 59.7 | html-to-image 60.9 · domlens 66.5 · modern-screenshot 68.1 |
| Photo gallery — 9 photos, 16 Mpx of sources, 960px wide | **61.8** | html2canvas 72.3 | html-to-image 244.6 · dom-to-image-more 426.6 · modern-screenshot 628.7 · domlens 841.6 |
| Polling — 20 captures of a live dashboard | **18.6** | modern-screenshot 109.1 | dom-to-image-more 333.3 · domlens 470.4 |
| Deep nested tree — 16 chains × 10 levels, ~2,100 nodes, a `::before` stripe on every leaf | **295.5** | html2canvas 708.4 | domlens 1,106.0 · modern-screenshot 1,280.3 · html-to-image 2,240.1 |

Polling is the one row where SnapDOM runs with its **defaults**, memoization on: a dashboard
that re-captures the same element every tick is exactly what auto-burst and differential
recapture exist for. Without the memo (`burst: false`) the same loop costs 24.7 ms — the memo
is worth 1.33× here, not the order of magnitude an unrasterized comparison would suggest,
because every tick still pays the raster and the PNG encode.

CSS-heavy is a 1.10× lead over domlens, and the image grid is closer than it looks: with 40 real
HTTP images, everyone waits on the same fetches. The grid is in the table because the scenes
where SnapDOM does *not* pull far ahead are the ones worth knowing about — and the photo
gallery is a tie with html2canvas, for a reason worth spelling out. A 3000×1400 hero and eight
1500×1000 thumbnails shown at 960×360 and 232×130 are 16 Mpx of sources for 0.6 Mpx of output.
Every `<foreignObject>` library has to inline them into the SVG; SnapDOM downsamples each one to
the resolution the output can show (a 4 MB payload instead of 26 MB) and memoizes the result per
image, which is why the steady number is 61.8 while the libraries that embed the sources whole
pay the raster of 26 MB. html2canvas never inlines anything: it paints the images the browser has
already decoded for the page, straight onto its canvas, and that is as cheap as it gets. The
first capture of such a page is where the two approaches differ most; the real-page table below
has that number.

**The deep tree was the one SnapDOM lost outright — by 2.15×, to html2canvas, the oldest and
slowest library in every other row — until the raster stage was split; and it stayed the closest
row until the scene got the one thing every real page has.** The scene is borrowed
from domlens's own benchmark corpus, and their README diagnoses the mechanism honestly: on a
capture that large, most of the time is the browser rasterizing a multi-megapixel SVG image, not
anything the library does. Every `<foreignObject>` implementation pays it, and html2canvas, which
paints boxes onto a canvas and never builds that image, does not. Decomposed by stage, SnapDOM's
pipeline produces the SVG url in ~53 ms and the PNG encode is ~30 ms; the single `drawImage` of
the 1232×13572 image took **517 ms**, with none of our code running — and the bill is not linear
in pixels. The same document rendered at 1× / 0.5× / 0.25× the pixels takes 547 / 147 / 51 ms, but
a *smaller* document at the same 4.2 Mpx takes 39 ms.

What changed is that the exporter no longer asks Chromium for that one draw. Above 4 Mpx it draws
the decoded image in horizontal bands with source rects into the same canvas: 8 bands take
**123 ms** where the single draw took 517, pixel-identical up to the 256px tile seams of
Chromium's own one-shot raster (68 of 16.7M pixels, one grey level each). It is one decode, so it
is not the `crop` option, which rewrites the viewBox and re-decodes the svg per window and got
worse past 4 slices. Real Safari goes 153 → 94 ms through the same path; Firefox has no
nonlinearity and is unchanged. That took the row from 656 to 240.9 against html2canvas's 303.8,
with the scene as bare boxes — nested flex and grid with a number in each leaf. Bare boxes are
the one input a JavaScript repainter handles best, and no real page is made of them, so the
scene now carries a 2px `::before` stripe on every leaf: `content:""`, a solid colour, the
cheapest decoration there is. With it html2canvas's output is 7.2% off a screenshot of the live
element (SnapDOM 0.06%, domlens 0.06%) and its time goes from 299 to 708 ms, while SnapDOM
inlines the 1,936 stripes for about 50 ms: **295.5 against 708.4**, 2.4×. That pass used to
cost 150 µs per pseudo — it would have been 290 ms here — and costs 24 now: a document-wide
`querySelectorAll` that ran once per node, a 400-property read per pseudo where ~45 can
differ from the defaults, and a defaults table missing the five properties Chromium never
enumerates, so every class rule carried them. Below this shape the gap widens the same way — at
1, 2 and 4 chains the bare scene is 11 / 24 / 64 ms against html2canvas's 74 / 87 / 115 ms.

### Cold vs steady — per element

The number a one-shot user actually experiences is the **first** capture of an element, not the
fifth. Fresh element every iteration, big table, PNG for everyone:

| Arm | ms |
| --- | --- |
| SnapDOM — fresh element each capture | **180.1** |
| domlens.js — fresh element each capture | 211.6 |
| modern-screenshot — fresh element each capture | 592.8 |
| *SnapDOM — same element re-captured, for reference* | *127.4* |

SnapDOM is 1.17× ahead cold. The previous table had domlens ahead by 1.03×, and the one before
by 1.10×. Part of the move is the harness route — about 25 ms of a 7.7 Mpx capture was the
`<img>` load and the asynchronous blob route above 2 Mpx, which no other arm paid — and part is
the pipeline. The larger cold change is not in this table at all, because this page is bare: on
a real page with its own stylesheet the identity share used to switch itself off (see the host
CSS note below), and that is where cold captures were losing 80 ms.

### On a real page

Everything above runs in a bare harness page. A real page has its own stylesheets, fonts and
scripts, and they cost every library something — and used to cost SnapDOM more than most: a
single author `::before` rule, or a `.btn:hover`, anywhere in the document switched off two of
its fast paths for the whole capture (see the note at the end of this section). This table is
the same comparison run inside the docs site's own `/compare/` page, **per-element cold** — the
scene is mounted fresh for every capture, with unique content, so nothing is served from a
cache: the number a one-shot user actually experiences. Same rules, same adapters, five
captures per cell, median.

| Scene (per-element cold, docs page) | SnapDOM | domlens 0.1.0 | html2canvas 1.4.1 | modern-screenshot 4.7.0 | html-to-image 1.11.13 |
| --- | --- | --- | --- | --- | --- |
| Table, 500 rows (640×17312) | **191.1** | 275.0 | 375.7 | 599.0 ¹ | 1,450.1 ¹ |
| Deep nested tree (1232×15506) | **442.9** | 1,192.7 | 739.4 | 1,227.2 | 2,181.7 |
| Photo gallery (960×654) | 208.3 | 1,112.6 | **185.7** | 590.8 | 573.6 |

¹ Output a different size from everyone else's (modern-screenshot 640×17311, html-to-image
605×16384: it hits the 16384px canvas limit and downscales), so the cell is not comparable.

The table is SnapDOM's by 1.44× over domlens and the deep tree by 1.67× over html2canvas,
whose output there is 7% off the live element. The gallery goes to html2canvas, on a real page,
cold, and the reason is architectural: it never inlines a picture. On the deep tree SnapDOM's
first-capture pipeline is 184 ms (108 ms on the second capture of the same element, the 1,936
pseudo stripes included) and the remaining ~250 ms is raster and encode; the repainter's whole
job is 739. On the gallery the first capture pays to fetch nine photos,
base64-encode 26 MB of them into the clone and downsample them to the 4 MB the output can
show — 305 ms of pipeline where the repainter paints the browser's already-decoded images in
187. On the second capture SnapDOM's memo has the downsampled photos and the row flips to
62 vs 72 (the steady table above). The cell is here because a first capture on a real page is
the honest question, and this one is the answer today.

Run it: `npm run site` in one terminal, `node scripts/realpage-bench.mjs` in another. It prints
this table.

### Capability matrix — verified by pixels, not by READMEs

Each capability paints a marker colour into a fixture; the checker counts those pixels in the
captured PNG. It first proves it can say *no*, against the same fixture built with every
capability removed. Defaults profile, chromium.

| Library | Shadow DOM | Pseudo-elements | conic-gradient | Slotted content | adoptedStyleSheets | Painted `<canvas>` | 1st capture |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **SnapDOM** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 7 ms |
| modern-screenshot 4.7.0 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 8 ms |
| domlens.js 0.1.0 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 15 ms |
| dom-to-image-more 3.10.2 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 26 ms |
| html-to-image 1.11.13 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 31 ms |
| @renoun/screenshot 0.3.3 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | 18 ms |
| html2canvas 1.4.1 | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | 61 ms |
| dom-to-image 2.6.0 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | 109 ms |
| dom-to-image-modern 1.0.2 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | 111 ms |

Cells report behaviour **with defaults**; html2canvas passes conic gradients and
`adoptedStyleSheets` once `foreignObjectRendering: true` is set. Results also vary by engine —
`BROWSER=all` records a table per engine.

### The rules these tables follow

1. **One output stage.** Every arm ends at a PNG data URL, including SnapDOM's. SnapDOM's arm
   is `toCanvas` normalized by the harness's own `canvas.toDataURL()` — the treatment
   html2canvas's canvas already gets, and the route modern-screenshot and html-to-image take
   internally. `toPng` reaches the same data URL and then loads it into an `<img>` for the
   caller (25 ms on a 7.7 Mpx table, 3 ms at 60 rows, ~2 ms on the simple node); earlier tables
   timed that stage as SnapDOM's, and no other row had one.
2. **Same pixels.** `scale: 1` *and* `dpr: 1`. SnapDOM defaults `dpr` to `devicePixelRatio`, so
   on a retina screen it would otherwise encode four times the pixels of everyone else.
3. **Defaults, pinned versions.** No library is configured for advantage; configured profiles
   get their own labelled row.
4. **The memo is pinned off** except in the polling scenario, where it is the point and the
   label says so.

The category tables come from a bare harness; the real-page table above is the same comparison
inside the docs site, and the live lab captures inside whatever page you run it in. Expect the
bare numbers to be the lowest of the three. One large part of the gap between bare and real
used to be SnapDOM's alone: a single author `::before` rule anywhere in the document — matching
nothing — put the whole capture through a second recursive tree walk, taking the 500-row table
from 75 ms to 197 ms while html2canvas was unaffected. The pseudo pass now asks whether any node
*in the captured subtree* can match, instead of whether the *document* mentions a pseudo, and
that penalty is gone (197 → 66 ms). Captures where the rules do match are unchanged: the walk
still has to run.

A second penalty of exactly the same class went the same way. Any `:hover`, `:first-child`,
`p + p` or `:has()` rule anywhere in the page's CSS switched off the identity share — one full
computed-style read per structural identity, twins copy it — for the whole document, even when
the rule was scoped to a class the captured subtree never contains. Every real page has such
rules, so on the docs site the fast path never ran: the 500-row table cost 536k
`getPropertyValue` calls (178 per node) instead of 77k, and its pipeline 150 ms instead of 70.
The share now asks whether any of those selectors matches *under the capture root* right now.
Measured on the docs page, cold, PNG for both: SnapDOM 316 → 242 ms against domlens's 264–278 on
the same page.

### Run the benchmarks

```sh
git clone https://github.com/zumerlab/snapdom.git
cd snapdom
npm install
npm run test:benchmark                                   # everything
npx vitest bench __tests__/category.benchmark.js --browser.headless --watch=false
npx vitest run __tests__/category.capabilities.test.js --browser.headless --reporter=verbose
```


## Development

**Source layout:**
- `src/api/` – Public API (`snapdom`, `preCache`)
- `src/core/` – Capture pipeline, clone, prepare, plugins
- `src/modules/` – Images, fonts, pseudo-elements, backgrounds, SVG
- `src/exporters/` – toPng, toSvg, toBlob, etc.
- `dist/` – Build output (`snapdom.mjs`, `snapdom.cjs`, `snapdom.js`, plus the `preCache.mjs` / `plugins.mjs` re-export stubs)

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

SnapDOM runs in production across 250+ public repositories ([GitHub dependents graph](https://github.com/zumerlab/snapdom/network/dependents)). A few notable ones, each verified from its own `package.json`:

- [LobeHub](https://github.com/lobehub/lobehub) — platform for operating AI agents
- [Trilium Notes](https://github.com/TriliumNext/Trilium) — hierarchical personal knowledge base
- [Sealos](https://github.com/labring/sealos) — AI-native cloud operating system
- [Tencent tmagic-editor](https://github.com/Tencent/tmagic-editor) — low-code page editor
- [Playroom](https://github.com/seek-oss/playroom) — JSX design tool by SEEK
- [GPT-Vis](https://github.com/antvis/GPT-Vis) — AI-friendly data viz by Ant Group's AntV
- [Rabby Wallet](https://github.com/RabbyHub/Rabby) — browser wallet for EVM chains
- [uMap](https://github.com/umap-project/umap) — OpenStreetMap map builder
- [ListenBrainz](https://github.com/metabrainz/listenbrainz-server) — music tracker by MetaBrainz
- [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) — mind-map core; recommends SnapDOM for image export
- [Kong UI Components](https://github.com/Kong/public-ui-components) — Kong's dashboard renderer exports PDFs with SnapDOM
- [SnapDIFF](https://zumerlab.com/snapdiff/) — in-browser visual regression testing *(by Zumerlab)*

See the full gallery at **[snapdom.dev/made-with](https://snapdom.dev/made-with/)**. Shipping SnapDOM? [Open a PR](https://github.com/zumerlab/snapdom/pulls) to add your project — real, verifiable projects only.

## License

MIT © Zumerlab
