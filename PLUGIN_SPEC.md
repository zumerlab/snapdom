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
beforeSnap → beforeClone → afterClone → beforeRender → afterRender → [per export: beforeExport → afterExport] → afterSnap
```

Plus `defineExports` for adding custom export methods, and `resolveNode` per node during the clone walk.

| Hook | When it runs | Common use cases |
|------|-------------|-----------------|
| `beforeSnap` | Before anything happens | Validate options, set defaults |
| `beforeClone` | Before DOM is cloned | Pre-process live DOM (undo in afterClone) |
| `afterClone` | After clone is created | Transform clone: overlays, styles, replacements |
| `beforeRender` | Before SVG serialization | Modify SVG string or rendering options |
| `afterRender` | After SVG is rendered | Post-process rendered output |
| `beforeExport` | Before each export call | Modify export options (quality, type) |
| `afterExport` | After each export call | Observe the produced output (it cannot replace it) |
| `afterSnap` | Once, after the first export | Cleanup |
| `defineExports` | While the result object is built | Add new export formats (toPdf, toAscii) |
| `resolveNode` | Per node, during cloning | Replace/skip individual nodes (redaction, custom widgets) |

### Per-node hook: `resolveNode(node, ctx)`

Unlike the lifecycle hooks, `resolveNode` runs once **per source node** while the clone is
built (after `exclude`/`filter`, before built-in handling of iframe/canvas/video/audio).
The first plugin that returns a value wins:

- Return a **Node** → used as the finished clone for that node (subtree included). SnapDOM
  maps it to the source and copies the source's computed box styles onto it, so it keeps the
  original layout.
- Return **`null`** → the node is skipped entirely.
- Return **`undefined`** → continue with the normal pipeline.

```js
export function redactEmails() {
  return {
    name: 'redact-emails',
    resolveNode(node, _ctx) {
      if (node.nodeType === 1 && node.matches?.('[data-private]')) {
        const box = document.createElement('div')
        box.textContent = '███'
        return box
      }
      // undefined → normal cloning
    },
  }
}
```

Keep it fast: it runs on every node of the captured subtree. Prefer cheap checks
(`tagName`, an attribute) before anything expensive.

### Hook Context

There are **two** context shapes. Mixing them up is the most common plugin bug.

**Clone-phase hooks** (`beforeSnap`, `beforeClone`, `afterClone`, `beforeRender`, `afterRender`)
receive the capture state. Capture options are **not** flattened onto it: they live on `ctx.options`.

```js
{
  element,        // Original DOM element
  options,        // Normalized capture options (scale, dpr, embedFonts, backgroundColor, …)
  plugins,        // Active plugins for this capture

  clone,          // Cloned DOM tree            (from afterClone)
  classCSS, styleCache, nodeMap,             // (from afterClone)
  fontsCSS, baseCSS, scrollbarCSS,           // (from beforeRender)
  svgString, dataURL                         // (from afterRender)
}
```

**Export-phase hooks** (`beforeExport`, `afterExport`, `defineExports`) receive a spread of the
normalized options plus export info. There is no `clone` or `nodeMap` here: the clone is already
serialized into `export.url`.

```js
{
  // every normalized option, flattened: scale, dpr, width, height, quality, format, type,
  // backgroundColor, embedFonts, iconFonts, localFonts, excludeFonts, exclude, filter,
  // clip, compress, reconcile, burst, cache, useProxy, fallbackURL, placeholders, …
  element,        // Original DOM element
  meta,           // Frozen render geometry (same value as result.meta)
  export: { type, options, requestedOptions, url },
  exports         // Silent core exporters (defineExports only)
}
```

**Passing data from the clone phase to an export.** `ctx.__myData` set in `afterClone` does **not**
reach `defineExports`: they are different objects. Mirror it on `ctx.options`, the object the export
context is spread from:

```js
afterClone(ctx) {
  const data = collect(ctx.clone);
  ctx.__myData = data;                            // later clone-phase hooks
  if (ctx.options) ctx.options.__myData = data;   // export hooks and defineExports
},
defineExports() {
  return { mine: async (ctx) => ctx.__myData };   // arrives through the options spread
}
```

**Payloads.** `beforeExport(ctx, { format, options })` and
`afterExport(ctx, { format, options, result })` receive a second argument.

During an export, `export.options` is the normalized merge of capture defaults and
the export call. `export.requestedOptions` is a frozen shallow copy of exactly what
the caller passed to `toXxx(...)`: key presence is preserved, including explicit
values equal to a capture default. It is snapped synchronously when `toXxx()` is
called, before that export waits behind any earlier job in the capture's queue.
Plugin exporters should use it when applying their own defaults. In
`defineExports`, only the final canonical `export.url` is guaranteed because no
export call is active yet. `element` remains the original source element in both
`defineExports` and export-hook contexts, including when it belongs to a
same-origin iframe.

### Hook Rules

1. Hooks can be sync or async. SnapDOM awaits all hooks.
2. Mutate `ctx` freely, e.g. change `ctx.backgroundColor` in `beforeSnap`.
3. `afterExport` observes; it does not transform. What it returns becomes the payload passed to the
   next plugin's `afterExport`, but the caller always receives what the exporter produced. To change
   an output, register your own export with `defineExports`.
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
const blob = await result.toPdf({ width: 800 });   // or result.to('pdf', { width: 800 })
// (result.pdf() is not generated: only the toX() helper and to(name).)
```

**Priority.** When multiple sources define the same export key, resolution is **local plugin > global plugin > core**. So a plugin passed via `snapdom(el, { plugins: [...] })` can override `toPng`, `toJpg`, `toCanvas`, etc., and a per-capture plugin beats a globally-registered one with the same key. Use this to swap a core exporter for a plugin implementation (e.g. a plugin-provided `png` that reuses the existing SVG via `ctx.export.url`).

`defineExports(ctx)` also receives `ctx.exports`, a silent facade over the core
exporters. It reuses this capture without recursively firing export hooks. Its
`canvas()` method accepts `crop: { x, y, width, height }` in SVG viewBox
coordinates; SnapDOM windows the SVG before image decode, allowing document
plugins to rasterize page-sized regions instead of one browser-limited bitmap.
A crop is clipped to the intersection with the viewBox, and it never degrades
silently: a non-finite or empty window, a window fully outside the viewBox, or a
payload that is not a serialized SVG capture all reject with a `RangeError`
rather than returning the whole capture where one page was requested.
The returned capture object exposes the same immutable render geometry as
`result.meta`; both the metadata value and the result property that holds it are
non-writable/non-configurable. Auxiliary element captures can therefore measure
their own final SVG artifact without consulting the live source tree or risking
URL/geometry drift.

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
| **Capture** | Modify how DOM is captured | node redaction via `resolveNode`, lazy-load handlers |
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
