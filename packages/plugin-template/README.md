# snapdom-plugin-template

A starter for [SnapDOM v3](https://github.com/zumerlab/snapdom) plugins. Replace the package
name, description and example option with your own before publishing. See the
[plugin specification](https://github.com/zumerlab/snapdom/blob/main/PLUGIN_SPEC.md) for capture hooks, custom exports and stage requirements.

## Install

Install SnapDOM as a dev dependency:

```bash
npm install --save-dev @zumer/snapdom@3.0.0
```

Scaffold a plugin from this template:

```bash
npx degit zumerlab/snapdom/packages/plugin-template snapdom-plugin-yourname
cd snapdom-plugin-yourname
npm install --save-dev @zumer/snapdom@3.0.0
```

The template has no relative core dependency, so it works independently of the monorepo's
directory layout. Keep the peer range aligned with the versions you test. The public
[installation notes](https://github.com/zumerlab/snapdom#installation) and
[plugin specification](https://github.com/zumerlab/snapdom/blob/main/PLUGIN_SPEC.md)
track the released core.

## Usage

```js
import { snapdom } from '@zumer/snapdom';
import { myPlugin } from './index.js';

const result = await snapdom(element, {
  plugins: [myPlugin({ example: 'value' })]
});
const image = await result.toPng();
```

## Options

| Option    | Type   | Default     | Description           |
|-----------|--------|-------------|-----------------------|
| `example` | string | `'default'` | Describe this option  |

## Hooks used

`afterClone` modifies the cloned DOM tree. The template's hook is empty until you add your
implementation. Plugins can also add outputs such as HTML or structured context through
`defineExports`.

## License

MIT
