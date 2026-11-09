# @zumer/snapdom-pdf

[![NPM version](https://img.shields.io/npm/v/@zumer/snapdom-pdf?style=flat-square&label=PDF)](https://www.npmjs.com/package/@zumer/snapdom-pdf)
[![Core version](https://img.shields.io/npm/v/@zumer/snapdom?style=flat-square&label=SnapDOM)](https://www.npmjs.com/package/@zumer/snapdom)

PDF export for [SnapDOM](https://snapdom.dev/): `pdf()` adds `toPdf()` to a capture, returning a PDF Blob with the capture's appearance, selectable and searchable text, links, pagination, repeated table headers, Unicode, transparency and optional form fields. Export options also cover headers, footers, metadata, tagging and encryption. MIT licensed. Landing page and live demo: [snapdom.dev/plugins/pdf](https://snapdom.dev/plugins/pdf/).

## Install

```sh
npm install @zumer/snapdom@latest @zumer/snapdom-pdf@latest
```

Requires SnapDOM 3.4.0 or newer within 3.x. Up to SnapDOM plugins 4.x the same exporter shipped as `@zumer/snapdom-plugins/pdf`; only the import changes.

## Usage

```js
import { snapdom } from '@zumer/snapdom';
import { pdf } from '@zumer/snapdom-pdf';

const result = await snapdom(element, { plugins: [pdf()] });
const blob = await result.toPdf({ page: 'a4', margin: 36 });
await result.toPdf({ page: 'letter', download: 'report.pdf' });
```

`toPdf()` returns a `Blob`; downloading is opt-in. Put capture-time measurement options on `pdf({ forms, outline, breakAvoid, shadow, formValues })` and paper size, orientation, margins, tagging, metadata, headers, footers, compression or encryption on `toPdf()`. Tagged output alone does not guarantee PDF/UA conformance: the exporter reports eligibility and blockers. Redact sensitive source content structurally before capture; covering pixels does not remove searchable text. See the [full reference](REFERENCE.md) and the [public types](index.d.ts).

## Migrating from `pdf-image`

Replace `pdfImage()` with `pdf()` and `toPdfImage()` with `toPdf({ download: 'capture.pdf' })`. Put orientation on the export. The old temporary object-URL return becomes a persistent Blob. The default page sizing and pagination differ: choose `page: 'a4'` explicitly.

## Live demo and verification

From the monorepo root, run `npm run compile` and `npm run site`, then open `/plugins/pdf/` or `/showcase/`. The demos generate real PDFs from editable DOM samples. Run `npm run test:pdf` for the PDF engine suites; see the [verification notes](test/README.md).

## License

MIT
