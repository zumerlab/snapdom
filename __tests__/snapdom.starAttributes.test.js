import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/index'

describe('*-prefixed HTML attributes', () => {
  let host
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host) })
  afterEach(() => host.remove())

  it('does not throw EncodingError when an element has an *-prefixed attribute', async () => {
    // *-prefixed names are illegal via setAttribute but the HTML parser accepts
    // them (this is how Angular structural directives actually reach the DOM).
    host.innerHTML = '<div *ngIf="true" *ngFor="let item of items" *data-custom="value">inside</div>'

    const canvas = await snapdom.toCanvas(host, { scale: 1, dpr: 1 })
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
  })

  it('produces an SVG with no *-prefixed attributes', async () => {
    host.innerHTML = '<span *ngIf="true" *custom-attr="value">hi</span>'

    const raw = await snapdom.toRaw(host)
    const svg = decodeURIComponent(raw.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
    expect(svg).not.toMatch(/\*\w/)
  })
})
