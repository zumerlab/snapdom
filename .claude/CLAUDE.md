# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Where the code lives (2026-08-15)

Three SEPARATE repos, three separate clones. Getting this wrong pushes private work to a public remote, so check which directory you are in.

| repo | visibility | clone | branch |
|---|---|---|---|
| `zumerlab/snapdom` | **public** | `~/GitHub/zumerlab/snapdom` | `main` (shipped, 2.24.x) and `dev` |
| `zumerlab/snapdom-v3` | private | `~/GitHub/zumerlab/snapdom-v3` | `main` (default) — the v3 line, this file included |
| `zumerlab/snapdom-agent` | private | its own repo | the agent oracle (was `packages/agent`) |

In each clone `origin` is its OWN repo, so a bare `git push` is always correct. **This was not
true until 2026-08-15**: `snapdom-v3` used to be a git WORKTREE of the public clone, which meant
one shared object store (v3 commits physically lived inside the public `.git`, one stray
`git push origin --all` from leaking), one shared set of refs (only one branch could be called
`main`, and the public line owned the name), and a `node_modules` symlinked to the public clone
so its dependency upgrades silently drove v3's tests. All three are gone: separate clones,
separate objects, separate deps.

- The v3 repo has exactly one branch, `main`. `experimental` was deleted on both sides.
- A GitHub Action on the v3 repo commits `chore: update contributors list` after a push, so the
  remote is one commit ahead right after pushing. Fast-forward, do not panic.
- **`package-lock.json` is COMMITTED** (2026-08-15) and `playwright` is pinned to an exact
  version, no caret. Both exist for the same reason: the browser build is part of the visual
  fixture, not a floating dependency. While the lockfile was gitignored, a fresh `npm install`
  pulled Playwright 1.62.1 where the baselines had been recorded against 1.55.1, and two
  CJK-text demos failed DETERMINISTICALLY until 1.55.1 went back. Upgrading Playwright is a
  deliberate act that re-records baselines, never a side effect of installing. If visual demos
  move after any dependency work, check the Playwright version before reading the code.
- `packages/agent` and the `agent-lab` branch no longer exist here — that product lives in its
  own repo with its history. Do not recreate them.
- v3 is a breaking release. Anything that must reach users NOW (a fix that also affects the
  public `main`) belongs in a separate public-main release, not gated behind v3.

## Non-negotiable project goals

Every change must respect these, in this order:

1. **Speed** — no change may regress capture performance. If a fix or feature adds work to the hot path (`captureDOM` and anything it calls per-node), justify the cost and, when in doubt, measure with `npm run test:benchmark` before/after.
2. **Fidelity** — the rendered capture must match the live DOM. Never trade visual accuracy for convenience. Safari workarounds, bleed math, font embedding, and the clone-in-document measurement pass exist for fidelity reasons; don't "simplify" them without understanding what breaks.
3. **Minimal code** — no decorative code. No helpers for single callers, no speculative abstractions, no options for hypothetical future needs, no defensive checks for impossible states. The library is deliberately small; keep it that way. If a change adds bytes, it has to pay for them.

If a proposed change conflicts with (1) or (2), don't ship it — surface the trade-off instead.

## Commands

All scripts are npm-driven. Tests run in a real browser via Vitest + Playwright (chromium), so `npx playwright install` is required once.

- Build: `npm run compile` (esbuild → `dist/`) · `npm run build` = `npm pack` (a `prepack` hook compiles first)
- Lint: `npm run lint` · auto-fix: `npm run lint:fix`
- Tests: `npm test` (runs `lint:fix` then `vitest run --browser.headless`)
- Coverage: `npm run test:coverage`
- Benchmarks: `npm run test:benchmark`
- Packaging contract: `npm run test:pack` — packs with no `dist/`, asserts every entrypoint is inside the tarball, installs it into throwaway consumer projects and typechecks with `skipLibCheck: false` under both `node16` and `bundler`, then resolves every entrypoint at runtime and counts the globals the browser bundle leaks. The browser suite cannot see any of this: it imports `src/`.
- Single test file: `npx vitest run __tests__/<file>.test.js --browser.headless`
- Single test by name: `npx vitest run --browser.headless -t "<test name substring>"`

