// Cross-engine visual report: one row per demo, Chromium as reference, WebKit
// and Firefox side by side with per-pair pixel diffs and mismatch ratios.
// Rows are sorted by divergence so the most inconsistent demos surface first.
// Standalone tool — never part of npm test (cross-engine divergence is expected).
// Usage: node scripts/cross-report.mjs  → __snapshots__/cross-report.html

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '__snapshots__')
const REF = { label: 'Chromium', dir: 'visual' }
const OTHERS = [
  { label: 'WebKit (Safari)', dir: 'visual-webkit', key: 'webkit' },
  { label: 'Firefox', dir: 'visual-firefox', key: 'firefox' },
]
const DIFF_DIR = join(root, 'cross-diffs')
mkdirSync(DIFF_DIR, { recursive: true })

const names = new Set()
for (const dir of [REF.dir, ...OTHERS.map(o => o.dir)]) {
  try {
    for (const f of readdirSync(join(root, dir))) {
      if (f.endsWith('.png')) names.add(f.replace(/\.png$/, ''))
    }
  } catch { /* engine dir not recorded yet */ }
}
const demos = [...names].sort()

const asDataUrl = (dir, name) => {
  try {
    return `data:image/png;base64,${readFileSync(join(root, dir, `${name}.png`)).toString('base64')}`
  } catch {
    return null
  }
}

const browser = await chromium.launch()
const page = await browser.newPage()

// Pixel diff in a canvas: red where channels differ beyond the threshold,
// faded grayscale reference elsewhere. Returns ratio + diff png.
async function diffPair(refUrl, otherUrl) {
  return page.evaluate(async ([a, b]) => {
    const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height)
    const dimsMatch = ia.width === ib.width && ia.height === ib.height
    const px = (im) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, w, h) }
    const da = px(ia), db = px(ib)
    const out = new ImageData(w, h)
    let diff = 0
    for (let i = 0; i < da.data.length; i += 4) {
      const d = Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) +
                Math.abs(da.data[i + 2] - db.data[i + 2]) + Math.abs(da.data[i + 3] - db.data[i + 3])
      if (d > 30) {
        diff++
        out.data[i] = 255; out.data[i + 3] = 255
      } else {
        const g = (da.data[i] + da.data[i + 1] + da.data[i + 2]) / 3
        out.data[i] = out.data[i + 1] = out.data[i + 2] = g
        out.data[i + 3] = Math.round(da.data[i + 3] * 0.25)
      }
    }
    const c = document.createElement('canvas'); c.width = w; c.height = h
    c.getContext('2d').putImageData(out, 0, 0)
    return { ratio: diff / (w * h), dimsMatch, png: c.toDataURL('image/png') }
  }, [refUrl, otherUrl])
}

const rows = []
for (const name of demos) {
  const ref = asDataUrl(REF.dir, name)
  const row = { name, results: {} }
  for (const { dir, key } of OTHERS) {
    const other = asDataUrl(dir, name)
    if (!ref || !other) { row.results[key] = { missing: true }; continue }
    const { ratio, dimsMatch, png } = await diffPair(ref, other)
    writeFileSync(join(DIFF_DIR, `${name}.${key}.png`), Buffer.from(png.split(',')[1], 'base64'))
    row.results[key] = { ratio, dimsMatch }
  }
  row.worst = Math.max(...Object.values(row.results).map(r => r.missing ? 1 : r.ratio))
  rows.push(row)
  console.log(`${name}  ${OTHERS.map(o => { const r = row.results[o.key]; return `${o.key}: ${r.missing ? 'missing' : (r.ratio * 100).toFixed(2) + '%'}` }).join('  ')}`)
}
await browser.close()

rows.sort((a, b) => b.worst - a.worst)

const badge = (r) => {
  if (r.missing) return '<span class="badge miss">missing</span>'
  const pct = (r.ratio * 100).toFixed(2) + '%'
  const cls = r.ratio >= 0.05 ? 'bad' : r.ratio >= 0.01 ? 'warn' : 'ok'
  return `<span class="badge ${cls}">${pct}${r.dimsMatch ? '' : ' · dims!'}</span>`
}

const body = rows.map(({ name, results }) => {
  const cells = [`<td><img loading="lazy" src="${REF.dir}/${name}.png" onerror="this.replaceWith('missing')"></td>`]
  for (const { dir, key } of OTHERS) {
    const r = results[key]
    cells.push(`<td>${badge(r)}<img loading="lazy" src="${dir}/${name}.png" onerror="this.replaceWith('missing')"></td>`)
    cells.push(`<td class="diff">${r.missing ? '' : `<img loading="lazy" src="cross-diffs/${name}.${key}.png">`}</td>`)
  }
  return `<tr><th>${name}</th>${cells.join('')}</tr>`
}).join('\n')

const html = `<!doctype html><meta charset="utf-8"><title>snapDOM cross-engine visual report</title>
<style>
  body { margin: 0; font: 13px/1.4 system-ui, sans-serif; background: #f4f4f5 }
  table { border-collapse: collapse; width: 100% }
  thead th { position: sticky; top: 0; background: #18181b; color: #fff; padding: 8px; z-index: 1 }
  tbody th { position: sticky; left: 0; background: #fff; text-align: left; padding: 8px; font-family: monospace; max-width: 160px; overflow-wrap: anywhere }
  td, tbody th { border: 1px solid #ddd; vertical-align: top }
  td { padding: 6px; width: 19% }
  td.diff { background: #fafafa }
  img { max-width: 100%; display: block; background: repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 0/16px 16px; cursor: zoom-in }
  img:fullscreen { background: #fff; object-fit: contain }
  .badge { display: inline-block; margin-bottom: 4px; padding: 1px 8px; border-radius: 9px; font-weight: 600; font-size: 12px }
  .badge.ok { background: #dcfce7; color: #166534 }
  .badge.warn { background: #fef9c3; color: #854d0e }
  .badge.bad { background: #fee2e2; color: #991b1b }
  .badge.miss { background: #e4e4e6; color: #52525b }
  p { margin: 8px }
</style>
<p>Reference: <b>${REF.label}</b> · rows sorted by divergence (worst first) · diff: red = pixels differing from Chromium</p>
<table>
<thead><tr><th>demo</th><th>${REF.label}</th><th>WebKit (Safari)</th><th>diff</th><th>Firefox</th><th>diff</th></tr></thead>
<tbody>
${body}
</tbody>
</table>
<script>document.addEventListener('click', e => { if (e.target.tagName === 'IMG') e.target.requestFullscreen() })</script>
`

const out = join(root, 'cross-report.html')
writeFileSync(out, html)
console.log(`\n${rows.length} demos → ${out}`)
