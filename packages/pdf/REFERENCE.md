# SnapDOM PDF reference

Reference for `@zumer/snapdom-pdf` 1.0.0. The same text is at https://snapdom.dev/plugins/pdf/docs.html.

Turn a SnapDOM capture into a real PDF: pages, selectable text, links, bookmarks and fillable fields. Everything runs in the browser and nothing is uploaded.

## Install

```sh
npm install @zumer/snapdom @zumer/snapdom-pdf
```

It needs SnapDOM 3.4.0 or newer. Without a bundler, map both packages in an import map and serve the whole `@zumer/snapdom-pdf` folder, because its `index.js` imports files from `src/`.

```html
<script type="importmap">
{
  "imports": {
    "@zumer/snapdom": "/vendor/snapdom.mjs",
    "@zumer/snapdom-pdf": "/vendor/snapdom-pdf/index.js"
  }
}
</script>
```

## Quick start

```js
import { snapdom } from '@zumer/snapdom'
import { pdf } from '@zumer/snapdom-pdf'

snapdom.plugins(pdf())

const shot = await snapdom(document.querySelector('#report'), { dpr: 2 })
const blob = await shot.toPdf({ page: 'a4', download: 'report.pdf' })
```

Register the plugin before you capture. A capture made without it has no `toPdf()`. To use it on one capture only, pass it there: `snapdom(el, { plugins: [pdf()] })`.

`toPdf()` returns a PDF `Blob`. `download` also saves the file. `shot.to('pdf', options)` does the same as `toPdf(options)`.

## Options on pdf()

Five options decide what the plugin reads from the page while SnapDOM captures it, so they go on `pdf()` and not on `toPdf()`.

| Option | Default | What it does |
|---|---|---|
| `formValues` | `true` | Include the values typed in inputs and the selected option. Passwords become bullets. |
| `shadow` | `true` | Read text inside open shadow roots. |
| `breakAvoid` | `true` | Measure blocks so page breaks avoid cutting them. |
| `outline` | `true` | Turn headings into bookmarks. A selector string picks other elements; `false` turns it off. |
| `forms` | `true` | Measure form controls so the PDF can have fillable fields. |

Every other option works in either place. On `pdf()` it becomes the default for every export; in `toPdf()` it applies to that export and wins.

## Pages

| Option | Default | What it does |
|---|---|---|
| `page` | `'fit'` | `'fit'` makes one page the size of the capture. Paper sizes: `'a3'` to `'a6'`, `'b4'`, `'b5'`, `'letter'`, `'legal'`, `'tabloid'`, `'executive'`, or `[width, height]` in points. |
| `orientation` | `'portrait'` | `'portrait'` or `'landscape'`. |
| `margin` | `24` | Margin on every side, in points. |
| `repeatHeaders` | `true` | Repeat a table's `` on each page the table continues to. |

Page breaks avoid table rows, list items, figures, quotes, images and anything with `break-inside: avoid`. CSS page breaks are respected. A block taller than a page still has to split.

## Image and file size

What you see in the PDF is an image of the capture, with invisible text on top so it can be selected and searched.

| Option | Default | What it does |
|---|---|---|
| `image` | `true` | Draw the captured image. `false` makes a PDF with text only. |
| `codec` | `'auto'` | Try JPEG and lossless and keep the smaller file, per image. `'jpeg'` or `'flate'` forces one. |
| `quality` | `0.92` | JPEG quality. It only matters when JPEG wins, which on normal pages is rare. |
| `backgroundColor` | none | Fill transparent areas with a colour. Usually makes the file smaller. |

Sharpness and size come from the capture: `snapdom(el, { scale, dpr })`. Both multiply the image's pixels and leave the page layout alone. `dpr` defaults to the screen of the machine that exports, so set it, for example to `2`, to get the same file everywhere.

## Text and links

| Option | Default | What it does |
|---|---|---|
| `text` | `true` | Add the invisible text layer, so the text can be selected, searched and copied. |
| `links` | `true` | Make links clickable. Same-page anchors jump inside the PDF. |
| `debugText` | `false` | Paint the text layer red, to check where it sits. |

Links work for `http:`, `https:`, `mailto:` and `tel:`. Any other link is left out with a warning.

> Covering something with a box or a blur hides the pixels, not the text: it can still be selected in the PDF. To keep data out, remove or replace it before the capture.

## Fonts and sharp text

| Option | Default | What it does |
|---|---|---|
| `embedFonts` | `true` | Embed the page's web fonts, only the letters the document uses. `'full'` embeds whole fonts; `false` none. |
| `vectorText` | `false` | Draw the text as real letters instead of pixels: sharp at any zoom. |

The PDF can only embed fonts the capture carries, so capture with `snapdom(el, { embedFonts: true })`. System fonts have no file to embed. Copying text works the same with or without embedded fonts.

`vectorText` needs embedded fonts. Right-to-left and complex scripts stay as image. With `image: false` it gives a very small text-only PDF, without borders, backgrounds or pictures.

