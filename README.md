# snapDOM

**snapDOM** is a high-fidelity DOM capture tool, developed as part of the animation engine I'm developing for Zumly — a framework for creating smooth zoom-based view transitions.

It converts any HTML element into a scalable SVG image, preserving styles, fonts, backgrounds, shadow DOM content, pseudo-elements, and more.

- 📸 Full DOM capture
- 🎨 Embedded styles, pseudo-elements, and fonts
- 🖼️ Export to SVG, PNG, JPG, WebP, or `canvas`
- ⚡ Lightweight, no dependencies
- 📦 100% based on standard Web APIs


## Installation

You can use **snapDOM** by including it via **CDN**, **script tag**, or by **importing it as a module**.

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

The main API is exposed as `snapdom` and offers multiple capture methods:

| Method | Description | Returns |
|:-------|:------------|:--------|
| `snapdom(el, scale?)` | Captures as SVG Data URL | `Promise<string>` |
| `snapdom.toImg(el, scale?)` | Captures as `HTMLImageElement` (SVG) | `Promise<HTMLImageElement>` |
| `snapdom.toCanvas(el, scale?)` | Captures as `HTMLCanvasElement` | `Promise<HTMLCanvasElement>` |
| `snapdom.toPng(el, scale?)` | Captures as PNG image (`Image`) | `Promise<HTMLImageElement>` |
| `snapdom.toJpg(el, scale?, quality?)` | Captures as JPG image (`Image`) | `Promise<HTMLImageElement>` |
| `snapdom.toWebp(el, scale?, quality?)` | Captures as WebP image (`Image`) | `Promise<HTMLImageElement>` |
| `snapdom.toBlob(el, scale?)` | Captures as SVG `Blob` | `Promise<Blob>` |

**Parameters:**
- `el`: DOM element to capture.
- `scale`: Scale factor (default is `1`).
- `quality`: Compression quality for JPG/WebP (range `0`–`1`).


## Special features

- **Shadow DOM**: Captures content inside Web Components and `shadowRoot`.
- **Pseudo-elements**: Captures `::before` and `::after`, including background images.
- **Backgrounds and images**: Inlines external images as Data URLs.
- **Fonts**: Replicates applied font families without needing external font files.
- **Placeholder and Exclusion**:
  - `data-capture="exclude"`: Skips an element while preserving layout space.
  - `data-capture="placeholder"` + `data-placeholder-text="Text"`: Replaces an element with decorative placeholder text.


## Full example

```html
<div id="captureMe">
  <h1 style="color: tomato;">Hello World!</h1>
  <p>This content will be captured.</p>
</div>

<script type="module">
  import { snapdom } from './snapdom.esm.js';

  const button = document.createElement('button');
  button.textContent = "Capture";
  button.onclick = async () => {
    const img = await snapdom.toPng(document.getElementById('captureMe'), 2);
    document.body.appendChild(img);
  };
  document.body.appendChild(button);
</script>
```


## Limitations

- External images must be CORS-accessible.
- Fonts must be fully loaded before capturing (`document.fonts.ready` is automatically awaited).
- Iframes are not captured.


## Benchmark

`snapDOM` is not only highly accurate — it's also **extremely fast** at capturing large or complex DOM structures.

In benchmark tests against popular libraries:

| Element Size | Winner | Compared to `modern-screenshot` | Compared to `html2canvas` |
|:------------:|:------:|:-------------------------------:|:-------------------------:|
| 200×100 (Small) | `modern-screenshot` | 1.18× faster | 4.46× faster |
| 400×300 (Modal) | `snapDOM` | 1.04× faster | 4.07× faster |
| 1200×800 (Page view) | `snapDOM` | 2.43× faster | 5.74× faster |
| 2000×1500 (Large scroll area) | `snapDOM` | 5.02× faster | 9.35× faster |
| 4000×2000 (Very large) | `snapDOM` | 11.35× faster | 15.98× faster |

✅ **Key insight**:  
While `modern-screenshot` is yet slightly faster for very small elements, **snapDOM dramatically outperforms all others as the DOM size grows**.

✅ **Perfect for:**  
- Capturing full-page views
- Capturing modal windows
- Complex layouts with custom fonts, backgrounds, or shadow DOM


## License

MIT © Juan Martín Muda - Zumerlab
