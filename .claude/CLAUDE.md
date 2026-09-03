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
experimental peer (opt-in `engine: 'html-in-canvas'`): same input, different painter. It runs from a lazy seam in `captureDOM` right
where the clone is finished, and mounts THAT clone (it used to run before the pipeline and copy
the live element, which is why it had to bail on plugins/clip/exclude/reconcile — it skipped the
passes that implement them). Its only remaining bails are geometry: `outerShadows`, `clip` and
explicit `width`/`height` need the bbox math that lives in the svg engine. It is NOT optimized,
and in unflagged browsers every capture still falls to the svg engine (no draw API). With the
Chrome 148+ origin trial / flag it CAN run: the spec dropped tainting for "read-back-allowed
rendering" (sensitive content is excluded from painting instead), and the finished clone is
same-origin by construction, so the taint probe passes. `assembleCaptureCSS`
(utils/capture.helpers.js) is the one place both engines get their CSS from.

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

**The pseudo pass asks a SUBTREE question, not a document one** (`canSkipPseudoWalk`,
pseudo.js). `shouldProcessPseudos` only answers "does any stylesheet here mention a pseudo?",
and every real page answers yes — so the pass used to recurse over every node of the capture to
discover that nothing matched. One `.zz::before` rule matching ZERO nodes took the 500-row table
from 75 ms to 197 ms (instrumented: 0 gate passes, 0 getComputedStyle probes — the walk WAS the
cost), and html2canvas was unaffected, so it was ours alone. The root call now runs one
`querySelector` over the joined gates and returns immediately when nothing in the subtree can
match: 197 → 66 ms, with scenes whose rules DO match unchanged. Two cases must still walk and
are bailed on explicitly: a `null` gate (untrusted scan) and any shadow root in the capture
(`sessionCache.shadowScopes`, filled by deepClone, which always runs first). Pinned by
`module.pseudo.subtreeGate.test.js`, whose descendant-match test goes red if the
`querySelector` half is removed.

**`MAX_RASTER_SIDE` is per engine** (`toCanvas.js`): 16384 on Safari, 32767 elsewhere. It used
to be 16384 for everyone — WebKit's number applied to all three — so a tall capture on a real
page came back silently DOWNSCALED (live 640x17298 rendered 606x16384, while domlens and
html2canvas returned it whole). Chromium decodes an svg data URL at 640x32768 and backs a
640x17298 canvas, probed directly. The clamp path is also not free: it decodes the whole svg
payload, rewrites the header, re-encodes and resamples at a fractional scale — 5.2 ms/Mpx
through it against 3.1 ms/Mpx just under it. The AREA cap is unchanged. Pinned by
`exporters.rasterLimit.test.js` (skipped on webkit, which really does cap at 16384).

**Large captures are drawn in horizontal BANDS from one decoded image** (`drawBanded`,
toCanvas.js). Chromium's svg-as-image draw is superlinear in the destination size: the deep
tree (1232x13572, ~20k boxes) took 517 ms as one `drawImage` and 123 ms as 8 bands drawn with
source rects into the same canvas; real Safari 26.5 through the exporter path 153 → 94; Firefox
has no nonlinearity (49 → 54, harmless). The 500-row table is unchanged (37 → 38), so the gate
is AREA, not height: one draw below 4 Mpx, a band per ~2 Mpx above, capped at 8 (16 measured
slower). Cut on whole device rows with the dpr folded into the destination size under an
identity transform, so every band uses the exact transform the whole draw would. Pixels:
68 of 16.7M differ on Chromium, at rows 256 apart — the tile seams of Chromium's own one-shot
raster, not band edges — and 0 on Firefox. This is NOT the `crop` option: crop rewrites the
viewBox and re-decodes the svg per window (~47 ms of load+layout each on that tree), which is
why it got worse past 4 slices (370 / 549 / 982 ms at 4 / 8 / 16) while bands keep improving.
Two WebKit facts to keep straight: `waitForImgPaint`'s 16x16 probe is a `drawImage` too (the
call-count test filters it by canvas size), and the exporter's raster differs from a naive
main-document `new Image()` draw of the same svg by 0.9–24% of the pixels WITH THE BANDS OFF
(identical counts with them on, safaridriver-measured), so the parity tests skip there — that
gap belongs to the decode-frame path and predates this. Pinned by
`exporter.toCanvas.bands.test.js`, proven red: a one-row band shift differs by 760k pixels.

