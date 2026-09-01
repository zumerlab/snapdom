// __tests__/category.libs.js
// Shared, SIDE-EFFECT-FREE surface for the category comparison: the library adapters and the
// scenario builders. Importing a *.benchmark.js file from a test executes its top-level
// bench() calls, which throw "bench() is only available in benchmark mode" and take the whole
// test file down with them — so anything both a bench and a test need lives here instead.
//
// Every adapter has the same signature, (el) => Promise<pngDataUrl>, and every library is
// called with its DEFAULTS at scale 1, so the comparison is like-for-like.

import { snapdom } from '../src/index'
import * as htmlToImage from 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/+esm'
import { domToPng } from 'https://cdn.jsdelivr.net/npm/modern-screenshot@4.7.0/+esm'
import * as d2iMore from 'https://cdn.jsdelivr.net/npm/dom-to-image-more@3.10.2/+esm'
import * as d2i from 'https://cdn.jsdelivr.net/npm/dom-to-image@2.6.0/+esm'
import * as d2iModern from 'https://cdn.jsdelivr.net/npm/dom-to-image-modern@1.0.2/+esm'
import { capture as domlensCapture } from 'https://cdn.jsdelivr.net/npm/domlens.js@0.1.0/+esm'
import { screenshot as renounScreenshot } from 'https://cdn.jsdelivr.net/npm/@renoun/screenshot@0.3.3/+esm'

let html2canvasLoaded = false
export async function loadHtml2Canvas() {
  if (html2canvasLoaded) return
  await new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'
    script.onload = () => resolve()
    script.onerror = reject
    document.head.appendChild(script)
  })
  html2canvasLoaded = true
}
await loadHtml2Canvas()

const pick = (m) => (m.default && typeof m.default === 'object' ? m.default : m)

// Normalize any library output (data URL | <img> | <canvas> | Blob) to a PNG data URL,
// so every caller ends at the same stage.
export async function toDataUrl(out) {
  if (typeof out === 'string') return out
  if (out?.tagName === 'IMG') return out.src
  if (out?.tagName === 'CANVAS') return out.toDataURL('image/png')
  if (out instanceof Blob) return await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(out) })
  if (out && typeof out.toPng === 'function') return toDataUrl(await out.toPng())
  throw new Error('unrecognized capture output')
}

export const LIBS = {
  // burst:false is load-bearing for FAIRNESS. tinybench runs each library's iterations
  // against the same mounted element, and snapdom's auto-burst memoizes after 3 captures of
  // one element inside 2s — so from iteration 3 the "pipeline" column was the memo while
  // every competitor ran its full pipeline. The memo is a real product win, but it is
  // measured honestly in session.static.benchmark.js under its own label; this table claims
  // steady-state PIPELINE cost, so it must pin the pipeline.
  'snapDOM current': async (el) => toDataUrl(await snapdom.toPng(el, { scale: 1, burst: false })),
  'html2canvas 1.4.1': async (el) => toDataUrl(await window.html2canvas(el, { logging: false, scale: 1 })),
  'html-to-image 1.11.13': async (el) => toDataUrl(await htmlToImage.toPng(el, { pixelRatio: 1 })),
  'modern-screenshot 4.7.0': async (el) => toDataUrl(await domToPng(el, { scale: 1 })),
  'dom-to-image-more 3.10.2': async (el) => toDataUrl(await pick(d2iMore).toPng(el, { scale: 1 })),
  'dom-to-image 2.6.0': async (el) => toDataUrl(await pick(d2i).toPng(el, { scale: 1 })),
  'dom-to-image-modern 1.0.2': async (el) => toDataUrl(await pick(d2iModern).toPng(el, { scale: 1 })),
  'domlens.js 0.1.0': async (el) => toDataUrl(await domlensCapture(el, { scale: 1 })),
  '@renoun/screenshot 0.3.3': async (el) => toDataUrl(await renounScreenshot.canvas(el, { scale: 1 })),
}

// ── Scenarios ───────────────────────────────────────────────────────────────

export function complexCardHTML() {
  let items = ''
  for (let i = 0; i < 12; i++) {
    items += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px dashed #d8d6cc">
      <div style="width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 30% 30%, #ff8800, #cc00cc);box-shadow:0 2px 6px rgba(0,0,0,.25)"></div>
      <div style="flex:1"><b style="letter-spacing:.02em">Item ${i} 🚀</b><br><span style="color:#6b7069;font-size:11px">detail with <i>emphasis</i> and <code style="background:#eee;border-radius:3px;padding:0 3px">code</code></span></div>
      <span style="transform:rotate(${i * 3}deg);display:inline-block;background:linear-gradient(135deg,#0f5c48,#0a3d30);color:#fff;border-radius:10px;padding:2px 8px;font-size:10px">tag${i}</span>
    </div>`
  }
  return `<div class="hero" style="position:relative;border-radius:14px;padding:18px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.15);border:1px solid #d8d6cc">
    <h2 style="margin:0 0 4px">Complex card</h2>
    <svg width="80" height="24" viewBox="0 0 80 24" style="display:block;margin:4px 0"><rect x="0" y="4" width="80" height="16" rx="8" fill="#0f5c48"/><circle cx="14" cy="12" r="6" fill="#ff8800"/><text x="28" y="16" font-size="10" fill="#fff">inline svg</text></svg>
    <div style="transform:rotate(-1.5deg) scale(.98);border:2px solid #0f5c48;border-radius:10px;overflow:hidden;background:linear-gradient(180deg,#fff,#f4f4ee)">${items}</div>
    <p style="margin:10px 0 0;column-count:2;column-gap:14px;font-size:11px">Two-column text to force non-trivial layout. Shadows, gradients, transforms, inline SVG, emoji and mixed typography in one viewport-sized subtree.</p>
  </div>`
}

export function bigTableHTML(rows = 500) {
  let trs = ''
  for (let i = 0; i < rows; i++) {
    trs += `<tr style="background:${i % 2 ? '#f4f4ee' : '#fff'}"><td style="padding:4px 8px;border:1px solid #d8d6cc;font-weight:600">#${i}</td><td style="padding:4px 8px;border:1px solid #d8d6cc;color:#0f5c48">item-${(i * 7919) % 10000}</td><td style="padding:4px 8px;border:1px solid #d8d6cc;background:linear-gradient(90deg,#e8e8e0,#fff)">${(i * 13.37).toFixed(2)}</td><td style="padding:4px 8px;border:1px solid #d8d6cc"><span style="border-radius:8px;background:#a85e00;color:#fff;padding:1px 6px">tag${i % 9}</span></td></tr>`
  }
  return `<table style="border-collapse:collapse;width:100%">${trs}</table>`
}

export const SCENARIOS = [
  { label: 'Complex card (viewport)', width: 520, html: complexCardHTML(), opts: { warmupIterations: 2, iterations: 8, time: 0 } },
  { label: 'Big table (500 rows, ~11.5k px tall)', width: 640, html: bigTableHTML(500), opts: { warmupIterations: 1, iterations: 3, time: 0 } },
  { label: 'Simple node, page view (1200x800)', width: 1200, height: 800, html: '<h1>Page view (1200x800)</h1>', opts: { warmupIterations: 2, iterations: 8, time: 0 } },
]
