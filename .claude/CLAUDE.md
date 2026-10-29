# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**The source is the documentation.** Every file in `src/` opens with a header that says what it
owns and what a change must not break; every export carries its reason, the number it was
measured at, and the test that goes red ("Pinned by …", greppable). This file holds only what
the code cannot: where the repos are, the goals, the commands, the testing traps, the release
and verification process, and a map from each mechanism to the file that explains it. When
this file and a source comment disagree, the source wins; fix this file.

## Where the code lives (2026-10-23)

v3 is public: it merged into `zumerlab/snapdom` `main` and shipped as 3.0.0 on 2026-09-14.
Current line: 3.3.x on npm `latest`. **This clone is the repo.**

| repo | visibility | clone | branches |
|---|---|---|---|
| `zumerlab/snapdom` | **public** | `~/GitHub/zumerlab/snapdom` | `main` (3.x, shipped), `v2` (the 2.24.x line, last 2.24.18 on 2026-09-10) |
| `zumerlab/snapdom-v3` | private | `~/GitHub/zumerlab/snapdom-v3` | last commit 2026-09-14 (3.0.0-beta.1); superseded by public `main`, history only |
| `zumerlab/snapdom-agent` | private | no local clone; the `agent` remote here points at it | the agent oracle (was `packages/agent`) |

- `origin` is the public repo, so a bare `git push` publishes. Never `git push --all`, and never push
  to `agent`: that remote is the private agent repo.
- New features go on `main` as a 3.x minor; a fix a v2 user needs goes on `v2` as a 2.24.x patch.
  `dev` is stale (last touched 2026-07-18).
- A GitHub Action (`update-contributors.yml`) commits `chore: update contributors list` after a
  push, so the remote is one commit ahead right after pushing. Fast-forward, do not panic.
- **`package-lock.json` is COMMITTED** (2026-08-15) and `playwright` is pinned to an exact
  version, no caret. Both exist for the same reason: the browser build is part of the visual
  fixture, not a floating dependency. While the lockfile was gitignored, a fresh `npm install`
  pulled Playwright 1.62.1 where the baselines had been recorded against 1.55.1, and two
  CJK-text demos failed DETERMINISTICALLY until 1.55.1 went back. Upgrading Playwright is a
  deliberate act that re-records baselines, never a side effect of installing. If visual demos
  move after any dependency work, check the Playwright version before reading the code.
- `packages/agent` and the `agent-lab` branch no longer exist here; that product lives in its
  own repo with its history. Do not recreate them.

## Non-negotiable project goals

Every change must respect these, in this order:

1. **Speed** — no change may regress capture performance. If a fix or feature adds work to the hot path (`captureDOM` and anything it calls per-node), justify the cost and, when in doubt, measure with `npm run test:benchmark` before/after.
2. **Fidelity** — the rendered capture must match the live DOM. Never trade visual accuracy for convenience. Safari workarounds, bleed math, font embedding, and the clone-in-document measurement pass exist for fidelity reasons; don't "simplify" them without understanding what breaks.
3. **Minimal code** — no decorative code. No helpers for single callers, no speculative abstractions, no options for hypothetical future needs, no defensive checks for impossible states. The library is deliberately small; keep it that way. If a change adds bytes, it has to pay for them.

If a proposed change conflicts with (1) or (2), don't ship it — surface the trade-off instead.

## Commands

All scripts are npm-driven. Tests run in a real browser via Vitest + Playwright (chromium), so `npx playwright install` is required once.