**An inlined data: URL is written to the clone ONCE** (images.js, clone.helpers.js
`freezeImgSrcset`). Every write of an `<img>` src re-parses the URL and starts a load, and for
a data: URL that is a base64 decode of the whole payload; every READ through the `src` /
`currentSrc` getters re-serializes it. The gallery bench (9 sources, 26 MB of base64) paid
that four times: cloneNode's attribute copy, freezeImgSrcset re-setting the identical value,
inlineImages re-assigning the same string through the setter (and caching a multi-MB key
pointing at itself), then compress writing the downsample — plus two regex scans over the
same megabytes (`resolveCSSVars` looking for `var(`, `sanitizeCloneForXHTML` for invalid XML).
Profiled 2026-09-02: processImg 61 + setAttribute 47 + cloneNode 41 of a 180 ms warm
pipeline. Now a data: src returns from inlineImages before any fetch or write, freezeImgSrcset
compares the raw attribute and writes only what differs, and both scanners skip base64
payloads: warm pipeline 172 → 62 ms, cold 409 → 298, gallery toPng 275 → 144 against
html-to-image's 280. What is left is cloneNode's own 41 ms — the attribute copy itself starts
the load — and removing it means a clone that carries no `src` until serialization, which
plugins reading the clone would observe; not done. Pinned by
`modules.images.dataUrlPassthrough.test.js` (counts src writes on the clones; restoring either
write turns it red).

**Compress runs on a lazy worker POOL and takes the fetched Blob, not its base64 string**
(compress.js, snapFetch.js, images.js). The worker's cost on the 9-photo gallery, measured
sequentially: `fetch(dataURL)` 140 ms (a base64 decode of the 26 MB of sources), PNG decode
105, resize 1, PNG encode 65, base64 back 3. Two things followed. One worker serialized the
jobs: 219 ms wall against 145 on four (138 on eight — four is the knee), so slots are spawned
on demand up to `min(4, hardwareConcurrency - 1)`, with the same pool-wide failure semantics
the single worker had (a throwing constructor or an erroring worker fails every pending job
over to the sync path and stops the route). And when the image came over HTTP, snapFetch
already held the Blob it base64-encoded for the clone's src: it now rides on the result,
inlineImages parks it on the clone (`img.__snapdomBlob`), and compress posts it instead of
the string — a Blob crosses postMessage by reference, the string was cloned and decoded
again. Cold captures only; warm ones are served by the compress memo. Measured with every
cache emptied: data:-sourced gallery 298 → 226 ms of pipeline (pool; there is no Blob for a
data: source, so the decode happens either way); HTTP-sourced photos 258 → 187 in the fast
mode, medians 261 → 201 (pool + Blob). Resizing inside createImageBitmap was measured slower
(260 vs 219) and is not used. Images under 64 KB never reach the worker, so the README's
image-grid row does not move.

**The identity share asks a SUBTREE question too** (`styleShareSafe`, styles.js; the gate
is built by styleScan.js). One full computed-style read per structural identity, twins copy
it — but it was switched off by a DOCUMENT-wide flag whenever any author selector could
split identical twins: `:hover`, `:first-child`, `p + p`, `:has()`. Every real page has
those, scoped to classes the captured subtree never contains, so on the docs site the fast
path never ran: a 500-row table cost 536k `getPropertyValue` calls (178 per node) instead
of 77k, and the pipeline 150 ms instead of 76 — while the vitest pages, bare of host CSS,
reported the fast number. Measured 2026-09-02 with a call-site census on the real page
(cold toPng 316 → 242 ms; domlens 264–278 on the same page). The scan now COLLECTS the
splitting selectors (`&` resolved first, since `matches()` answers false, not throws, to a
raw `&`) and the capture asks whether any of them matches under the root right now: a rule
that matches nobody there styles nobody the snapshot reads, so twins stay identical. The
list is indexed by each selector's subject compound (first class, else id, else tag) and
only selectors whose key is present in the subtree reach the `querySelector`: unindexed,
3000 Tailwind-shaped `.hover\:x:hover` rules cost the gate 55 ms and 15k cost 276; indexed,
74 and 85 ms for the whole toRaw against 77 with no rules. The root is part of the question
(`el.matches`). Pinned by `module.styles.shareSubtreeGate.test.js`, proven to fail both
ways: the document flag turns its first test red, dropping the querySelector half its second.

