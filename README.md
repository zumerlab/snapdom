<p align="center">
  <a href="http://zumerlab.github.io/snapdom">
    <img src="https://raw.githubusercontent.com/zumerlab/snapdom/main/docs/assets/newhero.png" width="80%">
  </a>
</p>

<p align="center">
 <a href="https://www.npmjs.com/package/@zumer/snapdom">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@zumer/snapdom?style=flat-square&label=Version">
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

# snapDOM

**snapDOM** is a fast and accurate DOM-to-image capture tool built for **Zumly**, a zoom-based view transition framework.

It captures any HTML element as a scalable SVG image, preserving styles, fonts, background images, pseudo-elements, and even shadow DOM. It also supports export to raster image formats and canvas.

* 📸 Full DOM capture
* 🎨 Embedded styles, pseudo-elements, and fonts
* 🖼️ Export to SVG, PNG, JPG, WebP, `canvas`, or Blob
* ⚡ Ultra fast, no dependencies
* 📦 100% based on standard Web APIs

## Demo

[https://zumerlab.github.io/snapdom/](https://zumerlab.github.io/snapdom/)

## Installation

### NPM / Yarn

```sh
npm i @zumer/snapdom
```

```sh
yarn add @zumer/snapdom
```

Then import it in your code:

```js
import { snapdom } from '@zumer/snapdom';
```

### CDN

```html
<script src="https://cdn.jsdelivr.net/npm/@zumer/snapdom/dist/snapdom.min.js"></script>
```

### Script tag (local)

```html
<script src="snapdom.js"></script>
```

### ES Module

```js
import { snapdom } from './snapdom.mjs';
```

### Module via CDN

```html
<script type="module">
  import { snapdom } from 'https://cdn.jsdelivr.net/npm/@zumer/snapdom/dist/snapdom.mjs';
</script>
```

## Basic usage

### Reusable capture
```js
const el = document.querySelector('#target');
const result = await snapdom(el);

const img = await result.toPng();
document.body.appendChild(img);

await result.download({ format: 'jpg', filename: 'my-capture' });
```

### One-step shortcuts
```js
const el = document.querySelector('#target');
const png = await snapdom.toPng(el);
document.body.appendChild(png);

const blob = await snapdom.toBlob(el);
```

## API

### `snapdom(el, options?)`

Returns an object with reusable export methods:

```js
{
  url: string;
  toRaw(): string;
  toImg(): Promise<HTMLImageElement>;
  toCanvas(): Promise<HTMLCanvasElement>;
  toBlob(options?): Promise<Blob>;
  toPng(options?): Promise<HTMLImageElement>;
  toJpg(options?): Promise<HTMLImageElement>;
  toWebp(options?): Promise<HTMLImageElement>;
  download(options?): Promise<void>;
}
```

### Shortcut methods

| Method                         | Description                       |
| ------------------------------ | --------------------------------- |
| `snapdom.toImg(el, options?)`  | Returns an `HTMLImageElement`     |
| `snapdom.toCanvas(el, options?)` | Returns a `Canvas`               |
| `snapdom.toBlob(el, options?)` | Returns an SVG or raster `Blob`   |
| `snapdom.toPng(el, options?)`  | Returns a PNG image               |
| `snapdom.toJpg(el, options?)`  | Returns a JPG image               |
| `snapdom.toWebp(el, options?)` | Returns a WebP image              |
| `snapdom.download(el, options?)` | Triggers a download              |

## Options

> ✅ **Note:** Style compression is now always on internally. The `compress` option has been removed.

All capture methods accept an `options` object:

| Option            | Type     | Default  | Description                                     |
| ----------------- | -------- | -------- | ----------------------------------------------- |
| `fast`            | boolean  | `true`   | Skips small idle delays for faster results      |
| `embedFonts`      | boolean  | `false`  | Inlines non-icon fonts (icon fonts always on)   |
| `localFonts`      | array    | `[]`     | Local fonts `{ family, src, weight?, style? }`  |
| `iconFonts`       | string\|RegExp\|Array | `[]` | Extra icon font matchers                      |
| `excludeFonts`    | object  | `{}`     | Exclude font families/domains/subsets during embedding |
| `scale`           | number   | `1`      | Output scale multiplier                         |
| `dpr`             | number   | `devicePixelRatio` | Device pixel ratio                     |
| `width`           | number   | -        | Output width                                    |
| `height`          | number   | -        | Output height                                   |
| `backgroundColor` | string   | `"#fff"` | Fallback color for JPG/WebP                     |
| `quality`         | number   | `1`      | Quality for JPG/WebP (0 to 1)                   |
| `useProxy`        | string   | `''`     | Proxy base for CORS fallbacks                   |
| `type`            | string   | `svg`    | Default Blob type (`svg`\|`png`\|`jpg`\|`webp`) |
| `exclude`         | string[] | -        | CSS selectors to exclude                        |
| `filter`          | function | -        | Custom predicate `(el) => boolean`              |
| `cache`           | string   | `"soft"` | Control internal caches: `disabled`, `soft`, `auto`, `full` |
| `defaultImageUrl` | string \| function  | -                  | Fallback image when an `<img>` fails. If a function is provided, it receives `{ width?, height?, src?, element }` and must return a URL (string or Promise<string>). Useful for placeholder services (e.g. `https://placehold.co/{width}x{height}`) |

### Fallback image on `<img>` load failure

Provide a default image for failed `<img>` loads. You can pass a fixed URL or a callback that receives measured dimensions and returns a URL (handy to generate dynamic placeholders).

```js
// 1) Fixed URL fallback
await snapdom.toImg(element, {
  defaultImageUrl: '/images/fallback.png'
});

// 2) Dynamic placeholder via callback
await snapdom.toImg(element, {
  defaultImageUrl: ({ width = 300, height = 150 }) =>
    `https://placehold.co/${Math.round(width)}x${Math.round(height)}`
});

