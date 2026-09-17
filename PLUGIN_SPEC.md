# SnapDOM Plugin Specification (SnapDOM v3.x.x)

This guide covers the plugin contract for SnapDOM v3. SnapDOM captures the rendered
state of web apps and exports images and canvases. Plugins can transform that capture,
export HTML, context, element maps or PDF, and record a live element as GIF or video.

## What is a Plugin?

A plugin is a plain JavaScript object with a unique `name` and one or more lifecycle hooks.
Each hook runs at a defined point in capture or export.

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
  const { color = 'red' } = options;

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
beforeSnap → beforeClone → resolveNode (per node) → afterClone → beforeRender → afterRender
→ defineExports → [beforeExport → exporter → afterExport] → afterSnap
```

The bracketed segment runs for every export. `afterSnap` runs once, after the first
successful export. A plugin with `beforeRender` or `afterRender` makes an
`engine: 'html-in-canvas'` request use the SVG fallback.

| Hook | When it runs | Common use cases |
|------|-------------|-----------------|
| `beforeSnap` | Before capture work begins | Validate options, set defaults |
| `beforeClone` | Before DOM is cloned | Pre-process live DOM (undo in afterClone) |
| `resolveNode` | Per node, during cloning | Replace/skip individual nodes (redaction, custom widgets) |
| `afterClone` | After DOM and styles are cloned | Transform clone: overlays, styles, replacements |
| `beforeRender` | Before the selected renderer runs | Adjust the clone or generated CSS |
| `afterRender` | After the render artifact exists | Read `ctx.dataURL` / `ctx.meta`, and `ctx.svgString` on the SVG path |
| `defineExports` | During result setup, after capture | Add new export formats (toPdf, toAscii) |
| `beforeExport` | Before each export call | Adjust export options (quality, size) |
| `afterExport` | After each export call | Observe the export result (log, upload, measure) |
| `afterSnap` | Once, after the first successful export | Cleanup capture-scoped resources |

### Per-node hook: `resolveNode(node, ctx)`

`resolveNode` runs once per source node while the clone is
built (after the compiled exclusion policy, before built-in handling of
iframe/canvas/video/audio).
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

Capture hooks (`beforeSnap` through `afterRender`, plus `afterSnap`) share one context object,
`ctx`. It holds normalized options and the values produced at each stage. Changes to capture
options in `beforeSnap` affect the capture, with the exceptions listed under [Hook Rules](#hook-rules).
`format` is the canonical image-format field; the deprecated `type` alias stays synchronized.

Export hooks receive a per-export copy with an `export` block for that call. Change export
options through the second argument's `options` object.

```js
{
  // Input & options
  element,           // Capture root, set on full and differential recapture paths
  options,           // Self-reference to this same ctx (for plugins written against ctx.options)
  needs,             // How far this capture runs: 'clone' | 'render'
  debug,             // Mode flags
  scale, dpr,        // Resolution
  width, height,     // Dimensions
  backgroundColor,   // Background color
  quality,           // Export quality (0-1)
  useProxy,          // CORS proxy URL
  cache,             // Persistent resource/style cache policy
  outerTransforms, outerShadows,
  embedFonts, localFonts, iconFonts, excludeFonts, fontStylesheetDomains,
  filter, filterMode, exclude, excludeMode,
  shouldExclude,     // Combined data-capture/exclude/filter content decision
  fallbackURL, placeholders,
  format, type, filename, canvas, captureSelection, // format is canonical; type is synchronized
  reconcile, invalidate, excludeStyleProps,
  clip, engine, plugins,

  // Intermediate values (available after their stage)
  clone,             // Cloned DOM tree, from afterClone through afterRender
  classCSS, styleCache, nodeMap,
  fontsCSS, baseCSS,
  svgString,         // Serialized SVG source, available in afterRender, then released
  dataURL,           // Capture data URL when the selected engine produces one
  meta,              // Frozen render geometry (viewBox, content origin, clip) after render
                     // clone/nodeMap/styleCache/svgString are released once afterRender has
                     // run: keeping them would make every live result retain the whole tree.

  // During export hooks (defineExports and beforeExport/afterExport)
  export: {
    type, options, url, // URL is SVG by default; PNG after a successful native html-in-canvas capture
    requestedOptions, // Exactly what this toXxx() call passed, frozen (omitted keys stay omitted)
    svgString,       // () => string; lazily decodes SVG, throws for a raster engine capture
  },
  artifacts: {       // Captured render CSS, available without parsing the URL
    classCSS, fontsCSS, baseCSS,
    scrollbarCSS,    // author rules for UA parts the clone cannot read: scrollbars, meter, progress, slider
  },
  exports,           // defineExports only: core exporters (png, canvas, blob, …)
                     // without their hooks, so a custom format can build on them
                     // without re-entering the export pipeline
}
```

### The export hooks take a payload

`beforeExport` and `afterExport` receive a second argument describing the export at hand:

```js
beforeExport(ctx, { format, options })          // format: 'png' | 'blob' | 'download' | your key
afterExport (ctx, { format, options, result })  // result: what the exporter returned
```

`options` is the object the exporter receives, so mutating it in
`beforeExport` steers that export. For format-selecting exporters, `options.format` is
canonical; its deprecated `options.type` alias is also honored and synchronized:

```js
{
  name: 'jpeg-quality',
  beforeExport(ctx, { format, options }) {
    if (format === 'jpeg') options.quality = 0.6
  },
}
```

Every plugin receives the same payload. Hook return values are ignored; the caller gets
what the exporter produced.
`beforeExport` may still mutate `options`; only `afterExport` receives `result`. To hand back
something else, declare that format in `defineExports` (it can build on
`ctx.exports.png()` and friends).

Compared with v2.x.x, `afterExport` no longer chains its return value as the next hook's
payload. That return never replaced the result received by the caller in v2 either.
Remove return-value chaining; custom output belongs in `defineExports`.

The v2 named TypeScript interface `PluginExportFacade` is no longer exported. The runtime
facade still exists; infer `ctx.exports` inside `defineExports`, or derive its type:

```ts
import type { CaptureContext } from '@zumer/snapdom';
type CoreExports = NonNullable<CaptureContext['exports']>;
```

### Hook Rules

1. Hooks can be sync or async. SnapDOM awaits all hooks.
2. Set capture options in `beforeSnap`, e.g. `ctx.backgroundColor`, `ctx.scale`, `ctx.width`,
   `ctx.clip`, `ctx.outerTransforms` or `ctx.outerShadows`. The exceptions are options resolved
   before hooks run: `plugins`, `needs`, `invalidate` and `cache`. Setting those in a
   hook has no effect.
3. Use `beforeExport` to change export options and `afterExport` to observe the result.
   Use `defineExports` to provide a different exporter.
4. DOM mutations in `beforeClone` must be undone. The live page should not be affected.

### How far the pipeline runs: `needs`

The pipeline has two capture stages, followed by exports:

```
element ──▶ [clone] ──▶ [render] ──▶ exports
```

Plugins that only need captured DOM or structured data can skip rendering:

```js
{ name: 'my-plugin', needs: 'clone' }   // through afterClone; nothing is rendered
{ name: 'my-plugin' }                   // default 'render': clone and render
```

Only a per-capture plugin may lower the stage. Global registration rejects `needs: 'clone'`
because it would silently remove pixels from every capture in the application.

The supported stages are `'clone'` and `'render'`; the former `'dom'` stage is no longer
supported. `ctx.shouldExclude` covers both the exclusion rules and the inclusion filter at
either stage, following changes made in `beforeSnap`. For cloning, `data-capture="exclude"`
and `exclude` are checked before `filter`; the first omission supplies `excludeMode` or
`filterMode` respectively. Both modes default to `hide` and can differ in one capture.
`resolveNode` runs after these content-selection checks.

The capture runs to the deepest stage requested by its plugins. An undeclared `needs`
means `'render'`, so every attached plugin must request `'clone'` to skip rendering.
Captures without plugins render normally. `result.needs` reports which stage ran.

If the capture stopped at `'clone'`, `url`, `toRaw()`, `toPng()`, `toCanvas()` and other image
exports throw, naming the plugins that lowered the stage. They never recapture on demand:
that would produce an image from a later moment. Skipping render still pays the cost of
cloning; it is useful when a caller needs only the plugin's non-image output.

Plugins that support both stages should accept a `needs` option:

```js
export function myPlugin(options = {}) {
  return { name: 'my-plugin', needs: options.needs ?? 'render', /* hooks */ }
}
```

`contextExport({ needs: 'clone' })` and `agentMap({ image: false, needs: 'clone' })` are the
official examples. Both default to `'render'` so the caller can choose whether to omit images.

Core rejects unknown stages. Validate any narrower stage requirements in your plugin:

```js
import { assertNeeds } from '@zumer/snapdom/plugins'
const needs = assertNeeds('my-plugin', options.needs, ['clone', 'render'])  // rejects 'dom'
```

`STAGES`, exported from the same entry point, is `['clone', 'render']`.
For example, `agent-map` requires `image: false` when `needs: 'clone'`.

### Plugins × the engine's fast paths (v3)

SnapDOM can reuse an unchanged capture (memoization) or rebuild changed subtrees
(differential recapture). By default, plugins with `resolveNode`, `beforeSnap`, `beforeClone`,
`afterClone`, `beforeRender` or `afterRender` disable these paths so their work is never skipped.
Export-only plugins (`defineExports`, `beforeExport`, `afterExport`) keep them available.

If your capture hooks are deterministic and idempotent (same input → same output, no
external state like timestamps or counters), declare it:

```js
{ name: 'my-plugin', pure: true, afterClone(ctx) { /* … */ } }
```

`pure: true` opts the plugin back into unchanged-repeat memoization. A pure plugin whose
capture-affecting hooks are limited to `beforeRender` / `afterRender` may also use
differential recapture, because those boundaries run around the rebuilt render. Hooks that
participate in clone construction (`beforeSnap`, `beforeClone`, `resolveNode`, `afterClone`)
still force a conservative full recapture after a change: the splice path cannot skip them.
Captures stopped at `needs: 'clone'` are never memoized because there is no render artifact
to serve, regardless of purity.
Declaring a hook pure when it reads changing external state can serve stale results.

## Adding Custom Exports with defineExports

```js
export function pdfExport(options = {}) {
  return {
    name: 'pdf-export',
    defineExports(ctx) {
      return {
        pdf: async (ctx, opts) => {
          const captureUrl = ctx.export.url; // SVG by default; PNG after successful native html-in-canvas
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

When export keys collide, priority is **local plugin > global plugin > core**. A per-capture
plugin can override `toPng`, `toJpg`, `toCanvas` or another exporter. Use `ctx.export.url` or
`ctx.exports` to build that export from the existing capture.

## Distribution

### Official plugins

Official plugins ship separately and require a matching core major version. See
[Installation](./README.md#installation) for core and CDN examples.

```bash
npm i @zumer/snapdom@latest @zumer/snapdom-plugins@latest
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
    needs: 'render', // per-capture plugins may instead request 'clone'
    pure: false,     // true only for deterministic/idempotent capture-affecting hooks

    // Pick only the hooks you need:
    // beforeSnap(ctx) {},
    // beforeClone(ctx) {},
    // resolveNode(node, ctx) {},

    afterClone(ctx) {
      if (!enabled) return;
      // modify ctx.clone
    },

    // beforeRender(ctx) {},
    // afterRender(ctx) {},
    // defineExports(ctx) { return { format: async (ctx, opts) => {} }; },
    // beforeExport(ctx, { format, options }) {},
    // afterExport(ctx, { format, options, result }) {},
    // afterSnap(ctx) {},
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
  "peerDependencies": { "@zumer/snapdom": "^3" },
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
| **Capture** | Modify how DOM is captured | custom-widget resolver, lazy-load handler |
| **Transform** | Alter cloned output | overlay, filter, redact, watermark |
| **Export** | Add output formats | PDF, ASCII, AVIF, animated GIF |
| **Integration** | Connect to external services | upload to S3, post to Slack |
| **Utility** | Dev tools and helpers | debug overlay, perf timer |

## Best Practices

1. Keep plugin work inside the hooks that need it.
2. Restore the DOM. If you mutate in `beforeClone`, undo in `afterClone`.
3. Use the factory pattern. Always accept options, always set defaults.
4. Name uniquely. Check the directory first.
5. Recover from errors where possible; otherwise throw a useful error instead of returning incomplete output.
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

For help, open a [Discussion](https://github.com/zumerlab/snapdom/discussions) or browse the [Plugin Directory](https://snapdom.dev/plugins).