Note: `npm test` runs `lint` (check only) then `test:types` then vitest, so verifying never edits files. `npm run lint:fix` is the explicit auto-fix. `npm run build` is pure; the git add/commit/push that used to ride along as `prebuild` now lives in the explicit `npm run release`, which VERIFIES FIRST (test → test:pack → build) and pushes last. Publishing is deliberately not automated: `npm run publish:beta` is `npm publish --tag beta`, so a beta can never move `latest`.

**`prepack` is load-bearing.** `dist/` is gitignored — correct, it is a build output — and `files`/`exports` point into it, so without the hook `npm publish` from a clean checkout produces a tarball whose package.json references four files that are not in it. Nothing broken ever shipped, because the release flow packed after compiling on a machine that had `dist/`; the hook removes the dependence on that luck. `test:types` runs with `skipLibCheck: false` and includes `packages/plugins/*.d.ts` for the same reason: with it on, the repo checked declarations in a mode no consumer is ever in.

## Architecture

SnapDOM captures a DOM subtree and serializes it as an SVG `data:` URL embedded in a `<foreignObject>`, which exporters then rasterize to PNG/JPG/WebP/Canvas/Blob.

### Capture pipeline (`src/core/capture.js` + `src/engines/`)

**The pipeline splits at the clone**, the same seam `stages.js` names (`element -> clone -> render`):
`captureDOM` owns `element -> clone` (freeze, style snapshot, image/font inlining) and a render
ENGINE owns `clone -> pixels`. `src/engines/svg.js` is the default engine (`composeAndSerialize`:
base reset, bbox/bleed math, foreignObject assembly, SVG data-URL encoding) and is also
re-entered by burst's differential recapture. `src/engines/htmlInCanvas.js` is its
experimental peer: same input, different painter. It runs from a lazy seam in `captureDOM` right
where the clone is finished, and mounts THAT clone (it used to run before the pipeline and copy
the live element, which is why it had to bail on plugins/clip/exclude/reconcile — it skipped the
passes that implement them). Its only remaining bails are geometry: `outerShadows`, `clip` and
explicit `width`/`height` need the bbox math that lives in the svg engine. It is NOT optimized,
and it cannot run anywhere yet: Chromium taints the canvas unconditionally, so the taint probe
sends every capture to the svg engine. `assembleCaptureCSS` (utils/capture.helpers.js) is the
one place both engines get their CSS from.

Linear pipeline orchestrated by `captureDOM(element, options)`:

1. `prepareClone` (`src/core/prepare.js`) — deep clone with `deepClone` (`src/core/clone.js`), inlines pseudo-elements (`src/modules/pseudo.js`) and SVG `<defs>`/`<symbol>` refs (`src/modules/svgDefs.js`). Returns `{ clone, classCSS, classPrefixCSS, styleCache, nodeMap, reconcileRisk, clipWindow }`.
2. Inline assets: `inlineImages` (`src/modules/images.js`), `inlineBackgroundImages` (`src/modules/background.js`), optional `embedCustomFonts` (`src/modules/fonts.js`). (The old `idle()` call-through is gone — the ceremony outlived its scheduler and only added latency.)
3. Hand the finished clone to the render engine (`src/engines/svg.js`): compute bbox + bleed (shadows, blur, outline, transforms — helpers in `src/utils/capture.helpers.js` and `src/utils/transforms.helpers.js`), serialize `<foreignObject>` into an SVG, return a `data:image/svg+xml` URL.
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

### Caching (`src/core/cache.js`) and per-capture session (`src/core/session.js`)

Global `cache` exposes `EvictingMap` (FIFO, capped) instances for `image`, `background`, `resource`, `baseStyle`, `defaultStyle`, `compress`; `WeakMap`s for `computedStyle` and `measureHints` (caches the expensive clone-in-document layout round-trip); and a `Set` for `font`. Those are genuine cross-capture caches — that is the ONLY thing module-level mutable state is for here.

Everything scoped to one capture lives on the session object from `createCaptureSession()`, threaded explicitly through every stage. The old mutable `cache.session` global is gone: it was the mechanism behind #463 and the double scroll-compensation race, and its whole bug class is now structurally unrepresentable. Do not reintroduce per-capture state at module scope.

The `cache` option collapsed in v3 to `"soft"` (structural default) and `"disabled"`. `normalizeCachePolicy` maps everything else — including the legacy `"auto"`/`"full"` strings — to `"soft"`, silently. Caching is structural now, not a knob.

