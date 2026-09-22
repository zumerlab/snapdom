# Test and benchmark fixtures

Served same-origin by the vitest dev server, so tests and realistic benchmarks exercise the
real fetch → inline path without network jitter. Font fixtures are also used by `npm test`.

- `fonts/` — Inter 400/700 and JetBrains Mono 400, latin subsets, from Google Fonts.
  Licensed under the SIL Open Font License 1.1 (© The Inter Project Authors,
  © The JetBrains Mono Project Authors) — redistribution permitted with this notice.
- `fonts/mathjax-zero.woff2` — MathJax 4.1.3 zero-width font for the #506 first-raster
  regression; see [provenance](fonts/mathjax-zero.README.md) and [Apache-2.0 license](fonts/mathjax-zero.LICENSE).
- `images/` — 40 distinct 96×96 PNGs generated programmatically (gradient + per-file noise,
  ~5–15 KB each) so every file has unique bytes and a real compressed size.
