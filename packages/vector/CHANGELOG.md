# Vector changes

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
