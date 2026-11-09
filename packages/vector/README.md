# @zumer/snapdom-vector

[![NPM version](https://img.shields.io/npm/v/@zumer/snapdom-vector?style=flat-square&label=Vector)](https://www.npmjs.com/package/@zumer/snapdom-vector)
[![Core version](https://img.shields.io/npm/v/@zumer/snapdom?style=flat-square&label=SnapDOM)](https://www.npmjs.com/package/@zumer/snapdom)

Editable SVG and Figma clipboard export for [SnapDOM](https://snapdom.dev/): `vector()` adds `toVector()`, a standalone SVG string with editable text and supported shapes and no `<foreignObject>`, and `toFigma()`, which writes a Figma clipboard payload. MIT licensed; the internal SVD format lives in `svd/`, no additional package is needed. Landing page and live demo: [snapdom.dev/plugins/vector](https://snapdom.dev/plugins/vector/).

## Install

```sh
npm install @zumer/snapdom@latest @zumer/snapdom-vector@latest
```

Requires SnapDOM 3.4.0 or newer within 3.x. Up to SnapDOM plugins 4.x the same exporter shipped as `@zumer/snapdom-plugins/vector`; only the import changes.

## Usage

```js
import { snapdom } from '@zumer/snapdom'
import { vector } from '@zumer/snapdom-vector'

const result = await snapdom(element, { plugins: [vector()] })
const svg = await result.toVector()
copyButton.addEventListener('click', () => result.toFigma()) // HTTPS or localhost
```

`exclude` accepts a selector, a predicate, or an array of either; export-time exclusions override the factory default. Keep the source element connected through export. `toVector()` returns a string. `toFigma()` resolves without a return value after writing the clipboard, and needs the async clipboard API on HTTPS or localhost, called from a user action. Register per capture to avoid applying the render hook to unrelated captures. SVG preserves editable text and supported shapes; unsupported paint is diagnosed by the engine. See [the public contract](CONTRACT.md) for supported behavior and limits.

## Source layout

`src/public.js` defines the public `toVector()` and `toFigma()` contract. `src/index.js` and the emitters retain the internal engine used by the suites. `figma-plugin/` is the optional SVD consumer exercised by those suites; the public clipboard export does not require installing that plugin. Inline SVG export omits inactive mask longhands from unmasked nodes, while retaining active masks and embedded stylesheet behavior.

## Live demo and verification

From the monorepo root, run `npm run compile` and `npm run site`, then open `/plugins/vector/` or `/showcase/`. The demo exports real SVG and can copy artwork to Figma. Run `npm run test:vector` from the monorepo root; the migrated baselines are unchanged.

## License

MIT
