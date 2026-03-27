# SnapDOM Plugin Specification v1.0

The official guide for creating SnapDOM plugins.

## What is a Plugin?

A SnapDOM plugin is a plain JavaScript object with a unique `name` and one or more lifecycle hooks. Plugins can modify the capture at any stage.

```js
const myPlugin = {
  name: 'my-plugin',
  afterClone(ctx) {
    // modify ctx.clone before render
  }
};
```

## Plugin Factory Pattern (Recommended)

Wrap your plugin in a factory function to accept options:

```js
export function myPlugin(options = {}) {
  const { color = 'red', opacity = 0.5 } = options;

  return {
    name: 'my-plugin',
    afterClone(ctx) {
      ctx.clone.style.border = `2px solid ${color}`;
    }
  };
}
```

Usage:

```js
import { snapdom } from '@zumer/snapdom';
import { myPlugin } from 'snapdom-plugin-my-plugin';

// Per-capture
const result = await snapdom(element, {
  plugins: [myPlugin({ color: 'blue' })]
});

// Global registration
snapdom.plugins(myPlugin());
```

## Lifecycle Hooks

Hooks execute in this order:

```
beforeSnap → beforeClone → afterClone → beforeRender → afterRender → beforeExport → afterExport
```

Plus `defineExports` for adding custom export methods.

| Hook | When it runs | Common use cases |
|------|-------------|-----------------|
| `beforeSnap` | Before anything happens | Validate options, set defaults |
| `beforeClone` | Before DOM is cloned | Pre-process live DOM (undo in afterClone) |
| `afterClone` | After clone is created | Transform clone: overlays, styles, replacements |
| `beforeRender` | Before SVG serialization | Modify SVG string or rendering options |
| `afterRender` | After SVG is rendered | Post-process rendered output |
| `beforeExport` | Before each export call | Modify export options (quality, type) |
| `afterExport` | After each export call | Transform export output (chained) |
| `defineExports` | During plugin registration | Add new export formats (toPdf, toAscii) |

### Hook Context

Every hook receives a single context object (`ctx`):

```js
{
  // Input & options
  element,           // Original DOM element
  debug, fast,       // Mode flags
  scale, dpr,        // Resolution
  width, height,     // Dimensions
  backgroundColor,   // Background color
  quality,           // Export quality (0-1)
  useProxy,          // CORS proxy URL
  cache,             // Cache instance
  outerTransforms, outerShadows,
  embedFonts, localFonts, iconFonts, excludeFonts,
  exclude, excludeMode,
  filter, filterMode,
  fallbackURL,

  // Intermediate values (available after their stage)
  clone,             // Cloned DOM tree
  classCSS, styleCache,
  fontsCSS, baseCSS,
  svgString,         // After beforeRender
  dataURL,           // After afterRender

  // During export hooks
  export: { type, options, url }
}
```

### Hook Rules

1. Hooks can be sync or async. SnapDOM awaits all hooks.
2. Mutate `ctx` freely, e.g. change `ctx.backgroundColor` in `beforeSnap`.
3. `afterExport` return values are chained to the next plugin.
4. DOM mutations in `beforeClone` must be undone. The live page should not be affected.

## Adding Custom Exports with defineExports

```js
export function pdfExport(options = {}) {
  return {
    name: 'pdf-export',
    defineExports(ctx) {
      return {
        pdf: async (ctx, opts) => {
          const svgUrl = ctx.export.url;
          // convert to PDF...
          return pdfBlob;
        }
      };
    }
  };
}

// After registration:
const result = await snapdom(element, { plugins: [pdfExport()] });
const blob = await result.toPdf({ width: 800 });
```

## Distribution

### Official plugins

Official plugins ship as a separate package to keep the core lightweight:

```bash
npm i @zumer/snapdom-plugins
```

```js
// Individual (tree-shakeable)
import { filter } from '@zumer/snapdom-plugins/filter';

// All at once
import { filter, asciiExport, replaceText } from '@zumer/snapdom-plugins';
```

They live in `packages/plugins/` inside the snapdom monorepo.

