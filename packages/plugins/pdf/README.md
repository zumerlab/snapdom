# PDF plugin

MIT-licensed PDF export for SnapDOM, replacing the former PDF Pro and `pdf-image` implementations. This source is part of `@zumer/snapdom-plugins` 4.x and requires core 3.x. The 4.x release is available on npm.

```js
import { snapdom } from '@zumer/snapdom';
import { pdf } from '@zumer/snapdom-plugins/pdf';

const result = await snapdom(element, { plugins: [pdf()] });
const blob = await result.toPdf({ page: 'a4', margin: 36 });
await result.toPdf({ page: 'letter', download: 'report.pdf' });
```

`toPdf()` returns a `Blob`; downloading is opt-in. The exporter preserves the captured appearance and supports selectable, searchable text, links, pagination, repeated table headers, Unicode, transparency and optional form fields. Export options also cover headers, footers, metadata, tagging and encryption. Tagged output alone does not guarantee PDF/UA conformance.

Put capture-time measurement options on `pdf()` and paper/output options on `toPdf()`. Structurally redact sensitive source content before capture: covering pixels does not remove searchable text. See the [full reference](REFERENCE.md) and [public types](../pdf.d.ts).

## Live demo and verification

From the monorepo root, run `npm run compile` and `npm run site`, then open `/pro/pdf/` or `/playground/`. These demos generate real PDFs from editable DOM samples. The retained `/pro/` URL does not denote a paid product.

Run `npm run test:pdf` for the PDF engine suites. See [verification notes](test/README.md).
