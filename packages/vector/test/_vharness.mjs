// Reconciliation harness: drives demo/vector.html over the 5 fixtures in the
// four option combinations, records everything that could be a silent failure,
// and regenerates out/vector/ from the canonical (design, no debugPaint) run.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/Users/martin/GitHub/zumerlab/snapdom-pro'
const OUT = path.join(ROOT, 'out/vector')
const BASE = 'http://localhost:4321/demo/vector.html'
const FIXTURES = ['fx-card', 'fx-type', 'fx-ui', 'fx-table', 'fx-z']
const MODES = ['design', 'replica']
const DEBUG = [false, true]

fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()

const consoleErrors = []
const pageErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push({ where: current(), text: m.text() })
})
page.on('pageerror', (e) => pageErrors.push({ where: current(), text: String(e && e.message || e) }))
let currentLabel = 'boot'
function current () { return currentLabel }

await page.goto(BASE, { waitUntil: 'load' })
await page.waitForFunction('window.__ready === true', null, { timeout: 30000 })

const rows = []
for (const fixture of FIXTURES) {
  for (const mode of MODES) {
    for (const debugPaint of DEBUG) {
      currentLabel = `${fixture}/${mode}/${debugPaint ? 'debug' : 'plain'}`
      const row = await page.evaluate(async ({ fixture, mode, debugPaint }) => {
        window.__vector.select(fixture)
        // The mode is a pressed-button bar and debugPaint a checkbox; drive the
        // real controls so the run goes through the same path a user does.
        for (const b of document.querySelectorAll('#mode button')) {
          b.setAttribute('aria-pressed', String(b.dataset.value === mode))
        }
        document.getElementById('debugPaint').checked = debugPaint
        await window.__vector.run()
        const r = window.__vector.result
        if (!r) return { failed: true }
        const svg = typeof r.svg === 'string' ? r.svg : String(r.svg)
        const grades = {}
        for (const n of Object.values(r.doc.nodes || {})) {
          const g = (n && n.fidelity && n.fidelity.grade) || 'E'
          grades[g] = (grades[g] || 0) + 1
        }
        const sev = {}
        const diags = [...(r.doc.diagnostics || []), ...(r.svgDiagnostics || [])]
        for (const d of diags) { const s = (d && d.severity) || 'info'; sev[s] = (sev[s] || 0) + 1 }
        return {
          nodes: Object.keys(r.doc.nodes || {}).length,
          schemaOk: !!(r.schema && r.schema.ok),
          schemaErrors: (r.schema && r.schema.errors) || [],
          foreignObject: (svg.match(/<foreignObject/g) || []).length,
          image: (svg.match(/<image\b/g) || []).length,
          grades,
          docDiagnostics: (r.doc.diagnostics || []).length,
          svgDiagnostics: (r.svgDiagnostics || []).length,
          sev,
          figmaNodes: Object.keys(r.figma.nodes || {}).length,
          figmaDiagnostics: (r.figma.diagnostics || []).length,
          figmaErrors: (r.figma.diagnostics || []).filter((d) => d.severity === 'error').length,
          hasDocument: !!r.figma.document,
          svgBytes: svg.length,
          warnings: (r.warnings || []).length,
        }
      }, { fixture, mode, debugPaint })
      rows.push({ fixture, mode, debugPaint, ...row })
    }
  }
}

// ——— canonical artifacts: design, no debugPaint ———
for (const fixture of FIXTURES) {
  currentLabel = `${fixture}/artifacts`
  const data = await page.evaluate(async (fixture) => {
    window.__vector.select(fixture)
    for (const b of document.querySelectorAll('#mode button')) {
      b.setAttribute('aria-pressed', String(b.dataset.value === 'design'))
    }
    document.getElementById('debugPaint').checked = false
    await window.__vector.run()
    const r = window.__vector.result
    return {
      svg: typeof r.svg === 'string' ? r.svg : String(r.svg),
      svd: JSON.stringify(r.doc, null, 2),
      figma: JSON.stringify(r.figma),
    }
  }, fixture)
  fs.writeFileSync(path.join(OUT, `${fixture}.svg`), data.svg)
  fs.writeFileSync(path.join(OUT, `${fixture}.svd.json`), data.svd)
  fs.writeFileSync(path.join(OUT, `${fixture}.figma.json`), data.figma)

  // The source of truth: the live element, 1:1.
  await page.locator(`#${fixture}`).screenshot({ path: path.join(OUT, `${fixture}.orig.png`) })
}

await ctx.close()

// ——— standalone render of each emitted SVG, at its natural size ———
const shotCtx = await browser.newContext({ deviceScaleFactor: 1 })
for (const fixture of FIXTURES) {
  const svg = fs.readFileSync(path.join(OUT, `${fixture}.svg`), 'utf8')
  const m = /width="([\d.]+)"\s+height="([\d.]+)"/.exec(svg)
  const w = Math.ceil(Number(m ? m[1] : 800))
  const h = Math.ceil(Number(m ? m[2] : 600))
  const p = await shotCtx.newPage()
  await p.setViewportSize({ width: w, height: h })
  await p.setContent(
    `<style>html,body{margin:0;padding:0;background:#fff}svg{display:block}</style>${svg}`,
    { waitUntil: 'networkidle' }
  )
  await p.waitForTimeout(250)
  await p.screenshot({ path: path.join(OUT, `${fixture}.standalone.png`) })
  await p.close()
}
await shotCtx.close()
await browser.close()

fs.writeFileSync(
  '/private/tmp/claude-502/-Users-martin-GitHub-zumerlab/603a7db5-1732-4d85-a08c-86d737302c3f/scratchpad/runs.json',
  JSON.stringify({ rows, consoleErrors, pageErrors }, null, 2)
)

const bad = rows.filter((r) => r.failed || !r.schemaOk || r.foreignObject > 0)
console.log('runs:', rows.length, 'console errors:', consoleErrors.length, 'page errors:', pageErrors.length, 'bad:', bad.length)
if (consoleErrors.length) console.log(JSON.stringify(consoleErrors.slice(0, 10), null, 2))
if (pageErrors.length) console.log(JSON.stringify(pageErrors.slice(0, 10), null, 2))
if (bad.length) console.log(JSON.stringify(bad, null, 2))
console.table(rows.map((r) => ({
  fx: r.fixture, mode: r.mode, dbg: r.debugPaint ? 'Y' : 'n', nodes: r.nodes,
  ok: r.schemaOk, fo: r.foreignObject, E: r.grades && r.grades.E, A: r.grades && r.grades.A,
  O: r.grades && r.grades.O, R: (r.grades && r.grades.R) || 0,
  diag: r.docDiagnostics, svgDiag: r.svgDiagnostics,
  fig: r.figmaNodes, figErr: r.figmaErrors, kb: Math.round(r.svgBytes / 1024),
})))
