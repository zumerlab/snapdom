# Contributing Plugins to SnapDOM

## Quick Start

```bash
npx degit zumerlab/snapdom/packages/plugin-template snapdom-plugin-yourname
cd snapdom-plugin-yourname
npm install
```

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

**Official plugins** ship as `@zumer/snapdom-plugins`, a separate package that keeps the core lightweight. They live in `packages/plugins/` inside the snapdom monorepo.

**Community plugins** go on npm as `snapdom-plugin-[name]`. Your repo, your rules.

Both show up in the same plugin directory on the site.

## Conventions

**Naming:**
- npm package: `snapdom-plugin-[name]`
- Plugin `name` field: lowercase kebab-case (e.g., `'my-plugin'`)
- Main export: camelCase factory function (e.g., `myPlugin`)

**Structure:**
- Always use the factory pattern (accept options, return plugin object)
- Set sensible defaults for all options
- Export as both named and default export

**Hooks:**
`beforeSnap` → `beforeClone` → `afterClone` → `beforeRender` → `afterRender` → `beforeExport` → `afterExport` + `defineExports`

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

The plugin directory page loads this file automatically — no HTML editing needed.

### Option B: Open an Issue

Provide: plugin name, npm link, GitHub link, category, one-line description.

## Quality Guidelines

1. Works with `snapdom@latest` and `snapdom@dev`.
2. Zero side effects. Restore DOM mutations.
3. Handles errors. Wrap risky code in `try/catch`.
4. Has a README with install, usage, options, and an example.
5. Lists `@zumer/snapdom` as a peerDependency.
6. Minimal dependencies. Ideally zero.
7. Includes `snapdom` and `snapdom-plugin` keywords in package.json.

## Plugin Ideas

Some things the community has asked for:

- **Redact** blur or black-bar sensitive content by selector
- **Watermark** text/image watermarks with positioning
- **PDF Export** export captures as PDF
- **Annotations** arrows, circles, and callouts
- **Dark Mode** force dark/light theme on captures
- **Crop** crop to a region within the capture
- **Responsive** capture at multiple viewport sizes
- **Diff** visual diff between two captures
- **Upload** direct upload to S3, Cloudinary, Imgur
- **QR Code** embed a QR code linking to the source URL

## Getting Help

- [Discussions](https://github.com/zumerlab/snapdom/discussions) for questions and ideas
- [Plugin Spec](./PLUGIN_SPEC.md) for the full reference
- [Issues](https://github.com/zumerlab/snapdom/issues) for bugs and feature requests
