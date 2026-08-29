// Visual regression suite for snapdom demos. Shared by the visual.demos.N.test.js
// shards; not a test file itself, so the `*.test.js` include skips it.
//
// It is SPLIT ACROSS SHARDS because vitest parallelises by FILE, not by test: every
// demo in one file meant one worker running them all in series, and that single file
// was the entire wall clock of `npm test`: every other file finished in parallel
// around it. The split is round-robin so the slow demos do not pile into one shard.
// Requires @zumer/snapdiff >= 0.3.0, which clears artifacts once per RUN and
// accumulates the report across files; on 0.2.x shard N wipes shard N-1's artifacts
// and report.html ends up covering one shard.
//
// First run: every demo recorded as a baseline (status "new", test passes).
// Subsequent runs: any pixel mismatch above threshold fails the test.
// Update baselines with `VITE_UPDATE_VISUAL=1 npm run test:visual`
// or by appending `?update` to the vitest browser URL.
//
// Demos that pull KaTeX/MathJax/webfonts/images from a CDN are run one at a time, or
// skipped with the reason attached, when the connection cannot serve them at full tilt.
// That is not this suite's own machinery: the gate is generic (helpers/network-gate.js +
// vitest.network.mjs) and all this file adds is "a demo needs the network when its own HTML
// points off-origin". Force a mode with `NETWORK_GATE=off|serial|skip`.
//
// The static review report is written to __snapshots__/visual/report.html.

import { describe, it, beforeEach, afterAll, inject, vi } from 'vitest'
import { defineDemoSuite } from '@zumer/snapdiff/vitest/suite'
import { networkGuard, networkStatus, pageNeedsNetwork } from './helpers/network-gate.js'

// import.meta.glob is a Vite primitive, evaluated at module load, returns
// a map of URL → loader. We only use the keys.
const ALL_DEMOS = import.meta.glob('/demos/d*.html')

// These demos fetch KaTeX/MathJax/fonts from a CDN before they lay out, and the whole
// file runs three times under BROWSER=all. The 15s browser-mode default expired on
// whichever demo happened to be waiting on the network when the machine was loaded:
// d1, d6, d24 and d474 each timed out on different runs, none of them reproducibly.
//
// The budget is not fixed, because "too slow" is a property of the link: on a fast one
// 10s means a demo is genuinely stuck, while on the link the gate puts into serial mode
// the same 10s only converts a slow download into a red test. vitest bakes the timeout in
// when tests are registered, which is why this reading comes from the pre-run probe in the
// config rather than from the runtime gate.
//
// hookTimeout covers the beforeEach below, which is where a test queues for the serial
// lane, so it has to outlast that queue rather than the test itself.
//
// EVERY BUDGET BELOW IS A CEILING ON ONE DEMO, AND THEY ADD UP. The first version of this
// let a demo queue 120s for the lane and then run for 30s more, so a single demo could be
// reported at over two and a half minutes, and with the retry, at five. A gate that costs
// that much has stopped being a way of coping with a slow link and become the slow thing.
// The whole chain is now sized to stay under a minute per demo:
//
//   gate probe   <= 9s   (warmup 5s + payload batch 4s, in vitest.network.mjs)
//   lane queue   <= 15s  (LANE_WAIT_MS below; the broker usually refuses instantly)
//   ---------------------------------------
//   worst hook     24s, against a 35s hookTimeout. The margin is deliberate: a hook that
//                  times out reports a FAILED test, which is the one outcome this whole
//                  gate exists to avoid, so it must never be the thing that expires first.
//   test body      30s   at most, and the lane's own run budget caps how many pay it
const NETWORK = inject('network') ?? { mode: 'parallel', serialTimeoutMs: 30000 }
// Engines running at once. Under BROWSER=all the same demo gets a third of the machine and a
// third of the link, and the two failures that survived the pre-run probe were exactly that:
// d-compress, which touches no network at all and just decodes nineteen canvases, and d474,
// which pulls KaTeX. Both hit the 10s budget that had been sized for one engine on an idle
// line.
const ENGINES = inject('engines') ?? 1
// How long a demo may take to stop changing. It is a CAP, not a wait: a demo that settles in
// 200ms still costs 200ms. Three engines sharing the machine need the room; a degraded link
// does NOT get it multiplied on top, because in serial mode the lane has already given this
// demo the link to itself, and 8s of waiting for a payload that is not coming is 8s wasted
// on every network demo in the run.
const SETTLE_BUDGET_MS = NETWORK.mode === 'parallel' ? 2500 * ENGINES : 8000
// How long a demo may queue for the serial lane before it is skipped instead. Has to stay
// clear of hookTimeout below: a hook that times out reports a FAILED test, and a demo the
// connection could not serve is not a failure of snapdom.
const LANE_WAIT_MS = 15000
vi.setConfig({
  // In serial mode the demo already has the link to itself, so the engine count does not
  // multiply on top of serialTimeoutMs the way it does for the parallel budget.
  testTimeout: NETWORK.mode === 'parallel' ? 10000 * ENGINES : NETWORK.serialTimeoutMs,
  hookTimeout: 35000,
  // One retry whenever the gate is live, not only when the PRE-RUN probe already found the
  // link degraded. The reading that sizes this file is taken on an idle line, and the run
  // itself is what saturates it: a demo that starts under a "parallel" verdict and finishes
  // after the link has collapsed either times out or captures with the fallback font and
  // diffs as a regression it is not (d21 did exactly that: 16.76% mismatch on a run where its
  // siblings were being skipped; d25 did it again with Google Fonts). The retry re-consults
  // the gate, which by then has measured the run's own congestion and says serial or skip. A
  // real regression fails both times, so this hides nothing.
  retry: 1,
})

