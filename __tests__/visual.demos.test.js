// Visual regression suite for snapdom demos.
// Drop this file into snapdom/__tests__/. Runs as part of `npm test`.
//
// First run: every demo recorded as a baseline (status "new", test passes).
// Subsequent runs: any pixel mismatch above threshold fails the test.
// Update baselines with `UPDATE_VISUAL=1 npx vitest run __tests__/visual.demos.test.js`
// or by appending `?update` to the vitest browser URL.
//
// The static review report is written to __snapshots__/visual/report.html.

import { describe, it } from 'vitest'
import { defineDemoSuite } from '@zumer/snapdiff/vitest/suite'

// import.meta.glob is a Vite primitive — evaluated at module load, returns
// a map of URL → loader. We only use the keys.
const demos = import.meta.glob('/demos/d*.html')

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

  // Per-demo overrides for demos that don't use #target or need a delay.
  // Fill in based on what each demo expects.
  demoOptions: {
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
    // Real KaTeX from CDN (issue #454 repro) — needs time to load and lay out fonts.
    'd454-katex-hide-tail': {
      wait: 2500,
      setup: async (win) => { try { await win.document.fonts.ready } catch { } }
    },
    // Examples — adjust to your demos:
    // 'd1':  { target: 'body' },
    // 'd2':  { target: '#target', wait: 1500, snapdomOptions: { embedFonts: true } },
    // 'd31': { target: '.demo-host', setup: async (win) => { win.startAnimation?.(); await new Promise(r => setTimeout(r, 500)) } },
  },
})