// 3) With proxy (if your fallback host has no CORS)
await snapdom.toImg(element, {
  defaultImageUrl: ({ width = 300, height = 150 }) =>
    `https://dummyimage.com/${Math.round(width)}x${Math.round(height)}/cccccc/666.png&text=img`,
  useProxy: 'https://corsproxy.io/?url='
});
```

Notes:
- If the fallback image also fails to load, snapDOM replaces the `<img>` with a placeholder block preserving width/height.
- Width/height used by the callback are gathered from the original element (dataset, style/attrs, etc.) when available.


### Dimensions (`scale`, `width`, `height`)

* If `scale` is provided, it **takes precedence** over `width`/`height`.
* If only `width` is provided, height scales proportionally (and vice versa).
* Providing both `width` and `height` forces an exact size (may distort).

### Cross-Origin Images & Fonts (`useProxy`)

By default snapDOM tries `crossOrigin="anonymous"` (or `use-credentials` for same-origin). If an asset is CORS-blocked, you can set `useProxy` to a prefix URL that forwards the actual `src`:

```js
await snapdom.toPng(el, {
  useProxy: 'your-proxy' // Example 'https://api.allorigins.win/raw?url='
});
```

**Tips**

* Keep the proxy **fast** and **cache-friendly** (adds big wins on repeated captures).
* The proxy is only used as a **fallback**; same-origin and CORS-enabled assets skip it.

### Fonts

#### `embedFonts`
When `true`, snapDOM embeds **non-icon** `@font-face` rules detected as used within the captured subtree. Icon fonts (Font Awesome, Material Icons, etc.) are embedded **always**.

#### `localFonts`
If you serve fonts yourself or have data URLs, you can declare them here to avoid extra CSS discovery:

```js
await snapdom.toPng(el, {
  embedFonts: true,
  localFonts: [
    { family: 'Inter', src: '/fonts/Inter-Variable.woff2', weight: 400, style: 'normal' },
    { family: 'Inter', src: '/fonts/Inter-Italic.woff2', style: 'italic' }
  ]
});
```

#### `iconFonts`
Add custom icon families (names or regex matchers). Useful for private icon sets:

```js
await snapdom.toPng(el, {
  iconFonts: ['MyIcons', /^(Remix|Feather) Icons?$/i]
});
```

#### `excludeFonts`
Skip specific non-icon fonts to speed up capture or avoid unnecessary downloads.

```js
await snapdom.toPng(el, {
  embedFonts: true,
  excludeFonts: {
    families: ['Noto Serif', 'SomeHeavyFont'],     // skip by family name
    domains: ['fonts.gstatic.com', 'cdn.example'], // skip by source host
    subsets: ['cyrillic-ext']                      // skip by unicode-range subset tag
  }
});
```
*Notes*
- `excludeFonts` only applies to **non-icon** fonts. Icon fonts are always embedded.
- Matching is case-insensitive for `families`. Hosts are matched by substring against the resolved URL.


### Filtering nodes: `exclude` vs `filter`

* `exclude`: remove by **selector**.
* `filter`: advanced predicate per element (return `false` to drop).

**Example: filter out elements with `display:none`:**
```js
/**
 * Example filter: skip elements with display:none
 * @param {Element} el
 * @returns {boolean} true = keep, false = exclude
 */
function filterHidden(el) {
  const cs = window.getComputedStyle(el);
  if (cs.display === 'none') return false;
  return true;
}

