# snapdom-plugin-my-plugin

A [SnapDOM](https://github.com/zumerlab/snapdom) plugin that ...

## Install

```bash
npm i snapdom-plugin-my-plugin
```

## Usage

```js
import { snapdom } from '@zumer/snapdom';
import { myPlugin } from 'snapdom-plugin-my-plugin';

const result = await snapdom(element, {
  plugins: [myPlugin({ example: 'value' })]
});
```

## Options

| Option    | Type   | Default     | Description           |
|-----------|--------|-------------|-----------------------|
| `example` | string | `'default'` | Describe this option  |

## Hooks used

- `afterClone` — modifies the cloned DOM tree

## License

MIT
