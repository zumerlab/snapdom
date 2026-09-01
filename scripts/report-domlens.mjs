// Builds __snapshots__/domlens-compare/index.html from the artifacts the gated
// visual.domlens.compare.test.js run wrote: per demo, what snapdom captured, what domlens
// captured, and the painted diff (red = disagreement, orange = size mismatch banding).
// Run:  node scripts/report-domlens.mjs   (after VITE_DOMLENS_COMPARE=1 npx vitest run ...)
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(process.cwd(), '__snapshots__', 'domlens-compare')
if (!existsSync(ROOT)) { console.error('no domlens-compare artifacts; run the gated suite first'); process.exit(1) }
const engines = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)

const sections = engines.map((engine) => {
  const summary = JSON.parse(readFileSync(join(ROOT, engine, 'summary.json'), 'utf8'))
  const rows = summary.rows.filter((r) => r.pct !== undefined).sort((a, b) => b.pct - a.pct)
  const skipped = summary.rows.filter((r) => r.skip).length
  const cards = rows.map((r) => {
    const badge = r.pct >= 5 ? 'bad' : r.pct >= 1 ? 'warn' : 'ok'
    return `<details class="demo ${badge}" ${r.pct >= 5 ? 'open' : ''}>
      <summary><b>${r.name}</b><span class="pct ${badge}">${r.pct.toFixed(2)}%</span>
        ${r.dim ? `<span class="dim">size: ${r.dim}</span>` : ''}<span class="live">live: ${r.live}</span></summary>
      <div class="grid">
        <figure><figcaption>snapdom · ${r.snapDim}</figcaption><a href="${engine}/${r.name}.snapdom.png"><img loading="lazy" src="${engine}/${r.name}.snapdom.png"></a></figure>
        <figure><figcaption>domlens · ${r.lensDim}</figcaption><a href="${engine}/${r.name}.domlens.png"><img loading="lazy" src="${engine}/${r.name}.domlens.png"></a></figure>
        <figure><figcaption>diff — rojo: difieren · naranja: tamaño</figcaption><a href="${engine}/${r.name}.diff.png"><img loading="lazy" src="${engine}/${r.name}.diff.png"></a></figure>
      </div>
    </details>`
  }).join('\n')
  return `<section><h2>${engine} — ${rows.length} demos comparados, ${skipped} salteados (red) · ${summary.when}</h2>${cards}</section>`
}).join('\n')

const html = `<!doctype html><meta charset="utf-8"><title>domlens vs snapdom — demo corpus</title>
<style>
  body{margin:0;padding:24px;font:14px/1.5 -apple-system,system-ui,sans-serif;background:#f4f4ef;color:#1c1e1a}
  h1{margin:0 0 4px;font-size:22px} h2{font-size:15px;color:#555;font-weight:600}
  .demo{background:#fff;border:1px solid #ddd;border-radius:8px;margin:10px 0;padding:0 12px}
  .demo>summary{cursor:pointer;padding:10px 0;display:flex;gap:14px;align-items:baseline}
  .pct{font-weight:700;font-variant-numeric:tabular-nums}
  .pct.bad{color:#b3261e}.pct.warn{color:#9a6a00}.pct.ok{color:#2e7d32}
  .demo.bad{border-left:4px solid #b3261e}.demo.warn{border-left:4px solid #d9a400}.demo.ok{border-left:4px solid #9dbb9f}
  .dim{color:#b3261e;font-size:12px}.live{color:#777;font-size:12px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:0 0 12px}
  figure{margin:0;min-width:0}figcaption{font-size:12px;color:#666;margin-bottom:4px}
  img{max-width:100%;border:1px solid #e2e2dc;background:
      repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 0 0/16px 16px}
</style>
<h1>domlens 0.1.0 vs snapdom v3 — corpus real de demos</h1>
<p>Referencia: la captura de snapdom (71/71 pixel-idéntica a v2 shipped + baselines por engine).
Ordenado por divergencia. Click en una imagen = tamaño completo.</p>
${sections}`
writeFileSync(join(ROOT, 'index.html'), html)
console.log('report: ' + join(ROOT, 'index.html'))
