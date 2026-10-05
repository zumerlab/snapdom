# test/

One product, three suites, one harness.

Nothing here is a unit test. Every check boots Chromium, serves this repository,
captures a real fixture page and reads the finished PDF back with pdf.js — because
the thing under test is a browser measuring its own layout, and a mock of that
proves nothing.

| | asserts | run by |
|---|---|---|
| `verify.mjs` | the exporter against 23 fixtures, 700 checks | `npm run test:pdf` |
| `megacheck.mjs` | fillable fields, identity, page labels, the accessible-structure edge, determinism, abort | `npm run test:pdf` |
| `encryptcheck.mjs` | AES-256: no plaintext leaks, round trip through pdf.js, the refusals | `npm run test:pdf` |
| `tools/` | **nothing** | a human, when the question comes up |

A tool measures or investigates; each one's header says which question it was
written to answer, and it is fair to delete one once that question is settled.
`tools/bench.mjs` asks what a long export costs and what it retains;
`tools/wasmcheck.mjs` asks whether a Rust/WASM engine would make this faster.

**A file that asserts things belongs beside the suites and in `npm test`.** In the
monorepo the two feature suites lived under a `_` prefix that meant "not
discovered automatically", which in practice meant "runs when somebody
remembers" — the encryption suite gated nothing at all for a day. The directory
split is there so that cannot recur silently.

```
npm run test:pdf                all three (from the monorepo root)
node packages/plugins/pdf/test/verify.mjs            the fixture suite alone
node packages/plugins/pdf/test/verify.mjs prose table   prefix match, several allowed
node packages/plugins/pdf/test/serve.mjs   serve the fixtures
```

Artifacts land in `out/` (gitignored): `<fixture>.pdf`, `<fixture>.png` as pdf.js
renders it, and `<fixture>-debug.png` with the text layer painted red instead of
invisible — still the fastest way to *see* a text layer sliding off its raster.

## Shared surface

`harness.mjs` is the reporting, browser and pdf.js layer both the suites use.
`check(name, ok, detail)` records **and** prints and returns the coerced boolean,
so a caller can skip dependent checks; `report()` prints the summary, repeats
every failure with its fixture, and sets `process.exitCode`.

`serve.mjs` is the static server: this repository at `/`, and the snapdom v3
core at `/snapdom/`, by default this monorepo’s compiled core. Run `npm run compile` first. `SNAPDOM_V3_DIR` or `SNAPDOM_DIR` selects a
different built v3 checkout. The
server rejects incompatible core versions; all fixtures and their pixel oracle
use the same mount.

## No baselines, on purpose

Every expectation is derived from the live DOM in the same run — `[data-probe]`
boxes in CSS px from `#target`'s border box, compared against what pdf.js reads
back out of the finished file. Nothing is asserted against a number this suite
invented, which is why it can be trusted on a machine it has never run on.

Plus, on every PDF produced anywhere: `pdfProblems()` reads the **bytes** — xref
offsets, `/Size`, `/Length`. pdf.js repairs a broken xref and a wrong `/Length`
silently; Acrobat does not.

## What is NOT covered

Be suspicious of green. These are holes, not oversights waiting to be found.

- **Images.** There is not one `<img>` and not one `background-image` in
  `fixtures/`. The `/Subtype /Image` checks in `alpha` are about the *page raster*
  and its soft mask, not about decoding, CORS, `srcset` or orientation.
- **`::marker` and lists.** No `<ul>`, no `<ol>`, no `list-style`. The text layer
  has never seen one.
- **Fonts beyond what the machine has.** Base-14 substitution is asserted against
  whatever Chromium resolves locally.
- **One browser, one renderer.** Chromium only, pdf.js only. `build.mjs`
  separately smokes both built bundles in Firefox and WebKit, but does not run
  this layout matrix there. Nothing checks that Acrobat, Preview or a print RIP
  agrees; `pdfProblems()` only proves the file describes itself honestly.
- **Colour management.** sRGB end to end; no ICC, no CMYK, no wide gamut.
- **Print.** No `@media print`, no page-box CSS.
- **`paginate` is pure Node.** It proves the arithmetic, never that the DOM handed
  it the right blocks — only `table` and `prose` do that.