// Wait for the demo to STOP CHANGING instead of guessing with a fixed delay.
//
// Demos finish asynchronously in ways a fixed `wait` cannot cover: MathJax and KaTeX
// typeset after their CDN payload lands, iframes load, and a few demos append their own
// snapdom output back into the <body> that this suite captures (the suite falls back to
// `body` whenever a demo has no #target, so that appended screenshot is INSIDE the shot).
// A fixed wait lands on whichever frame it lands on, which is exactly why the same demo
// passed when run alone and failed in a full run: d10 captured the body with the demo's
// self-appended screenshot in one run and without it in the next.
//
// The signature is geometry-only, so a demo animating canvas pixels or colours reads as
// stable immediately and costs nothing; only a page still growing burns the budget.
/** Stylesheets the page has asked for and not received yet. A `<style>` block's
 *  `@import` is a CSSImportRule whose `.styleSheet` stays null until the import lands,
 *  and a `<link>`'s `.sheet` is null until the same. */
function styleSheetsPending(doc) {
  for (const link of doc.querySelectorAll('link[rel~="stylesheet"]')) {
    if (!link.sheet && !link.disabled) return true
  }
  for (const sheet of doc.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue } // cross-origin: nothing to wait for
    for (const rule of rules) {
      if (rule.type === 3 /* CSSRule.IMPORT_RULE */ && !rule.styleSheet) return true
    }
  }
  return false
}

/** Faces that are actually in flight. NOT `unloaded`: that is the permanent status of a
 *  face the page declared and never used, and Google Fonts' css2 returns one @font-face
 *  per unicode-range, so a page using latin alone leaves cyrillic and greek `unloaded`
 *  forever. Treating those as pending burns the whole settle budget on every font demo and
 *  still waits for the wrong thing. What comes after the stylesheet lands is `fonts.ready`,
 *  which is about the faces the page USES. */
function fontFacesPending(doc) {
  for (const face of doc.fonts) {
    if (face.status === 'loading') return true
  }
  return false
}