await snapdom.toPng(document.body, { filter: filterHidden });
```

**Example with `exclude`:** remove banners or tooltips by selector
```js
await snapdom.toPng(el, {
  exclude: ['.cookie-banner', '.tooltip', '[data-test="debug"]']
});
```
### `preCache()` – Optional helper

Preloads external resources to avoid first-capture stalls (helpful for big/complex trees).

```js
import { preCache } from '@zumer/snapdom';

await preCache({
  root: document.body,
  embedFonts: true,
  localFonts: [{ family: 'Inter', src: '/fonts/Inter.woff2', weight: 400 }],
  useProxy: 'your-proxy'
});
```

### Cache control

SnapDOM maintains internal caches for images, backgrounds, resources, styles, and fonts.  
You can control how they are cleared between captures using the `cache` option:

| Mode        | Description                                                                 |
| ----------- | --------------------------------------------------------------------------- |
| `"disabled"`| No cache                   |
| `"soft"`    | Clears session caches (`styleMap`, `nodeMap`, `styleCache`) _(default)_      |
| `"auto"`    | Minimal cleanup: only clears transient maps                                 |
| `"full"`    | Keeps all caches (nothing is cleared, maximum performance)                  |

**Examples:**

```js
// Use minimal but fast cache
await snapdom.toPng(el, { cache: 'auto' });

// Keep everything in memory between captures
await snapdom.toPng(el, { cache: 'full' });

// Force a full cleanup on every capture
await snapdom.toPng(el, { cache: 'disabled' });
```

## Limitations

* External images should be CORS-accessible (use `useProxy` option for handling CORS denied)
* When WebP format is used on Safari, it will fallback to PNG rendering.
* `@font-face` CSS rule is well supported, but if need to use JS `FontFace()`, see this workaround [`#43`](https://github.com/zumerlab/snapdom/issues/43)


## ⚡ Performance Benchmarks

Snapdom has received **significant performance improvements** since version `v1.8.0`. The following benchmarks compare:

* **Snapdom (current)**
* **Snapdom v1.8.0**
* `html2canvas`
* `html-to-image`


### Simple elements

| Scenario                 | Snapdom (current) | Snapdom v1.8.0 | html2canvas | html-to-image |
| ------------------------ | ----------------- | -------------- | ----------- | ------------- |
| Small (200×100)          | **0.4 ms**        | 1.2 ms         | 70.3 ms     | 3.6 ms        |
| Modal (400×300)          | **0.4 ms**        | 1.1 ms         | 68.8 ms     | 3.6 ms        |
| Page View (1200×800)     | **0.4 ms**        | 1.0 ms         | 100.5 ms    | 3.4 ms        |
| Large Scroll (2000×1500) | **0.4 ms**        | 1.0 ms         | 153.1 ms    | 3.4 ms        |
| Very Large (4000×2000)   | **0.4 ms**        | 1.0 ms         | 278.9 ms    | 4.3 ms        |



### Complex elements

| Scenario                 | Snapdom (current) | Snapdom v1.8.0 | html2canvas | html-to-image |
| ------------------------ | ----------------- | -------------- | ----------- | ------------- |
| Small (200×100)          | **1.1 ms**        | 3.2 ms         | 76.0 ms     | 15.3 ms       |
| Modal (400×300)          | **4.5 ms**        | 14.0 ms        | 133.2 ms    | 55.4 ms       |
| Page View (1200×800)     | **32.9 ms**       | 113.6 ms       | 303.4 ms    | 369.1 ms      |
| Large Scroll (2000×1500) | **133.9 ms**      | 387.4 ms       | 594.4 ms    | 1,163.0 ms    |
| Very Large (4000×2000)   | **364.0 ms**      | 1,200.4 ms     | 1,380.8 ms  | 3,023.9 ms    |



### Summary

* Snapdom (current) is **2×–6× faster** than `v1.8.0`
* Up to **150× faster** than `html2canvas`
* Up to **8× faster** than `html-to-image` in large scenarios

<sub>Benchmarks run in Chromium using Vitest.<br>
Hardware: MacBook Air 2018.<br>
⚠️ Performance may vary depending on device.</sub>



### Run the benchmarks

```sh
git clone https://github.com/zumerlab/snapdom.git
cd snapdom
npm install
npm run test:benchmark
```


## Roadmap

Planned improvements for future versions of SnapDOM:

* [ ] **Implement plugin system**
  SnapDOM will support external plugins to extend or override internal behavior (e.g. custom node transformers, exporters, or filters).

* [ ] **Refactor to modular architecture**
  Internal logic will be split into smaller, focused modules to improve maintainability and code reuse.

