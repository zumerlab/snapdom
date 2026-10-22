import { afterEach, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { snapdom } from '../src/api/snapdom.js'
import { __diffStats } from '../src/core/diff.js'
import { scanAuthorStyles } from '../src/modules/styleScan.js'
import { universeFor } from '../src/modules/styles.js'

const mounted = []
const urls = []
afterEach(() => {
  while (mounted.length) mounted.pop().remove()
  while (urls.length) URL.revokeObjectURL(urls.pop())
})
function mount(el) { document.body.append(el); mounted.push(el); return el }
function sheet(css) {
  const style = mount(document.createElement('style'))
  style.textContent = css
  return style
}
function scene() {
  const root = mount(document.createElement('div'))
  root.style.cssText = 'width:160px;background:white;font:16px Arial'
  root.innerHTML = '<div><ul style="margin:0;padding:0;list-style:none">' +
    Array.from({ length: 6 }, (_, i) => `<li class="on" style="height:24px">Row ${i}</li>`).join('') + '</ul></div>'
  return root
}
async function warm(root) {
  for (let i = 0; i < 4; i++) await snapdom(root, { embedFonts: false })
}
async function recapture(root, serves) {
  await warm(root)
  root.querySelector('li').classList.remove('on')
  await new Promise(r => setTimeout(r, 0))
  const before = { ...__diffStats }
  const repeat = await snapdom(root, { embedFonts: false })
  expect(__diffStats.attempts).toBe(before.attempts + 1)
  expect(__diffStats.served).toBe(before.served + (serves ? 1 : 0))
  const fresh = await snapdom(root, { embedFonts: false, invalidate: true })
  expect(repeat.url).toBe(fresh.url)
  const pixels = async result => {
    const canvas = await result.toCanvas()
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  }
  expect(await pixels(repeat)).toEqual(await pixels(fresh))
}

it.each(['3', 'even', 'odd'])('refreshes siblings for nth-child(%s of .on)', async arg => {
  sheet(`li:nth-child(${arg} of .on) { background:#fcc }`)
  await recapture(scene(), false)
})
it.each(['3', 'even'])('refreshes siblings for nth-last-child(%s of .on)', async arg => {
  sheet(`li:nth-last-child(${arg} of .on) { background:#fcc }`)
  await recapture(scene(), false)
})
it('follows imported rules inside grouping rules', async () => {
  const url = URL.createObjectURL(new Blob(['@media all { .on + .on { background:#fcc } }'], { type: 'text/css' }))
  urls.push(url)
  const style = sheet('')
  await new Promise((resolve, reject) => {
    style.onload = resolve; style.onerror = reject
    style.textContent = `@import url("${url}");`
  })
  const root = scene()
  await expect.poll(() => getComputedStyle(root.querySelectorAll('li')[1]).backgroundColor).toBe('rgb(255, 204, 204)')
  await recapture(root, false)
})
it.each([false, true])('uses fetched cross-origin rules and keeps safe diff enabled (relational=%s)', async relational => {
  const href = await commands.serveCrossOriginCss(relational ? '.on + .on { background:#fcc }' : 'li { color:#333 }', { cors: true })
  const link = mount(document.createElement('link'))
  link.rel = 'stylesheet'
  await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; link.href = href })
  expect(() => link.sheet.cssRules).toThrow()
  const root = scene()
  // Trigger the copy fetch and wait for its epoch invalidation, rather than a fixed delay.
  await expect.poll(() => universeFor(root), { timeout: 5000 }).not.toBeNull()
  await recapture(root, !relational)
})
it('updates the leak flag when selectors change without changing properties', () => {
  const style = sheet('li { background:#fcc }')
  expect(scanAuthorStyles(document).leaksAcrossSubtrees).toBe(false)
  style.textContent = 'li:nth-child(3 of .on) { background:#fcc }'
  expect(scanAuthorStyles(document).leaksAcrossSubtrees).toBe(true)
})
it('invalidates the cached leak flag for an adopted rule with the same properties', async () => {
  const adopted = new CSSStyleSheet()
  adopted.replaceSync('li { background:#fcc }')
  const previous = document.adoptedStyleSheets
  document.adoptedStyleSheets = [...previous, adopted]
  try {
    const root = scene()
    await warm(root)
    const universe = universeFor(root)
    adopted.replaceSync('li:nth-child(3 of .on) { background:#fcc }')
    await recapture(root, false)
    expect(universeFor(root)).toBe(universe)
  } finally {
    document.adoptedStyleSheets = previous
  }
})
