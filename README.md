# snapDOM

**snapDOM** is a high-fidelity DOM capture tool, developed as part of the animation engine for Zumly — a framework for creating smooth zoom-based view transitions.

It converts any HTML element into a scalable SVG image, preserving styles, fonts, backgrounds, shadow DOM content, pseudo-elements, and more.

- 📸 Full DOM capture
- 🎨 Embedded styles, pseudo-elements, and fonts
- 🖼️ Export to SVG, PNG, JPG, WebP, or `canvas`
- ⚡ Lightweight, no dependencies
- 📦 100% based on standard Web APIs

---

## Installation

You can use **snapDOM** either by including it as a script or importing it as a module.

### Script tag

```html
<script src="snapdom.js"></script>
```

The global object `captureAs` will be available.

---

### ES Module

```javascript
import { captureAs } from './snapdom.esm.js';
```

Now you can call `captureAs.dataURL()`, `captureAs.png()`, etc., directly in your JavaScript.

---

## Basic usage

```javascript
// Capture an element as SVG Data URL
const svgDataUrl = await captureAs.dataURL(document.querySelector("#myElement"));

// Insert the captured image into the page
const img = new Image();
img.src = svgDataUrl;
document.body.appendChild(img);
```

---

## API

The main API is exposed as `captureAs` and offers multiple capture methods:

| Method | Description | Returns |
|:-------|:------------|:--------|
| `captureAs.dataURL(el, scale?)` | Captures as SVG Data URL | `Promise<string>` |
| `captureAs.img(el, scale?)` | Captures as `HTMLImageElement` (SVG) | `Promise<HTMLImageElement>` |
| `captureAs.canvas(el, scale?)` | Captures as `HTMLCanvasElement` | `Promise<HTMLCanvasElement>` |
| `captureAs.png(el, scale?)` | Captures as PNG image (`Image`) | `Promise<HTMLImageElement>` |
| `captureAs.jpg(el, scale?, quality?)` | Captures as JPG image (`Image`) | `Promise<HTMLImageElement>` |
| `captureAs.webp(el, scale?, quality?)` | Captures as WebP image (`Image`) | `Promise<HTMLImageElement>` |
| `captureAs.blob(el, scale?)` | Captures as SVG `Blob` | `Promise<Blob>` |

**Parameters:**
- `el`: DOM element to capture.
- `scale`: Scale factor (default is `1`).
- `quality`: Compression quality for JPG/WebP (range `0`–`1`).

---

## Special features

- **Shadow DOM**: Captures content inside Web Components and `shadowRoot`.
- **Pseudo-elements**: Captures `::before` and `::after`, including background images.
- **Backgrounds and images**: Inlines external images as Data URLs.
- **Fonts**: Replicates applied font families without needing external font files.
- **Placeholder and Exclusion**:
  - `data-capture="exclude"`: Skips an element while preserving layout space.
  - `data-capture="placeholder"` + `data-placeholder-text="Text"`: Replaces an element with decorative placeholder text.

---

## Full example

```html
<div id="captureMe">
  <h1 style="color: tomato;">Hello World!</h1>
  <p>This content will be captured.</p>
</div>

<script type="module">
  import { captureAs } from './snapdom.esm.js';

  const button = document.createElement('button');
  button.textContent = "Capture";
  button.onclick = async () => {
    const img = await captureAs.png(document.getElementById('captureMe'), 2);
    document.body.appendChild(img);
  };
  document.body.appendChild(button);
</script>
```

---

## Limitations

- External images must be CORS-accessible.
- Fonts must be fully loaded before capturing (`document.fonts.ready` is automatically awaited).
- Very dynamic or complex layouts might require manual style adjustments.

---

## License

MIT © Juan Martín Muda - Zumerlab
