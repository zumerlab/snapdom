import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

// querySelectorAll never matches the element it's called on: url(#id) references carried
// on the captured <svg> root's OWN attributes (fill/filter/style…) were never collected,
// so shared external defs stayed dangling and the shape rasterized unpainted (#461 shape).

describe('svg defs referenced from the root svg element', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('inlines defs referenced by the root svg attributes and style', async () => {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    defs.setAttribute('width', '0')
    defs.setAttribute('height', '0')
    defs.innerHTML = '<defs><linearGradient id="bh-g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>'
    document.body.appendChild(defs)

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.setAttribute('width', '40')
    icon.setAttribute('height', '40')
    icon.setAttribute('viewBox', '0 0 40 40')
    icon.setAttribute('fill', 'url(#bh-g)')
    icon.innerHTML = '<rect width="40" height="40"/>'
    document.body.appendChild(icon)

    const result = await snapdom(icon)
    const svg = decodeURIComponent(result.url.split(',')[1])
    expect(svg).toContain('bh-g')
    expect(svg).toContain('<linearGradient')
  })
})