### Burst memo + differential recapture (`src/core/burst.js`, `src/core/diff.js`)

Default engine behaviour, not an option: after three captures of the same element inside a 2s window, `shouldAutoBurst` engages memoization, and a mutation scoped to a subtree rebuilds ONLY that subtree against the retained clone (`tryDiffCapture`) instead of re-running the pipeline. This is where the branch's large wins live (mutating poll 563ms → 16ms; animated poll 39ms → 7.5ms).

Its correctness rests entirely on one thing: **the INVALIDATION MATRIX comment at the top of `burst.js` is the wiring's source of truth.** Every way a rendered frame can change must have an observer listed there, and several of them produce NO mutation record at all — scroll, form-control state (`value`/`checked` are properties), focus, ancestor theme attributes, shadow-root content, font/image loads, animations. If you add a way for output to change, add its row. Canvas pixel draws and programmatic CSSOM edits are deliberately EXCLUDED (nothing can observe them) → those need `invalidate: true`.

`diff.js` bails to the full pipeline on anything it cannot splice byte-faithfully: `reconcile`, `clip`, embedded fonts, impure render plugins, scoped `::marker`/`::first-line` rules, and stylesheets carrying relational selectors (`+ ~ :has()`, counters) whose match depends on nodes outside the rebuilt subtree — including in `adoptedStyleSheets`. The fast path must never cost correctness; when in doubt it returns null.

### Style scan (`src/modules/styleScan.js`)

One pass over the document's author styles yields (a) the property universe — snapshot only props the page can actually touch — and (b) per-pseudo selector gates, so one `el.matches()` replaces three `getComputedStyle` resolutions per node. Both memoized per document + style epoch.

**Do not narrow that memo to a "rule epoch" without measuring invalidation cost under load.**
It was tried (2026-08-14) and reverted. Keying on author-rule changes instead of the DOM epoch
is faster in isolation, but three ways the rules can change emit NO mutation record
(adoptedStyleSheets assignment, a `<link>` finishing its load, `insertRule`), so staying correct
required a census of every stylesheet in the document, once per capture, reading
`cssRules.length` on each. On a long suite the document accumulates sheets, and under
`BROWSER=all` that census timed out `module.pseudo` on WebKit and `d-compress` everywhere while
the pre-split code ran clean. Removing the census removed the timeouts and broke the three
correctness cases. `__tests__/module.styles.ruleEpoch.test.js` pins the trade.

Two traps this has already sprung: CSS-nesting selectors arrive as raw `& .x::before`, and `matches()` answers **false** to those instead of throwing — so an unresolved `&` silently gates every node out rather than falling back. And a gate that parses but can never match is worse than no gate: return `null` (probe everything) instead.

### Experimental canvas engine (`src/engines/htmlInCanvas.js`)

WICG canvas-place-element (`ctx.drawElement`), opt-in via `engine: 'canvas'`. Fully quarantined: core's only knowledge is a 3-line lazy import in `snapdom.js`, and on ANY doubt `tryEngineResult` returns null and the normal pipeline runs. It paints pixel-perfectly (native form controls included) but Chromium currently taints the canvas unconditionally, so there is no readback and every capture falls through today. Keep the quarantine contract intact — correctness must never depend on this module.

**It is NOT in the shipped bundle.** Nothing is code-split, so the lazy import still landed in `dist/` and every user downloaded a branch that cannot run. `esbuild.config.mjs` defines `__SNAPDOM_CANVAS_ENGINE__ = false`, and the seam in `snapdom.js` is written so esbuild folds the branch (and the module) away. Tests import `src` directly, where the identifier is undefined and the engine stays live. To build it in: `SNAPDOM_CANVAS_ENGINE=1 npm run compile`. When Chromium ships same-origin readback, flip the default.

### Safari/WebKit handling

The old once-per-session 3x pre-capture warmup is gone. WebKit quirks are handled at their point of impact instead (all verified against real Safari via a SnapEye harness — re-verify there before touching these):