async function settle(win, budget = SETTLE_BUDGET_MS) {
  const doc = win.document
  const deadline = Date.now() + budget
  const left = () => Math.max(0, deadline - Date.now())
  const sleep = (ms) => new Promise((r) => win.setTimeout(r, ms))

  // Typesetting depends on the webfont, so fonts first, but BOUNDED. Every wait below is
  // capped by the same deadline: an unbounded await would hand one stalled request the
  // entire test timeout (d474 sat at 30s on firefox exactly here).
  //
  // `document.fonts.ready` alone is NOT the signal. These demos pull their font through a
  // CSS `@import`, so while that stylesheet is in flight the document has declared no faces
  // at all and `ready` resolves immediately, on a page whose text is still in the fallback.
  // The geometry loop below then reads three stable frames of the WRONG font and the capture
  // diffs against a baseline recorded when the import had landed (d21, d25 and d3 failed
  // exactly this way on firefox, on a slow link, as a dimension mismatch rather than a
  // timeout). So: wait for the stylesheets the page asked for, then for the faces they
  // declare, then re-check, because a landing stylesheet declares new faces.
  while (Date.now() < deadline && (styleSheetsPending(doc) || fontFacesPending(doc))) {
    await sleep(Math.min(50, left()))
  }
  try { await Promise.race([doc.fonts.ready, sleep(left())]) } catch { /* best-effort */ }

  let last = '', stable = 0
  while (Date.now() < deadline && stable < 3) {
    await new Promise((r) => win.requestAnimationFrame(r))
    const el = doc.documentElement
    const sig = el.scrollWidth + 'x' + el.scrollHeight + 'x' + doc.images.length
    if (sig === last) stable++
    else { stable = 0; last = sig }
  }

  // An infinite CSS animation never reaches a resting frame, so the captured phase is just
  // whatever the clock read: d5's .transition-box rotates and scales on a 3s infinite loop
  // and diffed 4% between two runs of the same build. Pin every animation to its first frame
  // so the phase is a property of the suite instead of the scheduler.
  try { for (const a of doc.getAnimations()) { a.currentTime = 0; a.pause() } } catch { /* best-effort */ }

  // Decode last: this has to cover images the page appended while we were waiting above.
  try {
    await Promise.race([Promise.allSettled([...doc.images].map((im) => im.decode?.())), sleep(left())])
  } catch { /* best-effort */ }
}

// Poll a predicate to a deadline. Used by the demos that append their OWN snapdom output
// into the body this suite captures: settle() only proves the page is quiet, and a demo
// awaiting the network is quiet too, so those demos need to state what "done" looks like.
async function until(win, pred, budget = 8000) {
  const deadline = Date.now() + budget
  while (Date.now() < deadline) {
    try { if (pred()) return true } catch { /* not ready yet */ }
    await new Promise((r) => win.requestAnimationFrame(r))
  }
  return false
}

// ---------------------------------------------------------------------------
// Slow-connection auto-skip.
//
// Roughly a quarter of the demos fetch KaTeX, MathJax, icon fonts, Google Fonts or remote
// images before they lay out. On a link that cannot serve them those demos do not fail
// because snapdom regressed, they fail because the payload never arrived, and the failure
// lands on whichever demo happened to be waiting: a timeout, or a capture taken with the
// fallback font against a baseline recorded with the real one.
//
// The verdict comes from the shared gate in node, which decides between running them as
// usual, running them one at a time, and skipping them. The only demo-specific part is the
// rule below for what "needs the network" means here: the demo's own HTML points off-origin.
// ---------------------------------------------------------------------------

/** Demo base name -> its URL, filled per shard so the gate can read the demo's own HTML. */
const urlByName = new Map()

