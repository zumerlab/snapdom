// Webfonts — the configured profile the defaults table cannot show.
//
// Nothing benched embedCustomFonts before, yet real pages ship 2-3 webfont families —
// and the competitors embed fonts BY DEFAULT, so the defaults-profile scenarios
// systematically understated THEIR cost while snapdom's font path (collectFontUsage,
// unicode-range subsetting, the woff2 fetch + base64) went unmeasured. Fonts are
// same-origin woff2 fixtures (Inter 400/700 + JetBrains Mono, OFL), loaded in setup, so
// every arm captures a settled page and no network jitter leaks in.
//
// snapdom runs { embedFonts: true, burst: false } — the configured profile, labeled;
// competitors run their defaults, which already embed.
//
// The second describe prices snapdom's ICON-FONT rasterization path alone (glyph spans
// matched by the iconFonts option, each rasterized via a live-DOM measure + PNG encode):
// no competitor has an equivalent, so it is snapdom-vs-snapdom — with the matcher against
// without. The audit flagged this path as serialized per-glyph work; this pins its price.
//
// Run:  npx vitest bench __tests__/category.fonts.benchmark.js --browser.headless --watch=false
import { bench, describe, beforeAll, afterAll } from 'vitest'
import { snapdom } from '../src/index'
import { loadLibs, fontArticleScenario } from './category.libs.js'

const LIBS = await loadLibs()

let scene = null
beforeAll(async () => { scene = fontArticleScenario(); await scene.ready })
afterAll(() => scene?.cleanup())

const OPTS = { warmupIterations: 1, iterations: 4, time: 0 }

describe('Webfonts: article with Inter 400/700 + mono code spans (configured profile)', () => {
  bench('snapDOM { embedFonts: true }', async () => {
    await snapdom.toRaw(scene.root, { embedFonts: true, burst: false })
  }, OPTS)

  bench('snapDOM { embedFonts: true, cache: disabled } (cold font path — what a one-shot pays)', async () => {
    // The soft arm above is honest steady state: snapdom's font cache is a real
    // cross-capture cache, so iterations 2+ reuse the embedded CSS. But a one-shot user
    // pays the walk + woff2 fetch + base64 every time — this arm prices exactly that.
    await snapdom.toRaw(scene.root, { embedFonts: true, burst: false, cache: 'disabled' })
  }, OPTS)

  bench('snapDOM { embedFonts: false } (payload renders in fallback — lower bound, labeled)', async () => {
    await snapdom.toRaw(scene.root, { embedFonts: false, burst: false })
  }, OPTS)

  bench('modern-screenshot 4.7.0 (embeds by default)', async () => {
    await LIBS['modern-screenshot 4.7.0'](scene.root)
  }, OPTS)

  bench('html-to-image 1.11.13 (embeds by default)', async () => {
    await LIBS['html-to-image 1.11.13'](scene.root)
  }, OPTS)

  bench('dom-to-image-more 3.10.2 (embeds by default)', async () => {
    await LIBS['dom-to-image-more 3.10.2'](scene.root)
  }, OPTS)
})

describe('Icon-font path: 20 pseudo-element glyphs through the iconFonts matcher (snapdom-only)', () => {
  // PSEUDO-ELEMENTS are the real trigger: the matcher rasterizes ::before/::after glyph
  // content to images (verified: 20 <img> in the payload), while plain text spans in a
  // matched family stay text. ~0.5ms per glyph on a warm page — the serialized per-glyph
  // live-DOM measure the audit flagged. Lazy setup inside the bench body: with a
  // describe-level beforeAll here, vitest bench collected zero samples (NaN).
  let iconRoot = null
  function ensureIconRoot() {
    if (iconRoot && document.body.contains(iconRoot)) return iconRoot
    const st = document.createElement('style')
    st.setAttribute('data-bench-icons', '')
    st.textContent = Array.from({ length: 20 }, (_, i) =>
      `.bi-${i}::before{content:'${'ABCDEFGH'[i % 8]}';font-family:'BenchMono',monospace;font-size:20px;color:#333}`
    ).join('\n')
    document.head.appendChild(st)
    iconRoot = document.createElement('div')
    iconRoot.style.cssText = 'width:400px;padding:8px;background:#fff'
    iconRoot.innerHTML = Array.from({ length: 20 }, (_, i) => `<span class="bi-${i}"></span>`).join('')
    document.body.appendChild(iconRoot)
    return iconRoot
  }

  bench('with iconFonts matcher (each pseudo glyph rasterized to an image)', async () => {
    await snapdom.toRaw(ensureIconRoot(), { embedFonts: true, burst: false, iconFonts: [/BenchMono/] })
  }, { warmupIterations: 1, iterations: 3, time: 0 })

  bench('without matcher (glyphs stay text + embedded font)', async () => {
    await snapdom.toRaw(ensureIconRoot(), { embedFonts: true, burst: false })
  }, { warmupIterations: 1, iterations: 3, time: 0 })
})
