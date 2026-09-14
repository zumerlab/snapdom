import { it, expect, afterEach, vi } from 'vitest'
import { buildCounterContext } from '../src/modules/counter.js'
import { inlinePseudoElements } from '../src/modules/pseudo.js'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove(); vi.restoreAllMocks() })
function mount(tag, text, parent = document.body) {
  const node = document.createElement(tag)
  node.innerHTML = text
  parent.appendChild(node)
  mounted.push(node)
  return node
}

it('continues list-item ordinals from start and explicit values, including zero', () => {
  const root = mount('ol', '<li>A</li><li value="5">B</li><li>C</li><li value="0">D</li><li>E</li>')
  let ctx = buildCounterContext(root)
  expect([...root.children].map(li => ctx.get(li, 'list-item'))).toEqual([1, 5, 6, 0, 1])
  root.start = 3
  ctx = buildCounterContext(root)
  expect([...root.children].map(li => ctx.get(li, 'list-item'))).toEqual([3, 5, 6, 0, 1])
})

it('reads each element style once and respects stylesheet important counters', () => {
  mount('style', '.counter-important{counter-increment:item 3!important}', document.head)
  const root = mount('div', '<span class="counter-important" style="counter-increment:item 1"></span>')
  const reads = vi.spyOn(window, 'getComputedStyle')
  const ctx = buildCounterContext(root)
  expect(ctx.get(root.firstElementChild, 'item')).toBe(3)
  expect(reads).toHaveBeenCalledTimes(2)
})

it('materializes all pseudo counters and native list ordinals into generated content', async () => {
  mount('style', '.counter-many::before{counter-increment:a 2 b 5;content:counter(a) ":" counter(b) "/" counter(list-item)}', document.head)
  const root = mount('ol', '<li class="counter-many">A</li><li class="counter-many" value="5">B</li><li class="counter-many">C</li>')
  root.style.counterReset = 'a 0 b 0'
  const clone = root.cloneNode(true)
  const session = { styleMap: new Map(), styleCache: new WeakMap() }
  await inlinePseudoElements(root, clone, session, {})
  expect([...clone.querySelectorAll('[data-snapdom-pseudo]')].map(el => el.textContent)).toEqual(['2:5/1', '4:10/5', '6:15/6'])
})

it('paints counter labels identically to their explicit text', async () => {
  const sheet = mount('style', '.counter-raster li::before{counter-increment:a 2 b 5;content:counter(a) ":" counter(b) "/" counter(list-item)}', document.head)
  const root = mount('ol', '<li data-label="2:5/1"> A</li><li value="5" data-label="4:10/5"> B</li><li data-label="6:15/6"> C</li>')
  root.className = 'counter-raster'
  root.style.cssText = 'counter-reset:a 0 b 0;list-style:none;padding:0;margin:0;width:200px;height:72px;font:16px/24px monospace;color:black;background:white'
  const opts = { embedFonts: false, burst: false, scale: 1, dpr: 1 }
  const actual = await snapdom.toCanvas(root, opts)
  sheet.textContent = ['2:5/1', '4:10/5', '6:15/6'].map((text, i) =>
    `.counter-raster li:nth-child(${i + 1})::before{content:"${text}"}`).join('')
  const reference = await snapdom.toCanvas(root, opts)
  const pixels = (canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  const a = pixels(actual), b = pixels(reference)
  expect(a.length).toBe(b.length)
  let different = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 4) different++
  expect(different / a.length).toBeLessThan(0.001)
}, 15000)