- Build: `npm run compile` (esbuild → `dist/`); `prepack` compiles before every `npm publish`
- Lint: `npm run lint` · auto-fix: `npm run lint:fix`
- Static checks: `npm run check` (check-only `lint`, `tsc --noEmit`, `node --test scripts/release-checks.node.mjs`, compile + the IIFE global-leak check)
- Tests: `npm test` (chromium), `npm run test:firefox`, `npm run test:webkit`, `npm run test:full` (all three). Each runs `check`, then `REQUIRE_VISUAL=1 node scripts/vitest.mjs run --browser.headless`: vitest, plus a second turn, one engine and one file at a time, for every test the network gate skipped; a test still skipped after that fails the run
- Coverage, by hand: `npm run test:coverage`
- Live parity, by hand: `npm run test:parity` (or `node scripts/live-parity.mjs <demo-substring>` after a compile). Every demo's capture against Playwright's screenshot of the live page, per engine, into `output/live-parity/report.md` plus images for each demo over 0.5%. The visual suite only proves a capture did not CHANGE; this is the only check of whether it is RIGHT. Known reference limits (cross-origin placeholders, native controls, headless scrollbars, animated canvases, transformed roots) are listed in the script's `LIMITS`, not hidden. ~10 minutes for all three engines.
- Benchmarks: `npm run test:benchmark` · real page, three arms (liquidGL's NaughtyDOM, published v2, this checkout): `npm run compile && node scripts/bench-liquidgl.mjs` (clones liquidGL into the gitignored `.bench-liquidgl/` once; 2026-09-03: 11 / 53.3 / 53.1 ms)
- Packaging contract, by hand: `node scripts/check-pack.mjs` (run it after touching `exports`, `files` or the build) — packs with no `dist/`, asserts every entrypoint is inside the tarball, installs it into throwaway consumer projects and typechecks with `skipLibCheck: false` under both `node16` and `bundler`, then resolves every entrypoint at runtime and counts the globals the browser bundle leaks. The browser suite cannot see any of this: it imports `src/`.
- Single test file: `npx vitest run __tests__/<file>.test.js --browser.headless`
- Single test by name: `npx vitest run --browser.headless -t "<test name substring>"`

`npm test` runs the check-only `lint` and never rewrites a file; `npm run lint:fix` is the form that does. The release flow: a green `test:full` (or the per-engine scripts), then either a plain `git push`, or `npm run bump` (`npm version` commit + tag, then a regenerated CHANGELOG.md), a manual CHANGELOG review, `npm run release` (commits it, pushes with tags) and a manual `npm publish`. `npm run publish:dev` publishes the current commit as `<next patch>-dev.<n>` under the `dev` tag for users to test a fix (`latest` never moves, nothing is committed; it runs `scripts/check-pack.mjs` first). Benchmarks are run by hand. Plugins: `bump:plugins`, review `packages/plugins/CHANGELOG.md`, `release:plugins`, `publish:plugins` (PDF and vector checks first); `publish:plugins:dev` is `publish:dev` for the plugins package.

**`prepack` is load-bearing.** `dist/` is gitignored — correct, it is a build output — and `files`/`exports` point into it, so without the hook `npm publish` from a clean checkout produces a tarball whose package.json references four files that are not in it. Nothing broken ever shipped, because the release flow packed after compiling on a machine that had `dist/`; the hook removes the dependence on that luck. The `tsc --noEmit` in `check` runs with `skipLibCheck: false` and includes `packages/plugins/*.d.ts` for the same reason: with it on, the repo checked declarations in a mode no consumer is ever in (the reasoning is in `tsconfig.json`).

## Architecture, and where each piece explains itself

SnapDOM captures a DOM subtree and serializes it as an SVG `data:` URL embedded in a `<foreignObject>`, which exporters then rasterize to PNG/JPG/WebP/Canvas/Blob.

**The pipeline splits at the clone**, the seam `src/core/stages.js` names (`element -> clone -> render`). `captureDOM` (`src/core/capture.js`) owns `element -> clone`; a render engine owns `clone -> pixels`, `src/engines/svg.js` by default. Both file headers describe the split and the contract between them.

1. `prepareClone` (`src/core/prepare.js`): the live-DOM prep and its undo, `deepClone` (`src/core/clone.js`, the nodeMap contract), then every pass that needs clone and source side by side, in the order the header lists.
2. Asset inlining, concurrent: `src/modules/images.js`, `background.js`, `fonts.js`, then `compress.js`. All fetches go through `snapFetch.js`, which never throws.
3. The engine: bbox and bleed (`src/utils/capture.helpers.js`, `transforms.helpers.js`), foreignObject assembly, encoding.
4. Exporters (`src/exporters/*`) and `src/modules/rasterize.js`, dynamically imported from `src/api/snapdom.js`. Every raster export ends in `toCanvas.js`; its header says why WebKit gets its own paths.

Options: `src/core/context.js`. Every option, its default and its alias is decided there and nowhere else; add a new one there first. Plugins: `src/core/plugins.js` header (hook order, local-first rule) and `PLUGIN_SPEC.md`; official ones under `packages/plugins/`. Caches: `src/core/cache.js` lists who writes each entry; everything per capture lives on the session from `src/core/session.js`. **Do not reintroduce per-capture state at module scope** — that was #463 and the double scroll-compensation race, and the session object makes the bug class unrepresentable.

### The invalidation matrix is the wiring's source of truth

`src/core/burst.js` opens with every way a rendered frame can change and who observes it. Several produce no mutation record at all (scroll, form-control state, focus, ancestor theme attributes, shadow-root content, font and image loads, animations). **If you add a way for output to change, add its row.** Opaque/frame-driven trees (including canvas) bypass the memo and capture fresh; programmatic CSSOM edits are the remaining `invalidate: true` escape because no observer sees them. `src/core/diff.js` bails to the full pipeline on anything it cannot splice byte-faithfully; each `return null` says why.

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
- Memoization engages on an eligible static element's FIRST capture, capped at 64 live memos with LRU teardown (`disposeState`). `isAutoBurstSafe` keeps opaque/frame-driven trees fresh, and `invalidateHoverChanges` samples document/open-shadow hover state before every possible serve; see `src/core/burst.js`. `snapdom.preCapture()` is the only prefetch: link prefetch translated (a capture begun in the same press/click task is learned; later pointer-enter/focus intent replays it, while the first unknown pointer-enter/focus warms the viewport), `src/api/preCapture.js`. No `preCache`, no attribute, no re-seed, no document-level warm, by decision (2026-09-04); the corpus numbers behind it (79 demos: first capture 20.4 ms median, steady 4.8, hit 0, export 4.6) are in the header of that file.
- A shrink-to-fit box whose text is on one line live gets `nowrap` in the clone instead of a wider width (a wider width wrapped rows, #491): `freezeOneLine`, `src/modules/styles.js` (#516).
- Firefox for Android font inflation (getComputedStyle reports the authored font-size and line-height): `freezeInflatedFontSizes`, `src/utils/clone.helpers.js`. Fields are read through caret hit-testing; placeholders and `<select>` cannot be read and keep the authored size.
- A Firefox export smaller than the `layoutZoom` grid (every `download()` on a high-DPR screen, and any `scale < 1` at DPR 1, where the grid is 1) is rasterized at the grid and resampled, or snapped borders lose edges: the `fine` draw in `src/exporters/toCanvas.js` (#516; at DPR 1 it costs 0.3 to 3 ms per export, measured on d-text-layout and d5).
- PNG and JPEG files past the canvas limit are rendered in SVG windows and streamed into one file, never a full-size canvas: `toLargeImage`, `src/exporters/toLargeImage.js`, with the encoders in `src/modules/png.js` and `src/modules/jpeg.js` (#543; JPEG takes Firefox's chroma rule, 4:4:4 from quality 0.9 up, measured in the `jpeg.js` comment).
- A clip's culled block siblings fold into one spacer per run, measured on the live page, so a long page costs one box per run (800 cards, 19.6 -> 7.8 ms) and fractional heights no longer drift the window: `finishClipHusks`, `src/core/clone.js` (#549). The folded husks stay as display:none shells only when author `<style>` travels with the clone, because sibling selectors must match the same elements.
- snapdom's own scaffolding is never cloned below the root (the decode iframe `toCanvas` keeps in `document.body` was captured through a nested `toPng` by every later `body` capture): the skip at the top of `deepClone`, `src/core/clone.js`.
- A near-weight face (within 300 of the request) is embedded only over a used codepoint the exact faces' explicit `unicode-range` leaves uncovered, the one case where it paints (WebKit reaches the family's other weights there; Chromium and Firefox move to the next family): `faceMatchesRequired` and step 2a of `embedCustomFonts`, `src/modules/fonts.js` (jant#174 scene: svg 141 -> 68 KB, pixel-identical on all three engines).
- Under `embedFonts: 'auto'` a declared webfont family the document never drew (every face `unloaded` or `error`, e.g. a later family in a stack whose earlier one covers the text) is neither embedded nor warmed: `documentFontFamilies`, `src/modules/fonts.js`, read in the fonts phase after `prepareClone`'s layout, and after a layout in the Safari pre-step (jant#174 scene: svg 68 -> 14 KB, no font download left, pixel-identical on all three engines and real Safari).

### The html-in-canvas engine

`src/engines/htmlInCanvas.js`, opt-in via `engine: 'html-in-canvas'`, in the shipped bundle since 2026-10-28 (Chrome 157 ships `drawElementImage` unflagged; `scripts/verify-legacy-bundle.mjs` pins its presence, and the `__SNAPDOM_CANVAS_ENGINE__` define and the `@canvas` dist-tag are gone). It stays quarantined in behavior: on any doubt it returns null and the svg engine runs on the same clone, so the option is transparent in Firefox, WebKit and older Chrome, and a browser-independent call site needs no feature check. It is opt-in, not the default, on the speed goal: the native paint waits for a rendering update (~35 ms on a card against 3 for svg, BENCHMARKS.md); making it the default would need a measured case on all scenes. Live parity in Chrome 155 (2026-10-26): of the 41 demos it accepts (body captures and the geometry bails go to SVG), none is worse than the svg engine and two are better (scrollbars). Plugins with `beforeRender`/`afterRender` get SVG by contract (PLUGIN_SPEC.md); the other official plugins run on it, recordings frame by frame. Never call `canvas.requestPaint()`: it crashed Chrome 155's renderer at the next iframe (the file header has the story). **The pinned Playwright Chromium predates the API**, so the suite covers the engine through a `drawElementImage` stub (`__tests__/engines.htmlInCanvas.test.js`) and a green run says nothing about the native paint: check it by hand in Chrome 157 or newer with `SNAPDOM_ENGINE=html-in-canvas BROWSER=chromium node scripts/live-parity.mjs` (launches the installed Chrome and notes every demo that fell back to svg) and the lab at `docs/labs/html-in-canvas/`. The site's guide for it is `docs/how-to/html-in-canvas/`.

### Safari / WebKit

WebKit quirks are handled at their point of impact, each commented where it lives: the paint probe and the second probe after the draw in `waitForImgPaint` / the draw in `toCanvas.js` (WebKit #219770 / #394); the per-capture pre-step in `src/api/snapdom.js` (fonts ready, canvas stores poked); the vector path for a sized `toImg` in `src/exporters/toImg.js`; the font set stuck at "loading" with `ready` pending forever, which every font wait gets past through `fontsSettled` in `src/utils/browser.js` (jant#174; Playwright's WebKit shows the stuck status but its `ready` still resolves). All were verified in real Safari, and **Playwright's WebKit does not reproduce them**: a green `test:webkit` proves nothing about these paths. Re-verify in real Safari (the `safari-verification` skill) before touching any of them.

### Build outputs

Two files, `dist/snapdom.mjs` (ESM) and `dist/snapdom.js` (script-tag IIFE), and `types/snapdom.d.ts`. `esbuild.config.mjs` explains every choice inline; `scripts/check-pack.mjs` fails on a missing OR an extra file in the tarball. The constraints, not preferences: there is **no CommonJS build**, by decision (2026-09-02; v2's `require()` pointed at the IIFE and returned `{}`, so nothing that worked is lost, and a `require` condition must not come back); the `/plugins` subpath is **not a separate file**, because `package.json` maps it to the same `snapdom.mjs` so the subpath and the root are one module instance (separate entrypoints gave each its own registry, and re-export stubs were four files for nothing); the removed `/preCache` subpath must stay unexported; `buildLegacy` keeps `format: 'iife'` and has no `globalName` (without the format 442 minified bindings leaked as globals; with the name the empty export object overwrote `window.snapdom`); the subpath's `types` condition points at the root declarations, because `declare module` augmentations were TS2665 in every consumer. `compile` empties `dist/` first, since `files: ["dist/"]` ships whatever sits there. Nothing is code-split.

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
- Visual diffs live under `__snapshots__/visual*/`; `npm run cross:report` builds a cross-engine comparison page.
- **`demos/` is COMMITTED** (2026-09-01; 84 files — held back: the stale docs-site copy, Drift-branded assets, d17/d171 which are built around them, and the `labs*.html` scratch pages, all still gitignored). A checkout without it (sparse, or a worktree from before the commit) makes the visual suite silently skip itself (`visual.demos.test.js` globs `/demos/d*.html`, gets nothing, and registers a `describe.skip`) — a green `npm test` there proves NOTHING about pixels. If you must bring demos in by hand, **copy, do not symlink**: vite resolves through the link into the other repo's `node_modules`, several demos then capture at a wrong size, and you get ~11 fabricated "regressions". `npm run test:visual` runs just that file, on all three engines. `REQUIRE_VISUAL=1` turns both silences into a hard failure at globalSetup (`scripts/require-visual.mjs`): no demos, or no baselines at all — the case where the first run RECORDS them and passes, proving only that the build agrees with itself. Every package.json test script sets it; a bare `npx vitest` run does not. There is no CI on this repo (the `ci.yml` workflow was removed on 2026-08-30): verification is local, and a push to the remote is the last step, not the gate. Nothing but your own machine runs the test scripts or the visual suite, so a green `test:full` before `npm run release` is the release signal.
- **The cross-library comparison harness lives in `docs/compare/live/harness.js`**, shared by `__tests__/category.libs.js` and the live lab page, so **a checkout without `docs/` breaks the category suite** (same trap class as `demos/`). Its fairness rules and scenes: the `compare-harness` skill.
- Baselines are recorded on first run, so a v3-only run only proves v3 agrees with itself. To measure v3 against `main`, generate baselines in the main checkout (identical harness file), copy `__snapshots__/visual` over, and run here. Status as of 2026-08-10: **71/71 demos pixel-identical to main on chromium.** Two deliberate divergences since: `d14-cors-test` moved ~2% on all three engines with the `<img>` box fix in `clone.js` (its baselines were re-recorded), and the Firefox baseline of `d-plugin-animation-lab` was re-recorded when its range sliders started rendering the styled track and thumb like Chromium and the live page (a fidelity gain that rode along with the defaults fix in `css.js`).
- Coverage config in `vitest.config.js` scopes to `src/**/*.js`. **It only runs on chromium** (the v8 provider is Chromium-only), so Safari-only code reads as uncovered even when exercised — that is a measurement blind spot, not debt. Code that is unreachable by construction is marked with `/* c8 ignore start/stop */` and a reason; `/* c8 ignore next N */` also works (the v8-to-istanbul vendored into `@vitest/coverage-v8` 3.2.7 parses it in `dist/provider.js`, `_parseIgnore`), and `src/core/prepare.js` uses it.
- `docs/compare/live/lab.js` imports `@zumer/snapdom` from unpkg with NO version on purpose: that lane is the published-version arm of the comparison (the competitor adapters are pinned; snapdom's published arm is not). Never pin it.

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
