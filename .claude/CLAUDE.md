# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Non-negotiable project goals

Every change must respect these, in this order:

1. **Speed** — no change may regress capture performance. If a fix or feature adds work to the hot path (`captureDOM` and anything it calls per-node), justify the cost and, when in doubt, measure with `npm run test:benchmark` before/after.
2. **Fidelity** — the rendered capture must match the live DOM. Never trade visual accuracy for convenience. Safari workarounds, bleed math, font embedding, and the clone-in-document measurement pass exist for fidelity reasons; don't "simplify" them without understanding what breaks.
3. **Minimal code** — no decorative code. No helpers for single callers, no speculative abstractions, no options for hypothetical future needs, no defensive checks for impossible states. The library is deliberately small; keep it that way. If a change adds bytes, it has to pay for them.

If a proposed change conflicts with (1) or (2), don't ship it — surface the trade-off instead.

## Commands

All scripts are npm-driven. Tests run in a real browser via Vitest + Playwright (chromium), so `npx playwright install` is required once.

- Build: `npm run compile` (esbuild → `dist/`) · `npm run build` also runs `npm pack`
- Lint: `npm run lint` · auto-fix: `npm run lint:fix`
- Tests: `npm test` (runs `lint:fix` then `vitest run --browser.headless`)
- Coverage: `npm run test:coverage`
- Benchmarks: `npm run test:benchmark`
- Single test file: `npx vitest run __tests__/<file>.test.js --browser.headless`
- Single test by name: `npx vitest run --browser.headless -t "<test name substring>"`

Note: `npm test` auto-fixes lint before running. If you want to run tests without modifying files, call vitest directly.

## Architecture

SnapDOM captures a DOM subtree and serializes it as an SVG `data:` URL embedded in a `<foreignObject>`, which exporters then rasterize to PNG/JPG/WebP/Canvas/Blob.

### Capture pipeline (`src/core/capture.js`)

Linear pipeline orchestrated by `captureDOM(element, options)`:

1. `prepareClone` (`src/core/prepare.js`) — deep clone with `deepClone` (`src/core/clone.js`), inlines pseudo-elements (`src/modules/pseudo.js`) and SVG `<defs>`/`<symbol>` refs (`src/modules/svgDefs.js`). Returns `{ clone, classCSS, styleCache }`.
2. Inline assets via `idle()` phases: `inlineImages` (`src/modules/images.js`), `inlineBackgroundImages` (`src/modules/background.js`), optional `embedCustomFonts` (`src/modules/fonts.js`).
3. Compute bbox + bleed (shadows, blur, outline, transforms — helpers in `src/utils/capture.helpers.js` and `src/utils/transforms.helpers.js`), serialize `<foreignObject>` into an SVG, return a `data:image/svg+xml` URL.
4. Exporters (`src/exporters/*`) and `src/modules/rasterize.js` are dynamically imported from `src/api/snapdom.js` to keep the initial bundle tree-shakeable.

Two option flags materially change layout math: `outerTransforms` (default `true`; when `false`, root translate/rotate are stripped and bbox is recomputed from the remaining 2D matrix) and `outerShadows` (default `false`; when `true`, bbox expands for shadows/blur/outline, otherwise those effects are stripped from the root).

### Context & options (`src/core/context.js`)

`createContext(userOptions)` normalizes all user options into a single context object used throughout the pipeline and passed to plugins. It also resolves `format` aliases (`jpg` → `jpeg`) and applies defaults (e.g. JPEG/WebP get `backgroundColor: '#ffffff'`). When adding a new option, add it here first.

### Plugin system (`src/core/plugins.js`)

Plugins are plain objects with lifecycle hooks, local-first:

- Global: `snapdom.plugins(...defs)` (deduped by `name`).
- Per-capture: `snapdom(el, { plugins: [...] })` — locals override globals by name via `mergePlugins`. `attachSessionPlugins` freezes the merged list onto the capture context.
- Hooks fire in order: `beforeSnap → beforeClone → afterClone → beforeRender → afterRender → beforeExport → afterExport → afterSnap` (once per session). `runHook` chains return values; `runAll` collects all returns (used by `defineExports` so multiple plugins can contribute export formats).
- Plugins can add formats via `defineExports(ctx)` returning `{ <name>: async (ctx, opts) => result }`. `snapdom.capture` automatically wires them as `result.to<Name>(opts)` helpers and they get the same `beforeExport`/`afterExport` pipeline as core exports.

