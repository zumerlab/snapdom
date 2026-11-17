// The part rules of a control (::-webkit-progress-value, ::-moz-progress-bar) were memoized on
// the rule count of each sheet: rewritten at the same count they stayed, with `invalidate` too.
import { it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { flushStyleInvalidations } from '../src/core/changes.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

const CSS = (colour) => '.sd-bar{appearance:none;-webkit-appearance:none;display:block;width:200px;height:40px;border:0;background:#fff}' +
  `.sd-bar::-webkit-progress-bar{background:#fff}.sd-bar::-webkit-progress-value{background:${colour}}.sd-bar::-moz-progress-bar{background:${colour}}`

async function scene() {
  const style = document.createElement('style')
  style.textContent = CSS('rgb(255,0,0)')
  document.head.appendChild(style)
  const el = document.createElement('progress')
  el.className = 'sd-bar'
  el.max = 100
  el.value = 80
  document.body.appendChild(el)
  mounted.push(style, el)
  expect((await colours(el)).red).toBeGreaterThan(4000)
  return { style, el }
}

async function colours(el, opts) {
  const c = await snapdom.toCanvas(el, { dpr: 1, scale: 1, burst: false, embedFonts: false, ...opts })
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let red = 0, blue = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 200 && d[i + 2] < 60) red++
    else if (d[i] < 60 && d[i + 2] > 200) blue++
  }
  return { red, blue }
}

it('a <style> rewritten with as many rules repaints the bar', async () => {
  const { style, el } = await scene()
  style.textContent = CSS('rgb(0,0,255)')
  await new Promise((r) => setTimeout(r, 0))
  flushStyleInvalidations()
  const { red, blue } = await colours(el)
  expect([red, blue > 4000]).toEqual([0, true])
})

it('a rule edited through CSSOM repaints the bar under invalidate', async () => {
  const { style, el } = await scene()
  for (const rule of style.sheet.cssRules) if (/progress-value|moz-progress-bar/.test(rule.selectorText)) rule.style.background = 'rgb(0,0,255)'
  const { red, blue } = await colours(el, { invalidate: true })
  expect([red, blue > 4000]).toEqual([0, true])
})
