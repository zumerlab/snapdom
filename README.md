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

**Setup.** Chromium via Playwright, headless, DPR 1, Apple Silicon. Each cell is the **median
of four full runs**, in milliseconds — lower is better. Absolute values move with your CPU and
browser; the ratios are the part worth quoting.

> **Run it yourself:** [snapdom.dev/compare/live](https://snapdom.dev/compare/live/) runs this
> exact comparison in your own browser — same adapters, same scenes, same oracle — and prints
> a table you can paste into an issue.

### Steady state — re-capturing the same element

| Library | Complex card | Table, 500 rows | Simple node (1200×800) |
| --- | --- | --- | --- |
| **SnapDOM** | **11.1** | **183.0** | 12.9 |
| domlens.js 0.1.0 | 18.0 | 192.3 | 123.4 |
| modern-screenshot 4.7.0 | 30.0 | 534.2 | **12.1** |
| dom-to-image-more 3.10.2 | 32.3 | 703.8 | 17.8 |
| html-to-image 1.11.13 | 49.8 | 1,432.7 | 17.6 |
| html2canvas 1.4.1 | 83.8 | 363.1 | 90.4 |
| @renoun/screenshot 0.3.3 | 144.3 | 636.6 | 78.1 |
| dom-to-image 2.6.0 | 156.8 | 918.0 | 129.6 |
| dom-to-image-modern 1.0.2 | 157.2 | 924.5 | 131.6 |

Two of these three are close enough to say so out loud. SnapDOM takes the big table by 1.05×
— it lost that cell by the same margin before the inline-style pass was scoped (see below), and
the two libraries' run-to-run ranges still overlap. On the simple node modern-screenshot is
nominally ahead by 0.8 ms: that scene has almost nothing to capture, so it mostly prices the PNG
encode everyone shares, and the order flips between runs. The complex card is the one clear gap,
at 1.62×.

### Real-world scenes

| Scene | SnapDOM | Next fastest | Rest of the field |
| --- | --- | --- | --- |
| CSS-heavy page — 10k author rules, 240 class-styled cards | **129.3** | domlens 165.5 | modern-screenshot 291.0 · dom-to-image-more 337.4 · html-to-image 590.0 |
| Shadow DOM — 150 open roots, 3 levels, ~3k nodes | **12.1** | domlens 64.2 | modern-screenshot 120.1 · html2canvas 140.8 · dom-to-image-more 162.0 · html-to-image 432.8 |
| Web fonts — article with Inter 400/700 + mono spans | **11.3** | modern-screenshot 27.4 | dom-to-image-more 28.6 · html-to-image 39.6 |
| Image grid — 40 same-origin PNGs fetched over HTTP | **57.7** | modern-screenshot 65.1 | dom-to-image-more 73.6 · domlens 75.3 · html-to-image 85.5 |
| Polling — 20 captures of a live dashboard | **19.8** | modern-screenshot 112.4 | dom-to-image-more 334.5 · domlens 490.3 |
| Deep nested tree — 16 chains × 10 levels, ~2,100 nodes | 656 | **html2canvas 306** | domlens 666 · modern-screenshot 913 · html-to-image 1,356 |

Polling is the one row where SnapDOM runs with its **defaults**, memoization on: a dashboard
that re-captures the same element every tick is exactly what auto-burst and differential
recapture exist for. Without the memo (`burst: false`) the same loop costs 27.4 ms — the memo
is worth 1.39× here, not the order of magnitude an unrasterized comparison would suggest,
because every tick still pays the raster and the PNG encode.

CSS-heavy is a 1.28× lead over domlens, and the image grid is closer than it looks: with 40 real
HTTP images, everyone waits on the same fetches. The grid is in the table because the scenes
where SnapDOM does *not* pull far ahead are the ones worth knowing about.

**The deep tree is the one SnapDOM loses outright, by 2.15×** — and it loses to html2canvas, the
oldest and slowest library in every other row. The scene is borrowed from domlens's own benchmark
corpus, and their README diagnoses the mechanism honestly: on a capture that large, most of the
time is the browser rasterizing a multi-megapixel SVG image, not anything the library does. Every
`<foreignObject>` implementation pays it — domlens's SVG engine, modern-screenshot, html-to-image
and SnapDOM all land between 656 ms and 1,356 ms, while html2canvas, which paints boxes onto a
canvas and never builds that image, finishes in 306 ms. It is the clearest case in this document
of an architectural cost rather than an implementation one.

Decomposed by stage, SnapDOM's pipeline produces the SVG url in **~97 ms**; the browser spends
**800–1,200 ms** rasterizing it, and the PNG encode ~90 ms. Over 85% of that row is a single
`drawImage`, with none of our code running — and the bill is not linear in pixels, which is why
it only surfaces here. The same document rendered at 1× / 0.5× / 0.25× the pixels takes
547 / 147 / 51 ms, but a *smaller* document at the same 4.2 Mpx takes 39 ms: Chrome replays the
whole paint record per tile, so the cost scales with display items × tiles plus ~40 ms fixed.
That puts the crossover at roughly **1,000 nodes / ~8 Mpx**. Below it SnapDOM wins by a widening
margin — at 1, 2 and 4 chains the same scene is 11 / 24 / 64 ms against html2canvas's
74 / 87 / 115 ms. Above it, the raster is a wall that no pipeline work reaches.

### Cold vs steady — the one cell that is a tie

The number a one-shot user actually experiences is the **first** capture of an element, not the
fifth. Fresh element every iteration, big table, PNG for everyone:

| Arm | ms |
| --- | --- |
| domlens.js — fresh element each capture | **211.6** ← fastest cold |
| SnapDOM — fresh element + `cache: 'disabled'` | 216.4 |
| SnapDOM — fresh element each capture | 218.6 |
| modern-screenshot — fresh element each capture | 595.1 |
| *SnapDOM — same element re-captured, for reference* | *150.8* |

**domlens is 1.03× ahead on a cold big table — inside run-to-run noise.** It was 1.10× before
the inline-style pass was scoped to what actually needs re-resolving; that pass ran per node,
so it was cold cost as much as steady. What is left of SnapDOM's cold time is mostly the raster
and encode of a ~7.7 Mpx foreignObject, which no pipeline work removes, and their persistent
UA-default probe buys them the last few milliseconds. The cell is called out because it is the
one where the order still flips between runs. SnapDOM pulls clear the moment the same element is
captured twice — 150.8 ms against their 211.6.

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

1. **One output stage.** Every arm ends at a PNG data URL, including SnapDOM's.
2. **Same pixels.** `scale: 1` *and* `dpr: 1`. SnapDOM defaults `dpr` to `devicePixelRatio`, so
   on a retina screen it would otherwise encode four times the pixels of everyone else.
3. **Defaults, pinned versions.** No library is configured for advantage; configured profiles
   get their own labelled row.
4. **The memo is pinned off** except in the polling scenario, where it is the point and the
   label says so.

Numbers here come from a bare harness. A real page — its own stylesheets, its own webfonts —
costs every one of these libraries considerably more; the live lab captures inside a real page,
so expect its numbers to be higher than this table across the board. One large part of that gap
used to be SnapDOM's alone: a single author `::before` rule anywhere in the document — matching
nothing — put the whole capture through a second recursive tree walk, taking the 500-row table
from 75 ms to 197 ms while html2canvas was unaffected. The pseudo pass now asks whether any node
*in the captured subtree* can match, instead of whether the *document* mentions a pseudo, and
that penalty is gone (197 → 66 ms). Captures where the rules do match are unchanged: the walk
still has to run.

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
