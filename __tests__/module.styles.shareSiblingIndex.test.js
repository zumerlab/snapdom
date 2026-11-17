// sibling-index() computes per sibling under one selector: identity twins shared the style of
// the first and three boxes were painted with one opacity.
import { it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

const CSS_TEXT = '.sd-sib{width:40px;height:40px;background:rgb(255,0,0);opacity:calc(sibling-index() / 3)}'

async function reds(sheetNode) {
  document.head.appendChild(sheetNode)
  if (sheetNode.localName === 'link') await new Promise((resolve) => { sheetNode.onload = resolve })
  const root = document.createElement('div')
  root.style.cssText = 'width:40px;height:120px;background:#fff'
  root.innerHTML = '<div class="sd-sib"></div>'.repeat(3)
  document.body.appendChild(root)
  mounted.push(sheetNode, root)
  const canvas = await snapdom.toCanvas(root, { dpr: 1, scale: 1, burst: false, embedFonts: false })
  const ctx = canvas.getContext('2d')
  return [20, 60, 100].map((y) => ctx.getImageData(20, y, 1, 1).data[1])
}

const supported = CSS.supports('opacity', 'calc(sibling-index() / 2)')

it.runIf(supported)('three siblings under one rule keep their own opacity, from a <style>', async () => {
  const style = document.createElement('style')
  style.textContent = CSS_TEXT
  expect(await reds(style)).toEqual([170, 85, 0])
})

it.runIf(supported)('and from a linked sheet', async () => {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = URL.createObjectURL(new Blob([CSS_TEXT], { type: 'text/css' }))
  expect(await reds(link)).toEqual([170, 85, 0])
})
