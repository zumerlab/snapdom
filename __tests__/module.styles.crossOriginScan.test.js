// A cross-origin sheet (cssRules throws) made the whole author-style scan unreliable, and an
// unreliable scan cannot promise the page has no `:has()`, so stamp narrowing was off and every
// mutation anywhere invalidated every memo. A Google Fonts <link> plus a ticking counter
// elsewhere on the page re-captured a static element on every call. styles.js now reads such a
// sheet through a fetched copy when the server allows it.
import { describe, it, expect, afterEach } from 'vitest'
import { commands } from 'vitest/browser'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mount(el) { document.body.appendChild(el); mounted.push(el); return el }

async function linkCrossOriginSheet(css, cors) {
  const href = await commands.serveCrossOriginCss(css, { cors })
  const link = mount(document.createElement('link'))
  link.rel = 'stylesheet'
  await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; link.href = href })
  expect(() => link.sheet.cssRules).toThrow() // the scan really cannot read it
}

/** Captures `target` while a counter in another subtree changes between calls. The first
 *  two calls are warm-up: the first starts the copy's fetch, the second sees it land. */
async function servedWhileCounting(target, counter) {
  const opts = { embedFonts: false }
  let prev = await snapdom(target, opts)
  await new Promise((r) => setTimeout(r, 300))
  prev = await snapdom(target, opts)
  let served = 0
  for (let i = 0; i < 4; i++) {
    counter.textContent = String(i)
    await new Promise((r) => setTimeout(r, 50))
    const res = await snapdom(target, opts)
    if (res === prev) served++
    prev = res
  }
  return served
}

function scene() {
  const host = mount(document.createElement('div'))
  host.innerHTML = '<div><div class="cos-target" style="width:120px;height:40px;background:#fc0">card</div></div><div><span>0</span></div>'
  return { target: host.querySelector('.cos-target'), counter: host.querySelector('span') }
}

describe('cross-origin sheet read through a fetched copy', () => {
  it('a mutation in another subtree no longer re-captures a static element', async () => {
    await linkCrossOriginSheet('.cos-elsewhere{color:red}', true)
    const { target, counter } = scene()
    expect(await servedWhileCounting(target, counter)).toBe(4)
  })

  it('a sheet the page cannot fetch keeps the document-wide invalidation', async () => {
    await linkCrossOriginSheet('.cos-closed{color:red}', false)
    const { target, counter } = scene()
    expect(await servedWhileCounting(target, counter)).toBe(0)
  })

  it('a property only the copy declares still paints', async () => {
    await linkCrossOriginSheet('.cos-cols{columns:2;column-gap:20px;column-rule:10px solid rgb(255,0,0)}', true)
    const el = mount(document.createElement('div'))
    el.className = 'cos-cols'
    el.style.cssText = 'width:160px;height:40px;background:#fff;color:#fff;font:16px Arial'
    el.textContent = 'one two three four five six seven eight nine ten'
    await snapdom(el, { burst: false })
    await new Promise((r) => setTimeout(r, 300))
    const canvas = await snapdom.toCanvas(el, { burst: false, dpr: 1, embedFonts: false })
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let red = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) red++
    expect(red).toBeGreaterThan(300)
  })
})
