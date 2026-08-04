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

  // A rule that can NEST (CSS nesting, @scope, @container) used to fall through to the
  // verbatim cssText branch, carrying its inner @media into the SVG — where the condition
  // re-evaluates against the image box. A 300px component repainted at its mobile
  // breakpoint although that breakpoint is false on the live page.
  it('an @media nested inside a CSS-nesting rule is resolved, not leaked', async () => {
    async function centre(host) {
      const res = await snapdom(host, { cache: 'disabled', dpr: 1, scale: 1 })
      const c = await res.toCanvas()
      const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data
      return `${d[0]},${d[1]},${d[2]}`
    }
    const shapes = {
      'plain @media (control)': '.zzbox { background: rgb(0,128,0) } @media (max-width:350px) { .zzbox { background: rgb(255,0,0) } }',
      'nested @media': '.zzbox { background: rgb(0,128,0); & { @media (max-width:350px) { background: rgb(255,0,0) } } }',
    }
    for (const [label, css] of Object.entries(shapes)) {
      const host = document.createElement('div')
      host.style.cssText = 'width:300px'
      const style = document.createElement('style')
      style.textContent = css
      host.appendChild(style)
      host.insertAdjacentHTML('beforeend', '<div class="zzbox" style="width:300px;height:60px"></div>')
      document.body.appendChild(host)
      // Precondition: the breakpoint is FALSE live (the runner viewport is wide).
      expect(getComputedStyle(host.querySelector('.zzbox')).backgroundColor).toBe('rgb(0, 128, 0)')
      const painted = await centre(host)
      host.remove()
      expect(painted, label).toContain('0,128,0')
    }
  })

  it('@container passes through verbatim (it shares conditionText with @supports)', async () => {
    const host = document.createElement('div')
    const style = document.createElement('style')
    // The light-DOM path only rewrites <style> clones that mention @media, so mix both —
    // that is the reported shape. Rewriting @container as @supports would either force the
    // block on (unnamed: a valid declaration always "supports") or drop it (named: invalid).
    style.textContent = `
      @media (min-width: 400px) { .zz-c0 { border-top-color: rgb(4, 4, 4); } }
      .zz-w { container-name: side; container-type: inline-size; }
      @container (min-width: 400px) { .zz-c1 { column-rule-color: rgb(5, 5, 5); } }
      @container side (min-width: 400px) { .zz-c2 { column-rule-color: rgb(6, 6, 6); } }
    `
    host.appendChild(style)
    host.innerHTML += '<div class="zz-w"><div class="zz-c1">a</div><div class="zz-c2">b</div></div>'
    document.body.appendChild(host)

    const svg = await captureSvg(host)
    expect(svg).toContain('@container (min-width: 400px)')
    expect(svg).toContain('@container side (min-width: 400px)')
    expect(svg).not.toContain('@supports')
  })
})
