// Cross-engine visual report: the recorded baselines of WebKit and Firefox against Chromium's.
// Engines antialias text differently, so a plain pixel count paints every paragraph red. Each
// pair is therefore measured twice: `strict` counts every differing pixel, `layout` only those
// with no matching pixel one step away in the other image, which is what a moved box, a
// re-wrapped line or a missing element leaves. Rows sort by `layout`, and a size mismatch is
// called out first, since it shifts everything below it.
// Two engines disagreeing is not a capture bug by itself: their live pages disagree too. When
// `npm run test:parity` has run, each row also shows the capture against its own live page,
// and that is the number that points at snapdom.
// Standalone: never part of npm test (engines are expected to differ).
// Usage: node scripts/cross-report.mjs, then open __snapshots__/cross-report.html

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '__snapshots__')
const REF = { label: 'Chromium', dir: 'visual' }
const OTHERS = [
  { label: 'WebKit', dir: 'visual-webkit', key: 'webkit' },
  { label: 'Firefox', dir: 'visual-firefox', key: 'firefox' },
]
const DIFF_DIR = join(root, 'cross-diffs')
mkdirSync(DIFF_DIR, { recursive: true })

const names = new Set()
for (const dir of [REF.dir, ...OTHERS.map(o => o.dir)]) {
  try {
    for (const f of readdirSync(join(root, dir))) if (f.endsWith('.png')) names.add(f.replace(/\.png$/, ''))
  } catch { /* engine not recorded yet */ }
}

const asDataUrl = (dir, name) => {
  try { return `data:image/png;base64,${readFileSync(join(root, dir, `${name}.png`)).toString('base64')}` } catch { return null }
}

// demo name to { chromium, firefox, webkit, notes }, from scripts/live-parity.mjs.
const parity = new Map()
try {
  for (const line of readFileSync(join(root, '..', 'output/live-parity/report.md'), 'utf8').split('\n')) {
    const [, demo, c, f, w, notes] = line.split('|').map(x => x.trim())
    if (demo && /%|error/.test(c + f + w)) parity.set(demo, { chromium: c, firefox: f, webkit: w, notes })
  }
} catch { /* live parity has not run */ }
const OFF = 0.5 // percent against the live page past which a capture is worth a look

const browser = await chromium.launch()
const page = await browser.newPage()

/** Both measures and a diff image: red is a layout difference, amber is rendering only. */
async function diffPair(refUrl, otherUrl) {
  return page.evaluate(async ([a, b]) => {
    const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height)
    const px = (im) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0); return x.getImageData(0, 0, w, h).data }
    const da = px(ia), db = px(ib)
    const far = (p, q, i, j) => Math.abs(p[i] - q[j]) + Math.abs(p[i + 1] - q[j + 1]) + Math.abs(p[i + 2] - q[j + 2]) + Math.abs(p[i + 3] - q[j + 3]) > 30
    // Whether no pixel of `q` within one step of (x, y) matches `p` there.
    const alone = (p, q, x, y) => {
      const i = (y * w + x) * 4
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && !far(p, q, i, (ny * w + nx) * 4)) return false
        }
      }
      return true
    }
    const out = new ImageData(w, h)
    let strict = 0, layout = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (far(da, db, i, i)) {
          strict++
          const moved = alone(da, db, x, y) || alone(db, da, x, y)
          if (moved) layout++
          out.data[i] = moved ? 220 : 245; out.data[i + 1] = moved ? 38 : 158; out.data[i + 2] = moved ? 38 : 11; out.data[i + 3] = 255
        } else {
          out.data[i] = out.data[i + 1] = out.data[i + 2] = (da[i] + da[i + 1] + da[i + 2]) / 3
          out.data[i + 3] = Math.round(da[i + 3] * 0.25)
        }
      }
    }
    const c = document.createElement('canvas'); c.width = w; c.height = h
    c.getContext('2d').putImageData(out, 0, 0)
    return { strict: strict / (w * h), layout: layout / (w * h), size: [ib.width, ib.height], refSize: [ia.width, ia.height], png: c.toDataURL('image/png') }
  }, [refUrl, otherUrl])
}

const rows = []
for (const name of [...names].sort()) {
  const ref = asDataUrl(REF.dir, name)
  const row = { name, results: {}, refSize: null }
  for (const { dir, key } of OTHERS) {
    const other = asDataUrl(dir, name)
    if (!ref || !other) { row.results[key] = { missing: true }; continue }
    const { png, refSize, ...r } = await diffPair(ref, other)
    writeFileSync(join(DIFF_DIR, `${name}.${key}.png`), Buffer.from(png.split(',')[1], 'base64'))
    row.refSize = refSize
    row.results[key] = { ...r, resized: r.size[0] !== refSize[0] || r.size[1] !== refSize[1] }
  }
  const all = Object.values(row.results)
  row.missing = all.some(r => r.missing)
  row.resized = all.some(r => r.resized)
  row.layout = Math.max(...all.map(r => r.missing ? 1 : r.layout))
  row.level = row.missing ? 'missing' : row.resized ? 'size' : row.layout >= 0.01 ? 'layout' : row.layout >= 0.001 ? 'minor' : 'same'
  row.live = parity.get(name)
  row.off = row.live ? ['chromium', 'firefox', 'webkit'].filter(e => !(parseFloat(row.live[e]) < OFF)) : []
  rows.push(row)
}
await browser.close()

const ORDER = ['missing', 'size', 'layout', 'minor', 'same']
rows.sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level) || b.layout - a.layout)

