<p align="center">
  <a href="http://zumerlab.github.io/snapdom">
    <img src="https://raw.githubusercontent.com/zumerlab/snapdom/main/docs/assets/newhero.png" width="70%">
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
const result = await snapdom(el, { scale: 2 });

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

| Method                         | Description                           |
| ------------------------------ | ------------------------------------- |
| `snapdom.toImg(el, options?)`  | Returns an `HTMLImageElement`         |
| `snapdom.toCanvas(el, options?)     ` | Returns a `Canvas`                    |
| `snapdom.toBlob(el, options?)` | Returns an SVG `Blob`                 |
| `snapdom.toPng(el, options?)`  | Returns a PNG image                   |
| `snapdom.toJpg(el, options?)`  | Returns a JPG image                   |
| `snapdom.toWebp(el, options?)` | Returns a WebP image                  |
| `snapdom.download(el, options?)     ` | Triggers download in specified format |

## Options

All capture methods accept an `options` object:

| Option            | Type     | Default  | Description                                |
| ----------------- | -------- | -------- | ------------------------------------------ |
| `compress`        | boolean  | `true`   | Removes redundant styles                   |
| `fast`            | boolean  | `true`   | Skips idle delay for faster results        |
| `embedFonts`      | boolean  | `false`  | Inlines fonts (icon fonts always embedded) |
| `scale`           | number   | `1`      | Output scale multiplier                    |
| `dpr`             | number   | `devicePixelRatio` | Device pixel ratio                 |
| `width`           | number   | -        | Output specific width size                 |
| `height`          | number   | -        | Output specific height size                |
| `backgroundColor` | string   | `"#fff"` | Fallback color for JPG/WebP                |
| `quality`         | number   | `1`      | Quality for JPG/WebP (0 to 1)              |
| `useProxy`     | string | ''        | Specify a proxy for handling CORS images as fallback|
| `type`     | string | `svg`        | Select `png`, `jpg`, `webp` Blob type|
| `exclude` | string[] | -  | CSS selectors for elements to exclude |
| `filter` | function | -  | Custom filter function ie `(el) => !el.classList.contains('hidden')` |

### Setting custom dimensions with width and height options

Use the `width` and `height` options to generate an image with specific dimensions.

**Examples:**

**1. Fixed width (proportional height)**
Sets a specific width while maintaining the aspect ratio. Height adjusts proportionally.

```js
const result = await snapdom(element, {
  width: 400 // Outputs a 400px-wide image with auto-scaled height
});
```

**2. Fixed height (proportional width)**
Sets a specific height while maintaining the aspect ratio. Width adjusts proportionally.

```js
const result = await snapdom(element, {
  height: 200 // Outputs a 200px-tall image with auto-scaled width
});
```

**3. Fixed width and height (may distort image)**
Forces exact dimensions, potentially distorting the image if the aspect ratio differs.

```js
const result = await snapdom(element, {
  width: 800,  // Outputs an 800px × 200px image (may stretch/squish content)
  height: 200
});
```

**Note:** If `scale` is different from  1, it takes priority over width and height.
Example: `{ scale: 3, width: 500 }` ignores width and scales the image 3x instead.


### Cross-Origin Images

By default, snapDOM loads images with `crossOrigin="anonymous"` or `crossOrigin="use-credentials"`. In case fails to get the images, `useProxy` can be used to deal with CORS images:

```js
const result = await snapdom(element, {
  useProxy: 'your/proxy/' //Example: 'https://corsproxy.io/?url=' or 'https://api.allorigins.win/raw?url='
});
```


### Download options

```js
{
  format?: "svg" | "png" | "jpg" | "jpeg" | "webp"; // default: "png"
  filename?: string;         // default: "capture"
  backgroundColor?: string;  // optional override
}
```


### `preCache()` – Optional helper

The `preCache()` function can be used to load external resources (like images and fonts) in advance. It is specially useful when the element to capture is big and complex.

```js
import { preCache } from '@zumer/snapdom';

await preCache(document.body);
```

```js
import { snapdom, preCache } from './snapdom.mjs';
    window.addEventListener('load', async () => {
    await preCache();
    console.log('📦 Resources preloaded');
    });
```

**Options for `preCache()`:**

* `embedFonts` *(boolean, default: true)* — Inlines non-icon fonts during preload.
* `useProxy` *(string)* — Proxy for handling CORS images as fallback.


## Features

* Captures **shadow DOM** and Web Components
* Supports `::before`, `::after` and `::first-letter` pseudo-elements
* Inlines background images and fonts
* Handles **Font Awesome**, **Material Icons**, and more
* `data-capture="exclude"` to ignore an element
* `data-capture="placeholder"` with `data-placeholder-text` for masked replacements

## Limitations

* External images should be CORS-accessible (use `useProxy` option for handling CORS denied)
* Iframes are not supported
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
<a href="https://github.com/kohaiy" title="kohaiy"><img src="https://avatars.githubusercontent.com/u/15622127?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="kohaiy"/></a>
<a href="https://github.com/fu050409" title="fu050409"><img src="https://avatars.githubusercontent.com/u/46275354?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="fu050409"/></a>
</p>
<!-- CONTRIBUTORS:END -->

## 💖 Sponsors

Special thanks to [@megaphonecolin](https://github.com/megaphonecolin) for supporting this project!

If you'd like to support this project too, you can [become a sponsor](https://github.com/sponsors/tinchox5).

## License

MIT © Zumerlab
