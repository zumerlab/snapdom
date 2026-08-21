// Visual regression suite for snapdom demos.
// Drop this file into snapdom/__tests__/. Runs as part of `npm test`.
//
// First run: every demo recorded as a baseline (status "new", test passes).
// Subsequent runs: any pixel mismatch above threshold fails the test.
// Update baselines with `UPDATE_VISUAL=1 npx vitest run __tests__/visual.demos.test.js`
// or by appending `?update` to the vitest browser URL.
//
// The static review report is written to __snapshots__/visual/report.html.

import { describe, it, vi } from 'vitest'
import { defineDemoSuite } from '@zumer/snapdiff/vitest/suite'

// import.meta.glob is a Vite primitive — evaluated at module load, returns
// a map of URL → loader. We only use the keys.
const demos = import.meta.glob('/demos/d*.html')

// These demos fetch KaTeX/MathJax/fonts from a CDN before they lay out, and the whole
// file runs three times under BROWSER=all. The 15s browser-mode default expired on
// whichever demo happened to be waiting on the network when the machine was loaded —
// d1, d6, d24 and d474 each timed out on different runs, none of them reproducibly.
vi.setConfig({ testTimeout: 30000 })

// Wait for the demo to STOP CHANGING instead of guessing with a fixed delay.
//
// Demos finish asynchronously in ways a fixed `wait` cannot cover: MathJax and KaTeX
// typeset after their CDN payload lands, iframes load, and a few demos append their own
// snapdom output back into the <body> that this suite captures (the suite falls back to
// `body` whenever a demo has no #target, so that appended screenshot is INSIDE the shot).
// A fixed wait lands on whichever frame it lands on, which is exactly why the same demo
// passed when run alone and failed in a full run — d10 captured the body with the demo's
// self-appended screenshot in one run and without it in the next.
//
// The signature is geometry-only, so a demo animating canvas pixels or colours reads as
// stable immediately and costs nothing; only a page still growing burns the budget.
async function settle(win, budget = 2500) {
  const doc = win.document
  const deadline = Date.now() + budget
  const left = () => Math.max(0, deadline - Date.now())
  const sleep = (ms) => new Promise((r) => win.setTimeout(r, ms))

  // Typesetting depends on the webfont, so fonts first — but BOUNDED. document.fonts.ready
  // does not settle while a font request is still in flight, and these demos fetch from a
  // CDN, so an unbounded await hands one stalled request the entire test timeout (d474 sat
  // at 30s on firefox exactly here). Every wait below is capped by the same deadline.
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
  // whatever the clock read — d5's .transition-box rotates and scales on a 3s infinite loop
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

// Per-demo overrides for demos that don't use #target or need a delay.
const overrides = {
  // The snapVisual demo toggles a `body.mutated` class with new bg gradients
  // and pseudo content — large legitimate visual diff, not a snapdom bug.
  'demo': { skip: true },
  // Continuous WebGL blend/wipe transition re-triggered on every DOM-to-texture
  // update (~70-110ms cross-fade) — never at rest, so no fixed wait lands on a
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
  // Decoding them takes longer than `defaultWait` on a loaded machine — WebKit dropped a
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
  // Awaits preCache(document) — pure network, during which the page sits perfectly still —
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
  // resulting re-layout nudges the paragraph a few px WITHOUT changing page geometry — so a
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
  // Real KaTeX from CDN (issue #454 repro) — needs time to load and lay out fonts.
  'd454-katex-hide-tail': { wait: 2500 },
  // Paginates one capture into three crop'd canvases at load. The baseline holds the
  // live document next to the rasterized pages, so a wrong crop origin or a stretched
  // page shows up as the tiles no longer reconstructing the source.
  'd-crop-pages': {
    setup: async (win) => { try { await win.__ready } catch { /* error is rendered into the demo */ } },
  },
  // Issue #474 formulas rendered live at load (captures only run on click) — snapshotting
  // the table is a KaTeX layout fidelity check. Same CDN font wait as d454.
  'd474-katex-formulas': { wait: 2500 },
}

// Every demo gets settle(), not just the ones with an override, so readiness is a property
// of the suite rather than something each demo has to remember to opt into.
function baseName(url) {
  const m = String(url).match(/([^/\\]+?)(?:\.html?)?$/i)
  return m ? m[1] : String(url)
}

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
// "No test found in suite". Skip this whole file when there are no demos.
if (Object.keys(demos).length === 0) {
  describe.skip('visual demos (no demos/ folder found)', () => {
    it('skipped', () => {})
  })
} else defineDemoSuite({
  demos,

  // snapdiff's own readUpdateFlag() reads process.env.UPDATE_VISUAL, but this suite runs in the
  // browser (vitest browser mode) where `process` doesn't exist — so UPDATE_VISUAL never reaches
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
