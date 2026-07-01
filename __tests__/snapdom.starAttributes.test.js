import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/index'

describe('*-prefixed HTML attributes', () => {
  let host
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host) })
  afterEach(() => host.remove())

  it('does not throw EncodingError when an element has an *-prefixed attribute', async () => {
    const el = document.createElement('div')
    el.setAttribute('*ngIf', 'true')
    el.setAttribute('*ngFor', 'let item of items')
    el.setAttribute('*data-custom', 'value')
    el.textContent = 'inside'
    host.appendChild(el)

    const canvas = await snapdom.toCanvas(host, { scale: 1, dpr: 1 })
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
  })

  it('produces an SVG with no *-prefixed attributes', async () => {
    const el = document.createElement('span')
    el.setAttribute('*ngIf', 'true')
    el.setAttribute('*custom-attr', 'value')
    el.textContent = 'hi'
    host.appendChild(el)

    const raw = await snapdom.toRaw(host)
    const svg = decodeURIComponent(raw.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
    expect(svg).not.toMatch(/\*\w/)
  })
})
