/**
 * The vector page (`src/svd-pdf.js`): the engine's document in, a PDF that is
 * DRAWN out.
 *
 *   node test/svdcheck.mjs
 *
 * Nothing calls the vector page from `toPdf()` yet, so nothing else in this
 * directory would notice if it stopped loading. This is the one live seam: a
 * real capture, the vector engine's own document for it, and the file this
 * module writes from that — checked for being a well-formed PDF, for being
 * paths and text rather than a picture, and for carrying the page's words.
 */
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { serve } from './serve.mjs'
import { check, report, setFixture, pdfProblems } from './harness.mjs'

const require = createRequire(import.meta.url)
const pdfjs = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'))
pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')

const server = await serve()
const browser = await chromium.launch()
try {
  setFixture('svd')
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', e => errors.push(String(e.message || e)))
  await page.goto(`http://localhost:${server.port}/test/fixtures/svd.html`)
  await page.waitForFunction('window.__ready === true')
  const out = await page.evaluate(() => window.__vectorPage())

  if (!check('the engine describes the capture and the vector page writes a file from it', !out.error, out.error || `${out.nodes} chars of document`)) {
    report()
  } else {
    const bytes = Buffer.from(out.base64, 'base64')
    const problems = pdfProblems(bytes.toString('latin1'))
    check('xref, /Size and /Length describe the actual bytes', problems.length === 0, problems.join('; '))

    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
    check('one page', pdf.numPages === 1, `${pdf.numPages}`)
    const pg = await pdf.getPage(1)
    const text = (await pg.getTextContent()).items.map(i => i.str).join(' ')
    check('the page carries its words as text', text.includes('VectorPageHeading') && text.includes('DrawnNotPictured'), text.slice(0, 80))

    const ops = await pg.getOperatorList()
    const name = (fn) => Object.keys(pdfjs.OPS).find(k => pdfjs.OPS[k] === fn)
    const used = new Set(ops.fnArray.map(name))
    const images = [...used].filter(k => /paintImage|paintInlineImage/.test(k))
    check('the card is drawn as paths, not placed as a picture', (used.has('constructPath') || used.has('fill') || used.has('stroke')) && images.length === 0,
      `${[...used].filter(k => /Path|fill|stroke|shading/i.test(k)).join(', ')}${images.length ? ` — images: ${images.join(', ')}` : ''}`)
    check('the gradient is a shading', used.has('shadingFill') || [...used].some(k => /shading/i.test(k)), [...used].filter(k => /shading/i.test(k)).join(', '))
    await pdf.destroy()
    check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
    report()
  }
} finally {
  await browser.close()
  server.close()
}
