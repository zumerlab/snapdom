# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**The source is the documentation.** Every file in `src/` opens with a header that says what it
owns and what a change must not break; every export carries its reason, the number it was
measured at, and the test that goes red ("Pinned by …", greppable). This file holds only what
the code cannot: where the repos are, the goals, the commands, the testing traps, the release
and verification process, and a map from each mechanism to the file that explains it. When
this file and a source comment disagree, the source wins; fix this file.

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
- Tests: `npm test` (runs `lint:fix`, `test:types`, `test:bundle` (compile + the IIFE global-leak check), then `vitest run --browser.headless`)
- Coverage: `npm run test:coverage`
- Benchmarks: `npm run test:benchmark` · real page, three arms (liquidGL's NaughtyDOM, published v2, this checkout): `npm run compile && node scripts/bench-liquidgl.mjs` (clones liquidGL into the gitignored `.bench-liquidgl/` once; 2026-09-03: 11 / 53.3 / 53.1 ms)
- Packaging contract: `npm run test:pack` — packs with no `dist/`, asserts every entrypoint is inside the tarball, installs it into throwaway consumer projects and typechecks with `skipLibCheck: false` under both `node16` and `bundler`, then resolves every entrypoint at runtime and counts the globals the browser bundle leaks. The browser suite cannot see any of this: it imports `src/`.
- Single test file: `npx vitest run __tests__/<file>.test.js --browser.headless`
- Single test by name: `npx vitest run --browser.headless -t "<test name substring>"`

`npm test` runs `lint:fix`, so it CAN rewrite a file; `npm run lint` is the check-only form. `npm run build` is pure; the git add/commit/push that used to ride along as `prebuild` now lives in the explicit `npm run release`, which VERIFIES FIRST (test → test:pack → build) and pushes last. Publishing is deliberately not automated: `npm run publish:beta` is `npm publish --tag beta`, so a beta can never move `latest`.

**`prepack` is load-bearing.** `dist/` is gitignored — correct, it is a build output — and `files`/`exports` point into it, so without the hook `npm publish` from a clean checkout produces a tarball whose package.json references four files that are not in it. Nothing broken ever shipped, because the release flow packed after compiling on a machine that had `dist/`; the hook removes the dependence on that luck. `test:types` runs with `skipLibCheck: false` and includes `packages/plugins/*.d.ts` for the same reason: with it on, the repo checked declarations in a mode no consumer is ever in (the reasoning is in `tsconfig.json`).

## Architecture, and where each piece explains itself

SnapDOM captures a DOM subtree and serializes it as an SVG `data:` URL embedded in a `<foreignObject>`, which exporters then rasterize to PNG/JPG/WebP/Canvas/Blob.

**The pipeline splits at the clone**, the seam `src/core/stages.js` names (`element -> clone -> render`). `captureDOM` (`src/core/capture.js`) owns `element -> clone`; a render engine owns `clone -> pixels`, `src/engines/svg.js` by default. Both file headers describe the split and the contract between them.

1. `prepareClone` (`src/core/prepare.js`): the live-DOM prep and its undo, `deepClone` (`src/core/clone.js`, the nodeMap contract), then every pass that needs clone and source side by side, in the order the header lists.
2. Asset inlining, concurrent: `src/modules/images.js`, `background.js`, `fonts.js`, then `compress.js`. All fetches go through `snapFetch.js`, which never throws.
3. The engine: bbox and bleed (`src/utils/capture.helpers.js`, `transforms.helpers.js`), foreignObject assembly, encoding.
4. Exporters (`src/exporters/*`) and `src/modules/rasterize.js`, dynamically imported from `src/api/snapdom.js`. Every raster export ends in `toCanvas.js`; its header says why WebKit gets its own paths.

Options: `src/core/context.js`. Every option, its default and its alias is decided there and nowhere else; add a new one there first. Plugins: `src/core/plugins.js` header (hook order, local-first rule) and `PLUGIN_SPEC.md`; official ones under `packages/plugins/`. Caches: `src/core/cache.js` lists who writes each entry; everything per capture lives on the session from `src/core/session.js`. **Do not reintroduce per-capture state at module scope** — that was #463 and the double scroll-compensation race, and the session object makes the bug class unrepresentable.

### The invalidation matrix is the wiring's source of truth

`src/core/burst.js` opens with every way a rendered frame can change and who observes it. Several produce no mutation record at all (scroll, form-control state, focus, ancestor theme attributes, shadow-root content, font and image loads, animations). **If you add a way for output to change, add its row.** Canvas pixel draws and CSSOM edits are excluded on purpose (nothing can observe them) and need `invalidate: true`. `src/core/diff.js` bails to the full pipeline on anything it cannot splice byte-faithfully; each `return null` says why.

### Measured mechanisms, and the file that carries the numbers

Each of these was a real regression or a real win, with the measurement and the pinning test next to the code. Read the comment before touching the function.

- Pseudo pass asks a SUBTREE question, not a document one: `canSkipPseudoWalk`, `src/modules/pseudo.js` (197 → 66 ms on the 500-row table).
- What the pseudo pass costs per `::before`, and the four things that took it from 150 to 24 µs: `inlinePseudoElements`, `src/modules/pseudo.js`; the pseudo universe in `src/modules/styleScan.js`; the per-tag defaults fix in `getDefaultStyleForTag`, `src/utils/css.js`; twin pseudos in `pseudoSnapshotFor`, `src/modules/styles.js`.
- The identity share and its subtree gate: `styleShareSafe`, `src/modules/styles.js`; the gate is built by `scanAuthorStyles`, `src/modules/styleScan.js`.
- What a twin must RE-READ (used values: grid tracks, transform, `@container`), found through an 18.6% pixel defect: `shareLists`, `src/modules/styles.js`.
- `normalizeInlineStyleToComputed` has three contracts, not one: `src/modules/styles.js`.
- There is no rule epoch, on purpose; the memo is keyed on the DOM epoch: the note above `getStyleEnvEpoch`, `src/modules/styles.js`. **Do not narrow it without measuring invalidation under `BROWSER=all`**; the census it needs timed WebKit out. `__tests__/module.styles.ruleEpoch.test.js` pins the trade. Two traps of the scan itself (nesting `&`, a gate that can never match) are commented in `styleScan.js` where they bite.
- An inlined data: URL is written to the clone ONCE: header of `src/modules/images.js`, and `freezeImgSrcset` in `src/utils/clone.helpers.js`.
- Compress runs on a lazy worker pool and takes the Blob, not the base64 string: `downsampleDataURL` and the worker section, `src/modules/compress.js`.
- `MAX_RASTER_SIDE` is per engine, and large captures are drawn in horizontal bands unless embedded resources outweigh the markup (every band re-reads the payload, ~1.8 ms per MB): the notes at the top of `src/exporters/toCanvas.js`, `resourceHeavy` and `drawBanded`.
- snapdom's own scaffolding is never cloned below the root (the decode iframe `toCanvas` keeps in `document.body` was captured through a nested `toPng` by every later `body` capture): the skip at the top of `deepClone`, `src/core/clone.js`.

### Experimental canvas engine

`src/engines/htmlInCanvas.js`, opt-in via `engine: 'html-in-canvas'`, quarantined: on any doubt it returns null and the svg engine runs on the same clone. Unflagged browsers have no draw API and fall through; under the Chrome 148+ origin trial it runs (verified in real Chrome 2026-09-03, timings and the OT contract in the file header) and hands the painted bitmap straight to the pixel exports. **It is not in the shipped bundle**: `esbuild.config.mjs` defines `__SNAPDOM_CANVAS_ENGINE__ = false` and the seam in `capture.js` folds away; tests import `src`, where it stays live. To build it in: `SNAPDOM_CANVAS_ENGINE=1 npm run compile`. Correctness must never depend on this module.

### Safari / WebKit

WebKit quirks are handled at their point of impact, each commented where it lives: the paint probe and the second probe after the draw in `waitForImgPaint` / the draw in `toCanvas.js` (WebKit #219770 / #394); the per-capture pre-step in `src/api/snapdom.js` (fonts ready, canvas stores poked); the vector path for a sized `toImg` in `src/exporters/toImg.js`. All were verified in real Safari, and **Playwright's WebKit does not reproduce them**: a green `test:webkit` proves nothing about these paths. Re-verify per the SnapEye section below before touching any of them.

### Build outputs

Two files, `dist/snapdom.mjs` (ESM) and `dist/snapdom.js` (script-tag IIFE), and `types/snapdom.d.ts`. `esbuild.config.mjs` explains every choice inline; `npm run test:pack` fails on a missing OR an extra file in the tarball. The constraints, not preferences: there is **no CommonJS build**, by decision (2026-09-02; v2's `require()` pointed at the IIFE and returned `{}`, so nothing that worked is lost, and a `require` condition must not come back); the `/plugins` and `/preCache` subpaths are **not files**, `package.json` maps them to the same `snapdom.mjs` so the subpath and the root are one module instance (separate entrypoints gave each its own registry, and re-export stubs were four files for nothing); `buildLegacy` keeps `format: 'iife'` and has no `globalName` (without the format 442 minified bindings leaked as globals; with the name the empty export object overwrote `window.snapdom`); the subpaths' `types` condition points at the root declarations, because `declare module` augmentations were TS2665 in every consumer. `compile` empties `dist/` first, since `files: ["dist/"]` ships whatever sits there. Nothing is code-split.

## Code style (eslint.config.cjs)

- Single quotes, no semicolons, max 1 consecutive empty line, final newline required.
- Unused vars/args prefixed `_` are allowed.
- Lint scope is `src/**/*.js` and `__tests__/**/*.js` only.
- Browser globals + `WebKitCSSMatrix` are pre-declared.

## Comments

Written for a person or a model reading the file cold, in the voice of a colleague at your desk.
Standard JSDoc, no tooling, no custom tags.

- Every file: a `/** … @module */` header with what it owns and the contracts a change must keep.
- Every export: verb-first first line; the why only when sourced (issue, measured number with its scene, the trap); "Pinned by `__tests__/x.test.js`"; `@param`/`@returns` with real types.
- Internals: one line, only when the name does not carry the contract. Inline `//` only on a quirk a reader would "fix", naming the engine and the issue.
- Never paraphrase the code. Never invent a reason: no source (code, tests, `git log -S`), no claim. No "this function", "handles", "ensures", "robust", "simply", colon reveals, or em-dashes in new text. Spanish comments get translated when touched.
- A comments-only change is verified by minifying HEAD and the working copy through esbuild (stdin, same context) and comparing bytes, and by checking that every test file named in the diff exists.

## Testing

- Tests run in a real browser (Playwright). There is no Node/jsdom mode — DOM APIs are real.
- `vitest.config.js` aliases the bare specifier `@zumer/snapdom` to `src/index.js`. `packages/plugins/*` import the core by NAME because they are published separately, and under test that name resolved to whatever npm had installed — the last PUBLISHED release, 2.24.1 — so `gif-export` and `video-export` ran their internal recaptures against v2 while appearing to test v3.
- `BROWSER=webkit|firefox|all` selects the engine; visual baselines are kept per engine. **A fidelity change is not done until it is green on all three** — several fixes this branch shipped behaved differently per engine.
- Cross-origin CSS in a test: `commands.serveCrossOriginCss()` (vitest.config.js) serves a sheet on 127.0.0.1 whose `cssRules` throws — the deterministic "unreliable scan" on all three engines.
- Benchmarks: files matching `*.benchmark.js` are excluded from the normal test run; use `npm run test:benchmark` or `npx vitest bench`.
- Visual diffs live under `__snapshots__/visual*/`; `npm run report:cross` builds a cross-engine comparison page.
- **`demos/` is COMMITTED** (2026-09-01; 84 files — held back: the stale docs-site copy, Drift-branded assets, d17/d171 which are built around them, and the `labs*.html` scratch pages, all still gitignored). A checkout without it (sparse, or a worktree from before the commit) makes the visual suite silently skip itself (`visual.demos.test.js` globs `/demos/d*.html`, gets nothing, and registers a `describe.skip`) — a green `npm test` there proves NOTHING about pixels. If you must bring demos in by hand, **copy, do not symlink**: vite resolves through the link into the other repo's `node_modules`, several demos then capture at a wrong size, and you get ~11 fabricated "regressions". `npm run test:visual` runs just that file. `REQUIRE_VISUAL=1` turns both silences into a hard failure at globalSetup (`scripts/require-visual.mjs`): no demos, or no baselines at all — the case where the first run RECORDS them and passes, proving only that the build agrees with itself. `npm run release` sets it; ordinary runs and forks are unaffected. There is no CI on this repo (the `ci.yml` workflow was removed on 2026-08-30): verification is local, and a push to the remote is the last step, not the gate. Nothing but your own machine runs `npm test`, `test:pack` or the visual suite, so `npm run release` — which verifies before it pushes — is the release signal.
- **The cross-library comparison harness lives in `docs/compare/live/harness.js`**, not in
  `__tests__/`. It holds the competitor adapters (pinned CDN versions), the fixture-free
  scenes and the pixel capability oracle, and it is imported by BOTH `__tests__/category.libs.js`
  (every `category.*.benchmark.js` + the matrix test) and the live lab page at
  `docs/compare/live/`, which is the same comparison run in a visitor's browser. It sits under
  `docs/` because the published site can only serve what is inside `docs/` — so **a checkout
  without `docs/` breaks the category suite**, same trap class as `demos/`. One copy is the
  point: a live demo that drifts from the measured table is how a project starts contradicting
  its own README. The deep-tree scene carries a `::before` stripe on every leaf on purpose:
  without it the scene measured html2canvas's repainter on bare boxes, the one input it handles
  best.
  Four fairness rules the harness exists to enforce, each of which was violated at some point
  and measured wrong because of it: (1) **one output stage** — every arm ends at a PNG data
  URL, never snapdom's `toRaw` against someone else's raster; (2) **same pixels** — `scale: 1`
  AND `dpr: 1`, because snapdom defaults `dpr` to `devicePixelRatio` and headless chromium's
  DPR of 1 hides it; (3) **correctly-shaped options** — domlens takes `{ output: { scale } }`
  and silently ignores a flat `scale`, and it takes `viewport: { scrollX: 0, scrollY: 0 }`
  because its default viewport reads the window's scroll and the region it cuts is offset by
  exactly that much (lab page scrolled 300px: the table capture starts at row #9; 1000px:
  row #29; 0.00% against a live screenshot with the option, at any scroll — measured
  2026-09-02 after the user saw "domlens never looks right" on the lab and suspected the
  host page; the host CSS was innocent, disabling it only moved the element to scroll 0);
  (4) **the memo pinned off** (`burst: false`) except in
  the polling scene, where it is the point and the label says so. Scenes carry no `class`
  attributes (the host page would style them) and must fit inside the 16384px canvas limit,
  past which each library clamps to a different scale and rule (1) quietly ends.
- Baselines are recorded on first run, so a v3-only run only proves v3 agrees with itself. To measure v3 against `main`, generate baselines in the main checkout (identical harness file), copy `__snapshots__/visual` over, and run here. Status as of 2026-08-10: **71/71 demos pixel-identical to main on chromium.** Two deliberate divergences since: `d14-cors-test` moved ~2% on all three engines with the `<img>` box fix in `clone.js` (its baselines were re-recorded), and the Firefox baseline of `d-plugin-animation-lab` was re-recorded when its range sliders started rendering the styled track and thumb like Chromium and the live page (a fidelity gain that rode along with the defaults fix in `css.js`).
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
- **Two captures mounted in ONE document share class names.** `regression.pseudo.afterPosition` collided `.c1` across hosts the moment a pseudo snapshot depended on unrelated author CSS; a snapshot key must depend only on what the node itself renders.

## Real-Safari verification (SnapEye)

Playwright's WebKit does not reproduce the quirks the Safari code exists for — a green `test:webkit` proves nothing about them. For anything touching `toCanvas`, `toImg`, the Safari pre-step, fonts, or workers:

1. `npm run compile`, then `node bench/snapeye-dev.mjs`. **UNTRACKED**: `bench/` is gitignored, so the harness does not come with a fresh clone, and it needs the sibling `../snapeye` repo. It serves the local `dist/` — confirm that is the build you mean to test.
2. Drive real Safari via `safaridriver --port 4444` + plain WebDriver calls over curl (Develop → Allow Remote Automation is already enabled on this machine).
3. The harness writes every captured blob to `.snapeye/`. Complete captures are byte-identical, so any file-size outlier is a blank or corrupt frame. Last run (2026-09-02, Safari 26.5.1, SnapEye 0.3.0): 100/100 identical, the 50 base and the 50 compressed each one sha1, all valid PNG, first capture identical to the rest.

Sanity-check the detector itself: a blank PNG at the same dimensions weighs ~0.4% of a real capture, so the size threshold genuinely discriminates. And check the FORMAT of what lands in `.snapeye/` — a run that quietly produced SVG instead of PNG is what exposed the `toBlob` format regression that the unit suite missed.

## Audit defects — all six FIXED 2026-09-02

Each fix is narrow because the trap that guarded the earlier "do not fix" decision is still real. The mechanism, the trap and the pin live next to the code:

- First WebKit capture blank: the second probe after the draw, `toCanvas.js` (five earlier attempts verified before the draw and could not see it).
- Scoped `::marker` / `::first-line` skipped on an unreliable scan: the null-probe in the scoped emitter, `pseudo.js`.
- `styleFingerprint` ignored adopted stylesheets: `pseudo.js` (counts adopted sheets only, NOT a census of every document sheet, which is the forbidden thing above).
- The differential path skipped the live-DOM prep: the `lineClampTree` + `forceContentVisibility` wrap in `diff.js`.
- `<img>` freeze and floor written from the border box: the box-sizing subtraction in `deepClone`, `clone.js`.
- Shadow-root `::before`/`::after` never painted: `__shadowPseudo` in `canSkipPseudoWalk`, `pseudo.js`, and the pseudo kept outside `:where()` in `wrapWithScope`, `clone.helpers.js`.
