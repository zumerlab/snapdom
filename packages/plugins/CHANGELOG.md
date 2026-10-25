# Plugin changes

## 4.3.0

> 25 October 2026

**Fixes**

- **stream:** report only dirty rects inside the canvas [`f9302d4`](https://github.com/zumerlab/snapdom/commit/f9302d4bd8b76f4dcab81c83314778cf9074b2a3)

## 4.2.1

- Fix the stream plugin: a box cut by an ancestor with overflow hidden was painted whole. Patches now stay inside every clipping ancestor.
- Export asciiFromCanvas and asciiStream from the package entry point, as the type declarations already did.
- Declare result.toStream() on the capture result type.
- Set the SnapDOM peer dependency to ^3.4.0 (3.3.8 was never published) and document asciiFromCanvas and asciiStream in the README.

Requires SnapDOM 3.4.0 or newer within 3.x.

## 4.2.0

- Export asciiFromCanvas(source, options) from @zumer/snapdom-plugins/ascii-export: the ASCII conversion on its own, for a canvas, an image, a video frame or a stream frame. toAscii() keeps its output.
- Add asciiStream(element, options): stream() plus asciiFromCanvas() on every frame, with onText(text, frame).

Requires SnapDOM 3.4.0 or newer within 3.x.

## 4.1.0

- Add the stream plugin at @zumer/snapdom-plugins/stream: a live canvas that mirrors an element and repaints only the boxes that changed, for WebGL textures, video overlays and WebRTC tracks.
- Add streamTexture(gl), which uploads only the changed rectangles to a WebGL2 texture, and recordCanvas(canvas) to record a stream.
- Add streamExport(), which gives a capture result a toStream() method next to toMp4() and toGif().
- Add broadcast overlay templates (overlayStage, scoreboard, lowerThird, ticker and liveBadge), themed through CSS variables and built so that a score, a clock tick or a slide repaints as a patch.

Requires SnapDOM 3.4.0 or newer within 3.x.

## 4.0.1

- Add GitHub Sponsors funding metadata.
- Raise the SnapDOM peer dependency to ^3.3.0 and document the minimum supported core version.
- Explicitly include the PDF README in the package and update packaging checks.

Requires SnapDOM 3.3.0 or newer within 3.x.

## 4.0.0

- Replace pdf-image with the full PDF exporter previously distributed as PDF Pro. Import pdf from @zumer/snapdom-plugins/pdf; toPdf returns a Blob, with optional download, selectable text, links and pagination.
- Add the MIT-licensed Vector plugin with internal SVD, editable SVG and Figma clipboard exports.
- Add typed HTML, context, map, ASCII and recording result methods.
- Add escaped title and language metadata to HTML snapshots.
- Add optional colored HTML ASCII previews and contrast control while preserving plain-text defaults.
- Handle Unicode code points in ASCII ramps and reject empty ramps.
- Reject invalid semantic budgets, map widths and tint opacity with explicit errors.

Requires SnapDOM 3.x. This version is published on npm.
