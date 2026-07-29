// @media inside shadow-root CSS and kept light-DOM <style> clones must be resolved at
// capture time: the serialized SVG is its own tiny viewport, so a passed-through
// condition re-evaluates against the IMAGE size instead of the page's.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

async function captureSvg(el) {
  const res = await snapdom(el, { cache: 'disabled' })
  return decodeURIComponent(res.url.split(',')[1])
}

describe('@media frozen to the live viewport', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('light-DOM <style>: matching block inlines unwrapped, non-matching drops', async () => {
    const host = document.createElement('div')
    const style = document.createElement('style')
    // Viewport is 1280 wide in the test runner: min-width 400 matches, min-width 9000 doesn't.
    style.textContent = `
      @media (min-width: 400px) { .zz-m { border-top-color: rgb(1, 2, 3); } }
      @media (min-width: 9000px) { .zz-m { border-top-color: rgb(9, 9, 9); } }
    `
    const target = document.createElement('div')
    target.className = 'zz-m'
    target.textContent = 'media'
    host.appendChild(style)
    host.appendChild(target)
    document.body.appendChild(host)

    const svg = await captureSvg(host)
    expect(svg).not.toContain('@media')
    expect(svg).toContain('rgb(1, 2, 3)')
    expect(svg).not.toContain('rgb(9, 9, 9)')
  })

  it('shadow-root CSS: media state is frozen at extraction', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const el = document.createElement('div')
    const sr = el.attachShadow({ mode: 'open' })
    sr.innerHTML = `
      <style>
        @media (min-width: 400px) { .in { outline-color: rgb(4, 5, 6); } }
        @media (min-width: 9000px) { .in { outline-color: rgb(8, 8, 8); } }
      </style>
      <span class="in">shadow</span>
    `
    host.appendChild(el)

    const svg = await captureSvg(host)
    expect(svg).not.toContain('@media')
    expect(svg).toContain('rgb(4, 5, 6)')
    expect(svg).not.toContain('rgb(8, 8, 8)')
  })

  it('@supports keeps its wrapper (viewport-independent condition)', async () => {
    const host = document.createElement('div')
    const style = document.createElement('style')
    style.textContent = '@media (min-width: 400px) { @supports (display: grid) { .zz-s { column-rule-color: rgb(7, 7, 7); } } }'
    const target = document.createElement('div')
    target.className = 'zz-s'
    target.textContent = 'sup'
    host.appendChild(style)
    host.appendChild(target)
    document.body.appendChild(host)

    const svg = await captureSvg(host)
    expect(svg).toContain('@supports')
    expect(svg).toContain('rgb(7, 7, 7)')
    expect(svg).not.toContain('@media')
  })
})
