/**
 * `window.toPdf(el, options)` for the fixtures, built on the real plugin.
 *
 * The exporter is a snapdom plugin, so producing a PDF is two steps: capture,
 * then export. The suite predates that and calls one function with one bag of
 * options, so this splits the bag the way the plugin does — capture options to
 * `snapdom()`, page options to `toPdf()` — and nothing else. Every byte the
 * suite asserts on still comes from the plugin path.
 *
 * `scale: 2, dpr: 1` are the defaults here rather than the engine's, so a run on
 * a Retina machine rasterizes the same as CI.
 */
import { snapdom } from '@zumer/snapdom'
import pdf from '/src/index.js'

/** Read when the DOM is measured, so they belong to the plugin instance. */
const CAPTURE_TIME = ['formValues', 'shadow', 'breakAvoid', 'outline']
/** Read by the engine, so they belong to the capture. */
const ENGINE = ['scale', 'dpr', 'backgroundColor', 'outerShadows', 'outerTransforms',
  'embedFonts', 'exclude', 'excludeMode', 'cache', 'width', 'height', 'clip', 'reconcile']

/** Old names the suite still uses, mapped onto the ones the plugin has. */
const RENAMED = { compress: 'deflate', background: 'backgroundColor', filename: 'download' }

window.toPdf = async (element, options = {}) => {
  const capture = { scale: 2, dpr: 1, ...(options.snapdom || {}) }
  const measure = {}
  const page = {}

  for (const [key, value] of Object.entries(options)) {
    if (key === 'snapdom') continue
    const name = RENAMED[key] || key
    if (ENGINE.includes(name)) capture[name] = value
    else if (CAPTURE_TIME.includes(name)) measure[name] = value
    else page[name] = value
  }

  // Elements cannot cross the Playwright boundary, so the suite names them with a
  // selector and they are resolved HERE, in the page that owns them. `cover` and
  // `back` are element-only options; `header`, `footer` and `watermark` also take
  // strings, so those spell it `{ element: '#id' }` to stay unambiguous.
  const el = (v) => (typeof v === 'string' ? document.querySelector(v) : v)
  // Functions cannot cross it either, and the plugin's per-page segments ARE
  // functions. `{ $format: '…{page}…{pages}…' }` is the wire form; it is expanded
  // by substitution, never by `new Function` — the product bans that outright and
  // a test that reaches for it is a test that stops resembling the product.
  const fn = (v) => (v && typeof v === 'object' && typeof v.$format === 'string'
    ? (p, n) => v.$format.split('{page}').join(p).split('{pages}').join(n)
    : v)
  for (const key of ['cover', 'back']) if (page[key]) page[key] = el(page[key])
  for (const key of ['header', 'footer']) {
    if (!page[key] || typeof page[key] !== 'object') continue
    if (page[key].element) { page[key] = el(page[key].element); continue }
    page[key] = { ...page[key] }
    for (const seg of ['left', 'center', 'right']) {
      if (page[key][seg]) page[key][seg] = fn(page[key][seg])
    }
  }
  if (page.pageNumbers && page.pageNumbers.format) {
    page.pageNumbers = { ...page.pageNumbers, format: fn(page.pageNumbers.format) }
  }
  if (page.watermark && page.watermark.element) {
    page.watermark = { ...page.watermark, element: el(page.watermark.element) }
  }

  const shot = await snapdom(element, { ...capture, plugins: [pdf(measure)] })
  // The geometry oracle in verify.mjs must inspect the SAME canonical artifact
  // that toPdf measures and rasterizes. Keeping this test-only snapshot avoids a
  // second capture (which could itself differ) and never reaches the plugin API.
  window.__lastPdfArtifact = { url: shot.url, meta: { ...shot.meta } }
  return shot.toPdf(page)
}

window.__pdfReady = true
