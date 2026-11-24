# PDF changes

## 1.0.2

> 24 November 2026

**Features**

- **pdf:** WOFF2 fonts embed, and text is painted only from a file that holds its glyphs [`9644f96`](https://github.com/zumerlab/snapdom/commit/9644f969972bd942d2a767ccc70876adc916b00c)
- **pdf:** a word painted as glyphs is in the file once [`88c831e`](https://github.com/zumerlab/snapdom/commit/88c831e4c0d07acb5a37749b15ff7fa88a2e100d)
- **pdf:** text is painted as real glyphs by default [`9c525aa`](https://github.com/zumerlab/snapdom/commit/9c525aacdefb31320542b208df6aa1891ee5e2ec)

**Refactoring**

- the vector engine writes no PDF; the PDF plugin owns all of it [`acaff7d`](https://github.com/zumerlab/snapdom/commit/acaff7d76e12661a67ae8e1214b71c69f753bcc1)
- one engine per product; the PDF plugin does not use the vector engine [`de4f795`](https://github.com/zumerlab/snapdom/commit/de4f79529174793e2800cd3517b40769d9be59d0)

**Chores**

- **pdf,vector:** require SnapDOM 3.8.3 [`548afe4`](https://github.com/zumerlab/snapdom/commit/548afe42db29c19ce6c2a1eeddd84f6c86aa1117)
- release each package from its workspace instead of sixteen root aliases [`37f6b34`](https://github.com/zumerlab/snapdom/commit/37f6b341e842f6480786b663a3bc1123de393659)

## 1.0.1

> 9 November 2026

**Fixes**

- **pdf:** place the text layer correctly on hidpi screens [`05d87aa`](https://github.com/zumerlab/snapdom/commit/05d87aa81de0e03dd7c76e782626b629851b81ee)
- **pdf:** rasterize a capture enlarged to the paper at its printed size [`20add63`](https://github.com/zumerlab/snapdom/commit/20add63a27d31da61da1911001e1461ba4b7b99d)

**Refactoring**

- **pdf:** drop two locals nothing reads [`f49f5c1`](https://github.com/zumerlab/snapdom/commit/f49f5c1c050b83687d5a79365fca9ab4d280e4f4)

**Docs**

- **pdf:** rewrite the reference in plain words, capture the demo at dpr 2 [`b79e178`](https://github.com/zumerlab/snapdom/commit/b79e178f3f5fcd8b23c224ade730df830cf34d4a)
- **pdf:** fold the reference into the README [`e9f3a4f`](https://github.com/zumerlab/snapdom/commit/e9f3a4f8e0cde00e3a1bdab5f9ade5d06229346c)
- **site:** point the demos and docs at the published packages [`c57b2b3`](https://github.com/zumerlab/snapdom/commit/c57b2b38f3b57fc51e0cb7f64f8207ddad9421ef)

## 1.0.0

> 9 November 2026

- First release as its own package, `@zumer/snapdom-pdf`. Up to `@zumer/snapdom-plugins` 4.4.1 the same exporter shipped at that package's `/pdf` subpath; its earlier history is in [packages/plugins/CHANGELOG.md](https://github.com/zumerlab/snapdom/blob/main/packages/plugins/CHANGELOG.md). Options and behavior are unchanged; only the import changes.
