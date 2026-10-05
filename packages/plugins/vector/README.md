# Vector plugin

MIT-licensed editable SVG and Figma clipboard export for SnapDOM.
The plugin lives inside the official `packages/plugins` workspace and requires core 3.x.
SVD lives in `svd/` as an internal format; no additional npm package is needed.

```js
import { snapdom } from '@zumer/snapdom'
import { vector } from '@zumer/snapdom-plugins/vector'

const result = await snapdom(element, { plugins: [vector()] })
const svg = await result.toVector()
copyButton.addEventListener('click', () => result.toFigma()) // HTTPS or localhost
```

`exclude` accepts a selector, a predicate, or an array of either. Export-time
exclusions override the factory default. Keep the source element connected through export. `toVector()` returns a string;
`toFigma()` resolves without a return value after writing the clipboard.
Register per capture to avoid applying
the render hook to unrelated captures. SVG preserves editable text and supported
shapes; unsupported paint is diagnosed by the engine.

The package is prepared locally and has not been published yet.
Run `npm run test:vector` from the monorepo root. The migrated baselines are
unchanged; the `challenges/fx-svg` SVG byte-count check also fails in the original
checkout when tested against this core (30070 bytes versus 26225 ± 2623).

`src/public.js` defines the public `toVector()` and `toFigma()` contract.
`src/index.js` and the emitters retain the internal engine used by the suites.
`figma-plugin/` is the optional SVD consumer exercised by those suites; the public
clipboard export does not require installing that plugin.

## Live demo

Run `npm run compile` and `npm run site` from the monorepo root, then open `/pro/vector/` or `/playground/`. The demo exports real SVG and can copy artwork to Figma. The retained `/pro/` URL does not denote a paid product. See [the public contract](CONTRACT.md) for supported behavior and limits.
