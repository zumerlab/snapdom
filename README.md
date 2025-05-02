<p align="center">
  <a href="http://zumerlab.github.io/orbit-docs">
    <img src="https://raw.githubusercontent.com/zumerlab/snapdom/main/docs/assets/hero.png" width="80%">
  </a>
</p>


<p align="center">
  <a href="https://www.npmjs.com/package/@zumer/snapdom"><img src="https://img.shields.io/github/package-json/v/zumerlab/snapdom"></a>
</p>


# snapDOM

**snapDOM** is a fast and accurate DOM capture tool to images developed for **Zumly**, a framework that enables zoom-based view transitions.  

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

```javascript
<script type="module">
  import { snapdom } from 'https://unpkg.com/@zumer/snapdom@latest/dist/snapdom.mjs';
</script>
```

Now you can call `snapdom(el)`, `snapdom.toPng(el)`, etc., directly in your JavaScript.


## Basic usage

```javascript
// Capture an element as SVG Data URL
const svgDataUrl = await snapdom(document.querySelector("#myElement"));

// Insert the captured image into the page
const img = new Image();
img.src = svgDataUrl;
document.body.appendChild(img);
```


## API

### Note: API may evolve until v1.0.0!

The main API is exposed as `snapdom` and offers multiple capture methods:

| Method                | Description                            | Returns                  |
|:----------------------|:---------------------------------------|:-------------------------|
| `snapdom(el, options?)` | Captures as SVG Data URL                | `Promise<string>`        |
| `snapdom.toImg(el, options?)` | Captures as `HTMLImageElement` (SVG)     | `Promise<HTMLImageElement>` |
| `snapdom.toCanvas(el, options?)` | Captures as `HTMLCanvasElement`        | `Promise<HTMLCanvasElement>` |
| `snapdom.toPng(el, options?)` | Captures as PNG image (`Image`)      | `Promise<HTMLImageElement>` |
| `snapdom.toJpg(el, options?)` | Captures as JPG image (`Image`)      | `Promise<HTMLImageElement>` |
| `snapdom.toWebp(el, options?)` | Captures as WebP image (`Image`)     | `Promise<HTMLImageElement>` |
| `snapdom.toBlob(el, options?)` | Captures as SVG `Blob`               | `Promise<Blob>`           |

**Options:**
- `scale` *(number)*: Scale factor (default is `1`)
- `quality` *(number)*: Compression quality for JPG/WebP (0–1)
- `backgroundColor` *(string)*: Background fill for JPG/WebP exports

---

## Special features

- **Shadow DOM**: Captures content inside Web Components and `shadowRoot`.
- **Pseudo-elements**: Captures `::before` and `::after`, including background images.
- **Backgrounds and images**: Inlines external images as Data URLs.
- **Fonts**: Replicates applied font families without requiring external font files.
- **Icon fonts**: Captures icon fonts like **Font Awesome** and **Material Icons**.
- **Placeholder and Exclusion**:
  - `data-capture="exclude"`: Skips an element while preserving layout space.
  - `data-capture="placeholder"` + `data-placeholder-text="Text"`: Replaces an element with placeholder text.

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
    const img = await snapdom.toImg(target);
    document.body.appendChild(img);
  });
</script>
```


## Limitations

- External images must be CORS-accessible.
- Fonts must be fully loaded before capturing (`document.fonts.ready` is automatically awaited).
- Iframes are not captured.


## Benchmarks

`snapDOM` is not only highly accurate — it’s **extremely fast**, especially for large elements.

Latest benchmarks show **major speed improvements** over existing libraries:

| Element Size             | vs. `modern-screenshot` | vs. `html2canvas` |
|:------------------------:|:-----------------------:|:-----------------:|
| **Small (200×100)**      | 9.84× faster            | 33.19× faster     |
| **Modal (400×300)**      | 11.72× faster           | 36.03× faster     |
| **Page view (1200×800)** | 24.40× faster           | 55.65× faster     |
| **Large (2000×1500)**    | 49.85× faster           | 90.74× faster     |
| **Very large (4000×2000)** | 138.93× faster         | 148.41× faster    |

✅ **snapDOM** also improved fidelity, even on complex layouts:
- Up to **7.82× faster** for complex modal captures.
- Still faster even at very large sizes.

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
