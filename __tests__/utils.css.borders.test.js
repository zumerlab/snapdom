import { describe, it, expect } from 'vitest'
import { snapshotComputedStyle } from '../src/utils'

// #390: invisible-border props leak into the SVG foreignObject and render as
// faint lines on <canvas> at high scale. Drop them when the side doesn't paint.
describe('snapshotComputedStyle — invisible border stripping (#390)', () => {
  const SIDES = ['top', 'right', 'bottom', 'left']

  it('drops border props on sides with style:none', () => {
    const el = document.createElement('div')
    el.style.border = 'none'
    document.body.appendChild(el)
    const snap = snapshotComputedStyle(getComputedStyle(el))
    for (const s of SIDES) {
      expect(snap[`border-${s}-style`]).toBeUndefined()
      expect(snap[`border-${s}-width`]).toBeUndefined()
      expect(snap[`border-${s}-color`]).toBeUndefined()
    }
    document.body.removeChild(el)
  })

  it('drops border props on sides with width:0 (ECharts-style canvas)', () => {
    const el = document.createElement('canvas')
    el.style.border = '0 solid red'
    document.body.appendChild(el)
    const snap = snapshotComputedStyle(getComputedStyle(el))
    for (const s of SIDES) {
      expect(snap[`border-${s}-width`]).toBeUndefined()
      expect(snap[`border-${s}-color`]).toBeUndefined()
    }
    document.body.removeChild(el)
  })

  it('keeps border props on visible sides', () => {
    const el = document.createElement('div')
    el.style.border = '2px solid red'
    document.body.appendChild(el)
    const snap = snapshotComputedStyle(getComputedStyle(el))
    for (const s of SIDES) {
      expect(snap[`border-${s}-style`]).toBe('solid')
      expect(snap[`border-${s}-width`]).toBe('2px')
    }
    document.body.removeChild(el)
  })

  it('drops only the invisible side in a mixed border', () => {
    const el = document.createElement('div')
    el.style.borderTop = '3px solid blue'
    el.style.borderBottom = '0'
    document.body.appendChild(el)
    const snap = snapshotComputedStyle(getComputedStyle(el))
    expect(snap['border-top-style']).toBe('solid')
    expect(snap['border-top-width']).toBe('3px')
    expect(snap['border-bottom-style']).toBeUndefined()
    expect(snap['border-bottom-width']).toBeUndefined()
    document.body.removeChild(el)
  })
})
