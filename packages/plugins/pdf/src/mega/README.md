# pdfmega — the "pro pro" layer

The modules that took `@zumer/snapdom-pdf` from *exact capture in a PDF* to
*document generator*: identity, diagnostics, flow control, folios, fillable
forms, and the accessible-structure edge. They are part of the plugin — bundled
by `build.mjs` like everything in `src/` — and live in their own folder because
each one is a bounded contract that `src/index.js` consumes, not a place where
page drawing happens.

| Module | Feature | Public surface |
|---|---|---|
| `meta.js` | `/Info`, XMP packet, `DisplayDocTitle` | `meta` export option |
| `diag.js` | stable warning codes + report | `onReport` export option |
| `flow.js` | progress + cancellation | `onProgress`, `signal` export options |
| `labels.js` | `/PageLabels` agreeing with the printed folio | automatic |
| `forms.js` | fillable AcroForm fields from captured controls | `forms` (capture), `fields` (export) |
| `fonts.js` | `@font-face` rules → fetched, parsed, subset, embeddable faces | `embedFonts`, `vectorText` export options |

The writer half of these features — trailer `/Info`/`/ID`, `%PDF-1.7`, `/OBJR`
and table attributes in the structure tree — lives in `src/writer`,
because bytes are its job. The capture half of forms — control records measured
under the same visibility, clip and transform rules as every text run — lives in
`src/text-layer.js`, because measurement is its job. What is in this folder is
the part in between: planning and byte-shaping.

Decisions that are settled (see the triage memory and REFERENCE.md):

- **The `pdfuaid` claim is earned, never configured.** Fonts embed from the
  capture's own `@font-face` (`fonts.js` + `pdf-writer/font.js`), subset to the
  glyphs the document drew (`pdf-writer/subset.js`; `embedFonts: 'full'` opts
  out, and CFF faces always travel whole). The claim is written
  exactly when every text operation rode an embedded face AND the export is
  tagged, has a language and displays a title; otherwise the blockers are named
  (`ua-withheld`). Fillable fields block it: their `/DA` types in unembedded
  Helvetica, so a UA-claiming export pairs with `fields: false`.
- **Dates are never invented.** `meta.created`/`modified` are written when the
  caller passes them. The trailer `/ID` is a content hash, not a random number.
  Byte determinism survives every feature in this folder.
- **A password value never reaches the file.** The field exists, flagged,
  empty.
- **No JavaScript actions, no submit URLs** in generated forms.

Verification: `node test/megacheck.mjs` (fields, identity, labels, structure
edge, determinism, abort — against `test/fixtures/mega.html`), plus the main
suite `node test/verify.mjs`, whose text-layer fixtures export with
`fields: false` because they assert the layer the values deliberately leave.
Demo: `demo/pdfmega.html` under `node test/serve.mjs`.
