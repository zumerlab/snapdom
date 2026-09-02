// A `replaceSync()` on a sheet the document has ALREADY adopted emits no mutation record and
// changes no sheet count, so every memo that keys on those stayed put: the pseudo pass's
// preflight ("does any sheet mention a pseudo?") answered from its memo, and the pseudo gates
// in styles.js from theirs. The fingerprint now counts the adopted sheets' rules, and a
// changed fingerprint on a document seen before invalidates the style memos with it.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => {
  while (mounted.length) mounted.pop().remove()
  document.adoptedStyleSheets = []
})

async function bluePixels(el) {
  const c = await snapdom.toCanvas(el, { scale: 1, dpr: 1, burst: false })
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let n = 0
  for (let i = 0; i < d.length; i += 4) if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0xe0) n++
  return n
}

describe('pseudo preflight and an already-adopted sheet', () => {
  it('a ::before added by replaceSync() between two captures renders in the second', async () => {
    const root = document.createElement('div')
    root.style.cssText = 'width:120px;height:120px;background:#fff'
    root.innerHTML = '<div class="ap-k"></div>'
    document.body.appendChild(root)
    mounted.push(root)
    const sheet = new CSSStyleSheet()
    sheet.replaceSync('.ap-k{width:40px;height:40px}')
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    expect(await bluePixels(root)).toBe(0) // memoized: no pseudo anywhere
    sheet.replaceSync('.ap-k{width:40px;height:40px} .ap-k::before{content:"";display:block;width:40px;height:40px;background:#0000e0}')
    expect(await bluePixels(root)).toBeGreaterThan(1000)
  })
})
