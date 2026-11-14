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

  it('scopes the first rule of a group rule like the ones after it', () => {
    for (const head of ['@supports (display:block)', '@container (min-width:1px)', '@layer base']) {
      const out = rewriteShadowCSS(`${head}{p{color:red}.b{color:blue}}`, '[data-sd="s1"]', 's1')
      expect(out).toBe(`${head}{:where([data-sd="s1"] p:not([data-sd-slotted~="s1"])){color:red}:where([data-sd="s1"] .b:not([data-sd-slotted~="s1"])){color:blue}}`)
    }
    expect(rewriteShadowCSS('@font-face{font-family:x}@layer a, b;', '[data-sd="s1"]', 's1')).toBe('@font-face{font-family:x}@layer a, b;')
    // Inside a nested style rule a group can open with declarations: they are not a selector.
    const nested = '@supports (display:block) { background-color: rgb(0, 255, 0); & .x { color: red; } }'
    expect(rewriteShadowCSS(`.card { & .a { color: blue; } ${nested} }`, '[data-sd="s1"]', 's1')).toContain(nested)
  })

  it('a shadow rule inside @supports does not paint the light DOM', async () => {
    const root = document.createElement('div')
    root.style.cssText = 'width:60px;background:rgb(255,255,255)'
    root.innerHTML = '<p style="margin:0;height:20px"></p><div class="host"></div>'
    root.querySelector('.host').attachShadow({ mode: 'open' }).innerHTML =
      '<style>@supports (display:block){p{background-color:rgb(255,0,0)}}</style><p style="margin:0;height:20px"></p>'
    document.body.appendChild(root)
    mounted = root
    const canvas = await snapdom.toCanvas(root, { scale: 1, dpr: 1, burst: false })
    expect(rgb(canvas, 30, 10)).toEqual([255, 255, 255])
    expect(rgb(canvas, 30, 30)).toEqual([255, 0, 0])
  })
})
