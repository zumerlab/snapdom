/**
 * Regression: CSS background-images were intermittently dropped when the captured tree
 * contained same-origin iframes.
 *
 * Sibling iframes rasterize concurrently; each nested capture's applyCachePolicy reassigns
 * the global cache.session.nodeMap, and the interleaved save/restore in rasterizeIframe
 * could leave the global pointing at an orphaned nested map. inlineBackgroundImages then
 * resolved clone→source through that empty map and skipped every background outside the
 * iframes. Post-clone passes now receive the capture's own nodeMap reference (threaded
 * from prepareClone through captureDOM), so the global's state no longer matters.
 *
 * Repro notes: backgrounds must come from a stylesheet rule with an http(s) URL — inline
 * style attributes are copied by cloneNode and blob:/data: URLs are handled by other
 * passes, both of which mask the bug. Asymmetric iframe content staggers the nested
 * captures the way real pages do; with fast:false this failed 19/20 runs before the fix.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='

/** Find a same-origin http URL the vitest server serves with 200 (content type is
 *  irrelevant — inlineSingleBackgroundEntry data-URLs any 200 response). */
async function findFetchableUrl() {
  const candidates = ['/README.md', '/package.json', '/index.html']
  for (const c of candidates) {
    try {
      const r = await fetch(c)
      if (r.ok) return new URL(c, location.origin).href
    } catch { /* try next */ }
  }
  throw new Error('no fetchable same-origin URL found for the background fixture')
}

let mounted = []
afterEach(() => {
  mounted.forEach((el) => el.remove())
  mounted = []
})

function makeContainer(bgUrl, iframeCount) {
  const style = document.createElement('style')
  style.textContent = `.snapbg-race { background-image: url("${bgUrl}"); background-size: cover; }`
  document.head.appendChild(style)
  mounted.push(style)

  const container = document.createElement('div')
  container.style.cssText = 'width:320px;padding:8px;background:#fff'
  for (let i = 0; i < 3; i++) {
    const d = document.createElement('div')
    d.className = 'snapbg-race'
    d.style.cssText = 'width:60px;height:40px;'
    d.textContent = `bg${i}`
    container.appendChild(d)
  }
  const frames = []
  for (let i = 0; i < iframeCount; i++) {
    const f = document.createElement('iframe')
    f.style.cssText = 'width:80px;height:50px;border:0'
    container.appendChild(f)
    const sp = document.createElement('div')
    sp.textContent = 'x'.repeat(50)
    container.appendChild(sp)
    frames.push(f)
  }
  document.body.appendChild(container)
  mounted.push(container)
  frames.forEach((f, i) => {
    const doc = f.contentDocument
    doc.open()
    if (i === 0) {
      // heavy iframe: many nodes + an image decode, so its nested capture overlaps the others
      let inner = `<img src="${TINY_PNG}" style="width:20px;height:20px" alt="">`
      for (let k = 0; k < 120; k++) inner += `<span style="color:rgb(${k},0,0)">s${k}</span>`
      doc.write(`<html><body style="margin:0">${inner}</body></html>`)
    } else {
      doc.write(
        `<html><body style="margin:0"><div style="width:100%;height:100%;background:teal">f${i}</div></body></html>`
      )
    }
    doc.close()
  })
  return container
}

/** count of nodes in the output SVG whose inline style has a data: background-image */
function countInlinedBackgrounds(dataUrl) {
  const svgText = decodeURIComponent(dataUrl.split(',').slice(1).join(','))
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  let count = 0
  for (const el of doc.querySelectorAll('[style]')) {
    const s = el.getAttribute('style') || ''
    if (/background-image:\s*url\(["']?data:/.test(s)) count++
  }
  return count
}

describe('background-image inlining races with same-origin iframe rasterization', () => {
  for (const fast of [true, false]) {
    it(`fast:${fast} — backgrounds survive 3 concurrent same-origin iframes (6 runs)`, async () => {
      const bgUrl = await findFetchableUrl()
      for (let run = 0; run < 6; run++) {
        const container = makeContainer(bgUrl, 3)
        const res = await snapdom(container, { fast })
        const inlined = countInlinedBackgrounds(res.url)
        mounted.forEach((el) => el.remove())
        mounted = []
        expect(inlined, `fast:${fast} run ${run}`).toBe(3)
      }
    }, 60000)
  }
})