**What a twin must RE-READ is the set of properties CSSOM resolves to USED values, and the
list was incomplete** (`shareLists`, styles.js). Turning the share on for real pages exposed
it: the deep-tree scene on the docs lab rendered 18.6% of its pixels wrong (html2canvas 0.8%
against a Playwright screenshot of the live element) because `grid-template-columns` reads
as the used track list — `1fr 1fr` is `42px 388px` on one grid and `230px 840px` on its
structural twin three levels up — and every grid took the first twin's columns. A probe of
twins with different boxes on all three engines gives the full divergence set: width /
height and their logical aliases, the box offsets, transform/perspective-origin, margin and
padding (% and auto), the grid track lists, and `transform` (a % translate is resolved into
the matrix). `inline-size`/`block-size` are re-read whenever present, the track lists only
on a grid container and `transform` only when the identity has one, so a table pays no
extra read. The list and the base signature are built on an identity's FIRST TWIN, not when
it is stored: on the deep tree every leaf is its own identity (unique inline background) and
building them per identity cost 27 ms of a 134 ms pipeline; the record now stores the
snapshot by reference and copies it once on the first hit — the identity's own object is
V8-dictionary-mode (keyed stores, then the strip's `delete`) and twins spreading it cost the
500-row table 6 ms. Deep tree 160 → 131 ms, table 68 unchanged, share-off 134 / 155.
A second hole of the same class: `@container` rules style by the container's size, which
twins under different-width parents do not share (measured: the narrow twin's colour painted
onto the wide one), so every selector inside one joins the share gate. Pinned by four tests
in `module.styles.identityShare.test.js`, all red on the previous code.

**The pseudo pass cost 150 µs per inlined `::before`, and four things made it** (measured
2026-09-02 on the deep tree with a 2px `::before` stripe on every leaf, 1,936 pseudos, bare
page: 435 ms against 125 without the rule; now 172). In order of size:
1. `styleFingerprint` ran on EVERY node of the recursion (`preflightWithFp` at the top of
   `inlinePseudoElements`): a document-wide `querySelectorAll('style,link…')` plus a walk of
   every sheet, per node — quadratic, 64 ms of the 295 on a page holding one `<style>`, on
   ANY page with any pseudo rule. It runs on the root call only now (`!isDescendant`).
2. The pseudo snapshot enumerated all ~400 computed properties (`snapshotComputedStyle` in
   utils/css.js, 788k `getPropertyValue` calls). It takes a property set now: the element
   universe first, then a PSEUDO universe (styleScan `pseudoUniverse`): a `::before` has no
   inline style and no presentational attributes, so a non-inherited property can only leave
   its UA default through a rule whose selector names a pseudo (collected as `pseudoProps`),
   an inherited one only through the element (INHERITED_PROPS ∩ universe), plus the five box
   props getStyleKey reads back. ~130 → ~45 reads per pseudo; null (unreliable scan, shadow
   content) keeps the full enumeration. The only declarations that leave the payload are
   currentcolor-derived colours on props the pseudo does not use (`outline-color`,
   `caret-color`, logical `border-*-color`) — pixel-identical on all 77 demos.
3. The per-tag defaults (`getDefaultStyleForTag`) were built by ENUMERATION, and Chromium's
   enumeration lists none of `counter-set`/`counter-reset`/`counter-increment`/
   `content-visibility`/`white-space`/`border-spacing`, all of which the universe reads by
   name — so every class rule of every element carried them as "non-default" values
   (`counter-set:none;content-visibility:visible;white-space:normal;…`). The defaults now
   read the ALWAYS_PROPS the enumeration skipped: the deep-tree payload shrank 10%.
4. Twin pseudos share one read (`pseudoSnapshotFor`, styles.js): keyed by the element's
   interned identity + the pseudo, the same used-value re-read list as the element share, the
   same lazy first-twin copy. Nothing on the deep tree (every leaf's inline background is its
   own identity) but 500 `li::before` bullets: 48 → 26 ms, 81k → 10k reads. Pinned by
   `module.pseudo.twinShare.test.js`; the share-off path was a `false.pseudo = …` TypeError
   swallowed by the pass's try/catch until that test's off arm caught it.
The deep-tree scene in the harness now CARRIES that stripe (docs/compare/live/harness.js):
without it the scene measured html2canvas's repainter on bare boxes, the one input it handles
best; with it its output is 7% off the live element and its cold speed edge is gone. Two
traps from landing this: (a) INHERITED_PROPS must not list engine-specific props the universe
may or may not contain (`-webkit-text-stroke-*`, `caret-color`) — read by name they made the
pseudo's snapshot key depend on unrelated author CSS, and `regression.pseudo.afterPosition`
(two captures mounted in ONE document, class names shared) collided `.c1` across hosts;
(b) the Firefox baseline of `d-plugin-animation-lab` moved and was re-recorded: its range
sliders now render the styled track and thumb like Chromium and the live page (the old
baseline had unstyled tracks), a fidelity gain that rode along with the defaults fix.

**`normalizeInlineStyleToComputed` is gated, and it has THREE contracts** (styles.js). It
re-resolves an element's inline declarations through the cascade; its docstring named only
#328 (a stylesheet `!important` must still beat an inline declaration inside the clone). The
other two are load-bearing and were found by tests going red: `background` ON TEXT FIELDS
only (the selection highlight composes its measured px layers on top of the longhands the
pass puts on an input's or textarea's clone; on every other node the shorthand copied
verbatim is the same value, and re-resolving it on a 500-row table was 13.5k reads plus
13.5k writes for nothing), and CONTEXT-DEPENDENT
inline values (`width:100%`, `1.2em`, `calc()`, `auto`) which resolve against a containing
block the foreignObject does not reproduce. Everything else is an absolute value copied onto
itself — the clone's style attribute already has it. The context test is ONE regex over the
whole style attribute, hoisted deliberately: testing per longhand cost more than the
resolutions it saved (67.6 → 63 ms instead of 49.7), and an earlier variant that compared the
clone's style attribute against the source's was PATH-DEPENDENT and broke `core.capture.diff`'s
byte-equality on all three engines. Pinned by `module.styles.inlineImportant.test.js`.
`importantPropsFor` rides the author scan that already walks every declaration; a null set
(untrusted scan) re-resolves everything, as before.

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

WICG html-in-canvas (`ctx.drawElementImage`; the M138-era dev trial called it `drawElement` and the module detects both, OT name first), opt-in via `engine: 'html-in-canvas'`. Fully quarantined: core's only knowledge is a 3-line lazy import in `snapdom.js`, and on ANY doubt `tryEngineResult` returns null and the normal pipeline runs. Status 2026-09-03: the spec dropped unconditional tainting for "read-back-allowed rendering" — sensitive/cross-origin content is excluded from painting and readback is allowed — shipping in the Chrome 148–154 origin trial behind `chrome://flags/#canvas-draw-element`; no Intent to Ship yet. The engine follows the OT contract (`layoutsubtree` on the canvas, `drawable` on the mounted wrapper, `paint` event after `requestPaint()` as the sync point, bounded) and draws the FINISHED CLONE — whose cross-origin content the pipeline already inlined, making it same-origin by construction, so the native-content exclusions don't bite and the taint probe passes. Unflagged browsers still fall through to the svg engine at `detectDrawApi()`. Keep the quarantine contract intact — correctness must never depend on this module.

**It is NOT in the shipped bundle.** Nothing is code-split, so the lazy import still landed in `dist/` and every user downloaded a branch that cannot run. `esbuild.config.mjs` defines `__SNAPDOM_CANVAS_ENGINE__ = false`, and the seam in `snapdom.js` is written so esbuild folds the branch (and the module) away. Tests import `src` directly, where the identifier is undefined and the engine stays live. To build it in: `SNAPDOM_CANVAS_ENGINE=1 npm run compile`. Readback already works under the Chrome 148+ origin trial, but the API is still churning (dpr semantics, transform sync) and there is no Intent to Ship — flip the default only when Chromium ships it unflagged.

### Safari/WebKit handling

The old once-per-session 3x pre-capture warmup is gone. WebKit quirks are handled at their point of impact instead (all verified against real Safari via a SnapEye harness — re-verify there before touching these):

- **WebKit #219770/#394** (svg-as-image: `img.decode()` resolves before embedded fonts / nested images paint → blank first `drawImage`): `toCanvas`'s `waitForImgPaint` attaches the img offscreen and, when the svg carries `@font-face`/`data:image` payloads, probe-draws a 16px canvas until ink appears (bounded ~600ms). Plain svgs keep the old two-rAF compositor wait. The pre-draw probe is not sufficient on its own for a large nested raster (WebKit decodes it asynchronously at a subsampling level chosen from the DRAW's scale, so the 16x16 probe proves a coarse frame the full-size draw does not reuse): the real draw is wrapped in `paint()` and, on Safari when the probe saw ink, the same probe runs ONCE MORE after the draw — blank means the finer decode is still pending, so wait for it (bounded 600ms) and `paint()` again at the same scale. Only a would-be-blank first capture pays the redraw; see the FIXED entry below.
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
- `vitest.config.js` aliases the bare specifier `@zumer/snapdom` to `src/index.js`. `packages/plugins/*` import the core by NAME because they are published separately, and under test that name resolved to whatever npm had installed — the last PUBLISHED release, 2.24.1 — so `gif-export` and `video-export` ran their internal recaptures against v2 while appearing to test v3. Since 2026-09-03 the package-manager layer agrees with the alias: both workspaces declare `@zumer/snapdom` as a `file:../..` devDependency (the peer range stays `>=3.0.0-0` for consumers), and the committed `.npmrc` sets `legacy-peer-deps=true` — without it npm tries to place one top-level `@zumer/snapdom` satisfying every peer range in the tree (`@zumer/snapdiff` wants `>=2.0.0`, which semver refuses to match with the local `3.0.0-beta.0` prerelease) and either fails `npm ci` or installs the published v2 from the registry, re-opening this exact trap.
- `BROWSER=webkit|firefox|all` selects the engine; visual baselines are kept per engine. **A fidelity change is not done until it is green on all three** — several fixes this branch shipped behaved differently per engine.
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
  its own README.
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

## Audit defects — all six FIXED 2026-09-02 (were "open" 2026-08-30 → 09-01)

The five audit defects plus the shadow-root `::after` were fixed in one pass. Each entry keeps
the mechanism and says how it was closed, so a regression is recognizable. The traps that
guarded the earlier "do not fix" decisions are still real — they are why each fix is narrow.

- **`toCanvas.js` `waitForImgPaint` — first WebKit capture blank — FIXED.** The 16x16 probe
  draw is not predictive of the full-size draw: WebKit decodes a large nested `data:image`
  asynchronously at a subsampling level picked from the DRAW's scale, so the probe proved a
  coarse frame and the real draw asked for a finer one and painted nothing while it decoded
  (instrumented: probe ink, full draw 0 px, both correct 100 ms later). The real draw is now
  wrapped in `paint()` and, on Safari when the pre-draw probe saw ink, the same 16x16 probe
  runs ONCE MORE AFTER the draw; blank means a decode is pending, so wait for ink (bounded
  600 ms) and `paint()` again at the same scale (which cannot request another level). Good
  path costs one probe draw; only a would-be-blank capture redraws. Non-WebKit runs no new
  code (the probe is created only under `isSafari()`). The five earlier reverted attempts all
  kept the verification BEFORE the draw, which cannot see this. Pinned by the now-UN-skipped
  crop case in `visual.fidelity.crossengine.test.js` (it must stay the first capture of that
  sprite in the page — the first decode of the data: URL is the trigger). Re-verified in REAL
  Safari 26.5.1 through SnapEye 0.3.0 (2026-09-02, `bench/snapeye-dev.mjs` driven by
  safaridriver): 100/100 captures, the 50 base and the 50 compressed each one sha1, all valid
  PNG, no size outlier, first capture identical to the rest.

- **`pseudo.js` — scoped `::marker` / `::first-line` skipped when the scan is unreliable —
  FIXED.** A cross-origin sheet makes `pseudoGatesFor` return null; the scoped emitter treated
  null as "no rules". It now PROBES on null (the boxes each pseudo can exist on — list items
  for `::marker`, block containers for `::first-line`, shadow content excluded), and the
  emitter only writes a declaration that DIFFERS from the element's own, so it cannot
  over-apply (the old fear). `-webkit-text-fill-color` joined MARKER_PROPS/FIRST_LINE_PROPS
  because the full-style read the unreliable path forces pins the element's fill colour, which
  overrides the pseudo's `color`; read from the pseudo it resolves to the pseudo's colour.
  Native pseudo rendering in a foreignObject varies by engine (Firefox paints no scoped
  `::marker` colour), so `module.pseudo.unreliableScan.test.js` pins the emitted RULE, matching
  how `module.pseudo.test.js` already pins markers. Cross-origin CSS in a test:
  `commands.serveCrossOriginCss()` (vitest.config.js) serves a sheet on 127.0.0.1 whose
  `cssRules` throws — the deterministic "unreliable scan" on all three engines.

- **`pseudo.js` `styleFingerprint` — ignores adopted stylesheets' rule counts — FIXED.** The
  fingerprint now sums each adopted sheet's `cssRules.length` (constructed sheets are
  same-origin, a page has a handful — NOT the per-capture census of every document sheet that
  timed out under `BROWSER=all` and is still forbidden), and a changed fingerprint on a
  document seen before calls `invalidateStyleCaches()` so the DOM-epoch memos in styles.js
  (universe, gates) re-scan with it. A `replaceSync()` on an already-adopted sheet now reaches
  the pass. Pinned by `module.pseudo.adoptedReplace.test.js`. `ruleEpoch.test.js`'s trade is
  untouched: this counts adopted sheets only, not a document-wide census.

