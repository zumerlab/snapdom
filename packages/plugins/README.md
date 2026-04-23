# @zumer/snapdom-plugins

Official plugins for [SnapDOM](https://github.com/zumerlab/snapdom) — extend and transform DOM captures with zero core changes.

## Install

```bash
npm install @zumer/snapdom-plugins
```

## Usage

Import plugins individually (recommended for tree-shaking):

```js
import { snapdom } from '@zumer/snapdom';
import { filter } from '@zumer/snapdom-plugins/filter';
import { timestampOverlay } from '@zumer/snapdom-plugins/timestamp-overlay';

const result = await snapdom(element, {
  plugins: [filter({ preset: 'grayscale' }), timestampOverlay()]
});
const png = await result.toPng();
```

Or import everything at once:

```js
import { filter, timestampOverlay, replaceText } from '@zumer/snapdom-plugins';
```

CDN (no install):

```js
import { snapdom } from 'https://esm.sh/@zumer/snapdom';
import { filter } from 'https://esm.sh/@zumer/snapdom-plugins/filter';
```

---

## Plugins

### `filter`

Applies CSS filter effects to the captured clone.

```js
import { filter } from '@zumer/snapdom-plugins/filter';

snapdom(el, { plugins: [filter({ preset: 'grayscale' })] });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `preset` | `string` | — | `'grayscale'` \| `'sepia'` \| `'blur'` \| `'invert'` \| `'vintage'` \| `'dramatic'` |
| `filter` | `string` | `''` | Raw CSS filter string, e.g. `'blur(2px) contrast(1.2)'` |

---

### `timestamp-overlay`

Adds a translucent timestamp label to the captured clone.

```js
import { timestampOverlay } from '@zumer/snapdom-plugins/timestamp-overlay';

snapdom(el, { plugins: [timestampOverlay({ position: 'top-right', format: 'date' })] });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `format` | `string \| function` | `'datetime'` | `'datetime'` \| `'date'` \| `'time'` \| `'iso'` \| custom `(Date) => string` |
| `position` | `string` | `'bottom-right'` | `'top-left'` \| `'top-right'` \| `'bottom-left'` \| `'bottom-right'` |
| `background` | `string` | `'rgba(0,0,0,0.6)'` | Label background color |
| `color` | `string` | `'#fff'` | Label text color |
| `fontSize` | `number` | `11` | Font size in px |

---

### `replace-text`

Find-and-replace text in the captured clone. Supports strings and regex.

```js
import { replaceText } from '@zumer/snapdom-plugins/replace-text';

snapdom(el, {
  plugins: [replaceText({
    replacements: [
      { find: 'DRAFT', replace: 'APPROVED' },
      { find: /\d{4}-\d{2}-\d{2}/, replace: '[REDACTED]' }
    ]
  })]
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `replacements` | `Array<{ find: string\|RegExp, replace: string }>` | `[]` | List of find/replace pairs |

---

### `color-tint`

Tints the entire capture to a specified color using a `mix-blend-mode` overlay.

```js
import { colorTint } from '@zumer/snapdom-plugins/color-tint';

snapdom(el, { plugins: [colorTint({ color: 'royalblue', opacity: 0.4 })] });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `color` | `string` | `'red'` | Any CSS color value |
| `opacity` | `number` | `1` | Overlay opacity (0–1) |

---

### `ascii-export`

Adds a `toAscii()` export method that converts captures to ASCII art.

```js
import { asciiExport } from '@zumer/snapdom-plugins/ascii-export';

const result = await snapdom(el, { plugins: [asciiExport({ width: 100 })] });
const art = await result.toAscii();
console.log(art);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `width` | `number` | `80` | Character width of output |
| `charset` | `string` | `' .:-=+*#%@'` | Characters from lightest to darkest |
| `invert` | `boolean` | `false` | Invert luminance mapping |

---

### `pdf-image`

Exports the capture as a PNG embedded in a downloadable PDF (A4). Adds a `toPdfImage()` method.

```js
import { pdfImage } from '@zumer/snapdom-plugins/pdf-image';

const result = await snapdom(el, { plugins: [pdfImage({ orientation: 'landscape' })] });
await result.toPdfImage(); // triggers download
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `orientation` | `string` | `'portrait'` | `'portrait'` \| `'landscape'` |
| `quality` | `number` | `0.92` | JPEG quality (0–1) |
| `filename` | `string` | `'capture.pdf'` | Download filename |

---

### `html-in-canvas`

Uses the experimental [WICG `drawElementImage`](https://github.com/WICG/canvas-place-element) API for direct DOM-to-canvas rendering where supported. Falls back gracefully.

```js
import { htmlInCanvas } from '@zumer/snapdom-plugins/html-in-canvas';

snapdom(el, { plugins: [htmlInCanvas()] });
```

> This plugin uses an experimental browser API and may not work in all environments.

---

### `prompt-export`

Adds a `toPrompt()` export method that returns an LLM-ready package: an annotated screenshot, a structured element map with bounding boxes, and a pre-formatted text description. Useful for vision-language models, browser-agent pipelines, visual QA, and any workflow that pairs a capture with structured metadata.

```js
import { promptExport } from '@zumer/snapdom-plugins/prompt-export';

const result = await snapdom(el, { plugins: [promptExport()] });
const { image, elements, dimensions, prompt } = await result.toPrompt();
```

The returned object:

| Field | Type | Description |
|-------|------|-------------|
| `image` | `string` | Data URL of the (optionally annotated) screenshot |
| `elements` | `Array` | One entry per detected element: `{ id, tag, type, text, bbox, attributes }` |
| `dimensions` | `{width, height}` | Image dimensions after `maxImageWidth` scaling |
| `prompt` | `string` | Pre-formatted text describing interactive + semantic elements |

`elements` is split into two `type`s:
- `'interactive'` — buttons, links, inputs, `[role]`/`[tabindex]` targets. These get numbered badges overlaid on the screenshot when `annotate` is on.
- `'semantic'` — headings, paragraphs, `<nav>`, `<main>`, images with `alt`, table cells, etc. Structural context, not overlaid.

Each `bbox` is in pixel coordinates of the returned image (scaled against `maxImageWidth`).

```js
// Example — feed a vision-capable LLM
const { image, elements } = await result.toPrompt({ maxImageWidth: 1024 });

// image is a data URL → pass as image input
// elements is JSON → pass as structured context alongside the image
// "Click element [3]" → look up elements[3].bbox for real coordinates
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `annotate` | `boolean` | `true` | Overlay numbered badges on interactive elements |
| `imageFormat` | `'png' \| 'jpg' \| 'webp'` | `'png'` | Output image format |
| `imageQuality` | `number` | `0.8` | Quality for lossy formats (0–1) |
| `maxImageWidth` | `number` | `1024` | Max width in px; downscales and rescales bboxes if larger |
| `interactiveSelector` | `string` | see below | CSS selector for the interactive element set |
| `semanticSelector` | `string` | see below | CSS selector for the semantic element set |
| `labelStyle` | `object` | `{}` | Override styles for the numbered badges (`position`, `color`, `backgroundColor`, etc.) |

Defaults:
- **interactive**: `a[href], button, input, select, textarea, [role="button"|"link"|"tab"|"menuitem"|"checkbox"|"radio"], [tabindex]:not([tabindex="-1"]), summary, [contenteditable="true"]`
- **semantic**: `h1–h6, p, li, img[alt], nav, main, article, section, header, footer, label, td, th, figcaption, blockquote, legend`

Both per-call options (`opts.imageFormat`, etc.) and constructor options are supported; per-call wins.

---

## Plugin registration

**Global** (applies to all captures):

```js
import { snapdom } from '@zumer/snapdom';
import { filter } from '@zumer/snapdom-plugins/filter';

snapdom.plugins(filter({ preset: 'sepia' }));
```

**Per-capture** (overrides global for that call):

```js
const result = await snapdom(element, {
  plugins: [filter({ preset: 'dramatic' })]
});
```

Per-capture plugins run before global ones. Duplicate plugin names are skipped automatically.

---

## Build your own plugin

Use the template to scaffold a new plugin in seconds:

```bash
npx degit zumerlab/snapdom/packages/plugin-template my-plugin
```

See [PLUGIN_SPEC.md](../../PLUGIN_SPEC.md) for the full hook specification and [CONTRIBUTING_PLUGINS.md](../../CONTRIBUTING_PLUGINS.md) to get your plugin listed on the community page.

---

## License

MIT
