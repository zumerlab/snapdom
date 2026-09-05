/**
 * Regressions from the v3 pre-release review (2026-08-15). Every test here failed against
 * the code as it stood; each pins one invariant the browser suite had no coverage for.
 *
 * They live together on purpose: the common thread is that the pipeline touches, observes
 * or remembers something OUTSIDE the clone it is building — the live tree, a second
 * document, a previous capture — and every bug below is that reach going wrong.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { lineClamp, textEllipsis } from '../src/modules/lineClamp.js'
import { htmlExport } from '../packages/plugins/html-export.js'
import { toImg } from '../src/exporters/toImg.js'
import { embedCustomFonts } from '../src/modules/fonts.js'
import { cache } from '../src/core/cache.js'

afterEach(() => { document.body.innerHTML = '' })

const settle = () => new Promise((r) => setTimeout(r, 0))

/* ────────────────────────────────────────────────────────────────────────────
 * 1. The clamp bake must not overwrite the page's own edits
 * ──────────────────────────────────────────────────────────────────────────── */

describe('lineClamp undo does not clobber concurrent DOM writes', () => {
  function clamped(text) {
    const el = document.createElement('div')
    el.style.cssText = 'width:80px;font:14px/18px Arial;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden'
    el.textContent = text
    document.body.appendChild(el)
    return el
  }

  const LONG = 'The quick brown fox jumps over the lazy dog and keeps running far past it'

  it('restores the original text when nothing else touched the node', () => {
    const el = clamped(LONG)
    const undo = lineClamp(el)
    expect(el.textContent).not.toBe(LONG)   // control: the bake actually happened
    expect(el.textContent.endsWith('…')).toBe(true)
    undo()
    expect(el.textContent).toBe(LONG)
  })

  it('leaves the new text alone when the app wrote to the node mid-capture', () => {
    const el = clamped(LONG)
    const undo = lineClamp(el)
    expect(el.textContent.endsWith('…')).toBe(true)
    // The app updates the very node the capture is holding — this is the window between
    // the bake and the undo, which spans an await in the real pipeline.
    el.textContent = 'LIVE UPDATE'
    undo()
    expect(el.textContent).toBe('LIVE UPDATE')
  })

  it('applies the same rule to the single-line ellipsis path', () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:60px;font:14px Arial;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
    el.textContent = LONG
    document.body.appendChild(el)
    const undo = textEllipsis(el)
    expect(el.textContent.endsWith('…')).toBe(true)
    el.textContent = 'LIVE UPDATE'
    undo()
    expect(el.textContent).toBe('LIVE UPDATE')
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Burst must not publish a frame that changed while it was being built
 * ──────────────────────────────────────────────────────────────────────────── */

describe('burst does not commit a memo torn by a record-less event', () => {
  /**
   * Firing the event from the test body would land BEFORE the capture starts — snapdom()
   * defers the real work to a microtask — and an edit before the capture is not torn at
   * all, it is just the next frame. `beforeRender` is unambiguously mid-capture, which is
   * where the dropped events actually arrived. `pure: true` keeps burst engaged; the hook
   * mutates nothing itself.
   */
  function trigger() {
    let armed = null
    return {
      plugin: { name: 'mid-capture-trigger', pure: true, beforeRender() { if (armed) { armed(); armed = null } } },
      arm(fn) { armed = fn },
    }
  }

  /** The memo engages on the first capture; three settled captures leave it warm. */
  async function engageBurst(el, plugins) {
    for (let i = 0; i < 3; i++) { await snapdom(el, { plugins }); await settle() }
  }

  /** A memo hit returns before the pipeline runs — no hooks, nothing to arm. Dirty the
   *  element so the next capture is a REAL one that the mid-capture event can tear. */
  let seq = 0
  const dirty = (el) => el.setAttribute('data-dirty', String(++seq))

  it('an input edit during the capture invalidates the memo', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:200px;padding:8px;background:#fff;font:14px Arial'
    const input = document.createElement('input')
    input.value = 'OLD'
    host.appendChild(input)
    document.body.appendChild(host)

    const t = trigger()
    const plugins = [t.plugin]
    await engageBurst(host, plugins)

    // Type into the field WHILE the capture is in flight. `input` carries no mutation
    // record at all (value is a property), so this is exactly the event burst dropped.
    dirty(host)
    t.arm(() => {
      input.value = 'NEW'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const during = await snapdom(host, { plugins })

    const after = await snapdom(host, { plugins })
    // The frame `during` was built across the edit, so it must not be republished.
    expect(after).not.toBe(during)
    expect(decodeURIComponent(after.url.split(',')[1])).toContain('NEW')
  })

  it('a scroll during the capture invalidates the memo', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:200px;height:80px;overflow:auto;background:#fff'
    host.innerHTML = '<div style="height:600px;background:linear-gradient(#f00,#00f)"></div>'
    document.body.appendChild(host)

    const t = trigger()
    const plugins = [t.plugin]
    await engageBurst(host, plugins)

    dirty(host)
    t.arm(() => {
      host.scrollTop = 200
      host.dispatchEvent(new Event('scroll'))
    })
    const during = await snapdom(host, { plugins })

    const after = await snapdom(host, { plugins })
    expect(after).not.toBe(during)
  })

  it('still memoizes when nothing happens during the capture', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:120px;height:40px;background:#0a0'
    host.textContent = 'stable'
    document.body.appendChild(host)

    const t = trigger()
    const plugins = [t.plugin]
    await engageBurst(host, plugins)
    const a = await snapdom(host, { plugins })
    const b = await snapdom(host, { plugins })
    // Control: with no torn frame the memo must still be served, or the fix would have
    // just disabled burst and the two tests above would pass for the wrong reason.
    expect(b).toBe(a)
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Same-origin iframes are a second realm AND a second document
 * ──────────────────────────────────────────────────────────────────────────── */

describe('capture inside a same-origin iframe', () => {
  function makeFrame(html) {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'width:300px;height:200px;border:0'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    doc.open()
    doc.write(`<html><head><style id="s">.box{background:#ff0000}</style></head><body style="margin:0">${html}</body></html>`)
    doc.close()
    return { iframe, doc }
  }

  it('captures a form control\'s LIVE value, not its HTML attribute', async () => {
    const { doc } = makeFrame(`
      <div class="box" style="padding:8px;font:14px Arial">
        <input id="i" value="ATTRIBUTE">
        <textarea id="t">ATTRTEXT</textarea>
        <select id="s"><option value="a">A</option><option value="b">B</option></select>
      </div>`)
    const host = doc.getElementById('i').parentElement
    // The live state every one of these differs from the markup.
    doc.getElementById('i').value = 'TYPED'
    doc.getElementById('t').value = 'TYPEDTEXT'
    doc.getElementById('s').value = 'b'

    const res = await snapdom(host)
    const svg = decodeURIComponent(res.url.split(',')[1])
    expect(svg).toContain('TYPED')
    expect(svg).toContain('TYPEDTEXT')
    // A realm-blind `instanceof` skipped these branches entirely and serialized the
    // attribute defaults instead.
    expect(svg).not.toContain('ATTRIBUTE')
  })

  it('sees a stylesheet edit made inside the frame on the next capture', async () => {
    const { doc } = makeFrame('<div class="box" style="width:100px;height:40px"></div>')
    const host = doc.querySelector('.box')

    const first = await snapdom(host)
    expect(decodeURIComponent(first.url.split(',')[1])).toContain('255, 0, 0')

    // Rewriting the rule inside the FRAME produced no epoch bump while the invalidation
    // observers were wired to the parent document only, so the style snapshot stayed red.
    doc.getElementById('s').textContent = '.box{background:#0000ff}'
    await settle()

    const second = await snapdom(host)
    expect(decodeURIComponent(second.url.split(',')[1])).toContain('0, 0, 255')
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * 4. htmlExport state is per capture, not per plugin instance
 * ──────────────────────────────────────────────────────────────────────────── */

describe('htmlExport does not leak markup between captures', () => {
  function box(text) {
    const el = document.createElement('div')
    el.style.cssText = 'width:120px;height:40px;background:#eee;font:14px Arial'
    el.textContent = text
    document.body.appendChild(el)
    return el
  }

  it('each result exports its OWN capture, whichever order toHtml() is called in', async () => {
    // ONE plugin instance for both captures — the global-registry case, and the one that
    // made every earlier result answer with the newest capture's markup.
    const plugin = htmlExport()
    const alpha = box('CAPTURE_ALPHA')
    const beta = box('CAPTURE_BETA')

    const resA = await snapdom(alpha, { plugins: [plugin] })
    const resB = await snapdom(beta, { plugins: [plugin] })

    const htmlA = await resA.toHtml()
    const htmlB = await resB.toHtml()

    expect(htmlA).toContain('CAPTURE_ALPHA')
    expect(htmlA).not.toContain('CAPTURE_BETA')
    expect(htmlB).toContain('CAPTURE_BETA')
    expect(htmlB).not.toContain('CAPTURE_ALPHA')
  })

  it('survives concurrent captures', async () => {
    const plugin = htmlExport()
    const one = box('CONCURRENT_ONE')
    const two = box('CONCURRENT_TWO')

    const [r1, r2] = await Promise.all([
      snapdom(one, { plugins: [plugin] }),
      snapdom(two, { plugins: [plugin] }),
    ])
    const [h1, h2] = await Promise.all([r1.toHtml(), r2.toHtml()])

    expect(h1).toContain('CONCURRENT_ONE')
    expect(h1).not.toContain('CONCURRENT_TWO')
    expect(h2).toContain('CONCURRENT_TWO')
    expect(h2).not.toContain('CONCURRENT_ONE')
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * 5. toSvg({scale}) must hand back a drawable image
 * ──────────────────────────────────────────────────────────────────────────── */

describe('toImg/toSvg resolves only once the image is decoded', () => {
  /**
   * Deliberately NOT a one-rect svg. A trivial data: URL finishes decoding synchronously in
   * Chromium, so the missing `await` was invisible and the test passed against the bug —
   * the control has to be able to register. Keep a nontrivial payload, and hold the real
   * decode promise below so the awaited-readiness contract cannot pass by winning a race.
   */
  const svgUrl = (w, h) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" fill="#e91e63"/>` +
    Array.from({ length: 4000 }, (_, i) =>
      `<rect x="${i % 200}" y="${(i / 200) | 0}" width="3" height="3" fill="hsl(${i % 360},80%,50%)"/>`).join('') +
    '</svg>'
  )

  it('awaits the single decode of the final scaled URL', async () => {
    // The final SVG dimensions are now patched BEFORE assigning src. One decode is enough,
    // but toImg must still await it: observable dimensions alone cannot prove that await.
    const proto = HTMLImageElement.prototype
    const original = proto.decode
    let decodes = 0
    let release, entered
    const held = new Promise(resolve => { release = resolve })
    const started = new Promise(resolve => { entered = resolve })
    proto.decode = function (...args) {
      decodes++
      const actual = original.apply(this, args)
      entered()
      return Promise.all([actual, held]).then(() => undefined)
    }
    let img
    try {
      let settled = false
      const pending = toImg(svgUrl(200, 100), { scale: 3 }).then(value => { settled = true; return value })
      await started
      await settle()
      expect(settled).toBe(false)
      release()
      img = await pending
    } finally {
      release()
      proto.decode = original
    }
    expect(decodes).toBe(1)

    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d').drawImage(img, 0, 0)
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    let opaque = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++
    // Control: a blank frame scores 0 here, so the assertion can actually fail.
    expect(opaque).toBeGreaterThan(0)
    expect(img.style.width).toBe('600px')
    expect(img.style.height).toBe('300px')
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * 6. A stylesheet that never answers must not take the capture with it
 * ──────────────────────────────────────────────────────────────────────────── */

describe('embedCustomFonts bounds the wait on an injected @import <link>', () => {
  it('settles on the deadline instead of hanging forever', async () => {
    // A <link> cannot be aborted and fires neither load nor error while its request hangs,
    // so this stub IS the failure: onload/onerror are simply never called. Before the
    // deadline the Promise.all below it never settled, snapdom() never resolved, and the
    // temporary <link> stayed in the page's <head> because the cleanup is after the await.
    const neverAnswers = { rel: '', href: '', onload: null, onerror: null, setAttribute() {}, remove() {} }
    const doc = {
      styleSheets: [],
      head: { appendChild() {} },
      fonts: null,
      createElement: () => neverAnswers,
      querySelector: () => null,
      querySelectorAll: (sel) => (sel === 'style' ? [{ textContent: '@import url("https://example.invalid/never.css");' }] : []),
    }

    const t0 = performance.now()
    await embedCustomFonts({ required: new Set(['Nunito']), doc })
    const elapsed = performance.now() - t0

    // Both bounds matter: the lower one proves the wait was real (the stub was reached and
    // the deadline is what released it), the upper one proves the deadline exists at all.
    expect(elapsed).toBeGreaterThan(2500)
    expect(elapsed).toBeLessThan(6000)
  }, 15000)
})

/* ────────────────────────────────────────────────────────────────────────────
 * 7. Cache keys must tell apart the things they exist to tell apart
 * ──────────────────────────────────────────────────────────────────────────── */

describe('the font cache key distinguishes different glyph sets', () => {
  /** A data: src produces CSS without a fetch, which is what makes the result cacheable —
   *  an empty result is not stored, so there would be no key to collide. */
  const LOCAL = [{ family: 'Inter', src: 'data:font/woff2;base64,AA==', weight: 400 }]

  /** No <style> and no <link>: nothing is injected, nothing is fetched. */
  const emptyDoc = () => ({
    styleSheets: [], head: { appendChild() {} }, fonts: null,
    createElement: () => ({ setAttribute() {}, remove() {} }),
    querySelector: () => null,
    querySelectorAll: () => [],
  })

  it('does not collide on two sets with the same codepoint sum', async () => {
    const doc = emptyDoc()
    cache.resource.clear()

    // 'a' + 'd' === 'b' + 'c' (97+100 === 98+99). The digest multiplied and summed, and both
    // operations are linear, so it reduced to a function of that sum alone: two different
    // glyph sets, one cache entry, and the second capture served the first one's subset.
    await embedCustomFonts({ required: new Set(['Inter']), usedCodepoints: new Set([97, 100]), localFonts: LOCAL, doc })
    const afterFirst = cache.resource.size
    await embedCustomFonts({ required: new Set(['Inter']), usedCodepoints: new Set([98, 99]), localFonts: LOCAL, doc })

    expect(afterFirst).toBe(1)
    expect(cache.resource.size).toBe(2)
  })

  it('still shares one entry for the same glyph set', async () => {
    const doc = emptyDoc()
    cache.resource.clear()
    // Control: the fix must not defeat the cache by making every key unique.
    await embedCustomFonts({ required: new Set(['Inter']), usedCodepoints: new Set([97, 100]), localFonts: LOCAL, doc })
    await embedCustomFonts({ required: new Set(['Inter']), usedCodepoints: new Set([100, 97]), localFonts: LOCAL, doc })
    expect(cache.resource.size).toBe(1)
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * 8. Geometry memo must not outlive the geometry
 * ──────────────────────────────────────────────────────────────────────────── */

describe('the root measurement hint follows the document when it shrinks', () => {
  it('does not keep a taller historical height', async () => {
    const tall = document.createElement('div')
    // 1200 → 1000 keeps the emitted CSS exactly the same LENGTH, which is what the hint was
    // keyed on. Anything that also changed the css length would invalidate the hint by
    // accident and the test would pass against the bug.
    tall.style.cssText = 'height:1200px;width:300px;background:#ddd'
    document.body.appendChild(tall)

    const before = await snapdom(document.body)
    tall.style.height = '1000px'
    const after = await snapdom(document.body)

    expect(before.meta.vbH).toBeGreaterThan(0)
    // The hint is combined with Math.max, so a stale one can only hold the raster TALL.
    expect(after.meta.vbH).toBeLessThan(before.meta.vbH)
    tall.remove()
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * 9. Shadow DOM: the events that do not compose out
 * ──────────────────────────────────────────────────────────────────────────── */

describe('burst observes scroll inside an open shadow root', () => {
  it('invalidates the memo when a pane inside a component scrolls', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:200px;height:100px'
    document.body.appendChild(host)
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<div id="pane" style="width:200px;height:100px;overflow:auto;background:#fff">' +
      '<div style="height:800px;background:linear-gradient(#0f0,#00f)"></div></div>'
    const pane = root.getElementById('pane')

    for (let i = 0; i < 3; i++) { await snapdom(host); await settle() }
    const memo = await snapdom(host)
    expect(await snapdom(host)).toBe(memo)   // control: the memo is live

    // `scroll` is composed:false — it stops at the shadow boundary, so the listener on the
    // host never saw it and the component kept serving its pre-scroll frame.
    pane.scrollTop = 400
    pane.dispatchEvent(new Event('scroll'))
    await settle()

    expect(await snapdom(host)).not.toBe(memo)
  })
})