* [X] **Decouple internal logic from global options**
  Functions will be redesigned to avoid relying directly on `options`. A centralized capture context will improve clarity, autonomy, and testability. See [`next` branch](https://github.com/zumerlab/snapdom/tree/main)

* [ ] **Expose cache control**
  Users will be able to manually clear image and font caches or configure their own caching strategies.

* [ ] **Auto font preloading**
  Required fonts will be automatically detected and preloaded before capture, reducing the need for manual `preCache()` calls.

* [ ] **Document plugin development**
  A full guide will be provided for creating and registering custom SnapDOM plugins.

* [ ] **Make export utilities tree-shakeable**
  Export functions like `toPng`, `toJpg`, `toBlob`, etc. will be restructured into independent modules to support tree shaking and minimal builds.

Have ideas or feature requests?
Feel free to share suggestions or feedback in [GitHub Discussions](https://github.com/zumerlab/snapdom/discussions).


## Development

To contribute or build snapDOM locally:

```sh
# Clone the repository
git clone https://github.com/zumerlab/snapdom.git
cd snapdom

# Switch to dev branch
git checkout dev

# Install dependencies
npm install

# Compile the library (ESM, CJS, and minified versions)
npm run compile

# Install playwright browsers (necessary for running tests)
npx playwright install

# Run tests
npm test

# Run Benchmarks
npm run test:benchmark
```

The main entry point is in `src/`, and output bundles are generated in the `dist/` folder.

For detailed contribution guidelines, please see [CONTRIBUTING](https://github.com/zumerlab/snapdom/blob/main/CONTRIBUTING.md).


## Contributors 🙌

<!-- CONTRIBUTORS:START -->
<p>
<a href="https://github.com/tinchox5" title="tinchox5"><img src="https://avatars.githubusercontent.com/u/11557901?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="tinchox5"/></a>
<a href="https://github.com/tarwin" title="tarwin"><img src="https://avatars.githubusercontent.com/u/646149?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="tarwin"/></a>
<a href="https://github.com/17biubiu" title="17biubiu"><img src="https://avatars.githubusercontent.com/u/13295895?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="17biubiu"/></a>
<a href="https://github.com/av01d" title="av01d"><img src="https://avatars.githubusercontent.com/u/6247646?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="av01d"/></a>
<a href="https://github.com/CHOYSEN" title="CHOYSEN"><img src="https://avatars.githubusercontent.com/u/25995358?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="CHOYSEN"/></a>
<a href="https://github.com/pedrocateexte" title="pedrocateexte"><img src="https://avatars.githubusercontent.com/u/207524750?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="pedrocateexte"/></a>
<a href="https://github.com/domialex" title="domialex"><img src="https://avatars.githubusercontent.com/u/4694217?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="domialex"/></a>
<a href="https://github.com/elliots" title="elliots"><img src="https://avatars.githubusercontent.com/u/622455?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="elliots"/></a>
<a href="https://github.com/jswhisperer" title="jswhisperer"><img src="https://avatars.githubusercontent.com/u/1177690?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="jswhisperer"/></a>
<a href="https://github.com/sharuzzaman" title="sharuzzaman"><img src="https://avatars.githubusercontent.com/u/7421941?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="sharuzzaman"/></a>
<a href="https://github.com/simon1uo" title="simon1uo"><img src="https://avatars.githubusercontent.com/u/60037549?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="simon1uo"/></a>
<a href="https://github.com/titoBouzout" title="titoBouzout"><img src="https://avatars.githubusercontent.com/u/64156?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="titoBouzout"/></a>
<a href="https://github.com/jhbae200" title="jhbae200"><img src="https://avatars.githubusercontent.com/u/20170610?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="jhbae200"/></a>
<a href="https://github.com/miusuncle" title="miusuncle"><img src="https://avatars.githubusercontent.com/u/7549857?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="miusuncle"/></a>
<a href="https://github.com/rbbydotdev" title="rbbydotdev"><img src="https://avatars.githubusercontent.com/u/101137670?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="rbbydotdev"/></a>
<a href="https://github.com/zhanghaotian2018" title="zhanghaotian2018"><img src="https://avatars.githubusercontent.com/u/169218899?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="zhanghaotian2018"/></a>
<a href="https://github.com/kohaiy" title="kohaiy"><img src="https://avatars.githubusercontent.com/u/15622127?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="kohaiy"/></a>
<a href="https://github.com/fu050409" title="fu050409"><img src="https://avatars.githubusercontent.com/u/46275354?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="fu050409"/></a>
</p>
<!-- CONTRIBUTORS:END -->

## 💖 Sponsors

Special thanks to [@megaphonecolin](https://github.com/megaphonecolin) for supporting this project!

If you'd like to support this project too, you can [become a sponsor](https://github.com/sponsors/tinchox5).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=zumerlab/snapdom&type=Date)](https://www.star-history.com/#zumerlab/snapdom&Date)

## License

MIT © Zumerlab
