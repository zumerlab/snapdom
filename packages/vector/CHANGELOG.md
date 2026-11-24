# Vector changes

## 1.0.4

> 24 November 2026

**Features**

- **vector:** WOFF2 fonts are rebuilt and embedded by the internal PDF emitter [`280e4b4`](https://github.com/zumerlab/snapdom/commit/280e4b40cbaedb65f7632142bd75dbfda2e19e44)

**Fixes**

- **vector:** the export is framed, laid out and painted as the page is [`3f89f95`](https://github.com/zumerlab/snapdom/commit/3f89f955ccd073d359ce2a7ee77cb80f1ce1912b)

**Refactoring**

- the vector engine writes no PDF; the PDF plugin owns all of it [`acaff7d`](https://github.com/zumerlab/snapdom/commit/acaff7d76e12661a67ae8e1214b71c69f753bcc1)
- one engine per product; the PDF plugin does not use the vector engine [`de4f795`](https://github.com/zumerlab/snapdom/commit/de4f79529174793e2800cd3517b40769d9be59d0)

**Tests**

- **vector:** re-record the fx-grid and fx-img baselines [`037babc`](https://github.com/zumerlab/snapdom/commit/037babc43812bf4d39b7f979bc7ca40a0dded9ff)

**Chores**

- **vector:** the package ships one built file instead of src/ [`39a3040`](https://github.com/zumerlab/snapdom/commit/39a304015495e6dfd91fdbb5df29f4244f21dc98)
- **pdf,vector:** require SnapDOM 3.8.3 [`548afe4`](https://github.com/zumerlab/snapdom/commit/548afe42db29c19ce6c2a1eeddd84f6c86aa1117)

## 1.0.3

> 20 November 2026

**Chores**

- **vector:** require SnapDOM 3.8.1 [`81a140c`](https://github.com/zumerlab/snapdom/commit/81a140c218158a61dd18688ef55bdbbc5bf3337a)

## 1.0.2

> 20 November 2026

**Fixes**

- **vector:** wrapped inline boxes, form text and fieldset frames paint as the page does [`da04465`](https://github.com/zumerlab/snapdom/commit/da0446568b8b2eccb88d2dabe637c4055a799f23)

## 1.0.1

> 17 November 2026

**Fixes**

- **vector:** match lone surrogates without a regex lookbehind [`#567`](https://github.com/zumerlab/snapdom/pull/567)

**Chores**

- release each package from its workspace instead of sixteen root aliases [`37f6b34`](https://github.com/zumerlab/snapdom/commit/37f6b341e842f6480786b663a3bc1123de393659)

## 1.0.0

> 9 November 2026

- First release as its own package, `@zumer/snapdom-vector`. Up to `@zumer/snapdom-plugins` 4.4.1 the same exporter shipped at that package's `/vector` subpath; its earlier history is in [packages/plugins/CHANGELOG.md](https://github.com/zumerlab/snapdom/blob/main/packages/plugins/CHANGELOG.md). Options and behavior are unchanged; only the import changes.
