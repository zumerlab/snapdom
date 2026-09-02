// The identity share asks a SUBTREE question, not a document one (styleShareSafe). A
// selector that could split identical twins — `:hover`, `:first-child`, `p + p` — sits in
// every real page's CSS, and a document-wide flag turned the fast path off everywhere it
// mattered: the docs site's `.btn:hover` cost a 500-row table 536k computed-style reads
// instead of 77k (150 ms → 73 ms pipeline). A rule that matches nothing under the capture
// root at capture time styles nobody the snapshot will read, so twins stay identical.
//
// Proven to fail: reverting styleShareSafe to the document flag turns the first test red
// (the read counts come out equal); dropping the querySelector half turns the second red.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { flushStyleInvalidations } from '../src/modules/styles.js'
import { bigTableHTML } from './category.libs.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mountCSS(css) {
  const st = document.createElement('style')
  st.textContent = css
  document.head.appendChild(st)
  mounted.push(st)
}

function mountTable() {
  const el = document.createElement('div')
  el.style.cssText = 'width:640px;font-family:Arial,sans-serif;font-size:13px'
  el.innerHTML = bigTableHTML(60)
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

async function settle() {
  await new Promise((r) => setTimeout(r, 0))
  flushStyleInvalidations()
}

/** Computed-style reads issued by one capture, and its payload. */
async function readsOf(el, opts) {
  const proto = CSSStyleDeclaration.prototype
  const orig = proto.getPropertyValue
  let n = 0
  proto.getPropertyValue = function (...a) { n++; return orig.apply(this, a) }
  try {
    const url = await snapdom.toRaw(el, { burst: false, ...opts })
    return { n, url }
  } finally {
    proto.getPropertyValue = orig
  }
}

describe('identity share — subtree gate', () => {
  it('a splitting selector that matches nothing under the root keeps the share ON', async () => {
    // Host-page CSS shape: state and structural selectors scoped to classes the captured
    // subtree does not contain.
    mountCSS('.btn:hover{color:red} .section-label:first-child{margin:0} .faq details p + p{margin-top:1em} .card:has(img){padding:0}')
    // A FRESH element per arm: the per-node snapshot cache would otherwise serve the
    // second arm from the first and both counts would be the warm count.
    const a = mountTable()
    await settle()
    const on = await readsOf(a, {})
    a.remove()
    const b = mountTable()
    await settle()
    const off = await readsOf(b, { __styleShare: false })
    // Same bytes, far fewer reads: the share ran.
    expect(on.url).toBe(off.url)
    expect(on.n).toBeLessThan(off.n / 2)
  })

  it('a splitting selector that matches INSIDE the root turns the share off', async () => {
    mountCSS('.btn:hover{color:red} tr:first-child td{color:rgb(1,2,3)}')
    const a = mountTable()
    await settle()
    const on = await readsOf(a, {})
    a.remove()
    const b = mountTable()
    await settle()
    const off = await readsOf(b, { __styleShare: false })
    expect(on.url).toBe(off.url)
    // Not the ~4x collapse the share produces: the full-read path ran in both arms (the
    // arms differ by a handful of once-per-capture reads, hence a ratio, not equality).
    expect(on.n).toBeGreaterThan(off.n * 0.9)
  })

  it('the root itself is part of the question', async () => {
    mountCSS('div.root-g:first-child{color:rgb(1,2,3)}')
    const wrap = document.createElement('div')
    wrap.innerHTML = '<div class="root-g"><span>a</span><span>a</span></div>'
    document.body.appendChild(wrap)
    mounted.push(wrap)
    const el = wrap.firstElementChild
    await settle()
    const on = await readsOf(el, {})
    const wrap2 = wrap.cloneNode(true)
    document.body.appendChild(wrap2)
    mounted.push(wrap2)
    await settle()
    const off = await readsOf(wrap2.firstElementChild, { __styleShare: false })
    expect(on.n).toBeGreaterThan(off.n * 0.9)
  })
})