- **WebKit #219770/#394** (svg-as-image: `img.decode()` resolves before embedded fonts / nested images paint → blank first `drawImage`): `toCanvas`'s `waitForImgPaint` attaches the img offscreen and, when the svg carries `@font-face`/`data:image` payloads, probe-draws a 16px canvas until ink appears (bounded ~600ms). Plain svgs keep the old two-rAF compositor wait.
- **`src/api/snapdom.js` Safari pre-step**: waits `ensureFontsReady` for the element's fonts (when `embedFonts`) and pokes `<canvas>` stores (`getImageData(1,1)`) so `cloneCanvas`'s `toDataURL` isn't blank. Cheap, runs per capture.
- **`toImg`/`toSvg` with scale/width/height on Safari stays vector**: `fixSafariShadows` (same rewrite `toCanvas` uses — WebKit flips svg-as-image shadow Y offsets) + patching the svg's own `width`/`height` to the display size, so it renders at natural scale. PNG rasterize is only the error fallback.

**How to verify WebKit changes in REAL Safari** (Playwright WebKit does NOT reproduce #219770 — a green `test:webkit` run proves nothing about these quirks):
- SnapEye harness: `bench/snapeye-dev.mjs` (untracked; requires the sibling `../snapeye` repo). It serves a demo page that runs capture loops and writes every captured blob to `.snapeye/` — complete captures are byte-identical, so any file-size outlier is a blank/corrupt frame. `npm run compile && node bench/snapeye-dev.mjs`, then open the URL in Safari itself.
- WebDriver fallback (no extra repo needed): `safaridriver --port 4444` (Develop → Allow Remote Automation must be enabled, already done on this machine) + plain curl WebDriver calls to run JS/DOM checks and read errors in real Safari.

### Build outputs (`esbuild.config.mjs`)

Written to `dist/`:
- `dist/snapdom.js` — IIFE from `src/index.browser.js` (exposes `window.snapdom`, `window.preCache`).
- `dist/snapdom.mjs` — ESM from `src/index.js`. **The single stateful runtime.**
- `dist/snapdom.cjs` — real CommonJS for `require()`. `main` and `exports["."].require` point here. Do NOT point `require` at the IIFE: `platform:'neutral'` never assigns `module.exports`, so `require()` returned `{}` in every version up to 2.24.1.
- `dist/preCache.mjs`, `dist/plugins.mjs`, `dist/preCache.cjs`, `dist/plugins.cjs` — **thin re-export stubs**, not bundles (~200 bytes each). The `.cjs` pair exists so a CJS app that `require()`s the root and reaches the registry through a subpath does not load `snapdom.cjs` AND `snapdom.mjs` — two instances, two registries.

That last point is a correctness constraint, not a size choice. Separate esbuild entrypoints get separate module state, so up to 2.24.1 `/plugins` carried its OWN plugin registry and `/preCache` warmed its OWN `cache`: registering through the subpath had zero effect on `snapdom()`. The stubs `export … from './snapdom.mjs'`, so the ESM graph resolves one instance. **Never turn them back into entryPoints.**

`buildLegacy` must keep `format: 'iife'` and must NOT have `globalName`. Without the format, `platform: 'neutral'` emitted bare top-level statements and a `<script>` tag published every minified binding as a global — 442 of them, verified by `npm run test:pack`. It shipped that way through 2.24.1. With `globalName`, esbuild wraps the bundle as `var snapdom = (() => {…})()` and, since `src/index.browser.js` exports nothing, that assignment lands after the body and overwrites the explicit `window.snapdom` with an empty object. The entry owns the global.

Type declarations mirror the same shape: `types/snapdom.d.ts` plus `types/plugins.d.ts` and `types/preCache.d.ts` re-export stubs, wired through a `types` condition per subpath in `exports`. They used to be `declare module "@zumer/snapdom/plugins"` blocks inside the root file, which in a file that is already a module are AUGMENTATIONS of a specifier TypeScript must resolve first — TS2665 in every consumer without `skipLibCheck: true`.

All are minified, `sideEffects: false`, `splitting: false`. No code splitting, no chunks, no dynamic-import output files: the distributed bundle stays single and self-sufficient.

## Code style (eslint.config.cjs)

- Single quotes, no semicolons, max 1 consecutive empty line, final newline required.
- Unused vars/args prefixed `_` are allowed.
- Lint scope is `src/**/*.js` and `__tests__/**/*.js` only.
- Browser globals + `WebKitCSSMatrix` are pre-declared.

## Testing

- Tests run in a real browser (Playwright). There is no Node/jsdom mode — DOM APIs are real.
- `vitest.config.js` aliases the bare specifier `@zumer/snapdom` to `src/index.js`. `packages/plugins/*` import the core by NAME because they are published separately, and under test that name resolved to whatever npm had installed — the last PUBLISHED release, 2.24.1 — so `gif-export` and `video-export` ran their internal recaptures against v2 while appearing to test v3.
- `BROWSER=webkit|firefox|all` selects the engine; visual baselines are kept per engine. **A fidelity change is not done until it is green on all three** — several fixes this branch shipped behaved differently per engine.
- Benchmarks: files matching `*.benchmark.js` are excluded from the normal test run; use `npm run test:benchmark` or `npx vitest bench`.
- Visual diffs live under `__snapshots__/visual*/`; `npm run report:cross` builds a cross-engine comparison page.
- **`demos/` is COMMITTED** (2026-09-01; 84 files — held back: the stale docs-site copy, Drift-branded assets, d17/d171 which are built around them, and the `labs*.html` scratch pages, all still gitignored). A checkout without it (sparse, or a worktree from before the commit) makes the visual suite silently skip itself (`visual.demos.test.js` globs `/demos/d*.html`, gets nothing, and registers a `describe.skip`) — a green `npm test` there proves NOTHING about pixels. If you must bring demos in by hand, **copy, do not symlink**: vite resolves through the link into the other repo's `node_modules`, several demos then capture at a wrong size, and you get ~11 fabricated "regressions". `npm run test:visual` runs just that file. `REQUIRE_VISUAL=1` turns both silences into a hard failure at globalSetup (`scripts/require-visual.mjs`): no demos, or no baselines at all — the case where the first run RECORDS them and passes, proving only that the build agrees with itself. `npm run release` sets it; ordinary runs and forks are unaffected. There is no CI on this repo (the `ci.yml` workflow was removed on 2026-08-30): verification is local, and a push to the remote is the last step, not the gate. Nothing but your own machine runs `npm test`, `test:pack` or the visual suite, so `npm run release` — which verifies before it pushes — is the release signal.
- Baselines are recorded on first run, so a v3-only run only proves v3 agrees with itself. To measure v3 against `main`, generate baselines in the main checkout (identical harness file), copy `__snapshots__/visual` over, and run here. Status as of 2026-08-10: **71/71 demos pixel-identical to main on chromium.**
- Coverage config in `vitest.config.js` scopes to `src/**/*.js`. **It only runs on chromium** (the v8 provider is Chromium-only), so Safari-only code reads as uncovered even when exercised — that is a measurement blind spot, not debt. Code that is unreachable by construction is marked with `/* c8 ignore start/stop */` and a reason; the `ignore next` form does nothing here.

## Writing tests that are worth having

Every one of these cost real time on this branch. They are not hypothetical.

- **Prove the test can fail.** Break the thing on purpose and confirm it goes red. Several "passing" checks were asserting nothing.
- **A control must be able to register.** A 1×1 transparent PNG used as a positive control measured 0% pixel difference and nearly validated a broken harness.
- **Assert on what PAINTS, not on the payload.** The serialized SVG carries the class CSS, so a `content` string or a colour can appear in `res.url` while nothing renders. Count pixels via `res.toCanvas()`.
- **Static imports defeat module stubbing.** A test that stubs `Worker` must live in a file that does NOT import the module at top level, or the module latches the real one first and the test silently exercises the wrong path.
- **Watch for cross-test contamination.** Run a suspicious test in isolation (`-t "<name>"`): if it passes in the file but fails alone, the feature is broken and a sibling test was masking it.
- **Scene size and system fonts change outcomes.** A reconcile regression is invisible on a small tree, and a scene that depends on a system font passes on two engines and fails on the third.
- **Before theorising from a number, look at the artifact.** On a glyph-dense image, ordinary hinting differences touch ~25% of the pixels.

## Real-Safari verification (SnapEye)

Playwright's WebKit does not reproduce the quirks the Safari code exists for — a green `test:webkit` proves nothing about them. For anything touching `toCanvas`, `toImg`, the Safari pre-step, fonts, or workers:

1. `npm run compile`, then `node bench/snapeye-dev.mjs`. **UNTRACKED**: `bench/` is gitignored, so the harness does not come with a fresh clone, and it needs the sibling `../snapeye` repo. It serves the local `dist/` — confirm that is the build you mean to test.
2. Drive real Safari via `safaridriver --port 4444` + plain WebDriver calls over curl (Develop → Allow Remote Automation is already enabled on this machine).
3. The harness writes every captured blob to `.snapeye/`. Complete captures are byte-identical, so any file-size outlier is a blank or corrupt frame. Last run: 100/100 identical, zero blanks.

Sanity-check the detector itself: a blank PNG at the same dimensions weighs ~0.4% of a real capture, so the size threshold genuinely discriminates. And check the FORMAT of what lands in `.snapeye/` — a run that quietly produced SVG instead of PNG is what exposed the `toBlob` format regression that the unit suite missed.

## Known open defects (v3 audit, 2026-08-30 → 09-01)

Everything below was found by the audit, confirmed by reading or measuring the real code, and
deliberately NOT fixed. Each line says why, so nobody re-derives it. **All five are inherited:
v2 has the identical code or behaviour — none is a v3 regression.** (The two v3-only gaps the
audit found are noted at the end.)

- **`toCanvas.js` `waitForImgPaint` — first capture blank on WebKit.** The first capture of an
  element whose svg carries a nested `data:image` comes back FULLY TRANSPARENT; every later
  capture of the same element is correct. Isolated: the payload is right, and drawing that very
  payload by hand is blank immediately after `img.decode()` resolves and correct 100ms later —
  WebKit #394, which this guard exists to cover. Instrumented, the probe reports
  `{verify:true, iters:3, ink:true}` and returns while the real `drawImage` lands nothing: the
  16x16 probe draw is **not predictive of the full-size draw**.
  FIVE candidate fixes were tried and all reverted — not aborting when the probe draw throws;
  waiting for two identical probe frames instead of first ink; keeping the probed image
  attached until after the real draw; routing Safari to v2's plain main-document Image instead
  of the recycled decode frame; and the combination. The decode-frame lifecycle is the next
  thing to read.
  **Scope check before investing:** SnapEye on real Safari 26.5 runs 100/100 clean, and the
  first capture there is correct (the size histogram is exactly 50/50 with no third group). So
  the real-world trigger is narrower than the synthetic fixture suggests — the demo uses `<img>`
  elements, the failing fixture an inlined `background-image`. Narrow the trigger first.
  Reproduces under Playwright WebKit, so it can be fixed and verified without SnapEye.
  Pinned by a documented skip in `__tests__/visual.fidelity.crossengine.test.js`.

- **`pseudo.js` — scoped `::marker` / `::first-line` skipped when the scan is unreliable.** A
  cross-origin stylesheet makes `pseudoGatesFor` return `null`, and the scoped emitter treats
  that as "no rules". Left alone ON PURPOSE: emitting the rule against an unreliable scan would
  over-apply `::marker` to nodes that never had it, which is a fidelity loss in the other
  direction. v2 never emitted these rules at all, so v3 is strictly ahead here.

- **`pseudo.js` `styleFingerprint` — ignores adopted stylesheets' rule counts.** A
  `replaceSync()` on an already-adopted sheet leaves the whole pseudo pass memoized off. Do NOT
  "fix" this by censusing sheets per capture: that is the same experiment as the rule-epoch one
  above, it was measured, it timed out `module.pseudo` on WebKit under `BROWSER=all`, and it was
  reverted. `module.styles.ruleEpoch.test.js` pins the trade.

- **`diff.js` — the differential path skips the live-DOM prep.** Dirty subtrees are rebuilt with
  a bare `deepClone`, so `lineClampTree` and `forceContentVisibility` never run for them and a
  spliced frame can render un-clamped text. v3-only code (v2 has no `diff.js`). Threading the
  live prep through needs its own review of the bail conditions.

- **`clone.js` `<img>` min-width/min-height floor.** Written from `offsetWidth` — the BORDER box
  — onto an element whose min-* resolve against the CONTENT box, so it is nominally too large
  with padding or a border. Correcting it was tried and REVERTED: the captured box measured
  102x52 against a live 102x52 either way, so no visible defect could be demonstrated, while
  `d14-cors-test` (images with `border: 1px solid black`) moved 2.26% / 728px. Revisit only with
  a case where the capture actually differs from the live element.
