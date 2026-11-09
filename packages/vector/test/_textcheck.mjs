// Two things no fixture exercises: text-shadow (collectBox emits `textEffects`,
// which index.js drops) and a raised run's `dy`. Both must be DECLARED, not silent.
import { chromium } from 'playwright'
const b = await chromium.launch(); const c = await b.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1}); const p = await c.newPage()
p.on('pageerror', e=>console.log('[pageerror]', e.message))
await p.goto('http://localhost:4321/demo/vector.html', {waitUntil:'load'})
await p.waitForFunction('window.__ready === true')
console.log(JSON.stringify(await p.evaluate(async ()=>{
  const { snapdom } = await import('@zumer/snapdom')
  const { vector, svdToSvg, svdToFigma } = await import('/src/index.js')
  const toVector = async (el, opts) => (await snapdom(el, { plugins: [vector(opts)] })).toVector()
  const host = document.createElement('div')
  host.style.cssText='position:absolute;left:0;top:0;width:420px;background:#fff;font:16px/1.5 Arial;padding:12px'
  host.innerHTML = `<p id="tsh" style="text-shadow: 0 2px 4px rgba(220,38,38,.8), 0 0 1px #0af">Sombra sobre las letras</p>
    <p id="sup">H<sub>2</sub>O y E=mc<sup>2</sup> en una línea</p>`
  document.body.appendChild(host)
  const doc = await toVector(host, { mode:'design' })
  const out = { nodes:Object.keys(doc.nodes).length, textShadow:{}, sup:{} }
  // text-shadow: is it declared anywhere?
  const hits = (doc.diagnostics||[]).filter(d=>/text-shadow/i.test(d.message||''))
  out.textShadow.diagnostics = hits.map(d=>({code:d.code, grade:d.grade, severity:d.severity, msg:(d.message||'').slice(0,110)}))
  out.textShadow.anyEffectEmitted = Object.values(doc.nodes).some(n=>(n.effects||[]).length)
  // dy: did any run keep a nonzero baseline offset?
  const dys=[]
  for (const [id,n] of Object.entries(doc.nodes)) {
    const t=n.text; if(!t) continue
    for (const r of t.runs||[]) if (r.dy) dys.push({id, dy:+r.dy.toFixed(3), text:t.characters.slice(r.start,r.end)})
  }
  out.sup.runsWithDy = dys
  out.sup.lineCount = Object.values(doc.nodes).filter(n=>n.text&&/H/.test(n.text.characters)).map(n=>n.text.lines.length)
  const svg = svdToSvg(doc, {})
  out.sup.svgHasDy = /<tspan[^>]*\bdy=/.test(svg.svg)
  const fig = svdToFigma(doc)
  out.sup.figmaHasBaselineShift = JSON.stringify(fig.nodes).includes('aselineShift') || JSON.stringify(fig.nodes).includes('OffsetType')
  out.svgDiagCodes = [...new Set((svg.diagnostics||[]).map(d=>d.code))]
  host.remove()
  return out
}), null, 2))
await b.close()
