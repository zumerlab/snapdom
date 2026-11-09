# SnapDOM PDF reference

Version 1.0.0 reference. This is the canonical option and behaviour reference
for the build beside it.

SnapDOM PDF is a SnapDOM plugin. It does not expose a standalone `toPdf(element)`
function. Register the `pdf()` factory before capture; the resulting capture
then gains `toPdf()` and the generic `to('pdf')` export.

```js
import { snapdom } from '@zumer/snapdom'
import pdf from './snapdom-pdf.mjs'

snapdom.plugins(pdf())

const shot = await snapdom(document.querySelector('#report'), {
  scale: 2,
  dpr: 1,
})

const blob = await shot.toPdf({ page: 'a4' })
```

See [README.md](./README.md) for the bundler and import-map installation
recipes. Both builds export the same factory as the default export and as the
named export `pdf`. The supported peer range is `@zumer/snapdom >=3.0.0 <4`.
The plugin uses v3's immutable capture metadata, requested export options and
pre-decode canvas crops. PDF declares `needs: 'render'` and uses the SVG path so
the text layer and raster share one immutable artifact.

## The two option moments

The plugin derives its geometry and document semantics lazily from SnapDOM's
final serialized clone when the first PDF export runs, rather than reading the
original live DOM. Five options control that capture model and therefore have
to be fixed on `pdf()` before the capture is created:

| Capture-time option | Default | Meaning |
|---|---:|---|
| `formValues` | `true` | Put `input`, `textarea` and selected `select` values in the text layer. Password values are replaced with bullets. |
| `shadow` | `true` | Walk open shadow roots as a flattened tree. Closed roots are unreachable. |
| `breakAvoid` | `true` | Measure rows, list items, figures and other atomic blocks so pagination can avoid splitting them. |
| `outline` | `true` | Build bookmarks from `h1`–`h6` and `role="heading"`. A string is a custom CSS selector; `false` disables the outline. |
| `forms` | `true` | Measure form controls (kind, name, value, options, geometry, painted style) so the export can write fillable fields. `false` skips the measurement entirely. |

```js
snapdom.plugins(pdf({
  shadow: true,
  outline: 'h1, h2, [role="heading"]',
  page: 'a4',       // an export default may also live here
  margin: 36,
}))

const shot = await snapdom(report)
await shot.toPdf({ margin: 48 }) // overrides only this export
```

Passing a capture-time option to `toPdf()` warns and ignores it. Every export
option below may also be supplied to `pdf()` as a default; `toPdf()` wins.

## `toPdf()`

```ts
shot.toPdf(options?: PdfExportOptions): Promise<Blob>
shot.to('pdf', options?: PdfExportOptions): Promise<Blob>
```

`download` is an optional side effect. A `Blob` with type `application/pdf` is
returned in every case.

### Page and pagination

| Option | Default | Meaning |
|---|---:|---|
| `page` | `'fit'` | `'fit'`; `a3`, `a4`, `a5`, `a6`, `b4`, `b5`, `letter`, `legal`, `tabloid`, `executive`; or `[width, height]` in PDF points. |
| `orientation` | `'portrait'` | `'portrait'` or `'landscape'`. It has no effect on `'fit'`. |
| `margin` | `24` | Points on all sides. It has no effect on `'fit'`. |
| `repeatHeaders` | `true` | On paginated output, repeat a table's `<thead>` wherever that table continues. |

`page: 'fit'` creates one page at the captured element's size. Other sizes scale
the capture to the printable width and paginate vertically. Declared
`break-before`/`break-after` values `always`, `page`, `left`, `right`, `recto`
and `verso` create plain breaks when they do not create an empty page.

Atomic blocks include table rows, list items, `dt`/`dd`, figures, blockquotes,
replaced content, `break-inside: avoid` content and short leaf blocks. A block
taller than a page still has to be split.

Repeated `<thead>` pixels and text are re-stamped from the body capture. Links
inside the repeated copy are not repeated. A header taller than half a page is
left where it originally occurs and produces a warning.

### Raster

