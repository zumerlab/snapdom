// #488's toolbar lost its group separators: three identical <issue488-group> hosts whose
// root sheet says `:host(:not(:first-child)){margin-left:8px;border-left:1px solid}`
// painted packed together. The identity share handed hosts 2 and 3 host 1's snapshot: the
// shadow sheet that splits them is outside the document scan, so the gate never saw
// `:first-child` (second and third tests; red without the shadowRoot/assignedSlot escape in
// inlineAllStyles). The rewrite was suspected first and is pinned too: `:host(` up to the
// first `)` stays balanced, and `:host-context(` must be rewritten BEFORE the bare `:host`
// pass eats its head (first test; red with the old order).
import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'
import { rewriteShadowCSS } from '../src/utils/clone.helpers.js'

let mounted

afterEach(() => {
  mounted?.remove()
  mounted = null
})

function rgb(canvas, x, y) {
  return [...canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data].slice(0, 3)
}

/** A 120x20 white flex row of three identical 20x20 blue boxes, `mode` deciding whether the
 *  splitting rule reaches them as hosts (:host) or as slotted twins (::slotted). */
function mountRow(mode) {
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;width:120px;height:20px;background:rgb(255,255,255);margin:0;padding:0'
  const box = 'display:block;width:20px;height:20px;background:rgb(0,0,255)'
  const split = 'margin-left:8px;border-left:4px solid rgb(255,0,0)'
  if (mode === 'host') {
    for (let i = 0; i < 3; i++) {
      const host = document.createElement('div')
      host.attachShadow({ mode: 'open' }).innerHTML = `<style>:host{${box}}:host(:not(:first-child)){${split}}</style>`
      row.appendChild(host)
    }
  } else {
    const host = document.createElement('div')
    host.attachShadow({ mode: 'open' }).innerHTML = `<style>:host{display:flex}::slotted(*){${box}}::slotted(:not(:first-child)){${split}}</style><slot></slot>`
    for (let i = 0; i < 3; i++) host.appendChild(document.createElement('div'))
    row.appendChild(host)
  }
  document.body.appendChild(row)
  mounted = row
  return row
}

async function expectSeparators(row) {
  const canvas = await snapdom.toCanvas(row, { scale: 1, dpr: 1, burst: false })
  // Box 1 at 0..20; box 2 starts after its 8px margin: 4px red border at 28..32, blue from 32.
  expect(rgb(canvas, 10, 10)).toEqual([0, 0, 255])
  expect(rgb(canvas, 24, 10)).toEqual([255, 255, 255])
  expect(rgb(canvas, 30, 10)).toEqual([255, 0, 0])
  expect(rgb(canvas, 40, 10)).toEqual([0, 0, 255])
  // Box 3 the same distance again: margin at 52..60, border at 60..64.
  expect(rgb(canvas, 56, 10)).toEqual([255, 255, 255])
  expect(rgb(canvas, 62, 10)).toEqual([255, 0, 0])
}

describe('shadow host structural rules (#488 separators)', () => {
  it('rewrites :host(), :host-context() and ::slotted() into rules the parser keeps', () => {
    const style = document.createElement('style')
    style.textContent = rewriteShadowCSS(
      ':host(:not(:first-child)){margin-left:8px}:host-context(.dark) p{color:red}::slotted(:not(:first-child)){margin:0}',
      '[data-sd="s1"]', 's1')
    document.head.appendChild(style)
    mounted = style
    const sels = [...style.sheet.cssRules].map((r) => r.selectorText)
    expect(sels).toEqual([
      ':where([data-sd="s1"]:is(:not(:first-child)))',
      ':where(:where(.dark) [data-sd="s1"]) p',
      ':where([data-sd="s1"] :not(:first-child))',
    ])
  })

  it('identical hosts split by :host(:not(:first-child)) each paint their own margin and border', async () => {
    await expectSeparators(mountRow('host'))
  })

  it('identical slotted nodes split by ::slotted(:not(:first-child)) each paint their own', async () => {
    await expectSeparators(mountRow('slotted'))
  })
})
