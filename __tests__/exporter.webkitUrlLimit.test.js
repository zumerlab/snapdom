// WebKit refuses to load a URL longer than 2^26 characters (67,108,864), and every raster
// export decodes the capture from an svg data: URL. langgenius/dify#46085 hit that limit at
// about 21 workflow nodes with html-to-image, which copies every computed property, design
// token custom properties included, onto every cloned element: 3.2 MB of URL per node.
// snapdom leaves custom properties out of the style snapshot, resolves inline var() to its
// computed value and shares style classes between equal nodes, so the same shape of page
// stays far from the limit. Measured 2026-11-12 on this fixture, encoded URL length:
//
//   nodes   chromium   firefox    webkit
//      20     77,525    70,732    85,573
//     150    420,325   389,716   522,092
//     300    792,742   734,833 1,026,326   (1.5% of the limit)
//
// Real Safari 27.0.1 drew a 300-node page of this shape from a 1.30 MB URL (bench outside
// the repo, 1.28 MB in Playwright's WebKit). WebKit is the largest because
// internInlineStyles is off there. The budget below is 6.5 times the WebKit number: tokens
// written inline on every node (they are then author styles and travel) measured 11.8 MB
// at 300 nodes and fail it.
import { describe, test, expect, afterEach } from 'vitest'
import { server } from 'vitest/browser'
import { snapdom } from '../src/index'

const ENGINE = server?.browser || 'unknown'
const WEBKIT_URL_LIMIT = 2 ** 26
const BUDGET = WEBKIT_URL_LIMIT / 10
const COLS = 12
let mounted = []
afterEach(() => { for (const el of mounted) el.remove(); mounted = [] })

/** A workflow canvas in Dify's shape: 900 tokens on :root, cards on a 300x200 grid, and
 *  edges whose only colour is an inline var(). Returns the viewport and the first edge. */
function mountWorkflow(n) {
  let tokens = ':root{'
  for (let i = 0; i < 450; i++) tokens += `--wf-color-${i}:hsl(${(i * 37) % 360} 70% ${40 + i % 30}%);--wf-space-${i}:${i}px;`
  const style = document.createElement('style')
  style.textContent = tokens + '}' +
    '.wf-viewport{position:relative;background:var(--wf-color-449);font:13px/1.4 Arial,sans-serif}' +
    '.wf-edges svg{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}' +
    '.wf-node{position:absolute;width:240px;box-sizing:border-box;border:1px solid var(--wf-color-11);' +
    'border-radius:var(--wf-space-8);background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.18)}' +
    '.wf-node header{padding:var(--wf-space-6) var(--wf-space-10);background:#fff;color:#000;font-weight:700}' +
    '.wf-node li{display:flex;justify-content:space-between;border-bottom:1px dashed var(--wf-color-29)}' +
    '.wf-node ul{list-style:none;margin:0;padding:var(--wf-space-6) var(--wf-space-10)}'
  const viewport = document.createElement('div')
  viewport.className = 'wf-viewport'
  const rows = Math.ceil(n / COLS)
  viewport.style.cssText = `width:${Math.min(n, COLS) * 300}px;height:${rows * 200}px`
  let nodes = ''
  let edges = ''
  for (let i = 0; i < n; i++) {
    const x = 30 + (i % COLS) * 300
    const y = 30 + Math.floor(i / COLS) * 200
    nodes += `<div class="wf-node" style="transform: translate(${x}px, ${y}px); z-index: 0;">` +
      `<header>Node ${i}</header><ul>` +
      [0, 1, 2, 3].map(r => `<li><span>field_${r}</span><b>${(i * 7 + r) % 100}</b></li>`).join('') +
      '</ul></div>'
    if ((i + 1) % COLS && i + 1 < n) {
      edges += `<svg style="z-index: 0;"><path style="stroke: var(--wf-color-${i % 60}); stroke-width: 6;" fill="none" ` +
        `d="M${x + 240},${y + 60} L${x + 300},${y + 60}"/></svg>`
    }
  }
  viewport.innerHTML = `<div class="wf-edges">${edges}</div>${nodes}`
  document.body.append(style, viewport)
  mounted.push(style, viewport)
  return viewport
}

const rgb = (d, i) => [d[i], d[i + 1], d[i + 2]]

describe(`token-heavy workflow stays under WebKit's URL limit [${ENGINE}]`, () => {
  test.each([20, 150, 300])('%i nodes', async (n) => {
    const viewport = mountWorkflow(n)
    const edge = viewport.querySelector('path')
    const live = getComputedStyle(edge).stroke.match(/\d+/g).map(Number)
    const res = await snapdom(viewport, { dpr: 2, burst: false })
    expect(res.url.startsWith('data:image/svg+xml')).toBe(true)
    expect(res.url.length).toBeLessThan(BUDGET)
    // The tokens never travel: an inline var() is resolved, the rest is left out.
    expect(res.url).not.toContain('--wf-')

    const canvas = await res.toCanvas()
    expect(canvas.width).toBe(viewport.offsetWidth * 2)
    expect(canvas.height).toBe(viewport.offsetHeight * 2)
    const ctx = canvas.getContext('2d')
    // Centre of the first edge, a 6px stroke between node 0 and node 1.
    const stroke = rgb(ctx.getImageData((30 + 270) * 2, (30 + 60) * 2, 1, 1).data, 0)
    for (let c = 0; c < 3; c++) expect(Math.abs(stroke[c] - live[c])).toBeLessThanOrEqual(2)
    // Black header text of the LAST node on its white header, so the whole canvas drew.
    const last = n - 1
    const hx = (30 + (last % COLS) * 300) * 2
    const hy = (30 + Math.floor(last / COLS) * 200) * 2
    const header = ctx.getImageData(hx + 20, hy + 10, 200, 40).data
    let ink = 0
    for (let i = 0; i < header.length; i += 4) if (header[i] < 80 && header[i + 1] < 80 && header[i + 2] < 80) ink++
    expect(ink).toBeGreaterThan(40)
  }, 120_000)
})
