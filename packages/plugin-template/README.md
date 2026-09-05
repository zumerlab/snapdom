# snapdom-plugin-template

A starter for [SnapDOM v3](https://github.com/zumerlab/snapdom) plugins. Replace the package
name, description and example option with your own before publishing. See the
[plugin specification](../../PLUGIN_SPEC.md) for capture hooks, custom exports and stage requirements.

## Install

```bash
npx degit zumerlab/snapdom/packages/plugin-template snapdom-plugin-yourname
cd snapdom-plugin-yourname
npm install
```

The template targets v3 beta. For the local core checkout, follow
[Installation](../../README.md#installation); set the generated package's dependencies to
the SnapDOM version or checkout you test against.

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
