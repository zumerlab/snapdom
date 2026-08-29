// Per-node style invalidation: a mutation invalidates the snapshots a selector could carry it
// to, instead of every snapshot in the document.
//
// The speed is only worth having if the capture still tells the truth, so most of this file is
// about what MUST still be invalidated. Each case mutates the page and asserts the NEXT capture
// carries the new style — a snapshot that survived when it should not shows up here as the old
// colour.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function page(css, html) {
  const sheet = document.createElement('style')
  sheet.textContent = css
  document.head.appendChild(sheet)
  mounted.push(sheet)
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  mounted.push(host)
  return host
}

/** The generated CSS of a capture, as one string. */
async function captureCSS(el) {
  const raw = await snapdom.toRaw(el, { embedFonts: false, burst: false })
  const svg = decodeURIComponent(raw.split(',')[1] || '')
  return [...svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
}

const RED = 'rgb(255, 0, 0)'

describe('what a mutation must still invalidate', () => {
  it('a descendant restyled by a class on its ancestor', async () => {
    const host = page(
      '.inv-parent.hot .inv-child { color: rgb(255, 0, 0) }',
      '<div class="inv-parent"><span class="inv-child">text</span></div>',
    )
    const target = host.querySelector('.inv-parent')
    expect(await captureCSS(target)).not.toContain(RED)
    target.classList.add('hot')
    expect(await captureCSS(target)).toContain(RED)
  })

  it('a sibling restyled through a combinator', async () => {
    const host = page(
      '.inv-a.on + .inv-b { color: rgb(255, 0, 0) }',
      '<div><span class="inv-a">a</span><span class="inv-b">b</span></div>',
    )
    const target = host.firstElementChild
    expect(await captureCSS(target)).not.toContain(RED)
    host.querySelector('.inv-a').classList.add('on')
    expect(await captureCSS(target)).toContain(RED)
  })

  it('a descendant that only inherits the changed value', async () => {
    const host = page(
      '.inv-root.hot { color: rgb(255, 0, 0) }',
      '<div class="inv-root"><span><b>deep</b></span></div>',
    )
    const target = host.firstElementChild
    expect(await captureCSS(target)).not.toContain(RED)
    target.classList.add('hot')
    expect(await captureCSS(target)).toContain(RED)
  })

  it('an ancestor restyled by :has() on what changed inside it', async () => {
    const host = page(
      '.inv-card:has(.inv-badge) { color: rgb(255, 0, 0) }',
      '<div class="inv-card"><span class="inv-slot">card</span></div>',
    )
    const target = host.querySelector('.inv-card')
    expect(await captureCSS(target)).not.toContain(RED)
    const badge = document.createElement('i')
    badge.className = 'inv-badge'
    target.querySelector('.inv-slot').appendChild(badge)
    expect(await captureCSS(target)).toContain(RED)
  })

  // The case per-node stamping cannot walk to, and the reason a :has() document keeps
  // document-wide invalidation: the mutation is in one subtree and the restyle lands in
  // another.
  it('a cousin restyled by :has() from a subtree it is not in', async () => {
    const host = page(
      '.inv-w:has(.inv-flag) ~ .inv-cousin { color: rgb(255, 0, 0) }',
      '<div><div class="inv-w"><span class="inv-hole"></span></div><div class="inv-cousin">cousin</div></div>',
    )
    const target = host.firstElementChild
    expect(await captureCSS(target)).not.toContain(RED)
    const flag = document.createElement('i')
    flag.className = 'inv-flag'
    host.querySelector('.inv-hole').appendChild(flag)
    expect(await captureCSS(target)).toContain(RED)
  })

  it('a theme flip written on <html>', async () => {
    const host = page(
      'html.inv-dark .inv-themed { color: rgb(255, 0, 0) }',
      '<div class="inv-themed">themed</div>',
    )
    const target = host.firstElementChild
    expect(await captureCSS(target)).not.toContain(RED)
    document.documentElement.classList.add('inv-dark')
    try {
      expect(await captureCSS(target)).toContain(RED)
    } finally {
      document.documentElement.classList.remove('inv-dark')
    }
  })

  it('a rule added to the document afterwards', async () => {
    const host = page('', '<div class="inv-late">late</div>')
    const target = host.firstElementChild
    expect(await captureCSS(target)).not.toContain(RED)
    const late = document.createElement('style')
    late.textContent = '.inv-late { color: rgb(255, 0, 0) }'
    document.head.appendChild(late)
    mounted.push(late)
    expect(await captureCSS(target)).toContain(RED)
  })

  it('an interaction that restyles without mutating (:checked)', async () => {
    const host = page(
      '.inv-box:checked + label { color: rgb(255, 0, 0) }',
      '<div><input type="checkbox" class="inv-box" id="invbox"><label for="invbox">label</label></div>',
    )
    const target = host.firstElementChild
    expect(await captureCSS(target)).not.toContain(RED)
    const box = host.querySelector('.inv-box')
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))
    expect(await captureCSS(target)).toContain(RED)
  })

  it('a CSSOM edit no observer reports, through the invalidate escape hatch', async () => {
    const host = page('.inv-cssom { color: rgb(0, 0, 255) }', '<div class="inv-cssom">cssom</div>')
    const target = host.firstElementChild
    expect(await captureCSS(target)).toContain('rgb(0, 0, 255)')
    const sheet = mounted.find((n) => n.tagName === 'STYLE').sheet
    sheet.cssRules[0].style.color = 'rgb(255, 0, 0)'
    const raw = await snapdom.toRaw(target, { embedFonts: false, burst: false, invalidate: true })
    const css = decodeURIComponent(raw.split(',')[1] || '')
    expect(css).toContain(RED)
  })
})

