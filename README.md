# snapDOM


<p align="center">
  <a href="http://zumerlab.github.io/orbit-docs">
    <img src="https://raw.githubusercontent.com/zumerlab/snapdom/main/docs/assets/hero.png" width="80%">
  </a>
</p>


<p align="center">
  <a href="https://www.npmjs.com/package/@zumer/snapdom"><img src="https://img.shields.io/github/package-json/v/zumerlab/snapdom"></a>
</p>



**snapDOM** is a fast and accurate DOM capture tool to images developed for **Zumly**, a WIP framework that enables zoom-based view transitions.  

It converts any HTML element into a scalable SVG image, preserving styles, fonts, backgrounds, shadow DOM content, pseudo-elements, and more.


- 📸 Full DOM capture
- 🎨 Embedded styles, pseudo-elements, and fonts
- 🖼️ Export to SVG, PNG, JPG, WebP, or `canvas`
- ⚡ Ultra fast, no dependencies
- 📦 100% based on standard Web APIs


## Installation

You can use **snapDOM** via **NPM**, **CDN**, **script tag**, or by **importing as a module**.

### NPM / Yarn

```sh
npm i @zumer/snapdom
```

```sh
yarn add @zumer/snapdom
```

### CDN

```html
<script src="https://unpkg.com/@zumer/snapdom@latest/dist/snapdom.min.js"></script>
```

### Script tag (local)

```html
<script src="snapdom.js"></script>
```

The global object `snapdom` will be available.

### ES Module

```javascript
import { snapdom } from './snapdom.mjs';
```

### Script Tag (Type Module)

```html
<script type="module">
  import { snapdom } from 'https://unpkg.com/@zumer/snapdom@latest/dist/snapdom.mjs';
</script>
```

Now you can call `snapdom(el)`, `snapdom.toPng(el)`, etc., directly in your JavaScript.

## Basic usage

```javascript
// Capture an element as <img> tag
const el = document.querySelector("#myElement")
const img = await snapdom.toImg(el);

document.body.appendChild(img);
```

## API

### Note: API may evolve until v1.0.0!

The main API is exposed as `snapdom` and offers multiple capture methods:

| Method                           | Description                                                    |
| :------------------------------- | :------------------------------------------------------------- | 
| `snapdom(el, options?)`          | Captures as SVG Data URL                                       | 
| `snapdom.toImg(el, options?)`    | Captures as `HTMLImageElement` (SVG)                           | 
| `snapdom.toCanvas(el, options?)` | Captures as `HTMLCanvasElement`                                | 
| `snapdom.toPng(el, options?)`    | Captures as PNG image (`Image`)                                | 
| `snapdom.toJpg(el, options?)`    | Captures as JPG image (`Image`)                                | 
| `snapdom.toWebp(el, options?)`   | Captures as WebP image (`Image`)                               | 
| `snapdom.toBlob(el, options?)`   | Captures as SVG `Blob`                                         | 
| `preCache(root?, options?)`      | Preload resources for faster and more accurate captures        | 

---

### Options

You can pass an `options` object to control the behavior of all capture methods:

| Option            | Type      | Default  | Description                                                                         |
| ----------------- | --------- | -------- | ----------------------------------------------------------------------------------- |
| `compress`        | `boolean` | `true`   | Removes default styles to reduce size and deduplicate CSS where possible.           |
| `fast`            | `boolean` | `true`   | Skips `requestIdleCallback` delays and executes preparation immediately.            |
| `embedFonts`      | `boolean` | `false`  | Inlines external fonts as Data URLs (except icon fonts, which are always embedded). |
| `scale`           | `number`  | `1`      | Multiplies the output resolution without affecting layout size.                     |
| `backgroundColor` | `string`  | `"#fff"` | Used when exporting to JPG or WebP formats (which don't support transparency).      |
| `quality`         | `number`  | `1`      | Compression quality for JPG/WebP, between `0` and `1`.                              |

---

### `preCache()` – Optional helper

The `preCache()` function can be used to load external resources (like images and fonts) in advance.

```js
import { preCache } from '@zumer/snapdom';

await preCache(document.body, {
  embedFonts: true,
  preWarm: true
});
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
* `reset` *(boolean, default: false)* — Clears all existing internal caches.
* `preWarm` *(boolean, default: true)* — Runs a fake capture in memory to warm up styles, fonts and layout detection.

## Special features

* **Shadow DOM**: Captures content inside Web Components and `shadowRoot`.
* **Pseudo-elements**: Captures `::before` and `::after`, including background images.
* **Backgrounds and images**: Inlines external images as Data URLs.
* **Fonts**: Replicates applied font families without requiring external font files.
* **Icon fonts**: Captures icon fonts like **Font Awesome** and **Material Icons**.
* **Placeholder and Exclusion**:

  * `data-capture="exclude"`: Skips an element while preserving layout space.
  * `data-capture="placeholder"` + `data-placeholder-text="Text"`: Replaces an element with placeholder text.

**Now with improved fidelity and even faster performance.**

## Full example

```html
<div id="captureMe">
  <h1 style="color: tomato;">Hello World!</h1>
  <p>This content will be captured.</p>
</div>

<button id="captureBtn">Capture as img</button>

<script type="module">
  import { snapdom } from './snapdom.mjs';

  const button = document.getElementById('captureBtn');
  button.addEventListener('click', async () => {
    const target = document.getElementById('captureMe');
    const img = await snapdom.toJpg(target, { quality: 0.5});
    document.body.appendChild(img);
  });
</script>
```

## Limitations

* External images must be CORS-accessible.
* Iframes are not captured.

### Please if you find a bug **open an issue**.

## Benchmarks

`snapDOM` is not only highly accurate — it’s **extremely fast**.


Latest benchmarks show significant performance improvements against other libraries:

| Scenario                         | vs. `modern-screenshot` | vs. `html2canvas` |
| -------------------------------- | :---------------------: | :---------------: |
| Small element (200×100)          |       6.46× faster      |   32.27× faster   |
| Modal size (400×300)             |       7.28× faster      |   32.66× faster   |
| Page view (1200×800)             |      13.17× faster      |   35.29× faster   |
| Large scroll area (2000×1500)    |      38.23× faster      |   68.85× faster   |
| Very large element (4000×2000)   |      93.31× faster      |   133.12× faster  |
| Complex small element (200×100)  |       3.97× faster      |   15.23× faster   |
| Complex modal (400×300)          |       2.32× faster      |    5.33× faster   |
| Complex page (1200×800)          |       1.62× faster      |    1.65× faster   |
| Complex large scroll (2000×1500) |       1.66× faster      |    1.24× faster   |
| Complex very large (4000×2000)   |       1.52× faster      |    1.28× faster   |


### Run the benchmarks

To run these benchmarks yourself:

```sh
git clone https://github.com/zumerlab/snapdom.git
cd snapdom
npm install
npm run test:benchmark
```

They execute in **headless Chromium** using real DOM nodes.

## License

MIT © Zumerlab

