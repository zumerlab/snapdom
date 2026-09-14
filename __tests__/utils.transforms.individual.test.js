import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { readIndividualTransforms, readTotalTransformMatrix } from '../src/utils/transforms.helpers.js'
import { composeResidual2D } from '../src/utils/capture.helpers.js'

const mounted = []
afterEach(() => { for (const node of mounted.splice(0)) node.remove() })
const options = { burst: false, embedFonts: false, dpr: 1, scale: 1, outerTransforms: true }
function box(css) {
  const el = document.createElement('div')
  el.style.cssText = 'position:absolute;left:200px;top:200px;width:100px;height:80px;background:rgb(255,0,0);transform-origin:25% 75%;' + css
  document.body.appendChild(el)
  mounted.push(el)
  return el
}
function redPixels(canvas) {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 200 && data[i + 1] < 50 && data[i + 2] < 50 && data[i + 3] > 200) count++
  }
  return count
}

describe('individual transforms share the root and frozen-position matrix composition', () => {
  it.each([
    ['scale:2', 'scale(2)'],
    ['scale:2 3', 'scale(2,3)'],
    ['rotate:90deg;scale:2 3', 'rotate(90deg) scale(2,3)'],
    ['rotate:0.25turn;scale:150% 50%', 'rotate(90deg) scale(1.5,.5)'],
    ['scale:-1 2', 'scale(-1,2)'],
  ])('preserves the full bbox and painted area for %s', async (individual, equivalent) => {
    const el = box(individual)
    const result = await snapdom(el, options)
    el.style.rotate = 'none'
    el.style.scale = 'none'
    el.style.transform = equivalent
    const control = await snapdom(el, options)
    expect(result.meta).toEqual(control.meta)
    expect(redPixels(await result.toCanvas())).toBe(redPixels(await control.toCanvas()))
  })

  it('strips individual percent translation just like matrix translation', async () => {
    const el = box('translate:50% -25%;scale:2')
    const result = await snapdom(el, options)
    el.style.translate = 'none'
    el.style.scale = 'none'
    el.style.transform = 'translate(50%, -25%) scale(2)'
    const control = await snapdom(el, options)
    expect(result.meta).toEqual(control.meta)
    expect(redPixels(await result.toCanvas())).toBe(redPixels(await control.toCanvas()))
  })

  it('uses the same residual origin for clipped individual and matrix transforms', async () => {
    const el = box('scale:2;translate:50% -25%')
    const rect = el.getBoundingClientRect()
    const clip = { x: rect.left + window.scrollX + 50, y: rect.top + window.scrollY + 20, width: 80, height: 60 }
    const result = await snapdom(el, { ...options, clip })
    el.style.translate = 'none'
    el.style.scale = 'none'
    el.style.transform = 'translate(50%, -25%) scale(2)'
    const control = await snapdom(el, { ...options, clip })
    expect(result.meta).toEqual(control.meta)
    expect(redPixels(await result.toCanvas())).toBe(redPixels(await control.toCanvas()))
  })

  it('keeps individual scale in the bbox when outerTransforms:false rewrites transform', async () => {
    const el = box('scale:2 3;transform:scale(1.5)')
    const result = await snapdom(el, { ...options, outerTransforms: false })
    expect(result.meta.vbW).toBe(306)
    expect(result.meta.vbH).toBe(366)
    expect(redPixels(await result.toCanvas())).toBe(300 * 360)
  })

  it('normalizes none and preserves zero/nonuniform scale in both readers', () => {
    const el = box('scale:0 2')
    const individual = readIndividualTransforms(el)
    expect(individual.rotate).toBe('0deg')
    expect(individual.translate).toBeNull()
    const M = composeResidual2D('', individual)
    expect(M.a).toBe(0)
    expect(M.d).toBe(2)
    expect(composeResidual2D('', { rotate: 'none', scale: '2 3' }).d).toBe(3)
  })

  it('composes CSS order and resolves percentages against the supplied box', () => {
    const M = readTotalTransformMatrix({ translate: '50% 25%', rotate: '90deg', scale: '2 3', baseTransform: 'translate(10px,20px)', width: 200, height: 80 })
    const expected = new DOMMatrix('translate(100px,20px) rotate(90deg) scale(2,3) translate(10px,20px)')
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) expect(M[key]).toBeCloseTo(expected[key], 8)
  })

  it('keeps axis rotations and three-axis scale in the matrix', () => {
    const M = readTotalTransformMatrix({ rotate: 'x 0.25turn', scale: '2 3 4', translate: '1px 2px 3px' })
    const expected = new DOMMatrix('translate3d(1px,2px,3px) rotateX(90deg) scale3d(2,3,4)')
    expect([...M.toFloat64Array()]).toEqual([...expected.toFloat64Array()])
  })

  it('resolves calc percentages through the reference-box fallback', () => {
    const css = document.createElement('style')
    css.textContent = 'div{width:10px!important;height:5px!important;transform:scale(7)!important}'
    document.head.appendChild(css)
    mounted.push(css)
    const M = readTotalTransformMatrix({ translate: 'calc(50% + 10px) calc(25% - 2px)', width: 200, height: 80 })
    expect(M.e).toBe(110)
    expect(M.f).toBe(18)
  })
})
