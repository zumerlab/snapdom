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

### `agent-map`

Produces a Set-of-Mark package for **visual agents**: an annotated screenshot with numbered badges on interactive elements, plus a compact JSON map from badge index → role / accessible name / bbox / state. One call, fully client-side.

```js
import { agentMap } from '@zumer/snapdom-plugins/agent-map';

const result = await snapdom(el, { plugins: [agentMap()] });
const { image, map, dimensions } = await result.toAgentMap();

// image: data URL of the screenshot with numbered red badges overlaid
// map:   [{ i, n, r, b, s? }, …] — index, name, role, bbox, state
// Agent says "click element 2" → map[2].b gives [x, y, w, h]
```

Map entry shape (default `fields: 'minimal'`):

| Key | Type | Description |
|-----|------|-------------|
| `i` | `number` | Index matching the badge drawn on the image |
| `n` | `string` | Accessible name (aria-label → labelledby → alt → title → labels → textContent, truncated to 60 chars) |
| `r` | `string` | ARIA-style role (`button`, `link`, `checkbox`, `radio`, `textbox`, `combobox`, `slider`, `heading`, …) — derived from `role` attribute or implicit role of the element |
| `b` | `[x, y, w, h]` | Bounding box in pixels, scaled against `maxImageWidth` |
| `s` | `object?` | State: included only when at least one key is meaningful — `checked`, `disabled`, `focus`, `expanded`, `pressed`, `selected`, `value`, `open`, `selectedText`, `covered` |

Example map for a checkout form:

```js
[
  { i: 0, n: 'Email',         r: 'textbox',  b: [28,  80, 280, 34], s: { value: 'ada@example.com' } },
  { i: 1, n: 'Send product updates', r: 'checkbox', b: [28, 134,  13, 13], s: { checked: true } },
  { i: 2, n: 'Apply coupon',  r: 'button',   b: [28, 176, 114, 38], s: { expanded: false } },
  { i: 3, n: 'Remove coupon', r: 'button',   b: [150, 176, 140, 38], s: { disabled: true } },
  { i: 4, n: 'Pay $53.90',    r: 'button',   b: [28, 220,  97, 38] }
]
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `image` | `'annotated' \| 'raw' \| false` | `'annotated'` | `'annotated'` overlays numbered badges; `'raw'` skips badges; `false` skips image generation entirely (no canvas draw, no toDataURL — cheapest path). |
| `fields` | `'minimal' \| 'full'` | `'minimal'` | `'full'` adds `t` (raw text content) and `a` (meaningful attributes) per entry. |
| `semantic` | `boolean` | `false` | Include non-interactive structural elements (headings, paragraphs, landmarks). Off by default — agents act on interactive. |
| `maxImageWidth` | `number` | `1024` | Downscale target for the image; bboxes rescale to match. |
| `imageFormat` | `'png' \| 'jpg' \| 'webp'` | `'png'` | Image format (only used when image is rendered). |
| `imageQuality` | `number` | `0.8` | Quality for lossy formats. |
| `interactiveSelector` | `string` | see below | CSS selector for interactive elements. |
| `semanticSelector` | `string` | see below | CSS selector for semantic elements (used when `semantic: true`). |
| `labelStyle` | `object` | `{}` | Override badge styles. |

Defaults:
- **interactive**: `a[href], button, input, select, textarea, [role="button"|"link"|"tab"|"menuitem"|"checkbox"|"radio"|"switch"|"slider"|"combobox"|"textbox"], [tabindex]:not([tabindex="-1"]), summary, [contenteditable="true"]`
- **semantic**: `h1–h6, nav, main, article, section, header, footer, figcaption, blockquote, legend, p`

Per-call options override constructor options (e.g. `result.toAgentMap({ image: false })`).

#### When to use

- Visual agents using Set-of-Mark prompting — one call gives you both the labelled image and the coordinate lookup table.
- Computer-use / browser-agent harnesses that need click coordinates for a vision model's output.
- Visual QA with an LLM judge — compare before/after captures with structured element identity.
- Dataset generation for vision-LLM fine-tuning — (image, map) pairs.

Because it runs entirely in the browser, it works in contexts where Playwright / Puppeteer can't: Chrome extensions, SaaS web apps capturing the user's own page, Electron apps capturing their own window.

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