## Bookmarks and accessibility

| Option | Default | What it does |
|---|---|---|
| `outline` | `true` | Bookmarks from headings. Set it on `pdf()`. |
| `tagged` | `true` | Tag headings, paragraphs, lists, tables and figures for screen readers. |
| `lang` | from the page | Document language, for example `'en'` or `'es-MX'`. |

The PDF is marked accessible (PDF/UA-1) only when it qualifies: every font embedded, a language, a `meta.title`, alt text on every image and `fields: false`. There is no option to force it. When something is missing, the report says what.

## Fillable forms

| Option | Default | What it does |
|---|---|---|
| `fields` | `true` | Turn form controls into fields you can fill in the PDF. `false` keeps their values as plain text. |

Text inputs, textareas, checkboxes, radio buttons and selects become fields with their name, value and label. Read-only, disabled, required and maxlength carry over. Password fields are written empty. Buttons, sliders, colour pickers and file inputs stay as image. The PDF never contains scripts or submit actions.

## Header, footer and page numbers

| Option | Default | What it does |
|---|---|---|
| `header` | none | Text, a function, `{ left, center, right, size, font, color, rule, gap }` or an element. |
| `footer` | none | The same, at the bottom. |
| `pageNumbers` | `false` | `true` writes "1 / 4". `{ format, align, size, font, color }` changes it. |

```js
await shot.toPdf({
  page: 'a4',
  header: { left: 'North Studio', right: 'Delivery report' },
  pageNumbers: { format: (page, pages) => `Page ${page} of ${pages}` },
})
```

These need a paper size and do nothing on `page: 'fit'`. Text is real PDF text. An element is captured as an image, so its text cannot be selected.

## Cover, contents, back page and watermark

| Option | Default | What it does |
|---|---|---|
| `cover` | none | An element captured as the first page. |
| `toc` | none | A table of contents from the headings. `true`, a title, or `{ title, levels, size, font, indent, dots, label, color, leaderColor }`. |
| `back` | none | An element captured as the last page. |
| `watermark` | none | Text or an element over every page. `{ text, opacity, angle, size, font, color }` or `{ element, opacity, angle, fit }`. |

Cover, contents and back page need a paper size. The watermark also works on `page: 'fit'`.

## Metadata

| Option | Default | What it does |
|---|---|---|
| `meta` | none | `{ title, author, subject, keywords, creator, created, modified }`. Viewers show the title instead of the file name. |

Dates are written only when you pass them. Pass `new Date()` when you want today. The same page exported twice gives the same file, byte for byte.

## Password

```js
await shot.toPdf({
  page: 'a4',
  encrypt: { userPassword: 'ada-1815', ownerPassword: 'owner-key' },
})
```

`encrypt` protects the file with AES-256. `userPassword` is required. `ownerPassword` defaults to it. `permissions` takes `print`, `modify`, `copy`, `annotate`, `fillForms`, `assemble` and `printHighRes`, all `true` by default.

Only the password protects the file. Permissions are requests that a viewer may ignore. Encryption needs https or localhost, and an encrypted export is different every time.

## Output

| Option | Default | What it does |
|---|---|---|
| `download` | `false` | A file name, or `true` for `snapdom.pdf`. The Blob is still returned. |
| `deflate` | `true` | Compress the PDF's internal streams. |

## Progress, cancel and report

| Option | Default | What it does |
|---|---|---|
| `onProgress` | none | Called with `{ phase, done, total }` as pages are made. `total` is `null` until the page count is known. |
| `signal` | none | An `AbortSignal`. Aborting stops the export with an `AbortError`. |
| `onReport` | none | Called once the PDF is done, with what happened: pages, size, fields, fonts and warnings. |

```js
await shot.toPdf({
  page: 'a4',
  onProgress: ({ done, total }) => bar.update(done, total),
  signal: controller.signal,
  onReport: (report) => console.log(report.pages, report.warnings),
})
```

Each warning in the report has a `code`, such as `link-unresolved` or `text-clipped`, so a test can check for them without reading messages.

## When something looks wrong

The plugin warns in the console with a `[snapdom-pdf]` prefix: a block split across pages, a link without a target, text cut off. The same warnings arrive in the report.

A grey box where an image should be means the capture could not read that image. It shows up in the capture's `result.warnings` as `image-fallback`. [Export a PDF with cross-origin images](https://snapdom.dev/how-to/pdf-cross-origin-images/) explains the fix.

If the PDF does not match the page, [open an issue](https://github.com/zumerlab/snapdom/issues) with a small example and we will fix it.

## Limits

- Text is an image unless you use `vectorText`, so a deep zoom shows the capture's resolution.
- Closed shadow roots cannot be read.
- Date inputs are written in ISO format, not as the browser shows them.
- An element used as header, footer or watermark has no selectable text. A repeated table header has no links.
- The full test suite runs in Chromium. Firefox and WebKit are checked for the main features.
