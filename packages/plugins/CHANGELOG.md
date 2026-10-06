# Plugin changes

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