// Per-demo overrides for demos that don't use #target or need a delay.
const overrides = {
  // The snapVisual demo toggles a `body.mutated` class with new bg gradients
  // and pseudo content: large legitimate visual diff, not a snapdom bug.
  'demo': { skip: true },
  // Continuous WebGL blend/wipe transition re-triggered on every DOM-to-texture
  // update (~70-110ms cross-fade), never at rest, so no fixed wait lands on a
  // stable frame. Diff is always a moving wipe boundary, not a snapdom bug.
  'd-plugin-webgl-seamless-dom': { skip: true },
  'd-plugin-webgl-time-tunnel': { skip: true },
  // Root translate/rotate stripped + viewBox recomputed from the remaining scale (fix 3241481).
  'd-root-transform': { snapdomOptions: { dpr: 1, scale: 0.5, embedFonts: true, outerTransforms: false } },
  // Bbox must expand for box-shadow / outline / blur bleed instead of clipping them.
  'd-outer-shadows': { snapdomOptions: { dpr: 1, scale: 0.5, embedFonts: true, outerShadows: true } },
  // compress:true must downsample each codec (PNG/JPEG/WebP) without corruption. Images are
  // drawn at load, so wait for them (setup runs after `wait`) before capturing.
  'd-compress-codecs': {
    snapdomOptions: { dpr: 1, scale: 0.5, embedFonts: true, compress: true },
    setup: async (win) => { try { await win.__ready } catch { /* best-effort */ } },
  },
  // 19 canvas-generated PNG data URLs (one 2600x1100 + 18 at 1400x1000) assigned at load.
  // Decoding them takes longer than `defaultWait` on a loaded machine: WebKit dropped a
  // single collage tile that way. The demo's own capture button awaits decode() before
  // capturing; the suite bypasses that button, so wait for the same thing here.
  'd-compress': {
    setup: async (win) => {
      try {
        const imgs = [...win.document.querySelectorAll('#target img')]
        await Promise.allSettled(imgs.map((im) => im.decode?.()))
      } catch { /* best-effort */ }
    },
  },
  // Loads Mansalva from a CDN, then captures `body` and appends the PNG back INTO body.
  // The suite captures `body` too, so that appended screenshot is part of the shot: the
  // baseline is 648x753 with it and 640x512 (bare viewport) without. Fixed waits raced it.
  'd10-multi-background-text': {
    setup: async (win) => { await until(win, () => win.document.querySelector('body > img')) },
  },
  // Awaits preCache(document), pure network, during which the page sits perfectly still,
  // then captures each .test-node and appends the results into #output. Wait for the count
  // the demo intends to produce rather than for the page to merely look quiet.
  'd12-backgrounds-test': {
    setup: async (win) => {
      const doc = win.document
      const want = doc.querySelectorAll('.test-node').length
      await until(win, () => doc.querySelector('#output')?.children.length >= want)
    },
  },
  // MathJax v2 (TeX-AMS-MML_SVG) typesets asynchronously once its CDN script lands, and the
  // resulting re-layout nudges the paragraph a few px WITHOUT changing page geometry, so a
  // quiet-page check reads it as ready and captures mid-typeset (a repeatable 0.58%/1916px
  // diff on roughly two runs in three). Queue on MathJax's own hub, which runs the callback
  // behind the typeset pass rather than guessing when it finished.
  'd13-svg-pdf-mathjax': {
    setup: async (win) => {
      await until(win, () => win.MathJax?.Hub)
      await Promise.race([
        new Promise((r) => { try { win.MathJax.Hub.Queue(r) } catch { r() } }),
        new Promise((r) => win.setTimeout(r, 8000)),
      ])
    },
  },
  // Real KaTeX from CDN (issue #454 repro): needs time to load and lay out fonts.
  'd454-katex-hide-tail': { wait: 2500 },
  // Paginates one capture into three crop'd canvases at load. The baseline holds the
  // live document next to the rasterized pages, so a wrong crop origin or a stretched
  // page shows up as the tiles no longer reconstructing the source.
  'd-crop-pages': {
    setup: async (win) => { try { await win.__ready } catch { /* error is rendered into the demo */ } },
  },
  // Issue #474 formulas rendered live at load (captures only run on click): snapshotting
  // the table is a KaTeX layout fidelity check. Same CDN font wait as d454.
  'd474-katex-formulas': { wait: 2500 },
  // #489 renders the same doubly-scaled box live, with default capture and with reconciliation.
  // Wait for both canvases, then capture the whole comparison through the repaired path too.
  'd489-reconcile-transform': {
    snapdomOptions: { dpr: 1, scale: 0.5, embedFonts: true, reconcile: true },
    setup: async (win) => { try { await win.__ready } catch { /* error is rendered below */ } },
  },
}

