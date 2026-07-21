import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'
import { reconcileCloneLayout } from '../src/utils/capture.helpers.js'

describe('reconcile — layout reconciliation', () => {
  let el
  afterEach(() => el?.remove())

  it('capture with reconcile:true still matches the element content', async () => {
    el = document.createElement('div')
    el.style.cssText = 'width:220px;padding:8px;background:#eee;font-family:sans-serif'
    el.innerHTML = '<p style="margin:0">reconciled capture</p><span>inline bit</span>'
    document.body.appendChild(el)
    const result = await snapdom(el, { reconcile: true })
    const svg = decodeURIComponent(result.url)
    expect(svg).toContain('reconciled capture')
    expect(svg).toContain('inline bit')
    const canvas = await result.toCanvas()
    expect(canvas.width).toBeGreaterThan(0)
  })

  it('pins only nodes whose measured size diverges from the live one', () => {
    // Live source: child renders 200px wide.
    const src = document.createElement('div')
    src.style.cssText = 'width:200px'
    const srcChild = document.createElement('div')
    srcChild.style.cssText = 'width:200px;height:40px'
    src.appendChild(srcChild)
    document.body.appendChild(src)

    // Clone: a class makes the child lay out 300px in the measure context → must be pinned.
    const clone = document.createElement('div')
    const cloneChild = document.createElement('div')
    cloneChild.classList.add('sd-reconcile-diverge')
    clone.appendChild(cloneChild)

    const nodeMap = new Map([[clone, src], [cloneChild, srcChild]])
    const css = '.sd-reconcile-diverge{width:300px;height:40px;display:block}'
    const pinned = reconcileCloneLayout(src, clone, css, nodeMap, 200, 40)

    expect(pinned).toBe(1)
    expect(parseFloat(cloneChild.style.width)).toBeCloseTo(200, 0)
    expect(cloneChild.style.boxSizing).toBe('border-box')
    src.remove()
  })

  it('leaves matching nodes unpinned', () => {
    const src = document.createElement('div')
    src.style.cssText = 'width:150px'
    const srcChild = document.createElement('div')
    srcChild.style.cssText = 'width:150px;height:30px'
    src.appendChild(srcChild)
    document.body.appendChild(src)

    const clone = document.createElement('div')
    const cloneChild = document.createElement('div')
    cloneChild.classList.add('sd-reconcile-same')
    clone.appendChild(cloneChild)

    const nodeMap = new Map([[clone, src], [cloneChild, srcChild]])
    const css = '.sd-reconcile-same{width:150px;height:30px;display:block}'
    const pinned = reconcileCloneLayout(src, clone, css, nodeMap, 150, 30)

    expect(pinned).toBe(0)
    expect(cloneChild.style.width).toBe('')
    src.remove()
  })
})
