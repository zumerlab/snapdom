# SnapDOM Plugin Specification v2.0 (snapdom v3)

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
| `beforeRender` | Before SVG serialization | Adjust the clone or the CSS that is about to be serialized |
| `afterRender` | After SVG is rendered | Read the serialized output (`ctx.svgString`, `ctx.dataURL`, `ctx.meta`) |
| `beforeExport` | Before each export call | Adjust export options (quality, size) |
| `afterExport` | After each export call | Observe the export result (log, upload, measure) |
| `defineExports` | During plugin registration | Add new export formats (toPdf, toAscii) |
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

Every capture hook (`beforeSnap` → `afterRender`, and `afterSnap`) receives **the same
single context object** (`ctx`): the normalized options at the top level, plus each stage's
product as it is produced. It is the very object the pipeline reads, so an option you change
in `beforeSnap` is the option the capture uses. The export hooks get a per-export VIEW of
that context (same option values, plus the `export` block for the call at hand), so there
you steer the export through `payload.options`, not through `ctx`.

```js
{
  // Input & options
  element,           // The capture root — set on every path, including burst's diff recapture
  options,           // Self-reference to this same ctx (for plugins written against ctx.options)
  needs,             // How far this capture runs: 'clone' | 'render'
  debug,             // Mode flags
  scale, dpr,        // Resolution
  width, height,     // Dimensions
  backgroundColor,   // Background color
  quality,           // Export quality (0-1)
  useProxy,          // CORS proxy URL
  cache,             // Cache instance
  outerTransforms, outerShadows,
  embedFonts, localFonts, iconFonts, excludeFonts,
  exclude, excludeMode,
  fallbackURL,
  clip, engine,

  // Intermediate values (available after their stage)
  clone,             // Cloned DOM tree — from afterClone through afterRender
  classCSS, styleCache, nodeMap,
  fontsCSS, baseCSS,
  svgString,         // Serialized SVG source — in afterRender (released right after it)
  dataURL,           // The capture's data: URL — from afterRender on
  meta,              // Frozen render geometry (viewBox, content origin, clip) after render
                     // clone/nodeMap/styleCache/svgString are released once afterRender has
                     // run: keeping them would make every live result retain the whole tree.

  // During export hooks (defineExports and beforeExport/afterExport)
  export: {
    type, options, url,
    requestedOptions, // Exactly what this toXxx() call passed, frozen (omitted keys stay omitted)
    svgString,       // () => string — LAZY decode of the serialized SVG (call it)
  },
  artifacts: {       // Render CSS the pipeline already holds — never reverse-parse the url
    classCSS, fontsCSS, baseCSS, scrollbarCSS
  },
  exports,           // defineExports only — the core exporters (png, canvas, blob, …)
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

`options` is the SAME object the exporter is about to receive, so mutating it in
`beforeExport` steers that export:

```js
{
  name: 'jpeg-quality',
  beforeExport(ctx, { format, options }) {
    if (format === 'jpeg') options.quality = 0.6
  },
}
```

Both hooks **observe** the result: every plugin receives the same payload, return values are
ignored, and the caller gets what the exporter produced. To hand back something else, declare
that format in `defineExports` (it can build on `ctx.exports.png()` and friends).

### Hook Rules

1. Hooks can be sync or async. SnapDOM awaits all hooks.
2. Mutate `ctx` freely, e.g. change `ctx.backgroundColor`, `ctx.scale`, `ctx.width`,
   `ctx.clip`, `ctx.outerTransforms` or `ctx.outerShadows` in `beforeSnap`: everything that
   shapes the picture is read after that hook has run. The exceptions are the options that
   pick the capture PATH, resolved before any hook can run: `plugins`, `needs`, `engine`,
   `burst`, `invalidate` and `cache`. Setting those in a hook has no effect.
3. Export hooks observe; `defineExports` is where an export result is decided.
4. DOM mutations in `beforeClone` must be undone. The live page should not be affected.

### How far the pipeline runs: `needs`

A capture is a chain, and each step consumes what the previous one produced:

```
element ──▶ [clone] ──▶ [render] ──▶ exports
```

Not every plugin needs the whole chain: one that annotates the clone may not want pixels.
Declare what your plugin needs, and snapdom stops there:

```js
{ name: 'my-plugin', needs: 'clone' }   // through afterClone; nothing is rendered
{ name: 'my-plugin' }                   // default 'render': the whole pipeline, as always
```

The clone is the floor. A shallower `'dom'` stage existed and was removed: a capture that
takes no clone does no capturing, so core contributed nothing to it but option
normalization and a hook runner, which a plugin can do by calling its own function on the
element. The one thing such a plugin genuinely needed from core, the compiled exclusion
policy, is `ctx.shouldExclude` and is available at every stage.

Two rules keep this predictable:

1. **The capture runs to the deepest stage its plugins declare.** A plugin can only lower
   the pipeline when every other plugin agrees, and a capture with no plugins behaves as it
   always did. (Adding a plugin that declares less than `'render'` DOES take the image
   away — that is the point of declaring it — but it can never do so behind another
   plugin's back.)
2. **What was never produced is never faked.** `url`, `toRaw()`, `toPng()`, `toCanvas()`
   and friends throw on a capture that stopped early, naming the plugins that lowered it.
   Re-capturing on demand would return pixels of a *different* instant and the caller
   would have no way to tell: the clone IS the freeze, and it cannot be taken afterwards.

`result.needs` reports what actually ran — same word, same three values.

**Why it is worth declaring.** Measured on a 601-node subtree: clone 43.3 ms, assets
2.7 ms, serialize 1.6 ms. Stopping before the render saves a few percent; stopping before
the clone saves ~89%, and only the plugin knows that cut can be made.

**Give the caller the same knob.** Plugins that can work at more than one depth take a
`needs` option and pass it through, so the vocabulary is identical everywhere:

```js
export function myPlugin(options = {}) {
  return { name: 'my-plugin', needs: options.needs ?? 'render', /* hooks */ }
}
```

`contextExport({ needs: 'clone' })` and `agentMap({ image: false, needs: 'clone' })` are the
official examples. Both default to `'render'`, because lowering the stage takes the picture
away and that is the caller's call to make.

Core rejects an unknown value by itself, naming your plugin. What core CANNOT know is a
stage your plugin doesn't support — and running there usually means returning something
empty that looks like a valid answer. Reject it yourself:

```js
import { assertNeeds, STAGES } from '@zumer/snapdom/plugins'
const needs = assertNeeds('my-plugin', options.needs, ['clone', 'render'])  // rejects 'dom'
```

`agent-map` is the cautionary example: it reads the map in `afterClone`, so at `'dom'` it
would hand back an empty map — indistinguishable from a page with nothing interactive.

### Plugins × the engine's fast paths (v3)

snapdom memoizes repeated captures automatically and rebuilds only mutated subtrees
(differential recapture). Because a memo serve skips render hooks and a subtree splice
would drop their work, **any plugin with a clone/render-affecting hook** (`resolveNode`,
`beforeSnap`, `beforeClone`, `afterClone`, `beforeRender`, `afterRender`) **suspends
those fast paths** for its captures. Export-only plugins (`defineExports`,
`beforeExport`, `afterExport`) keep the full speedup.

If your render hooks are **deterministic and idempotent** (same input → same output, no
external state like timestamps or counters), declare it:

```js
{ name: 'my-plugin', pure: true, afterClone(ctx) { /* … */ } }
```

`pure: true` opts the plugin back into memoization and differential recapture. Declaring
purity on a hook that reads changing external state will serve stale results — that is
the contract you sign.

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

**Priority.** When multiple sources define the same export key, resolution is **local plugin > global plugin > core**. So a plugin passed via `snapdom(el, { plugins: [...] })` can override `toPng`, `toJpg`, `toCanvas`, etc., and a per-capture plugin beats a globally-registered one with the same key. Use this to swap a core exporter for a plugin implementation (e.g. a plugin-provided `png` that reuses the existing SVG via `ctx.export.url`).

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
    // beforeExport(ctx, { format, options }) {},
    // afterExport(ctx, { format, options, result }) {},
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