Spec is in `PLUGIN_SPEC.md`; contribution guidelines in `CONTRIBUTING_PLUGINS.md`. Official plugins live in `packages/plugins/` (monorepo workspace).

### Caching (`src/core/cache.js`)

Global `cache` exposes `EvictingMap` (FIFO, capped) instances for `image`, `background`, `resource`, `baseStyle`, `defaultStyle`; `WeakMap`s for `computedStyle` and `measureHints` (caches the expensive clone-in-document layout round-trip); a `Set` for `font`; and a `session` bucket reset per capture. `cache` option accepts `"disabled" | "soft" | "auto" | "full"` (normalized via `normalizeCachePolicy`); `applyCachePolicy` is called at the top of `captureDOM`.

### Safari/WebKit handling

The old once-per-session 3x pre-capture warmup is gone. WebKit quirks are handled at their point of impact instead (all verified against real Safari via a SnapEye harness — re-verify there before touching these):

- **WebKit #219770/#394** (svg-as-image: `img.decode()` resolves before embedded fonts / nested images paint → blank first `drawImage`): `toCanvas`'s `waitForImgPaint` attaches the img offscreen and, when the svg carries `@font-face`/`data:image` payloads, probe-draws a 16px canvas until ink appears (bounded ~600ms). Plain svgs keep the old two-rAF compositor wait.
- **`src/api/snapdom.js` Safari pre-step**: waits `ensureFontsReady` for the element's fonts (when `embedFonts`) and pokes `<canvas>` stores (`getImageData(1,1)`) so `cloneCanvas`'s `toDataURL` isn't blank. Cheap, runs per capture.
- **`toImg`/`toSvg` with scale/width/height on Safari stays vector**: `fixSafariShadows` (same rewrite `toCanvas` uses — WebKit flips svg-as-image shadow Y offsets) + patching the svg's own `width`/`height` to the display size, so it renders at natural scale. PNG rasterize is only the error fallback.

**How to verify WebKit changes in REAL Safari** (Playwright WebKit does NOT reproduce #219770 — a green `test:webkit` run proves nothing about these quirks):
- SnapEye harness: `bench/snapeye-dev.mjs` (untracked; requires the sibling `../snapeye` repo). It serves a demo page that runs capture loops and writes every captured blob to `.snapeye/` — complete captures are byte-identical, so any file-size outlier is a blank/corrupt frame. `npm run compile && node bench/snapeye-dev.mjs`, then open the URL in Safari itself.
- WebDriver fallback (no extra repo needed): `safaridriver --port 4444` (Develop → Allow Remote Automation must be enabled, already done on this machine) + plain curl WebDriver calls to run JS/DOM checks and read errors in real Safari.

### Build outputs (`esbuild.config.mjs`)

Three parallel builds written to `dist/`:
- `dist/snapdom.js` — IIFE from `src/index.browser.js` (exposes `window.snapdom`, `window.preCache`).
- `dist/snapdom.mjs` — ESM from `src/index.js`.
- `dist/preCache.mjs`, `dist/plugins.mjs` — subpath ESM entries (see `package.json` `exports`).

All are minified, `sideEffects: false`. `src/index.js` only re-exports `snapdom` and `preCache`; plugins are a separate subpath so core bundles stay small.

## Code style (eslint.config.cjs)

- Single quotes, no semicolons, max 1 consecutive empty line, final newline required.
- Unused vars/args prefixed `_` are allowed.
- Lint scope is `src/**/*.js` and `__tests__/**/*.js` only.
- Browser globals + `WebKitCSSMatrix` are pre-declared.

## Testing

- Tests run in headless Chromium (Playwright). There is no Node/jsdom mode — DOM APIs are real.
- Benchmarks: files matching `*.benchmark.js` are excluded from the normal test run; use `npm run test:benchmark` or `npx vitest bench`.
- Visual diffs live under `__tests__/__screenshots__/`.
- Coverage config in `vitest.config.js` scopes to `src/**/*.js`.