describe('what a mutation must NOT cost', () => {
  /** Computed-property reads during one capture. Counted at getPropertyValue rather than at
   *  getComputedStyle: the caller resolves the declaration once per node either way, and it is
   *  the ~200 property reads behind it that a surviving snapshot saves. */
  async function readsFor(el) {
    const proto = CSSStyleDeclaration.prototype
    const real = proto.getPropertyValue
    let calls = 0
    proto.getPropertyValue = function (...args) { calls++; return real.apply(this, args) }
    try {
      await snapdom(el, { embedFonts: false, burst: false })
      return calls
    } finally {
      proto.getPropertyValue = real
    }
  }

  it('a mutation in an unrelated component does not re-read the captured subtree', async () => {
    const host = page(
      '.inv-perf span { padding: 2px }',
      '<div class="inv-perf">' + '<span>row</span>'.repeat(30) + '</div>' +
      '<div class="inv-other"><span>unrelated</span></div>',
    )
    const target = host.querySelector('.inv-perf')
    await readsFor(target)                        // warm the snapshots
    const warm = await readsFor(target)
    host.querySelector('.inv-other span').textContent = 'changed'
    const afterForeign = await readsFor(target)
    // Some reads are per-capture by construction (the root, the clone's own passes); what must
    // not happen is the whole subtree going cold again — that is thousands of reads, not tens.
    expect(afterForeign).toBeLessThan(warm * 1.5)
  })

  it('but a :has() document keeps the document-wide invalidation', async () => {
    const host = page(
      '.inv-has:has(.nothing) { color: rgb(255, 0, 0) } .inv-perf2 span { padding: 2px }',
      '<div class="inv-perf2">' + '<span>row</span>'.repeat(30) + '</div>' +
      '<div class="inv-other2"><span>unrelated</span></div>',
    )
    const target = host.querySelector('.inv-perf2')
    await readsFor(target)
    const warm = await readsFor(target)
    host.querySelector('.inv-other2 span').textContent = 'changed'
    const afterForeign = await readsFor(target)
    expect(afterForeign).toBeGreaterThan(warm * 2)
  })
})
