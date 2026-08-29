import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index'
import { reconcileCloneLayout } from '../src/utils/capture.helpers.js'
import { cache } from '../src/core/cache.js'

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

  it('pins a scaled node to its pre-transform layout size', () => {
    const src = document.createElement('div')
    src.style.cssText = 'width:200px;height:100px'
    const srcChild = document.createElement('div')
    srcChild.style.cssText = 'width:100px;height:40px;transform:scale(1.5);transform-origin:0 0'
    src.appendChild(srcChild)
    document.body.appendChild(src)

    const clone = document.createElement('div')
    const cloneChild = document.createElement('div')
    cloneChild.classList.add('sd-reconcile-scaled')
    clone.appendChild(cloneChild)

    const nodeMap = new Map([[clone, src], [cloneChild, srcChild]])
    const css = '.sd-reconcile-scaled{display:block;width:80px;height:40px;' +
      'transform:scale(1.5);transform-origin:0 0}'
    const pinned = reconcileCloneLayout(src, clone, css, nodeMap, 200, 100)

    expect(pinned).toBe(1)
    expect(parseFloat(cloneChild.style.width)).toBe(100)
    expect(parseFloat(cloneChild.style.height)).toBe(40)
    src.remove()
  })

  it('uses pre-transform sizes below a transformed ancestor', () => {
    const src = document.createElement('div')
    src.style.cssText = 'width:200px;height:100px'
    const srcParent = document.createElement('div')
    srcParent.style.cssText = 'width:100px;height:40px;transform:scale(1.5);transform-origin:0 0'
    const srcChild = document.createElement('div')
    srcChild.style.cssText = 'width:100px;height:40px'
    srcParent.appendChild(srcChild)
    src.appendChild(srcParent)
    document.body.appendChild(src)

    const clone = document.createElement('div')
    const cloneParent = document.createElement('div')
    cloneParent.classList.add('sd-reconcile-scaled-parent')
    const cloneChild = document.createElement('div')
    cloneChild.classList.add('sd-reconcile-scaled-child')
    cloneParent.appendChild(cloneChild)
    clone.appendChild(cloneParent)

    const nodeMap = new Map([
      [clone, src],
      [cloneParent, srcParent],
      [cloneChild, srcChild],
    ])
    const css = '.sd-reconcile-scaled-parent{display:block;width:100px;height:40px;' +
      'transform:scale(1.5);transform-origin:0 0}' +
      '.sd-reconcile-scaled-child{display:block;width:80px;height:40px}'
    const pinned = reconcileCloneLayout(src, clone, css, nodeMap, 200, 100)

    expect(pinned).toBe(1)
    expect(cloneParent.style.width).toBe('')
    expect(parseFloat(cloneChild.style.width)).toBe(100)
    expect(parseFloat(cloneChild.style.height)).toBe(40)
    src.remove()
  })

  it('does not create false pins below a scaled capture root', () => {
    const src = document.createElement('div')
    src.style.cssText = 'width:200px;height:100px;transform:scale(1.5);transform-origin:0 0'
    const srcChild = document.createElement('div')
    srcChild.style.cssText = 'width:100px;height:40px'
    src.appendChild(srcChild)
    document.body.appendChild(src)

    const clone = document.createElement('div')
    clone.style.cssText = src.style.cssText
    const cloneChild = document.createElement('div')
    cloneChild.classList.add('sd-reconcile-root-scale')
    clone.appendChild(cloneChild)

    const nodeMap = new Map([[clone, src], [cloneChild, srcChild]])
    const css = '.sd-reconcile-root-scale{display:block;width:100px;height:40px}'
    const pinned = reconcileCloneLayout(src, clone, css, nodeMap, 200, 100)

    expect(pinned).toBe(0)
    expect(cloneChild.style.width).toBe('')
    src.remove()
  })

  it('reconciles scaled nodes from a same-origin iframe realm', () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const doc = frame.contentDocument
    const src = doc.createElement('div')
    src.style.cssText = 'width:200px;height:100px'
    const srcChild = doc.createElement('div')
    srcChild.style.cssText = 'width:100px;height:40px;transform:scale(1.5);transform-origin:0 0'
    src.appendChild(srcChild)
    doc.body.appendChild(src)

    const clone = doc.createElement('div')
    const cloneChild = doc.createElement('div')
    cloneChild.classList.add('sd-reconcile-frame-scale')
    clone.appendChild(cloneChild)

    try {
      expect(cloneChild instanceof HTMLElement).toBe(false)
      const nodeMap = new Map([[clone, src], [cloneChild, srcChild]])
      const css = '.sd-reconcile-frame-scale{display:block;width:80px;height:40px;' +
        'transform:scale(1.5);transform-origin:0 0}'
      const pinned = reconcileCloneLayout(src, clone, css, nodeMap, 200, 100)

      expect(pinned).toBe(1)
      expect(parseFloat(cloneChild.style.width)).toBe(100)
      expect(parseFloat(cloneChild.style.height)).toBe(40)
    } finally {
      frame.remove()
    }
  })

  it('keeps fractional rect precision for translate-only transforms', () => {
    const src = document.createElement('div')
    src.style.cssText = 'width:200px;height:100px'
    const srcChild = document.createElement('div')
    srcChild.style.cssText = 'width:100.25px;height:40.25px;transform:translateX(12.5px)'
    src.appendChild(srcChild)
    document.body.appendChild(src)

    const clone = document.createElement('div')
    const cloneChild = document.createElement('div')
    cloneChild.classList.add('sd-reconcile-translated')
    clone.appendChild(cloneChild)

    const nodeMap = new Map([[clone, src], [cloneChild, srcChild]])
    const css = '.sd-reconcile-translated{display:block;width:80.25px;height:40.25px;' +
      'transform:translateX(12.5px)}'
    const pinned = reconcileCloneLayout(src, clone, css, nodeMap, 200, 100)

    expect(pinned).toBe(1)
    expect(parseFloat(cloneChild.style.width)).toBeCloseTo(100.25, 2)
    expect(parseFloat(cloneChild.style.height)).toBeCloseTo(40.25, 2)
    src.remove()
  })

  it('keeps fractional layout precision when a scale magnifies the result', () => {
    const src = document.createElement('div')
    src.style.cssText = 'width:200px;height:100px'
    const srcChild = document.createElement('div')
    srcChild.style.cssText = 'width:100.49px;height:40.49px;transform:scale(10);transform-origin:0 0'
    src.appendChild(srcChild)
    document.body.appendChild(src)

    const clone = document.createElement('div')
    const cloneChild = document.createElement('div')
    cloneChild.classList.add('sd-reconcile-fractional-scale')
    clone.appendChild(cloneChild)

    const live = srcChild.getBoundingClientRect()
    const nodeMap = new Map([[clone, src], [cloneChild, srcChild]])
    const css = '.sd-reconcile-fractional-scale{display:block;width:80px;height:30px;' +
      'transform:scale(10);transform-origin:0 0}'
    const pinned = reconcileCloneLayout(src, clone, css, nodeMap, 200, 100)

    expect(pinned).toBe(1)
    expect(parseFloat(cloneChild.style.width)).toBeCloseTo(live.width / 10, 2)
    expect(parseFloat(cloneChild.style.height)).toBeCloseTo(live.height / 10, 2)
    src.remove()
  })

  it('falls back to used sizes for collapsed table cells', () => {
    const src = document.createElement('table')
    src.style.borderCollapse = 'collapse'
    const srcRow = src.insertRow()
    const srcCell = srcRow.insertCell()
    srcCell.style.cssText = 'width:100.49px;height:40.49px;padding:.25px .35px;' +
      'border:1px solid;transform:scale(10);transform-origin:0 0'
    document.body.appendChild(src)

    const clone = document.createElement('table')
    const cloneRow = clone.insertRow()
    const cloneCell = cloneRow.insertCell()
    cloneCell.classList.add('sd-reconcile-collapsed-cell')

    const nodeMap = new Map([
      [clone, src],
      [cloneRow, srcRow],
      [cloneCell, srcCell],
    ])
    const css = 'table{border-collapse:collapse}' +
      '.sd-reconcile-collapsed-cell{width:80px;height:30px;padding:.25px .35px;' +
      'border:1px solid;transform:scale(10);transform-origin:0 0}'
    const pinned = reconcileCloneLayout(src, clone, css, nodeMap,
      src.offsetWidth, src.offsetHeight)

    expect(pinned).toBeGreaterThan(0)
    expect(parseFloat(cloneCell.style.width)).toBe(srcCell.offsetWidth)
    expect(parseFloat(cloneCell.style.height)).toBe(srcCell.offsetHeight)
    src.remove()
  })

  it('warns once, suggesting reconcile:true, when width-softened text is captured without it', async () => {
    cache.warnedReconcile = false
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // A table cell holds real text content, so getStyleKey softens (drops) its width — the
      // exact #429/#433/#434 risk shape.
      el = document.createElement('table')
      el.innerHTML = '<tr><td>some real text content</td></tr>'
      document.body.appendChild(el)

      await snapdom(el)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain('reconcile: true')

      // Doesn't repeat on a later capture, even of a fresh equally-at-risk element.
      const el2 = document.createElement('table')
      el2.innerHTML = '<tr><td>more text</td></tr>'
      document.body.appendChild(el2)
      await snapdom(el2)
      expect(warn).toHaveBeenCalledTimes(1)
      el2.remove()
    } finally {
      warn.mockRestore()
      cache.warnedReconcile = false
    }
  })

  it('does not warn when reconcile:true is already passed', async () => {
    cache.warnedReconcile = false
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      el = document.createElement('table')
      el.innerHTML = '<tr><td>some real text content</td></tr>'
      document.body.appendChild(el)
      await snapdom(el, { reconcile: true })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      cache.warnedReconcile = false
    }
  })
})