// `overrides[name].skip` wins: a demo skipped for its own reasons should not be reported as
// a casualty of the connection. In serial mode every network demo passes through the same
// one lane, so this is where the queue forms and where a demo is skipped rather than left
// to wait out a queue that cannot clear in time.
const guard = networkGuard(
  (name) => !overrides[name]?.skip && pageNeedsNetwork(urlByName.get(name)),
  { laneWaitMs: LANE_WAIT_MS },
)

// Every demo gets settle(), not just the ones with an override, so readiness is a property
// of the suite rather than something each demo has to remember to opt into.
function baseName(url) {
  const m = String(url).match(/([^/\\]+?)(?:\.html?)?$/i)
  return m ? m[1] : String(url)
}

/**
 * Register the demos belonging to one shard. Round-robin over the glob keys, so
 * adding or removing a demo reshuffles shards but never changes a baseline: the
 * baselines are keyed by demo name, not by which shard captured them.
 */
export function defineDemoShard (shardIndex, shardCount) {
  const demos = Object.fromEntries(
    Object.entries(ALL_DEMOS).filter((_, index) => index % shardCount === shardIndex)
  )
  for (const url of Object.keys(demos)) urlByName.set(baseName(url), url)

  // The gate runs per test, not once per file: it is the run itself that saturates the
  // link (six shards times three engines is eighteen workers pulling from CDNs at once),
  // so the reading has to come from the moment the demo is about to load.
  beforeEach(guard)

  // Say which mode the run ended up in. A serialised or skipped demo is not the same
  // coverage as a green one, and a run that quietly downgraded itself should say so.
  afterAll(async () => {
    const status = await networkStatus()
    if (status.mode !== 'parallel') console.log(`\n[network gate] ${status.mode}: ${status.reading}\n`)
  })

  const demoOptions = Object.fromEntries(
    Object.keys(demos).map(baseName).map((name) => {
      const o = overrides[name] ?? {}
      return [name, {
        ...o,
        setup: async (win, doc) => {
          await settle(win)
          if (o.setup) { await o.setup(win, doc); await settle(win) }
        },
      }]
    })
  )

  // demos/ is not committed to the repo. Forks running `npm test` get an empty
  // glob → defineDemoSuite registers zero test cases → vitest errors with
  // "No test found in suite". Skip this shard when there are no demos.
  if (Object.keys(demos).length === 0) {
    describe.skip('visual demos (no demos/ folder found)', () => {
      it('skipped', () => {})
    })
  } else defineDemoSuite({
    demos,

    // snapdiff's own readUpdateFlag() reads process.env.UPDATE_VISUAL, but this suite runs in the
    // browser (vitest browser mode) where `process` doesn't exist, so UPDATE_VISUAL never reaches
    // it. Vite DOES expose VITE_-prefixed vars to import.meta.env in the browser, so re-record
    // baselines with: `VITE_UPDATE_VISUAL=1 npm test` (or =true).
    updateBaselines: ['1', 'true', 'yes'].includes(String(import.meta.env.VITE_UPDATE_VISUAL || '').toLowerCase()),

    baseDir: '__snapshots__/visual',
    threshold: 0.1,
    failureRatio: 0.005, // tolerate 0.1% drift from font-hinting jitter
    defaultTarget: '#target',
    defaultWait: 200,
    snapdomUrl: '/dist/snapdom.mjs',
    snapdomOptions: { dpr: 1, scale: 0.5, embedFonts: true  },
    viewport: { width: 1280, height: 1024 },
    demoOptions,
  })
}