const pct = (v) => (v * 100).toFixed(v < 0.01 ? 2 : 1) + '%'
const LEVELS = {
  missing: 'A baseline is missing',
  size: 'Different size',
  layout: 'Layout differs (1% or more)',
  minor: 'Small layout difference',
  same: 'Same layout',
}
const count = (level) => rows.filter(r => r.level === level).length
const cell = (name, { dir, key }, r, refSize) => {
  if (r.missing) return '<td class="none" colspan="2">no baseline</td>'
  const size = r.resized ? `<b class="dims">${r.size.join(' x ')} (Chromium ${refSize.join(' x ')})</b>` : ''
  return `<td><img loading="lazy" src="${dir}/${name}.png"></td>
    <td><div class="n"><b>${pct(r.layout)}</b> layout <span>${pct(r.strict)} strict</span>${size}</div><img loading="lazy" src="cross-diffs/${name}.${key}.png"></td>`
}

const live = (r) => !r.live ? '' : `<small class="${r.off.length ? 'off' : ''}">Against its own live page: ` +
  ['chromium', 'firefox', 'webkit'].map(e => `${e} ${r.live[e].startsWith('error') ? 'no reference' : r.live[e]}`).join(', ') +
  (r.live.notes ? `<br>${r.live.notes.replace(/</g, '&lt;')}` : '') + '</small>'

const body = rows.map(({ name, results, level, refSize, ...r }) => `<tr class="${level}${r.off.length ? ' off' : ''}">
  <th><a href="../demos/${name}.html">${name}</a><i>${LEVELS[level]}</i>${live(r)}</th>
  <td><img loading="lazy" src="${REF.dir}/${name}.png"></td>
  ${OTHERS.map(o => cell(name, o, results[o.key], refSize)).join('\n  ')}</tr>`).join('\n')

const html = `<!doctype html><meta charset="utf-8"><title>snapDOM cross-engine report</title>
<style>
  body { margin: 0; font: 13px/1.4 system-ui, sans-serif; background: #f4f4f5; color: #18181b }
  header { position: sticky; top: 0; z-index: 2; background: #18181b; color: #fff; padding: 10px 14px }
  header p { margin: 0 0 8px; opacity: .8 }
  label { display: inline-block; margin-right: 14px; cursor: pointer }
  table { border-collapse: collapse; width: 100%; table-layout: fixed }
  thead th { background: #27272a; color: #fff; padding: 6px; font-weight: 600 }
  th:first-child { width: 230px }
  tbody th { background: #fff; text-align: left; padding: 8px; vertical-align: top; font-weight: 400 }
  tbody th a { font-family: ui-monospace, monospace; overflow-wrap: anywhere; color: inherit }
  tbody th i { display: block; margin-top: 4px; font-style: normal; font-size: 12px; font-weight: 600 }
  td, tbody th { border: 1px solid #ddd }
  td { padding: 6px; vertical-align: top }
  td.none { text-align: center; color: #71717a }
  /* A demo can be thousands of pixels tall: rows stay the same height and a click opens it. */
  img { display: block; max-width: 100%; max-height: 240px; object-fit: contain; object-position: top left; cursor: zoom-in;
    background: repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 0/16px 16px }
  img:fullscreen { max-height: none; background: #fff }
  .n { margin-bottom: 4px } .n span { color: #71717a; margin-left: 6px }
  .dims { display: block; color: #991b1b }
  small { display: block; margin-top: 6px; color: #52525b } small.off { color: #991b1b }
  body.only-off tr:not(.off) { display: none }
  tr.missing i, tr.size i { color: #991b1b } tr.layout i { color: #9a3412 } tr.minor i { color: #854d0e } tr.same i { color: #166534 }
  ${ORDER.map(l => `body:not(.show-${l}) tr.${l} { display: none }`).join('\n  ')}
</style>
<body class="show-missing show-size show-layout">
<header>
  <p>WebKit and Firefox baselines against Chromium's. <b>layout</b> ignores pixels that only moved by one, so it reads boxes and line breaks, not text antialiasing. In a diff, red is layout and amber is rendering only. Click an image to see it whole.</p>
  ${ORDER.map(l => `<label><input type="checkbox" value="${l}"${l === 'minor' || l === 'same' ? '' : ' checked'}> ${LEVELS[l]} (${count(l)})</label>`).join('\n  ')}
  ${parity.size ? `<label><input type="checkbox" value="only-off"> Only where a capture is ${OFF}% or more off its live page (${rows.filter(r => r.off.length).length})</label>` : '<span>Run npm run test:parity to see each capture against its live page.</span>'}
</header>
<table>
<thead><tr><th>demo</th><th>${REF.label}</th>${OTHERS.map(o => `<th>${o.label}</th><th>against Chromium</th>`).join('')}</tr></thead>
<tbody>
${body}
</tbody>
</table>
<script>
  document.addEventListener('click', (e) => { if (e.target.tagName === 'IMG') e.target.requestFullscreen() })
  document.addEventListener('change', (e) => document.body.classList.toggle(e.target.value === 'only-off' ? 'only-off' : 'show-' + e.target.value, e.target.checked))
</script>
`

writeFileSync(join(root, 'cross-report.html'), html)
for (const level of ORDER) {
  const of = rows.filter(r => r.level === level)
  if (!of.length) continue
  console.log(`\n${LEVELS[level]} (${of.length})`)
  if (level === 'same') continue
  for (const r of of) {
    console.log('  ' + (r.off.length ? '! ' : '  ') + r.name.padEnd(40) + OTHERS.map(o => { const x = r.results[o.key]; return `${o.key} ${x.missing ? 'missing' : pct(x.layout) + (x.resized ? ' ' + x.size.join('x') + ' vs ' + r.refSize.join('x') : '')}` }).join('   '))
  }
}
if (parity.size) console.log(`\n! marks a capture ${OFF}% or more off its own live page on some engine`)
console.log(`\n${rows.length} demos, report in ${join(root, 'cross-report.html')}`)
