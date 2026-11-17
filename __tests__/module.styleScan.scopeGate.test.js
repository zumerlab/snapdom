// `:scope .icon::before` inside @scope: as a matches() gate `:scope` is the node asked, so it
// never matched and the pseudo-element was dropped.
import { it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

it('a ::before declared through :scope inside @scope is painted', async ({ skip }) => {
  const style = document.createElement('style')
  style.textContent = '@scope (.sd-scope) { :scope .sd-icon::before { content:""; display:block; width:40px; height:40px; background:rgb(255,0,0) } }'
  document.head.appendChild(style)
  mounted.push(style)
  // Firefox before 128 drops the rule.
  if (!style.sheet.cssRules.length) skip()
  const root = document.createElement('div')
  root.className = 'sd-scope'
  root.style.cssText = 'width:120px;height:120px;background:#fff'
  root.innerHTML = '<div class="sd-icon"></div>'
  document.body.appendChild(root)
  mounted.push(root)
  expect(root.firstChild.getBoundingClientRect().height).toBe(40)
  const canvas = await snapdom.toCanvas(root, { dpr: 1, scale: 1, burst: false, embedFonts: false })
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let red = 0
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) red++
  expect(red).toBe(1600)
})
