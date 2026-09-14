# @zumer/snapdom-plugins

Official plugins for [SnapDOM](https://github.com/zumerlab/snapdom), a capture engine for
web apps. Core exports images and canvases; this package adds HTML, structured context,
element maps, PDF, ASCII, visual transforms and live GIF/video recording.

Image, HTML and structured exports use captured state; GIF and video start a sequence of
live captures when their export method is called.

## Install

Install the plugins next to a matching core:

```bash
npm install @zumer/snapdom@3.0.0 @zumer/snapdom-plugins@3.0.0
```

Plugins 3.x require a 3.x core. See the [migration guide](https://github.com/zumerlab/snapdom#migrating-from-v2) when upgrading from v2.

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

Or use the package entry point:

```js
import { filter, timestampOverlay, replaceText } from '@zumer/snapdom-plugins';
```

CDN (no install):

```js
import { snapdom } from 'https://esm.sh/@zumer/snapdom@3.0.0';
import { filter } from 'https://esm.sh/@zumer/snapdom-plugins@3.0.0/filter';
```

---

## Plugins

### `filter`

Applies CSS filter effects to the clone, overriding authored filters. `preset` takes
precedence over `filter`; an unknown preset logs a warning and `filter` applies.

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

Adds a timestamp label. The clock or custom formatter runs for every capture.

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

Replaces DOM text in the clone using strings or regular expressions. Stylesheet and script
text are left unchanged.

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

### `redact-inputs`

Masks input and textarea values, excludes selected blocks, and removes named attributes
from captured outputs. Core already masks password fields to match their visible bullets;
other field values remain visible unless you redact them. The live page stays unchanged.

```js
import { redactInputs } from '@zumer/snapdom-plugins/redact-inputs';

// Defaults: email, tel, and the cc-* / current-password / new-password / one-time-code
// autocomplete tokens.
snapdom(el, { plugins: [redactInputs()] });

// Everything, including textareas:
snapdom(el, { plugins: [redactInputs({ all: true })] });

// App-specific fields, blanked rather than bulleted:
snapdom(el, { plugins: [redactInputs({ selector: '[data-private]', mask: () => '' })] });

// Exclude whole blocks and remove metadata attributes:
const redaction = redactInputs({
  blocks: ['.private-panel', '[data-private-block]'],
  attributes: [
    { selector: '[data-token]', names: ['data-token'] },
    { selector: '.customer', names: ['title', 'aria-label'] }
  ]
});
snapdom(el, { plugins: [redaction] });

// Remove those blocks from the layout as well:
snapdom(el, { excludeMode: 'remove', plugins: [redaction] });
```

The default mask keeps the string's length. Glyph widths can differ, so wrapping and truncation may change.
A `<select>` is not masked (its visible option label stays); hide it with a `blocks` rule instead.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `types` | `string[]` | `['email', 'tel']` | Input `type` attribute values to redact |
| `autocomplete` | `string[]` | `['cc-*', 'current-password', 'new-password', 'one-time-code']` | Autocomplete tokens; a trailing `*` matches by prefix |
| `selector` | `string` | `''` | Extra CSS selector for inputs and textareas |
| `all` | `boolean` | `false` | Redact every input and textarea, regardless of `types`, `autocomplete` or `selector` |
| `mask` | `(value, el) => string` | same-length bullets | Custom masker |
| `blocks` | `string \| string[]` | `[]` | CSS selectors for whole subtrees to exclude; uses the capture's `excludeMode` |
| `attributes` | `Array<{ selector: string, names: string[] }>` | `[]` | Remove exact named attributes from clones of matching source elements and their semantic projections; names are not wildcard patterns |

`blocks` keeps an invisible space by default (`excludeMode: 'hide'`); `'remove'` drops the
subtree from the captured layout. It combines with the capture's existing `exclude` rules.
If the capture root itself belongs to a blocked subtree, `'remove'` throws; use `'hide'`
for that capture. Selectors match source elements, including nodes in open shadow trees.

`attributes` removes the listed DOM attributes and their projections in `agent-map` and
`context-export`, such as accessible names or structured state. It does not erase copies
of those values already materialized as visible text, CSS `content`, or bitmap pixels.
Use `blocks` to hide the subtree that paints visible content. A `value` attribute rule on
an input or textarea clears its displayed value and omits its structured `state.value`.
Existing default field masks still apply when you add block or attribute rules.

HTML exports use the sanitized clone. `agent-map` and `context-export` apply the same
block, attribute and field rules to their source-derived data, regardless of official
plugin order. The rules do not search arbitrary text or images for sensitive content.

The built-in mask without custom selectors permits reuse of unchanged captures. Custom
masks and nonempty `selector`, `blocks` or `attributes` rules run on every capture. Changed
content runs the full pipeline so no field skips redaction.

Nonempty `blocks` or `attributes` rules add a final `beforeRender` pass. In builds with the
experimental `engine: 'html-in-canvas'` enabled, that pass makes the capture use the SVG
renderer. Field-only redaction does not add this pass.

`agent-map` and `context-export` omit sensitive values and mask other typed values in their
structured state fields. Ordinary page text and labels remain. An attached image still
follows core's capture policy; use this plugin to mask its visible fields too.

---

### `color-tint`

Tints an HTML capture with a `mix-blend-mode` overlay. Opacity `0` leaves it unchanged.

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

`toAscii({ width, charset, invert })` overrides any of the three per call.

---

### `pdf-image`

Adds `toPdfImage()`, which downloads a single-page A4 PDF containing a JPEG of the capture.
Text is part of the image. The method returns a temporary object URL, revoked after five seconds.

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

### `agent-map`

Adds `toAgentMap()`: an image with numbered badges on interactive elements and a JSON map
of their names, roles, bounds and state. This format is often called Set-of-Mark.

```js
import { agentMap } from '@zumer/snapdom-plugins/agent-map';

const result = await snapdom(el, { plugins: [agentMap()] });
const { image, map, dimensions } = await result.toAgentMap();

// image: data URL of the screenshot with numbered red badges overlaid
// map:   [{ i, n, r, b, s? }, …]: index, name, role, bbox, state
// Agent says "click element 2" → map[2].b gives [x, y, w, h]
```

Map entry shape (default `fields: 'minimal'`):

| Key | Type | Description |
|-----|------|-------------|
| `i` | `number` | Index matching the badge drawn on the image |
| `n` | `string` | Accessible name: aria-label → labelledby → alt → title → labels → textContent. The textContent fallback is capped at 60 characters |
| `r` | `string` | Explicit `role` or an implicit role such as `button`, `link`, `checkbox`, `radio`, `textbox`, `combobox`, `slider` or `heading` |
| `b` | `[x, y, w, h]` | Bounding box in output pixels, scaled with the image and `maxImageWidth` |
| `s` | `object?` | Meaningful state: `checked`, `disabled`, `focus`, `expanded`, `pressed`, `selected`, `value`, `hasValue`, `open`, `selectedText`, `covered` |
| `isSemanticOnly` | `true?` | Structural entry added by `semantic: true`; no badge is drawn for it |

Example map for a checkout form:

```js
[
  { i: 0, n: 'Email',         r: 'textbox',  b: [28,  80, 280, 34] },
  { i: 1, n: 'Send product updates', r: 'checkbox', b: [28, 134,  13, 13], s: { checked: true } },
  { i: 2, n: 'Apply coupon',  r: 'button',   b: [28, 176, 114, 38], s: { expanded: false } },
  { i: 3, n: 'Remove coupon', r: 'button',   b: [150, 176, 140, 38], s: { disabled: true } },
  { i: 4, n: 'Pay $53.90',    r: 'button',   b: [28, 220,  97, 38] }
]
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `image` | `'annotated' \| 'raw' \| false` | `'annotated'` | Annotated image, raw image or map only. `false` skips this export's image generation; see `needs` to skip capture rendering too |
| `fields` | `'minimal' \| 'full'` | `'minimal'` | `'full'` adds `t` (raw text content) and `a` (meaningful attributes) per entry. |
| `semantic` | `boolean` | `false` | Include structural elements such as headings, paragraphs and landmarks |
| `maxImageWidth` | `number` | `1024` | Downscale target for the image; bboxes rescale to match. |
| `imageFormat` | `'png' \| 'jpg' \| 'webp'` | `'png'` | Image format (only used when image is rendered). |
| `imageQuality` | `number` | `0.8` | Quality for lossy formats. |
| `interactiveSelector` | `string` | see below | CSS selector for interactive elements. |
| `semanticSelector` | `string` | see below | CSS selector for semantic elements (used when `semantic: true`). |
| `labelStyle` | `object` | `{}` | Override badge styles. |
| `needs` | `'clone' \| 'render'` | `'render'` | Use `'clone'` with `image: false` to skip rendering; only valid on a per-capture plugin |

Defaults:

- Interactive elements: links with `href`, buttons, inputs, selects, textareas, summaries,
  `[contenteditable="true"]`, and elements with `tabindex` other than `-1`. Also matches
  roles `button`, `link`, `tab`, `menuitem`, `checkbox`, `radio`, `switch`, `slider`, `combobox`, `textbox`.
- Structural elements: `h1`–`h6`, `nav`, `main`, `article`, `section`, `header`, `footer`,
  `figcaption`, `blockquote`, `legend`, `p`.

Per-call overrides: `image`, `imageFormat`, `imageQuality`, `maxImageWidth`, plus image sizing
(`width`, `height`, `scale`, `dpr`) and `backgroundColor`. Selectors, fields, semantics and badge
styles are frozen during capture. For a map without rendering:

```js
const result = await snapdom(el, { plugins: [agentMap({ image: false, needs: 'clone' })] });
const { map, dimensions } = await result.toAgentMap();
```

Such a result has no image; `result.url` and image exports throw. The map includes open shadow
roots and slotted content and respects core's exclusion policy. Sensitive input values are
omitted; other input/textarea values become up to 12 bullets. This does not redact the image.

Badges are applied only to `toAgentMap({ image: 'annotated' })`; raw images and other exports
keep the captured page. Bounding boxes are not exact with perspective, rotated ancestors,
or a root rotation stripped by `outerTransforms: false`.

#### When to use

Use it for visual agents that need element coordinates, visual QA, or image/map datasets.
It runs inside the web app, including browser extensions and Electron pages, without
requiring an external browser automation process.

---

### `context-export`

Adds `toContext()`: the captured UI as a text outline or JSON tree containing structure,
roles, visible text, state and optional bounds. It skips hidden content and collapses
wrappers that add no information.

```js
import { contextExport } from '@zumer/snapdom-plugins/context-export';

const result = await snapdom(el, { plugins: [contextExport()] });
const outline = await result.toContext();
const { root, truncated, nodes } = await result.toContext({ format: 'json' });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `format` | `'outline' \| 'json'` | `'outline'` | Text outline or `{ root, truncated, nodes }` |
| `maxTextLength` | `number` | `120` | Per-node text limit; longer text ends with an ellipsis |
| `maxNodes` | `number` | `800` | Node limit; output reports truncation |
| `geometry` | `boolean` | `true` | Include `[x, y, width, height]` relative to the capture root |
| `needs` | `'clone' \| 'render'` | `'render'` | `'clone'` skips rendering; only valid on a per-capture plugin |

The tree is frozen during capture. Per-call options can change `format`, `maxTextLength`,
or omit captured geometry. They cannot increase `maxNodes` or restore geometry that was
not captured. Open shadow roots and slots follow core's exclusion policy. Sensitive input
values are omitted; other input/textarea values are masked. Ordinary page text and attributes
remain in the output.

Use `contextExport({ needs: 'clone' })` when you only need structured output. That result
has no image, so `result.url` and image exports throw.

---

### `html-export`

Adds `toHtml()`, which returns the frozen clone with its captured styles and fonts as an
HTML document. You can reopen the captured layout without exporting it as a bitmap.

```js
import { htmlExport } from '@zumer/snapdom-plugins/html-export';

const result = await snapdom(el, { plugins: [htmlExport()] });
const html = await result.toHtml();              // full <!DOCTYPE html> string

// Or download a .html file:
await result.toHtml({ download: 'snapshot.html' });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fullDocument` | `boolean` | `true` | Wrap output in `<!DOCTYPE html>…`; if `false`, return just `<style>` + the fragment |
| `filename` | `string` | `'capture.html'` | Download filename when `opts.download` is `true` |

Per-call `opts` accepts `fullDocument`, `filename` and `download`. Set `download: true` to
download, or pass a filename string. The method returns the HTML string either way.

The document retains source markup, including event-handler attributes; it is not sanitized.

---

### `gif-export`

Adds `toGif()`, which records the live element and returns an `image/gif` Blob. Its built-in
GIF89a encoder uses median-cut quantization and LZW, with no encoding dependency.

```js
import { gifExport } from '@zumer/snapdom-plugins/gif-export';

const result = await snapdom(el, { plugins: [gifExport({ fps: 12, duration: 3000 })] });
const blob = await result.toGif();

// Or download directly:
await result.toGif({ download: 'animation.gif' });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fps` | `number` | `10` | Frames per second |
| `duration` | `number` | `2000` | Total duration in ms (ignored if `frames` is set) |
| `frames` | `number` | — | Explicit frame count (overrides `duration`) |
| `maxColors` | `number` | `256` | Palette size per frame (2–256) |
| `background` | `string` | `'#ffffff'` | Color composited under transparent pixels |
| `scale` | `number` | capture's scale | Capture scale |
| `repeat` | `number` | `0` | Loop count (`0` = forever, `-1` = play once) |
| `filename` | `string` | `'capture.gif'` | Download filename |

Per-call `opts` override constructor options and accept `download` (`boolean \| string`).
Recording starts when `toGif()` runs, including its first frame. It preserves the original
capture policy, including exclusions and plugins. Frame capture speed limits the sampling rate.

---

### `video-export`

Adds `toMp4()`, which records the live element through `MediaRecorder`. The returned Blob's
type identifies the recorded container.

```js
import { videoExport } from '@zumer/snapdom-plugins/video-export';

const result = await snapdom(el, { plugins: [videoExport({ fps: 30, duration: 4000 })] });
const blob = await result.toMp4();

// Or download directly:
await result.toMp4({ download: true });
```

The plugin tries supported MP4 codecs first, then WebM. A WebM fallback logs a warning;
the default download filename matches the recorded `.mp4` or `.webm` container. Explicit
filenames and `download` strings are used as supplied.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fps` | `number` | `10` | Frames per second |
| `duration` | `number` | `2000` | Total duration in ms (ignored if `frames` is set) |
| `frames` | `number` | — | Explicit frame count (overrides `duration`) |
| `background` | `string` | `'#ffffff'` | Color composited under transparent pixels |
| `scale` | `number` | capture's scale | Capture scale |
| `bitrate` | `number` | — | `videoBitsPerSecond` passed to `MediaRecorder` |
| `filename` | `string` | — | Download filename; the default follows the recorded `.mp4` / `.webm` container |

Requires `MediaRecorder` and `canvas.captureStream()`, which may be unavailable in headless
environments. Per-call `opts` override constructor options and accept `download`
(`boolean \| string`). Recording starts at the call and preserves capture options as GIF
recording does. MediaRecorder uses a real-time clock, so slow captures can stretch duration.

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

Start from the plugin template:

```bash
npx degit zumerlab/snapdom/packages/plugin-template my-plugin
cd my-plugin && npm install --save-dev @zumer/snapdom@3.0.0
```

See [PLUGIN_SPEC.md](../../PLUGIN_SPEC.md) for the full hook specification and [CONTRIBUTING_PLUGINS.md](../../CONTRIBUTING_PLUGINS.md) to get your plugin listed on the community page.

---

## License

MIT