- **`diff.js` — the differential path skipped the live-DOM prep — FIXED.** The dirty subtree
  is now wrapped in `lineClampTree(src, null)` + `forceContentVisibility(src)` (the same passes
  capture.js/prepare.js run before the full pipeline's deepClone) with a try/finally undo, so a
  spliced frame clamps its text and un-skips content-visibility like a full capture. Pinned by
  the pixel-equal line-clamp test in `core.capture.diff.test.js`.

- **`clone.js` `<img>` min-width/min-height floor — FIXED.** The freeze AND the floor were
  both written from `offsetWidth`/`offsetHeight` (the BORDER box) onto content-box properties,
  so with padding or a border the picture rendered scaled inside a too-large box (measured
  against a live screenshot: 18–34% of pixels differ with 20px padding + a 5px border, 0%
  after; the earlier revert corrected only the floor while the freeze still wrote the border
  box, so no change showed). Both now subtract padding + border widths unless box-sizing is
  border-box. `d14-cors-test` (images with `border: 1px solid black`) moved ~2% on all three
  engines and its LOCAL baselines were re-recorded — a deliberate divergence from v2/main, so a
  future "compare against main" run expects d14 to differ; every other demo is unchanged.

- **shadow-root `::before`/`::after` never painted — FIXED** (was a `test.skip` in
  `module.pseudo.subtreeGate.test.js`). Two causes. `canSkipPseudoWalk` bailed on
  `sessionCache.shadowScopes?.size`, but `shadowScopes` is a WeakMap (`.size` is always
  undefined) so the walk was never kept for shadow content; it now bails on
  `sessionCache.__shadowPseudo`, set by deepClone when a shadow root's own CSS declares a
  pseudo (and the pass's document-level preflight is OR'd with it). And `wrapWithScope`
  produced `:where([data-sd] .k::after)`, which no parser accepts, so every scoped pseudo rule
  was dropped: the pseudo-element now stays OUTSIDE the `:where()` wrapper, and a span-inlined
  `::before`/`::after`/`::first-letter` (which the pseudo pass draws) is replaced by a
  never-matching selector so it is not painted twice. Pinned by the shadow `::after` (span,
  drawn once) and shadow `::marker` (native, from the scoped rule) tests.
