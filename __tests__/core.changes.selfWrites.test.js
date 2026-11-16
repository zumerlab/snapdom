// snapdom edits two kinds of page node for the length of a clone and puts them back: the
// text of a clamped box (lineClamp) and the inline style of a content-visibility:auto box.
// Their mutation records are not the page changing, so the capture that follows keeps the
// style snapshot cache, the memo and the differential path. A real edit of the same node
// still counts. The cost is measured in getPropertyValue calls, the call a full snapshot
// read makes once per property, on the third capture of an unchanged page.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { __diffStats } from '../src/core/diff.js'

const mounted = []
afterEach(() => { for (const n of mounted.splice(0)) n.remove() })

const LONG = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(4)
const CLAMP = 'width:200px;margin:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font:14px/18px sans-serif'

/** 30 sections x (1 header + 8 items), about 300 elements, unique classes per scene. */
function body(tag) {
  let html = ''
  for (let s = 0; s < 30; s++) {
    html += `<section class="${tag}-sec" style="padding:2px;border:1px solid #ccc"><h4 class="${tag}-h" style="margin:0;font:12px sans-serif">Section ${s}</h4>`
    for (let i = 0; i < 8; i++) html += `<span class="${tag}-it" style="display:inline-block;padding:1px 3px;color:#333">item ${s}.${i}</span>`
    html += '</section>'
  }
  return html
}

/**
 * where: 'none' | 'direct' (clamped <p> as a direct child of the root) | 'nested' (inside
 * the last section) | 'outside' (sibling of the root) | 'cv' (a content-visibility:auto box
 * as a direct child of the root) | 'fit' (a clamped <p> whose text already fits in two lines,
 * direct child: lineClamp still writes its one-line 'X' probe) | 'cvvisible' (the same box
 * with content-visibility:visible, which nothing writes: a no-write control).
 */
function mountScene(tag, where) {
  const host = document.createElement('div')
  const p = `<p class="${tag}-clamp" style="${CLAMP}">${LONG}</p>`
  const cv = `<div class="${tag}-cv" style="content-visibility:auto;contain-intrinsic-size:auto 20px;width:200px">cv box</div>`
  let inner = body(tag)
  if (where === 'direct') inner = p + inner
  if (where === 'nested') inner = inner.replace(/<\/section>$/, p + '</section>')
  if (where === 'cv') inner = cv + inner
  if (where === 'fit') inner = `<p class="${tag}-clamp" style="${CLAMP}">short</p>` + inner
  if (where === 'cvvisible') inner = cv.replace('content-visibility:auto', 'content-visibility:visible') + inner
  host.innerHTML = `<div class="${tag}-root" style="width:600px;background:#fff">${inner}</div>` + (where === 'outside' ? p : '')
  document.body.appendChild(host)
  mounted.push(host)
  return host.firstChild
}

async function countThirdCapture(where) {
  const tag = `rf${where}${Math.random().toString(36).slice(2, 6)}`
  const root = mountScene(tag, where)
  const view = window
  const orig = view.getComputedStyle
  const proto = CSSStyleDeclaration.prototype
  const origGPV = proto.getPropertyValue
  let calls = 0
  let gpv = 0
  const counts = []
  const reads = []
  const times = []
  for (let k = 0; k < 4; k++) {
    calls = 0
    gpv = 0
    view.getComputedStyle = function (...a) { calls++; return orig.apply(this, a) }
    proto.getPropertyValue = function (...a) { gpv++; return origGPV.apply(this, a) }
    const t0 = performance.now()
    try {
      await snapdom(root, { burst: false, embedFonts: false })
    } finally {
      view.getComputedStyle = orig
      proto.getPropertyValue = origGPV
    }
    times.push(+(performance.now() - t0).toFixed(1))
    counts.push(calls)
    reads.push(gpv)
    // Let the MutationObserver deliver whatever the capture left behind before the next one.
    await new Promise((r) => setTimeout(r, 30))
  }
  return { where, elements: root.querySelectorAll('*').length + 1, counts, reads, times }
}

describe('snapdom\'s own transient edits are not page changes', () => {
  it('a recapture of an unchanged page costs the same with or without a line clamp / cv:auto', async () => {
    const results = []
    for (const where of ['none', 'direct', 'nested', 'outside', 'fit', 'cv', 'cvvisible', 'none']) results.push(await countThirdCapture(where))
    const line = (r) => `${r.where.padEnd(8)} elements=${r.elements} getComputedStyle=${r.counts.join(',')} getPropertyValue=${r.reads.join(',')} ms=${r.times.join(',')}`
    const msg = results.map(line).join('\n')
    console.log(msg)
    // getComputedStyle is called per node on a hit too (it only returns the live object),
    // so the snapshot misses show in getPropertyValue, the call a full snapshot read makes
    // once per property. Third capture (index 2), against the scene without the writer.
    const base = results[0].reads[2]
    for (const r of results) {
      // The writes still move the sequence, so the used values beside them are probed: one
      // margin read per box where the engine has no Typed OM (Firefox, 889 to 1,194). Taken
      // for page changes they cost 12,839.
      expect(Math.abs(r.reads[2] - base) / base, msg).toBeLessThanOrEqual(0.5)
    }
  }, 60000)

  it('a page with a content-visibility:auto box is served by the differential path at once', async () => {
    const root = mountScene('rfdiff', 'cv')
    const O = { scale: 1, dpr: 1, embedFonts: false }
    await snapdom(root, O)
    const leaf = root.querySelector('.rfdiff-it')
    const out = []
    for (let i = 0; i < 3; i++) {
      leaf.textContent = 'edit ' + i
      const served = __diffStats.served
      await snapdom(root, O)
      out.push(__diffStats.served - served)
    }
    expect(out).toEqual([1, 1, 1])
  })

  it('a page edit of a clamped text between two captures is still seen', async () => {
    const root = mountScene('rfedit', 'direct')
    const p = root.querySelector('.rfedit-clamp')
    const width = async () => (await (await snapdom(p, { burst: false, scale: 1, dpr: 1, embedFonts: false })).toCanvas()).height
    const tall = await width()
    p.firstChild.data = 'short'
    expect(await width()).toBeLessThan(tall)
  })
})