| Option | Default | Meaning |
|---|---:|---|
| `image` | `true` | Draw the visible page raster. `false` skips rasterization and produces an image-free PDF while the enabled text, links and structure remain. Element headers, footers and watermarks are omitted because they are images. |
| `codec` | `'auto'` | `'auto'` encodes JPEG and lossless Flate and keeps the smaller image. `'jpeg'` and `'flate'` pin the choice. |
| `quality` | capture quality or `0.92` | Quality of the JPEG candidate, taken from the capture when the export does not set one. It reaches nothing when Flate wins, and on ordinary page artwork Flate wins until roughly 0.5. Measured on a 37-page report: `0.92`, `0.8` and `0.6` all produce a byte-identical 16.1 MB, `0.4` gives 13.7 MB and `0.2` gives 10.1 MB. An export whose lowered quality changed nothing says so. |
| `backgroundColor` | capture background or `null` | Flatten this PDF export onto a colour. May be set on the capture, the plugin defaults or this export. |

Resolution belongs to `snapdom(...)`: use `scale`, `dpr`, `width` and `height`
there, not in `toPdf()`. On v3, an explicit width or height overrides `scale`;
`dpr` still multiplies the raster resolution. Keep the capture aspect ratio when
setting both dimensions. The exporter rasterizes page regions lazily and caches
them on the capture for later exports. A different codec, quality or flattening
choice may still require encoding work.

**`dpr` is the same knob as `scale` here, and it defaults to the machine.**
A PDF has no device to match, so neither option moves a point of geometry: the
MediaBox, the text layer and every annotation are identical whatever they are
set to. What they multiply is the page image's pixel count, and they multiply it
together. Measured on an 8-page A4 report, `scale: 1, dpr: 2` and
`scale: 2, dpr: 1` produce the same 1748px-wide raster and the same 3.18 MB
file, against 1.63 MB at 1×1 and 6.93 MB at 2×2.

The catch is the default. SnapDOM reads `dpr` from `window.devicePixelRatio`,
which is right for a screenshot and surprising for a document: the same code
exports 3.18 MB from a 2× laptop and 1.63 MB from a 1× monitor or a CI
container, with no visible difference in the page and no warning. Set `dpr`
explicitly on the capture (`1` for a light, screen-read file, `2` for one meant
to be printed) and the export stops depending on who ran it.

`codec: 'auto'` costs an extra encode. Pin a codec when latency matters more than
choosing the smallest file. If `CompressionStream` is unavailable, `auto` uses
JPEG and a requested `flate` warns before falling back to JPEG.

Transparency uses a soft mask. `backgroundColor` removes that mask and usually
produces a smaller file. Geometry comes from the same final serialized clone as
the raster. Real removals/replacements made by `exclude`, `resolveNode`,
`afterClone`, `clip`, or a geometry-preserving `afterRender` replacement of the
final serialized tree/URL stay synchronized with the PDF layer. An `afterRender`
replacement that changes the artifact's viewBox, root paint/layout attributes or
intrinsic aspect/geometry incompatibly is rejected rather than exported with a
misaligned layer. Uniform width/height scaling that preserves aspect is allowed.

### Text, links, navigation and accessibility

| Option | Default | Meaning |
|---|---:|---|
| `text` | `true` | Emit selectable/searchable invisible text. |
| `links` | `true` | Emit external URI and in-document link annotations. |
| `tagged` | `true` | Emit a structure tree for headings, paragraphs, lists, tables, sections and figures. |
| `lang` | DOM language or `null` | Set the PDF document language, such as `'en'` or `'es-MX'`. |
| `embedFonts` | `true` | Embed the capture's `@font-face` binaries and point the text at them. |
| `vectorText` | `false` | Paint eligible text as real vector glyphs instead of leaving it invisible over the raster. |
| `debugText` | `false` | Paint the normally invisible layer in red and leave streams readable. |

#### Embedded fonts

The capture must CARRY its fonts for the export to embed them: pass
`embedFonts: true` to `snapdom(…)` (the engine option that inlines `@font-face`
into the capture), and the PDF side reads those rules, fetches each face the
text actually painted with, and embeds a SUBSET of it: only the glyphs the
document drew, renumbered into a dense space. On a Latin page a ~320 kB face
travels as a few kB; the subset renders pixel-identical to the whole font
(asserted by rendering both through pdf.js). A face travels once however many
styles and pages use it, and the saving is declared per face (`font-embedded`).

