# snapdom-plugin-template

A starter for [SnapDOM v3](https://github.com/zumerlab/snapdom) plugins. Replace the package
name, description and example option with your own before publishing. See the
[plugin specification](https://github.com/zumerlab/snapdom/blob/main/PLUGIN_SPEC.md) for capture hooks, custom exports and stage requirements.

## Install

Before v3 is published, start from the template in the v3 checkout. Build the core,
copy this directory to your own project, then install that built checkout explicitly:

```bash
# Inside the SnapDOM v3 checkout:
npm run compile
cp -R packages/plugin-template /path/to/snapdom-plugin-yourname
cd /path/to/snapdom-plugin-yourname
npm install --save-dev /absolute/path/to/snapdom-v3
```

Replace the example paths with your actual directories. The template has no relative
core dependency: it works independently of the monorepo's directory layout.

After v3 and this template are published in the main repository, scaffold with:

```bash
npx degit zumerlab/snapdom/packages/plugin-template snapdom-plugin-yourname
cd snapdom-plugin-yourname
npm install --save-dev @zumer/snapdom@3
```

For a published beta, install its explicit version instead of `@3`. Keep the peer range
aligned with the versions you test. The public [installation notes](https://github.com/zumerlab/snapdom#installation)
and [plugin specification](https://github.com/zumerlab/snapdom/blob/main/PLUGIN_SPEC.md)
track the released core; use the specification in your v3 checkout before publication.

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
