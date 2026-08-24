import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

function redBounds(canvas) {
  const { width, height } = canvas
  const data = canvas.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, width, height).data
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i] > 200 && data[i + 1] < 80 && data[i + 2] < 80 && data[i + 3] > 200) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { width: maxX - minX + 1, height: maxY - minY + 1 }
}

describe('issue #489 — reconcile with transformed elements', () => {
  let root
  afterEach(() => root?.remove())

  it('does not apply root and child scales twice', async () => {
    root = document.createElement('div')
    root.style.cssText = 'position:absolute;left:0;top:0;width:400px;height:200px;' +
      'overflow:hidden;background:rgb(255,220,80);transform:scale(1.5);transform-origin:0 0'
    const child = document.createElement('div')
    child.style.cssText = 'position:absolute;left:100px;top:50px;width:100px;height:40px;' +
      'background:rgb(220,30,30);transform:scale(1.5);transform-origin:0 0'
    root.appendChild(child)
    document.body.appendChild(root)

    const live = child.getBoundingClientRect()
    const without = redBounds(await (await snapdom(root, {
      reconcile: false,
      dpr: 1,
      compress: false,
    })).toCanvas())
    const withReconcile = redBounds(await (await snapdom(root, {
      reconcile: true,
      dpr: 1,
      compress: false,
    })).toCanvas())

    expect(without.width).toBeCloseTo(live.width, 0)
    expect(without.height).toBeCloseTo(live.height, 0)
    expect(withReconcile.width).toBeCloseTo(live.width, 0)
    expect(withReconcile.height).toBeCloseTo(live.height, 0)
  })

  it.each(['fixed', 'sticky'])('keeps scaled %s dimensions in clip captures', async (position) => {
    root = document.createElement('div')
    root.style.cssText = 'position:absolute;left:0;top:0;width:300px;height:200px;' +
      `overflow:${position === 'sticky' ? 'auto' : 'hidden'};background:rgb(255,255,255)`
    const box = document.createElement('div')
    box.style.cssText = `position:${position};left:20px;top:20px;width:100px;height:40px;` +
      'background:rgb(220,30,30);transform:scale(1.5);transform-origin:0 0'
    const filler = document.createElement('div')
    filler.style.height = '1000px'
    root.append(box, filler)
    document.body.appendChild(root)
    if (position === 'sticky') root.scrollTop = 100

    const live = box.getBoundingClientRect()
    const result = await snapdom(root, {
      clip: { x: 0, y: 0, width: 300, height: 200 },
      reconcile: true,
      dpr: 1,
      compress: false,
    })
    const painted = redBounds(await result.toCanvas())

    expect(painted.width).toBeCloseTo(live.width, 0)
    expect(painted.height).toBeCloseTo(live.height, 0)
  })

  it.each([1, 2])('keeps fixed dimensions under a transformed ancestor (own scale %s)', async (scale) => {
    root = document.createElement('div')
    root.style.cssText = 'position:absolute;left:0;top:0;width:600px;height:200px;' +
      'overflow:hidden;background:rgb(255,255,255)'
    const parent = document.createElement('div')
    parent.style.cssText = 'position:relative;width:180px;height:100px;' +
      'transform:scale(1.5);transform-origin:0 0'
    const box = document.createElement('div')
    box.style.cssText = 'position:fixed;left:20px;top:20px;width:100px;height:40px;' +
      'background:rgb(220,30,30)' + (scale === 1 ? '' :
        `;transform:scale(${scale});transform-origin:0 0`)
    // Exercise browsers without Typed OM: freeze leaves transform:'' when only the ancestor
    // is transformed, but the box is still already flattened to its painted size.
    Object.defineProperty(box, 'computedStyleMap', { value: undefined })
    parent.appendChild(box)
    root.appendChild(parent)
    document.body.appendChild(root)

    const live = box.getBoundingClientRect()
    const result = await snapdom(root, {
      clip: { x: 0, y: 0, width: 600, height: 200 },
      reconcile: true,
      dpr: 1,
      compress: false,
    })
    const painted = redBounds(await result.toCanvas())

    expect(painted.width).toBeCloseTo(live.width, 0)
    expect(painted.height).toBeCloseTo(live.height, 0)
  })

  it.each([1, 2])('preserves descendant dimensions in a flattened fixed box (child scale %s)', async (scale) => {
    root = document.createElement('div')
    root.style.cssText = 'position:absolute;left:0;top:0;width:300px;height:200px;' +
      'overflow:hidden;background:rgb(255,255,255)'
    const fixed = document.createElement('div')
    fixed.style.cssText = 'position:fixed;left:10px;top:10px;width:100px;height:60px;' +
      'transform:scale(1.5);transform-origin:0 0'
    const box = document.createElement('div')
    box.style.cssText = 'position:absolute;left:10px;top:10px;width:40px;height:20px;' +
      `background:rgb(220,30,30);transform:scale(${scale});transform-origin:0 0`
    fixed.appendChild(box)
    root.appendChild(fixed)
    document.body.appendChild(root)

    const live = box.getBoundingClientRect()
    const result = await snapdom(root, {
      clip: { x: 0, y: 0, width: 300, height: 200 },
      reconcile: true,
      dpr: 1,
      compress: false,
    })
    const painted = redBounds(await result.toCanvas())

    expect(painted.width).toBeCloseTo(live.width, 0)
    expect(painted.height).toBeCloseTo(live.height, 0)
  })

  it('keeps fixed dimensions below a scaled capture root', async () => {
    root = document.createElement('div')
    root.style.cssText = 'position:absolute;left:0;top:0;width:300px;height:200px;' +
      'overflow:hidden;background:rgb(255,255,255);transform:scale(1.5);transform-origin:0 0'
    const box = document.createElement('div')
    box.style.cssText = 'position:fixed;left:20px;top:20px;width:100px;height:40px;' +
      'background:rgb(220,30,30);transform:scale(1.5);transform-origin:0 0'
    root.appendChild(box)
    document.body.appendChild(root)

    const live = box.getBoundingClientRect()
    const result = await snapdom(root, {
      clip: { x: 0, y: 0, width: 450, height: 300 },
      reconcile: true,
      dpr: 1,
      compress: false,
    })
    const painted = redBounds(await result.toCanvas())

    expect(painted.width).toBeCloseTo(live.width, 0)
    expect(painted.height).toBeCloseTo(live.height, 0)
  })

  it('does not treat a plugin root resize as a transform', async () => {
    root = document.createElement('div')
    root.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:100px;' +
      'overflow:hidden;background:rgb(255,255,255)'
    const box = document.createElement('div')
    box.style.cssText = 'position:fixed;left:10px;top:10px;width:100px;height:40px;' +
      'background:rgb(220,30,30)'
    root.appendChild(box)
    document.body.appendChild(root)

    const live = box.getBoundingClientRect()
    const result = await snapdom(root, {
      clip: { x: 0, y: 0, width: 200, height: 100 },
      reconcile: true,
      dpr: 1,
      compress: false,
      plugins: [{
        name: 'resize-clone-root',
        afterClone({ clone }) { clone.style.width = '150px' },
      }],
    })
    const painted = redBounds(await result.toCanvas())

    expect(painted.width).toBeCloseTo(live.width, 0)
    expect(painted.height).toBeCloseTo(live.height, 0)
  })

  it('keeps fixed dimensions from a same-origin iframe realm', async () => {
    const frame = document.createElement('iframe')
    frame.width = '300'
    frame.height = '200'
    document.body.appendChild(frame)
    const doc = frame.contentDocument
    doc.body.style.margin = '0'
    const frameRoot = doc.createElement('div')
    frameRoot.style.cssText = 'position:absolute;left:0;top:0;width:300px;height:200px;' +
      'overflow:hidden;background:rgb(255,255,255)'
    const box = doc.createElement('div')
    box.style.cssText = 'position:fixed;left:20px;top:20px;width:100px;height:40px;' +
      'background:rgb(220,30,30);transform:scale(1.5);transform-origin:0 0'
    frameRoot.appendChild(box)
    doc.body.appendChild(frameRoot)

    try {
      const live = box.getBoundingClientRect()
      const result = await snapdom(frameRoot, {
        clip: { x: 0, y: 0, width: 300, height: 200 },
        reconcile: true,
        dpr: 1,
        compress: false,
      })
      const painted = redBounds(await result.toCanvas())

      expect(painted.width).toBeCloseTo(live.width, 0)
      expect(painted.height).toBeCloseTo(live.height, 0)
    } finally {
      frame.remove()
    }
  })
})
