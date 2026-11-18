// A capture with no property universe (an unreadable sheet, shadow content) reads every
// property a computed style lists. It reads them by name, from one list built once, instead of
// walking each element's style by index. That holds only while every element and pseudo-element
// of every document lists the same standard properties in the same order, which the first test
// pins on each engine. The second checks such a capture against the universe-pruned one.
import { describe, it, expect, afterEach } from 'vitest'
import { commands } from 'vitest/browser'
import { snapdom } from '../src/index.js'
import { snapshotFor } from '../src/modules/styles.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })
const mount = (el) => { document.body.appendChild(el); mounted.push(el); return el }

function standardProps(style) {
  const out = []
  for (let i = 0; i < style.length; i++) if (!style[i].startsWith('--')) out.push(style[i])
  return out.join(',')
}

describe('full style read without a universe', () => {
  it('every element and pseudo-element lists the same standard properties in one order', async () => {
    const host = mount(document.createElement('div'))
    host.style.setProperty('--zz-full-var', '1px')
    host.innerHTML = `
      <p style="--zz-full-own:2">text <b>bold</b></p>
      <ul><li>item</li></ul>
      <svg width="20" height="20"><rect width="5" height="5"/><text y="10">t</text><foreignObject width="10" height="10"><div>fo</div></foreignObject></svg>
      <math><mi>x</mi></math>
      <input placeholder="p"><textarea></textarea><select><option>a</option></select><button>b</button>
      <video></video><canvas></canvas><img alt="">
      <details><summary>s</summary>body</details>
      <zz-full-custom>custom</zz-full-custom>
      <div style="display:none"><span>hidden</span></div>
      <iframe></iframe>`
    const ref = standardProps(getComputedStyle(document.documentElement))
    expect(ref.split(',').length).toBeGreaterThan(100)
    const mismatches = []
    for (const el of [document.documentElement, document.body, ...host.querySelectorAll('*')]) {
      for (const pseudo of [null, '::before', '::after', '::marker', '::placeholder', '::first-line']) {
        const style = getComputedStyle(el, pseudo)
        if (style.length && standardProps(style) !== ref) mismatches.push(el.localName + (pseudo || ''))
      }
    }
    // One list serves every document, so an iframe's must list what the top document does.
    const frame = host.querySelector('iframe')
    const doc = frame.contentDocument
    doc.body.innerHTML = '<p>frame <span>text</span></p><svg><rect/></svg>'
    const view = frame.contentWindow
    const frameRef = standardProps(view.getComputedStyle(doc.documentElement))
    expect(frameRef).toBe(ref)
    for (const el of doc.querySelectorAll('*')) {
      if (standardProps(view.getComputedStyle(el)) !== frameRef) mismatches.push('iframe ' + el.localName)
    }
    expect(mismatches).toEqual([])
  })

  it('paints under an unreadable sheet what the universe-pruned capture paints', async () => {
    const el = mount(document.createElement('div'))
    el.style.cssText = 'width:200px;padding:6px;background:#fff'
    // Rules spread over the property list, so a list cut short or out of step loses some.
    // The ::before's opacity is neither inherited nor restated by a logical twin or by
    // -webkit-text-fill-color, as its color and margin are, so its read alone must carry it.
    el.innerHTML = `<style>
      .zz-full-a { accent-color: rgb(0, 160, 0); background-color: rgb(250, 230, 120); border-top: 4px solid rgb(0, 0, 200) }
      .zz-full-b { box-shadow: 3px 3px 0 rgb(200, 0, 0); color: rgb(0, 90, 90); letter-spacing: 2px; outline: 2px dashed rgb(120, 0, 160) }
      .zz-full-c { text-decoration: underline wavy rgb(220, 0, 120); text-shadow: 1px 1px 0 rgb(0, 200, 0); transform: rotate(4deg); z-index: 1; position: relative }
      .zz-full-c::before { content: '>'; color: rgb(0, 0, 255); margin-right: 4px; opacity: 0.5 }
    </style>
    <div class="zz-full-a"><input type="checkbox" checked> one</div>
    <div class="zz-full-b">two words</div>
    <div class="zz-full-c" style="--zz-full-own: 3px">three</div>`
    // Firefox reports fonts as loading while the previous test's fixture settles, and the
    // loadingdone that follows would retire the snapshot read below.
    await document.fonts.ready
    const opts = { burst: false, dpr: 1, embedFonts: false }
    const pixels = async () => {
      const canvas = await snapdom.toCanvas(el, opts)
      return { size: canvas.width + 'x' + canvas.height, data: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data }
    }
    const pruned = await pixels()
    const prunedProps = Object.keys(snapshotFor(el.querySelector('.zz-full-b'))).length

    const href = await commands.serveCrossOriginCss('.zz-full-elsewhere{color:red}', { cors: false })
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; link.href = href; document.head.appendChild(link) })
    try {
      expect(() => link.sheet.cssRules).toThrow()
      const full = await pixels()
      // The full read did run: it keeps every property with a value, not the universe's few.
      expect(Object.keys(snapshotFor(el.querySelector('.zz-full-b'))).length).toBeGreaterThan(prunedProps + 50)
      expect(full.size).toBe(pruned.size)
      let differ = 0
      for (let i = 0; i < full.data.length; i++) if (full.data[i] !== pruned.data[i]) differ++
      expect(differ).toBe(0)
    } finally {
      link.remove()
    }
  })
})
