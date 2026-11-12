# SnapDOM plugins

The core exports images, canvases and blobs. Everything else is a plugin from one of four npm packages, each MIT and each needing `@zumer/snapdom` 3.4.0 or newer within 3.x. Their version numbers do not follow the core's.

## Contents

- [Registering](#registering)
- [PDF](#pdf-zumersnapdom-pdf)
- [Vector](#vector-zumersnapdom-vector)
- [Stream](#stream-zumersnapdom-stream)
- [Toolbox](#toolbox-zumersnapdom-plugins)
- [Several outputs from one capture](#several-outputs-from-one-capture)
- [Writing a plugin](#writing-a-plugin)

## Registering

```js
import { snapdom } from '@zumer/snapdom';
import { pdf } from '@zumer/snapdom-pdf';

// For one capture
const result = await snapdom(element, { plugins: [pdf()] });

// For every later capture
snapdom.plugins(pdf());
```

A plugin must be present when the capture is taken. A result made without it has no `toPdf()`, and it cannot be added afterwards. Per-capture plugins run before global ones and replace a global plugin of the same name. `result.to('pdf', options)` is the same call as `result.toPdf(options)`.

Without a bundler, import from a CDN that resolves bare imports, as the README does:

```js
import { snapdom } from 'https://esm.sh/@zumer/snapdom@latest';
import { htmlExport } from 'https://esm.sh/@zumer/snapdom-plugins@latest/html-export';
```

## PDF: `@zumer/snapdom-pdf`

```sh
npm install @zumer/snapdom @zumer/snapdom-pdf
```

```js
import { snapdom } from '@zumer/snapdom';
import { pdf } from '@zumer/snapdom-pdf';

const shot = await snapdom(document.querySelector('#report'), {
  dpr: 2,
  embedFonts: true,
  plugins: [pdf()]
});
const blob = await shot.toPdf({ page: 'a4', margin: 36, download: 'report.pdf' });
```

`toPdf()` returns an `application/pdf` `Blob`; `download` (a file name, or `true`) also saves it. The page shows an image of the capture with an invisible text layer on top, so text can be selected, searched and copied, and links are clickable.

Options used most, on `toPdf()` (or on `pdf()` as defaults):

| Option | Default | Notes |
| --- | --- | --- |
| `page` | `'fit'` | `'fit'` is one page the size of the capture. Paper: `'a3'` to `'a6'`, `'b4'`, `'b5'`, `'letter'`, `'legal'`, `'tabloid'`, `'executive'`, or `[width, height]` in points |
| `orientation` | `'portrait'` | or `'landscape'` |
| `margin` | `24` | Points, every side |
| `text`, `links` | `true` | The text layer and clickable links |
| `fields` | `true` | Form controls become fillable PDF fields; `false` keeps their values as text |
| `vectorText` | `false` | Draw text as real letters instead of pixels; needs embedded fonts |
| `header`, `footer`, `pageNumbers` | none / `false` | Need a paper size |
| `meta` | none | `{ title, author, subject, keywords, ... }` |
| `encrypt` | none | `{ userPassword, ownerPassword?, permissions? }`, AES-256; needs HTTPS or localhost |
| `download` | `false` | File name, or `true` for `snapdom.pdf` |

Five options belong on `pdf()` only, because they decide what is read during capture: `formValues`, `shadow`, `breakAvoid`, `outline`, `forms` (all `true` by default).

Sharpness comes from the capture's `scale` and `dpr`; set `dpr` (for example `2`) for the same file on every machine. Page breaks avoid table rows, list items, figures, images and anything with `break-inside: avoid`. Covering text with a box does not remove it from the text layer: remove it before capturing. Reference: https://snapdom.dev/plugins/pdf/

## Vector: `@zumer/snapdom-vector`

```sh
npm install @zumer/snapdom @zumer/snapdom-vector
```

```js
import { snapdom } from '@zumer/snapdom';
import { vector } from '@zumer/snapdom-vector';

const result = await snapdom(element, { plugins: [vector()] });
const svg = await result.toVector();   // standalone SVG string, no <foreignObject>
copyButton.addEventListener('click', () => result.toFigma());
```

`toVector()` returns a string with editable text and native shapes for the CSS it supports; what it had to approximate is reported in the console with a `[snapdom-vector]` prefix. `toFigma()` writes a Figma clipboard payload and resolves with no value; it needs the async clipboard API, HTTPS or localhost, and a user action. The only option is `exclude` (selector, predicate or array). Keep the source element in the document until the export has finished. Register it per capture, not globally. Reference: https://snapdom.dev/plugins/vector/

## Stream: `@zumer/snapdom-stream`

```sh
npm install @zumer/snapdom @zumer/snapdom-stream
```

```js
import { stream } from '@zumer/snapdom-stream';

const live = stream(panel, {
  scale: 2,
  onFrame(frame) {
    // frame.canvas is updated in place; frame.rects lists what changed, in canvas pixels
  }
});
await live.ready;
// live.canvas is the canvas
live.stop();
```

`stream()` is a function, not a capture plugin: it returns `{ canvas, ready, stats, stop() }` and keeps the canvas in step with the element, repainting only the boxes that changed. It takes every capture option plus `onFrame`, `fps`, `patches` (`true`) and `animations` (`true`). The package also exports `streamTexture(gl)` (a WebGL texture that follows the stream), `recordCanvas(canvas, { fps, duration })` (records to MP4 or WebM), `streamExport()` (a plugin that adds `result.toStream()`), and overlay templates (`overlayStage`, `scoreboard`, `lowerThird`, `ticker`, `liveBadge`). Reference: https://snapdom.dev/plugins/stream/

## Toolbox: `@zumer/snapdom-plugins`

```sh
npm install @zumer/snapdom @zumer/snapdom-plugins
```

Twelve plugins. Import each from its subpath, or all but `jxl` from the package root.

| Factory | Import from | What it does |
| --- | --- | --- |
| `gifExport({ fps, duration, frames, maxColors, background, scale, repeat, filename })` | `@zumer/snapdom-plugins/gif-export` | `toGif()`: records the live element into an `image/gif` `Blob`. Defaults `fps: 10`, `duration: 2000` ms |
| `videoExport({ fps, duration, frames, background, scale, bitrate, filename })` | `/video-export` | `toMp4()`: records through `MediaRecorder`; MP4 where supported, else WebM. Read `blob.type` |
| `htmlExport({ fullDocument, filename, title, lang })` | `/html-export` | `toHtml()`: the captured clone as an HTML string with its styles and fonts. Not sanitized |
| `contextExport({ format, maxTextLength, maxNodes, geometry })` | `/context-export` | `toContext()`: a text outline, or with `format: 'json'` a tree `{ root, truncated, nodes }`, of structure, roles, text and state |
| `agentMap({ image, fields, semantic, maxImageWidth, ... })` | `/agent-map` | `toAgentMap()`: `{ image, map, dimensions }`, an image with numbered badges and a JSON map of interactive elements with name, role and bounds |
| `asciiExport({ width, charset, invert, format, contrast })` | `/ascii-export` | `toAscii()`: the capture as ASCII art text |
| `jxl({ effort, decoder, ... })` | `/jxl` only | `toJxl()`, and `'jxl'` as a format for `toBlob()` and `download()`. Needs `npm install rapier-jxl` |
| `redactInputs({ types, autocomplete, selector, all, mask, blocks, attributes })` | `/redact-inputs` | Masks input and textarea values in the capture; `blocks` hides whole subtrees. By default email, tel and sensitive autocomplete fields; `all: true` for every field |
| `replaceText({ replacements })` | `/replace-text` | `[{ find: string \| RegExp, replace: string }]` applied to text in the clone |
| `timestampOverlay({ format, position, background, color, fontSize })` | `/timestamp-overlay` | A timestamp label on the capture |
| `filter({ preset, filter })` | `/filter` | A CSS filter over the capture. Presets: `grayscale`, `sepia`, `blur`, `invert`, `vintage`, `dramatic` |
| `colorTint({ color, opacity })` | `/color-tint` | A color overlay |

```js
import { gifExport } from '@zumer/snapdom-plugins/gif-export';

const result = await snapdom(el, { plugins: [gifExport({ fps: 12, duration: 3000 })] });
const blob = await result.toGif();
await result.toGif({ download: 'animation.gif' });
```

GIF and video are the exception to "a result is frozen": recording starts when `toGif()` or `toMp4()` is called and takes new frames of the live element for the whole duration. `toMp4()` needs `MediaRecorder` and `canvas.captureStream()`.

The plugin named `filter` (a CSS effect) and the capture option `filter` (a keep predicate) are different things.

`contextExport({ needs: 'clone' })` and `agentMap({ image: false, needs: 'clone' })`, passed per capture, skip rendering when only the text or the map is wanted. Such a result has no image: `result.url` and the image exports throw.

One page per plugin, with options and a live demo: https://snapdom.dev/plugins/

## Several outputs from one capture

```js
import { snapdom } from '@zumer/snapdom';
import { htmlExport, contextExport, redactInputs } from '@zumer/snapdom-plugins';

const result = await snapdom(form, {
  plugins: [redactInputs({ all: true }), htmlExport(), contextExport()]
});
const image = await result.toPng();
const html = await result.toHtml();
const outline = await result.toContext();
```

## Writing a plugin

A plugin is an object with a `name` and any of these hooks, all of which may be async and receive the capture context: `beforeSnap`, `beforeClone`, `afterClone`, `beforeRender`, `afterRender`, `beforeExport`, `afterExport`, `afterSnap`, plus `resolveNode(node, ctx)` and `defineExports(ctx)`.

```js
// Edit the clone before it is rendered (what html2canvas's onclone did)
const image = await snapdom.toPng(el, {
  plugins: [{
    name: 'strip-controls',
    afterClone(ctx) {
      ctx.clone.querySelectorAll('button').forEach(node => node.remove());
    }
  }]
});
```

`defineExports(ctx)` returns `{ name: async (ctx, options) => value }`; each key becomes `result.to<Name>()`. It can build on the core exporters through `ctx.exports.png()`, `ctx.exports.canvas()` and the rest. Hook reference: https://snapdom.dev/docs/plugins/ and `PLUGIN_SPEC.md` in the repository.
