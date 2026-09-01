// Builds __snapshots__/competitor-compare/index.html from the artifacts the gated
// visual.competitors.compare.test.js run wrote: per demo and competitor, what snapdom
// captured, what the competitor captured, and the painted diff (red = disagreement,
// orange = size mismatch banding).
// Run:  node scripts/report-competitors.mjs  (after VITE_COMPETITOR_COMPARE=1 npx vitest run ...)
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(process.cwd(), '__snapshots__', 'competitor-compare')
if (!existsSync(ROOT)) { console.error('no competitor-compare artifacts; run the gated suite first'); process.exit(1) }
const engines = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)

const sections = engines.map((engine) => {
  const summary = JSON.parse(readFileSync(join(ROOT, engine, 'summary.json'), 'utf8'))
  const rows = summary.rows.filter((r) => r.pct !== undefined).sort((a, b) => b.pct - a.pct)
  const netCount = summary.rows.filter((r) => r.net).length
  const cards = rows.map((r) => {
    const lib = r.lib || 'domlens'
    const compPng = `${engine}/${r.name}.${lib}.png`
    const diffPng = r.lib ? `${engine}/${r.name}.${lib}.diff.png` : `${engine}/${r.name}.diff.png`
    const badge = r.pct >= 5 ? 'bad' : r.pct >= 1 ? 'warn' : 'ok'
    return `<details class="demo ${badge}" ${r.pct >= 5 ? 'open' : ''}>
      <summary><b>${r.name}</b><span class="lib">${lib}</span><span class="pct ${badge}">${r.pct.toFixed(2)}%</span>
        ${r.dim ? `<span class="dim">size: ${r.dim}</span>` : ''}${r.net ? '<span class="net">net</span>' : ''}<span class="live">live: ${r.live}</span></summary>
      <div class="grid">
        <figure><figcaption>snapdom · ${r.snapDim}</figcaption><a href="${engine}/${r.name}.snapdom.png"><img loading="lazy" src="${engine}/${r.name}.snapdom.png"></a></figure>
        <figure><figcaption>${lib} · ${r.lensDim}</figcaption><a href="${compPng}"><img loading="lazy" src="${compPng}"></a></figure>
        <figure><figcaption>diff — rojo: difieren · naranja: tamaño</figcaption><a href="${diffPng}"><img loading="lazy" src="${diffPng}"></a></figure>
      </div>
    </details>`
  }).join('\n')
  return `<section><h2>${engine} — ${rows.length} demos comparados (${netCount} dependen de red) · ${summary.when}</h2>${cards}</section>`
}).join('\n')

const html = `<!doctype html><meta charset="utf-8"><title>competitors vs snapdom — demo corpus</title>
<style>
  body{margin:0;padding:24px;font:14px/1.5 -apple-system,system-ui,sans-serif;background:#f4f4ef;color:#1c1e1a}
  h1{margin:0 0 4px;font-size:22px} h2{font-size:15px;color:#555;font-weight:600}
  .demo{background:#fff;border:1px solid #ddd;border-radius:8px;margin:10px 0;padding:0 12px}
  .demo>summary{cursor:pointer;padding:10px 0;display:flex;gap:14px;align-items:baseline}
  .pct{font-weight:700;font-variant-numeric:tabular-nums}
  .pct.bad{color:#b3261e}.pct.warn{color:#9a6a00}.pct.ok{color:#2e7d32}
  .demo.bad{border-left:4px solid #b3261e}.demo.warn{border-left:4px solid #d9a400}.demo.ok{border-left:4px solid #9dbb9f}
  .dim{color:#b3261e;font-size:12px}.live{color:#777;font-size:12px}
  .net{background:#e8eaf6;color:#3949ab;font-size:11px;padding:1px 6px;border-radius:8px}
  .lib{background:#f0ede3;color:#6b5d2e;font-size:11px;padding:1px 6px;border-radius:8px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:0 0 12px}
  figure{margin:0;min-width:0}figcaption{font-size:12px;color:#666;margin-bottom:4px}
  img{max-width:100%;border:1px solid #e2e2dc;background:
      repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 0 0/16px 16px}
</style>
<h1>competidores vs snapdom v3 — corpus real de demos</h1>
<p>Referencia: la captura de snapdom (71/71 pixel-idéntica a v2 shipped + baselines por engine).
Ordenado por divergencia. Click en una imagen = tamaño completo.</p>
${sections}`
writeFileSync(join(ROOT, 'index.html'), html)
console.log('report: ' + join(ROOT, 'index.html'))