`embedFonts` on the PDF export controls this: `true` (default) subsets;
`'full'` embeds the whole file unsubsetted (glyph ids stay the font's own);
`false` embeds nothing. CFF/OpenType (`OTTO`) faces are always embedded whole
(their charstrings are a different compiler), so `'full'` only differs for
TrueType. The subsetter is fail-safe: a TrueType face it cannot subset falls
back to a whole embed with an explicit `CIDToGIDMap`, never a corrupt glyph.

#### Vector text

By default the visible text is the raster: pixel-exact, but pixels. With
`vectorText: true` the exporter PAINTS eligible runs as real vector glyphs from
the embedded fonts, so the type is crisp at any zoom and the file is a fraction
of the size. This is a different fidelity model from the pixel-exact capture,
and it is opt-in for that reason.

A run is painted only where no shaping stands between code points and glyphs: a
left-to-right run, in a covering embedded face, with a resolved colour. RTL,
complex scripts, uncovered characters and unresolved colours are NOT painted,
because one CID per code point would place their glyphs wrong. Those runs stay
on the raster; in an image-free export they are invisible and `vector-missed`
says so.

The two useful pairings:

- `image: false, vectorText: true`: a small, fully-vector text PDF. Only the
  text and vector furniture travel; borders, checkboxes, background images and
  any un-paintable run are absent. Measured: the mega fixture is ~22 kB this way
  against ~420 kB with the raster.
- `image: true, vectorText: true`: the raster plus crisp vector glyphs painted
  over it. Larger, but sharp under magnification.

Interior glyph positions follow the embedded font's own advances scaled to the
run's measured width (`Tz`), not the browser's kerned positions, so a heavily
kerned pair can drift sub-pixel from the raster. Extraction is unchanged: the
painted glyphs carry the same `/ToUnicode` as the invisible layer.

Per run, the embedded face is used only when its real cmap covers every
character of the run; a run it cannot carry falls back to the unembedded layer
and is counted (`font-coverage`). System fonts have no bytes a page can hand
over and travel by name as before. WOFF unpacks; WOFF2, TrueType collections
and faces whose `OS/2 fsType` forbids embedding are refused with their reason
(`font-fallback`). No shaping is performed, which is correct for the invisible
layer, whose widths are pinned to the DOM measurement by `Tz`.

Text extraction is byte-for-byte identical with and without embedding (asserted
in the harness), because extraction runs off `/ToUnicode` either way.

#### The earned PDF/UA-1 claim

The exporter never takes a conformance claim as an option; it COMPUTES
eligibility per export: every text-showing operation on an embedded face,
`tagged` structure present, a document language, a `meta.title` to display, and
no painted image without alternative text. When all of it holds, the XMP carries
`pdfuaid:part 1` and the report says so (`ua-claimed`, `report.pdfua === true`).
When fonts are clean but a blocker remains, the blockers are named
(`ua-withheld`).

Two blockers are worth knowing in advance. Fillable fields block the claim,
because their editor-facing `/DA` types in unembedded Helvetica, so a
UA-claiming export pairs with `fields: false`. A painted `<img>` or
`role="img"` element with no accessible name blocks it too, because its pixels
live in the page raster, which is an artifact, and there is no `/Alt` to
announce: give it `alt`, `aria-label` or `title`, or `alt=""` when it is
decorative.

Text is measured from the final serialized clone, one run per word. Text
transforms are applied; open shadow roots, visible form values and bidi logical
order are included. Text hidden by layout, ancestor opacity or rectangular
overflow clipping is excluded.

Base-14 fonts carry WinAnsi text. Other scripts use an invisible Type0 font with
a `/ToUnicode` map. Without `vectorText`, the visible type remains the SnapDOM
raster.

Headings become bookmarks and named destinations. A same-document `#fragment`
link becomes a PDF destination; an unresolved or out-of-capture fragment gets no
annotation and produces a warning. External annotations are restricted to
`http:`, `https:`, `mailto:` and `tel:`. Malformed URLs and other schemes such
as `javascript:`, `data:`, `blob:` and `file:` are ignored and reported. A
custom `outline` selector is evaluated against the final flattened artifact, so
matching open-shadow and slotted headings participate too.

#### Redaction and semantic visibility

Visual occlusion is not redaction. A rectangle above a secret, blur, or arbitrary
overlap can hide pixels without removing the underlying text from the serialized
document. Remove or replace confidential nodes/text with `exclude`,
`resolveNode` or a clone/render hook. Do not use overlays or blur as a redaction
mechanism.

For known clipping, masking and filter geometry, the collector omits text and
links when it cannot prove they are visible. This is fail-safe: difficult visual
effects may lose selectable semantics instead of leaking content. An
`afterRender` hook is synchronized only when it replaces the final serialized
tree/URL while preserving its geometry. A purely visual overlay is not evidence
that semantic content vanished, and an incompatible viewBox, root paint/layout
or intrinsic-aspect change fails instead of guessing new coordinates.

Tagged output improves reading order and structure. It becomes a **PDF/UA-1
claim only when the export earns it** (see "The earned PDF/UA-1 claim" above);
short of that, no `pdfuaid` identifier is written. Either way the tree is
real: link annotations are tied in by
`/Link` structure elements carrying `/OBJR` references, fillable fields by
`/Form` elements, header cells carry `/Scope` (and spans), table row groups map
to `THead`/`TBody`/`TFoot`, pages declare `/Tabs /S` so tab order follows the
structure, and the parent tree resolves both marked content and annotations.
Inline formatting elements are deliberately not expanded into a structure node
each.

### Fillable form fields

| Option | Default | Meaning |
|---|---:|---|
| `fields` | `true` | Emit measured form controls as real AcroForm fields: fillable, tabbable, extractable. `false` keeps their values in the invisible text layer instead. |

A captured form should still BE a form. Text inputs, textareas, checkboxes,
radio groups, and selects become widget annotations with their DOM name, value,
options and checked state; `readonly`/`disabled` map to the read-only flag,
`required` and `maxlength` travel too, and the accessible label (`aria-label`,
`<label for>`, placeholder, title, in that order) becomes the field's tooltip,
which is what a screen reader speaks. Radios group by their HTML `name`;
duplicate non-radio names are uniquified with a suffix and reported.

The page image yields each fielded control's area to its widget, and the
widget's appearance follows one rule, dictated by macOS Preview: a field
HOLDING A VALUE paints it as real text, laid out from the control's own
measured runs so a textarea's wrap and an input's alignment are the page's
rather than a guess, while an EMPTY field wears the control's own crop of the
capture: border, corner radius and placeholder, pixel-exact. (Preview redraws a
text field's value over any appearance carrying an image, so a valued field's
crop would show the value twice there; text appearances render once everywhere:
Preview, Quick Look, Chrome, pdf.js, Acrobat, and every print/flatten path.)

What deliberately does not happen: a **password** field is written empty with
the password flag set, because a field value is plain text in the file; the
raster keeps its painted bullets. **Buttons, sliders, colour wells and file
pickers** stay pixels; a control that only means something to a running page is
not a field. **No JavaScript actions and no submit URLs** are ever written. A
rotated or clip-cut control is reported and left as invisible text, and a
control crossing a page break is clamped to one page and reported. With
`image: false` the appearance is synthesized (background, border and a base-14
value line), and a value outside WinAnsi sets `/NeedAppearances` so the viewer
draws it.

### Document metadata, identity and page labels

| Option | Default | Meaning |
|---|---:|---|
| `meta` | `null` | `{ title, author, subject, keywords, creator, created, modified }`: /Info plus a mirrored XMP packet. |

`title` also sets `/ViewerPreferences << /DisplayDocTitle true >>`, so viewers
show the document's name rather than its filename. `keywords` may be a string or
an array. `created`/`modified` accept a `Date` or ISO-8601 string and are
written ONLY when given: an invented "now" would break the byte-determinism
promise, so pass `new Date()` yourself when you mean it. `/Producer` is always
`snapdom-pdf` and is not an option.

Every file carries a trailer `/ID` derived from its own content: identical
unencrypted exports share an ID, different documents differ, and no clock is
involved. Paginated documents with front matter get `/PageLabels` (cover and
contents in lowercase roman, body decimal from 1), so the viewer's page field
agrees with the printed folio and with the generated contents.

### Encryption

| Option | Default | Meaning |
|---|---:|---|
| `encrypt` | `null` | `{ userPassword, ownerPassword, permissions }`: encrypt the file with AES-256 (standard security handler, revision 6). |

The exported file is the delivery: it gets downloaded, attached, and forwarded.
`encrypt` is what makes that file unreadable once it has left, and it is the
only protection here that is not advisory.

```js
await shot.toPdf({
  page: 'a4',
  encrypt: { userPassword: 'ada-1815', ownerPassword: 'owner-key' },
})
```

`userPassword` is **required and must be non-empty**, and an export that omits
it throws rather than producing a file. A PDF whose user password is `''` is
genuinely encrypted (the bytes are unreadable to a text editor), and every
viewer in the world still opens it without asking. That is the exact shape of a
document somebody believes is protected and is not. `ownerPassword` defaults to
the user password; it exists to lift the permission flags for whoever holds it.

**AES-256 and nothing older.** RC4 and revisions 2–4 are not offered at any
setting. A 40-bit key falls in seconds, 128-bit RC4 is not far behind, and both
need MD5, which the platform does not provide. Writing one by hand to ship a
weaker product is not a trade this exporter makes. Everything used here comes
from the browser's own `crypto.subtle`, so the plugin carries no cipher code and
no dependency. Encryption therefore needs a **secure context**: https, or
localhost. Encrypting a 14 MB document costs about 34 ms.

| | |
|---|---|
| `/Filter /Standard /V 5 /R 6`, `/CFM /AESV3`, 256-bit key | ISO 32000-2 §7.6.4 |
| Header stays `%PDF-1.7`; the catalog declares `/ADBE /ExtensionLevel 3` | the shape readers learned before ISO 32000-2 |
| Every stream and every string is encrypted, `/Metadata` included | strings inside content streams ride the stream |

#### Permissions are a request, not a protection

`permissions` accepts `print`, `modify`, `copy`, `annotate`, `fillForms`,
`assemble` and `printHighRes`; each defaults to `true`, and setting one to
`false` clears its `/P` bit. Understand what that buys: a flag is something a
viewer *may* honour and any other tool can ignore. The password is what protects
the document; the flags only express intent to software that has already been
given the key. The export says so in the report when any of them is set.

Extraction for accessibility is deliberately not exposed. PDF 2.0 deprecates
that bit (a conforming reader must always allow it), and PDF/UA requires an
encrypted file to keep permitting it, so an exporter whose selling point is an
extractable text layer has no business offering to switch it off. A UA-claiming
export and an encrypted one are compatible for exactly that reason.

#### Encrypted exports are not deterministic

The file key, the salts and every IV are random, drawn from
`crypto.getRandomValues` for each export. Encrypting the same document twice with
the same password gives two different files that open to the same content, so
two encrypted files never reveal that their contents match. Unencrypted exports
stay byte-deterministic.

### Progress, cancellation and the report

| Option | Default | Meaning |
|---|---:|---|
| `onProgress` | `null` | `({ phase, done, total })` per step: `measure`, `page` (with counts), `matter`, `assemble`. |
| `signal` | `null` | An `AbortSignal`; aborting rejects with `AbortError` between pages. |
| `onReport` | `null` | Receives the structured diagnostics report once the Blob is finished. |

The report is `{ warnings, counts, pages, bytes, fields, annotations,
fontsEmbedded, pdfua, vectorText }`, where each warning is `{ code, message }`,
`counts` tallies by code and `vectorText` counts the runs painted as glyphs.
Codes are a stable contract (`text-clipped`, `link-unresolved`, `field-skipped`,
`layout-split`, …) so a CI step can gate on "no annotations lost" without
parsing prose. Identical unencrypted exports produce identical reports; the
console keeps warning regardless, so nothing changes for callers who ignore all
of this.

### Header, footer and page numbers

| Option | Default | Meaning |
|---|---:|---|
| `header` | `null` | A string/function, a text-band object, or an Element. |
| `footer` | `null` | The same along the bottom. |
| `pageNumbers` | `false` | `true` or `{ format, align, size, font, color }`. |

Text bands accept `{ left, center, right, size, font, color, rule, gap }`.
Segments may be strings or `(page, pages) => value`. `font` is `document`,
`sans`, `serif` or `mono`; colours are three- or six-digit hex values.
`document`, the default, is the body's own embedded face when the export has
one, so a running head is set in the same type as the report it runs over, in
real embedded glyphs; per string it falls back to base-14 sans when nothing is
embedded or the face lacks a character. An explicit `sans`/`serif`/`mono` keeps
meaning base-14. Base-14 furniture remains limited to WinAnsi scripts.

Text-band defaults are `size: 9`, `font: 'document'`, `rule: true` and
`gap: 10`. Page numbers default to `(page, pages) => page + ' / ' + pages`,
centred at size 9 in the document face. `colour` is accepted as an alias for
`color`; prefer `color` in new code.

An Element band captures its capturable content and styles, but it is a picture
without its own selectable layer; scripts are not executed by the measurement
sandbox. Header, footer and numbers reserve space and only apply to paginated
page sizes. With `image: false`, Element bands are omitted with a warning; text
bands and page numbers still work.

### Cover, generated contents, closing page and watermark

| Option | Default | Meaning |
|---|---:|---|
| `cover` | `null` | An Element captured as the first page. |
| `toc` | `null` | `true`, a title string, or `{ title, levels, size, font, indent, dots, label, color, leaderColor }`. |
| `back` | `null` | An Element captured as the last page. |
| `watermark` | `null` | A string, Element, text-watermark object or element-watermark object. |

Cover and back are scaled to fit a whole page without cropping and receive a
selectable text layer. The generated contents comes from the same outline as
the bookmarks; each row links to the body destination. Its page numbers refer
to body pages, excluding cover and contents pages. When a custom
`pageNumbers.format` changes numbering, use `toc.label` to keep both in step.

Text watermarks accept `{ text, opacity, angle, size, font, color }`; omitting
`size` auto-fits the rotated text. Element watermarks accept
`{ element, opacity, angle, fit }`. Watermarks draw over every page and also work
with `page: 'fit'`. With `image: false`, an Element watermark is omitted, while
text watermarks still work. Cover, contents and back require a paginated page
size; image-free cover/back pages retain their measured text, links and structure
but not their visible raster.

Contents default to title `Contents`, three outline depths, size 10, the
document face, 14-point indentation and leaders enabled. Text watermarks default
to 12% opacity and 45 degrees; Element watermarks default to 12% opacity, no
rotation and a 0.6 fit. `colour`/`leaderColour` are accepted aliases for
`color`/`leaderColor`.

### Output

| Option | Default | Meaning |
|---|---:|---|
| `deflate` | `true` | Compress PDF content streams. `debugText` leaves them readable. |
| `download` | `false` | A filename, or `true` for `snapdom.pdf`. `.pdf` is appended when absent. |

Use `deflate`, not SnapDOM's `compress`; use `download`, not SnapDOM's
`filename`. `compress`, `filename`, PDF-side `scale`, legacy `background`,
`mode` and `vector` are not PDF options and are reported when passed.

## Errors and warnings

Register the plugin before capture. A capture made without it has no `toPdf()`
helper, and its generic `to('pdf')` has no PDF exporter to run. An available PDF
export rejects an incompatible SnapDOM contract, invalid or empty capture
geometry, an incompatible final-artifact viewBox/root paint-layout/intrinsic
aspect, invalid orientation/margins/custom page geometry, and invalid active
image codec/quality.
An unknown string paper name warns and falls back to A4 for untyped JavaScript
callers. Other fidelity losses are reported under `[snapdom-pdf]`, including:

- page breaks that split atomic blocks or declared breaks that cannot be used;
- text or links clipped, invisible, outside the page, or under unsupported 3D geometry;
- unresolved internal links and invalid custom outline selectors;
- missing language on tagged output;
- a repeated table header too tall to repeat;
- a requested contents page with no headings;
- Base-14 page furniture that cannot represent its script;
- invalid or translucent flattening colours and unavailable Flate compression;
- malformed links or URI schemes outside the safe allowlist.

Every one of these is also a structured diagnostic with a stable code in the
report handed to `onReport`, so a build can gate on them instead of reading the
console.

## Known limits

- Visible text is raster by default, so zooming beyond capture resolution exposes pixels. `vectorText` paints eligible runs as glyphs, never RTL or complex scripts.
- `textarea` wrapping is greedy and can drift for hyphenation, CJK, unbreakable strings and `line-height: normal`.
- Date-like controls contribute their ISO value rather than the locale-painted value. Multi-row selects contribute no value.
- Closed shadow roots are unreachable.
- Upright glyphs in vertical writing modes are placed square; sideways runs are supported.
- Ambiguous clipping, masking and filter geometry is omitted fail-safe, so some visibly painted text may not be selectable.
- Native `<select>` insets were measured on Chromium and can differ in other engines.
- Rotated links use an axis-aligned PDF rectangle.
- Captured header/footer Elements have no selectable text layer.
- `image: false` omits Element headers, footers and watermarks; cover/back pages
  keep semantics but lose their visible raster.
- Only `<thead>` repeats, and its repeated copy has no repeated link annotations.

## Browser status

The exporter is a browser ESM module. The complete PDF fixture suite runs in
Chromium through `npm run test:pdf`. The monorepo also tests registration,
searchable text, frozen capture state and redaction in Chromium and WebKit.
Firefox is not yet verified in this branch: its runner failed to connect.
The complete complex-layout matrix is not verified in every engine; known
engine-sensitive limits remain listed above.

The exporter runs locally in the page and returns a Blob. It does not upload the
PDF. SnapDOM may still fetch the page resources or use a proxy if the application
configured one.
