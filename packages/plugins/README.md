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

Adds a `toPrompt()` export method that returns an LLM-ready package: a structured element map with bounding boxes, a pre-formatted prompt text, and (optionally) an annotated screenshot. Tuned for vision-language models, browser-agent pipelines, visual QA, and any workflow that pairs a capture with structured metadata.

```js
import { promptExport } from '@zumer/snapdom-plugins/prompt-export';

const result = await snapdom(el, { plugins: [promptExport()] });
// Default: no image, just the structured map + prompt text (cheapest)
const { elements, prompt, dimensions } = await result.toPrompt();
```

To also include the annotated image (for tasks that truly depend on vision):

```js
const result = await snapdom(el, {
  plugins: [promptExport({ include: ['image', 'elements', 'prompt'] })]
});
const { image, elements, prompt, dimensions } = await result.toPrompt();
```

The returned object (fields present only if requested via `include`):

| Field | Type | Description |
|-------|------|-------------|
| `elements` | `Array` | One entry per detected element: `{ id, tag, type, name, text, bbox, attributes, state?, styles?, covered? }` |
| `prompt` | `string` | Pre-formatted text describing interactive + semantic elements |
| `image` | `string` | Data URL of the (optionally annotated) screenshot — **only when `include` contains `'image'`** |
| `dimensions` | `{width, height}` | Scaled dimensions (always present) |

`elements` is split into two `type`s:
- `'interactive'` — buttons, links, inputs, `[role]`/`[tabindex]` targets. These get numbered badges overlaid on the screenshot when `annotate` is on.
- `'semantic'` — headings, paragraphs, `<nav>`, `<main>`, images with `alt`, table cells, etc. Structural context, not overlaid.

Each `bbox` is in pixel coordinates of the returned image (scaled against `maxImageWidth`).

Each interactive entry also carries:
- `name` — the computed accessible name (aria-label → labelledby → alt → title → labels[0] → textContent)
- `state` — runtime state: `{ checked, disabled, focus, open, value, selectedText }` (only keys that apply)
- `styles` — visually-meaningful computed props filtered to drop defaults
- `covered: true` when another element is painted on top of the bbox center (an agent won't click through a modal)

```js
// Example — feed a vision-capable LLM
const { image, elements } = await result.toPrompt({
  include: ['image', 'elements', 'prompt']
});

// image is a data URL → pass as image input
// elements is JSON → pass as structured context alongside the image
// "Click element [3]" → look up elements[3].bbox for real coordinates
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `include` | `string[]` | `['elements', 'prompt']` | Fields to return. Add `'image'` for tasks that need vision (chart content, layout QA, canvas). Use `['prompt']` for the cheapest text-only mode. |
| `annotate` | `boolean` | `true` | Overlay numbered badges on interactive elements (only affects the image when included) |
| `promptMode` | `'compact' \| 'verbose'` | `'compact'` | Prompt text verbosity. Compact omits coords when badges are on the image. |
| `includeCoords` | `boolean` | `true` | Include bbox in the prompt text |
| `imageFormat` | `'png' \| 'jpg' \| 'webp'` | `'png'` | Output image format (only used when `image` is included) |
| `imageQuality` | `number` | `0.8` | Quality for lossy formats (0–1) |
| `maxImageWidth` | `number` | `1024` | Max width in px; downscales and rescales bboxes if larger |
| `interactiveSelector` | `string` | see below | CSS selector for the interactive element set |
| `semanticSelector` | `string` | see below | CSS selector for the semantic element set |
| `labelStyle` | `object` | `{}` | Override styles for the numbered badges (`position`, `color`, `backgroundColor`, etc.) |

Defaults:
- **interactive**: `a[href], button, input, select, textarea, [role="button"|"link"|"tab"|"menuitem"|"checkbox"|"radio"], [tabindex]:not([tabindex="-1"]), summary, [contenteditable="true"]`
- **semantic**: `h1–h6, p, li, img[alt], nav, main, article, section, header, footer, label, td, th, figcaption, blockquote, legend`

Both per-call options (`opts.include`, `opts.imageFormat`, etc.) and constructor options are supported; per-call wins.

#### Why the default excludes the image

Across 5 real pages (GitHub repo header, HN front page, Wikipedia article, Stripe pricing, snapdom.dev) with 15 UI-inspection questions total, we fed each capture to a VLM in five shapes and scored the answers:

| Method | Score | Total input tokens |
|--------|-------|--------------------|
| Raw PNG only | 7.5/15 | ~20,000 |
| Anthropic WebFetch tool¹ | 13/15 | ~850 |
| `toPrompt()` full — `['image','elements','prompt']` | 15/15 | ~115,000 |
| `toPrompt()` — `['elements','prompt']` (new default) | 15/15 | ~100,000 |
| **`toPrompt()` text only — `['prompt']`** | **15/15** | **~7,900** |

Vision-only (raw PNG) fails on dense-text UIs at typical capture resolutions — the text is simply too small to read reliably. Adding the structured text + JSON map recovers full accuracy. Adding the image *on top* of that doesn't improve accuracy on UI-inspection tasks, it just costs ~14× more tokens.

¹ WebFetch tokens measure the summary response returned to the model; Anthropic handles the fetch and summarization server-side, so the dev doesn't pay for the raw HTML (~100k tokens across these 5 pages). The lower token count is real, but so are the trade-offs: the summary is a black box that can miss details, it hallucinated a CTA label on snapdom.dev ("Browse Demos" doesn't exist on the page), and for live UIs it can return a different snapshot than what the dev captured (HN's front page reordered between our capture and the WebFetch call, giving points/comment counts that didn't match what was on screen). `toPrompt` captures the exact live DOM from inside the browser, so there's no drift.

The image still belongs in the output when the task truly depends on vision (reading a chart, judging layout, diffing visual regressions). Opt in per call:

```js
// Vision-dependent task
await result.toPrompt({ include: ['image', 'elements', 'prompt'] });

// Pure structured agent loop
await result.toPrompt({ include: ['prompt'] });
```

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
