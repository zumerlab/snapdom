# Vector plugin

MIT-licensed Vector source, integrated from the local snapdom-pro/vector repository.
SVD lives in `svd/` as an internal format; no additional npm package is needed.

```js
import { snapdom } from '@zumer/snapdom'
import { vector } from '@zumer/snapdom-plugins/vector'

const result = await snapdom(element, { plugins: [vector()] })
const svg = await result.toVector()
await result.toFigma() // HTTPS or localhost, called from a user action
```

`exclude` accepts a selector, a predicate, or an array of either. Export-time
exclusions override the factory default. Register per capture to avoid applying
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
