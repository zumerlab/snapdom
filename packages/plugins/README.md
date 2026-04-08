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