### Community plugins

Publish to npm with the naming convention:

**Package name:** `snapdom-plugin-[name]`

**Plugin `name` field:** lowercase kebab-case: `'watermark'`, `'redact'`, `'pdf-export'`

## Plugin Template

```js
/**
 * snapdom-plugin-example
 * Short description.
 *
 * @param {Object} options
 * @returns {Object} SnapDOM plugin
 */
export function example(options = {}) {
  const {
    enabled = true,
  } = options;

  return {
    name: 'example',

    // Pick only the hooks you need:
    // beforeSnap(ctx) {},
    // beforeClone(ctx) {},

    afterClone(ctx) {
      if (!enabled) return;
      // modify ctx.clone
    },

    // beforeRender(ctx) {},
    // afterRender(ctx) {},
    // beforeExport(ctx) {},
    // afterExport(ctx) {},
    // defineExports(ctx) { return { format: async (ctx, opts) => {} }; },
  };
}
```

## Publishing a Community Plugin

### 1. Create the package

```bash
mkdir snapdom-plugin-yourname && cd $_
npm init -y
```

### 2. package.json

```json
{
  "name": "snapdom-plugin-yourname",
  "version": "1.0.0",
  "description": "A SnapDOM plugin that does X",
  "type": "module",
  "main": "index.js",
  "exports": { ".": "./index.js" },
  "keywords": ["snapdom", "snapdom-plugin", "dom-capture"],
  "peerDependencies": { "@zumer/snapdom": ">=0.9.0" },
  "license": "MIT"
}
```

### 3. Write, test, publish

```bash
npm publish
```

Then open a PR or issue at [zumerlab/snapdom](https://github.com/zumerlab/snapdom) to list it in the plugin directory.

## Plugin Categories

| Category | Description | Examples |
|----------|------------|---------|
| **Capture** | Modify how DOM is captured | pictureResolver, lazy-load handler |
| **Transform** | Alter cloned output | overlay, filter, redact, watermark |
| **Export** | Add output formats | PDF, ASCII, AVIF, animated GIF |
| **Integration** | Connect to external services | upload to S3, post to Slack |
| **Utility** | Dev tools and helpers | debug overlay, perf timer |

## Best Practices

1. Be opt-in. Zero overhead when not active.
2. Restore the DOM. If you mutate in `beforeClone`, undo in `afterClone`.
3. Use the factory pattern. Always accept options, always set defaults.
4. Name uniquely. Check the directory first.
5. Handle errors gracefully. `try/catch` your logic.
6. Document your options. Type, default, description.
7. Keep dependencies minimal. Ideally zero.
8. Test with `scale: 2`. High-DPI exposes pixel math issues.

## Example: Watermark Plugin

```js
export function watermark(options = {}) {
  const {
    text = '© SnapDOM',
    fontSize = 14,
    color = 'rgba(0,0,0,0.15)',
    position = 'bottom-right',
    rotate = -30,
  } = options;

  return {
    name: 'watermark',

    afterClone(ctx) {
      const overlay = document.createElement('div');
      const posStyles = {
        'top-left':     'top:8px;left:8px',
        'top-right':    'top:8px;right:8px',
        'bottom-left':  'bottom:8px;left:8px',
        'bottom-right': 'bottom:8px;right:8px',
        'center':       'top:50%;left:50%;transform:translate(-50%,-50%)'
      };

      overlay.style.cssText = `
        position:absolute;
        ${posStyles[position] || posStyles['bottom-right']};
        font-size:${fontSize}px;
        color:${color};
        pointer-events:none;
        z-index:999999;
        white-space:nowrap;
        ${position !== 'center' && rotate ? `transform:rotate(${rotate}deg)` : ''}
      `;
      overlay.textContent = text;
      ctx.clone.style.position = 'relative';
      ctx.clone.appendChild(overlay);
    }
  };
}
```

Questions? Open a [Discussion](https://github.com/zumerlab/snapdom/discussions) or check the [Plugin Directory](https://snapdom.dev/plugins).
