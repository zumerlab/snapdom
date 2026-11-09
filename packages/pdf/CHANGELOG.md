# PDF changes

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
