# Contributing Plugins to SnapDOM

Plugins can transform captured state, add exports or connect captures to another service.
This guide targets SnapDOM v3. See [Installation](./README.md#installation) for the published
versions.

## Quick Start

Install SnapDOM as a dev dependency:

```bash
npm install --save-dev @zumer/snapdom@latest
```

Scaffold a plugin from the template:

```bash
npx degit zumerlab/snapdom/packages/plugin-template snapdom-plugin-yourname
cd snapdom-plugin-yourname
npm install --save-dev @zumer/snapdom@latest
```

The [template installation guide](./packages/plugin-template/README.md#install)
covers the same steps and the peer range to keep.

```js
// index.js
export function yourPlugin(options = {}) {
  return {
    name: 'your-plugin',
    afterClone(ctx) {
      // modify ctx.clone
    }
  };
}
```

```js
// test it
import { snapdom } from '@zumer/snapdom';
import { yourPlugin } from './index.js';

const result = await snapdom(document.body, {
  plugins: [yourPlugin()]
});
const img = await result.toPng();
```

```bash
npm publish
```

Then open a PR to list it in the [Plugin Directory](https://snapdom.dev/plugins).

## How plugins are distributed

Official plugins ship as `@zumer/snapdom-plugins` and live in `packages/plugins/` in this repository.

Community plugins use the npm name `snapdom-plugin-[name]` and are maintained in their own repositories.

Both show up in the same plugin directory on the site.

## Conventions

**Naming:**

- npm package: `snapdom-plugin-[name]`
- Plugin `name` field: lowercase kebab-case (e.g., `'my-plugin'`)
- Main export: camelCase factory function (e.g., `myPlugin`)

**Structure:**

- Always use the factory pattern (accept options, return plugin object)
- Set sensible defaults for all options
- Export a named factory function; the template also includes a default export

**Hooks:**

```text
beforeSnap → beforeClone → resolveNode → afterClone → beforeRender → afterRender
→ defineExports → [beforeExport → exporter → afterExport] → afterSnap
```

`resolveNode` runs per source node. The bracketed segment runs per export; `afterSnap`
runs once after the first successful export.

Full reference in [PLUGIN_SPEC.md](./PLUGIN_SPEC.md).

**Categories:**

Tag yours with one of: `capture`, `transform`, `export`, `integration`, `utility`

## Submitting to the Plugin Directory

### Option A: Open a PR (recommended)

Add one line to [`docs/community-plugins.md`](./docs/community-plugins.md). The table format is:

```
| name | description | category | npm | github | author |
```

Example:

```
| snapdom-plugin-watermark | Add text or image watermarks to captures | transform | snapdom-plugin-watermark | https://github.com/you/snapdom-plugin-watermark | @you |
```

The plugin directory page loads this file automatically.

### Option B: Open an Issue

Provide: plugin name, npm link, GitHub link, category, one-line description.

### Make it discoverable

Add the [`snapdom-plugin`](https://github.com/topics/snapdom-plugin) GitHub topic to your
repository under **About → Topics**. The topic directory complements the curated plugin
list on the SnapDOM site.

## Quality Guidelines

1. Test against the SnapDOM versions you declare as supported, including v3.
2. Restore any changes to the live DOM.
3. Recover from errors where possible; otherwise report the failure instead of returning incomplete output.
4. Write a README with installation, usage, options and an example.
5. List `@zumer/snapdom` as a peerDependency.
6. Keep dependencies minimal, ideally zero.
7. Include `snapdom` and `snapdom-plugin` keywords in package.json.

Test in the browsers you support, including repeated captures and delayed exports from an
older result. Mark capture hooks `pure: true` only when they are deterministic and idempotent;
see [fast paths](./PLUGIN_SPEC.md#plugins--the-engines-fast-paths-v3).

## Plugin Ideas

Check [existing plugins](./packages/plugins/README.md) before starting. Plugins can add
workflows such as:

- **Redact** blur or black-bar sensitive content by selector
- **Watermark** text/image watermarks with positioning
- **PDF Export** custom layouts or pagination beyond the official image-PDF export
- **Annotations** arrows, circles, and callouts
- **Dark Mode** force dark/light theme on captures
- **Crop** region-selection tools around core's `clip` option
- **Responsive** capture at multiple viewport sizes
- **Diff** visual diff between two captures
- **Upload** direct upload to S3, Cloudinary, Imgur
- **QR Code** embed a QR code linking to the source URL

## Getting Help

- [Discussions](https://github.com/zumerlab/snapdom/discussions) for questions and ideas
- [Plugin Spec](./PLUGIN_SPEC.md) for the full reference
- [Issues](https://github.com/zumerlab/snapdom/issues) for bugs and feature requests
