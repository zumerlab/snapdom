// A cross-origin stylesheet makes the author-style scan unreliable (cssRules throws), and
// every pseudo gate turns null. ::before/::after/::first-letter already probed each node in
// that state; the scoped ::marker / ::first-line emitter treated null as "no rules" and a
// page with a Google Fonts <link> lost every authored marker and first line. Now null probes
// the boxes those pseudos can exist on, and the emitter still writes only what differs from
// the element's own style.
import { describe, it, expect, afterEach } from 'vitest'
import { commands } from '@vitest/browser/context'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mount(el) { document.body.appendChild(el); mounted.push(el); return el }

async function linkCrossOriginSheet() {
  const href = await commands.serveCrossOriginCss('.unreadable-elsewhere{color:red}')
  const link = mount(document.createElement('link'))
  link.rel = 'stylesheet'
  await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; link.href = href })
  expect(() => link.sheet.cssRules).toThrow() // the scan really cannot read it
}

async function scopedPseudoRule(el, pseudo) {
  const raw = decodeURIComponent((await snapdom.toRaw(el, { burst: false })).split(',')[1])
  return (raw.match(new RegExp(pseudo + '\\{[^}]*\\}', 'g')) || []).join(' ')
}

// Emission, not pixels: the defect is that these rules were SKIPPED under an unreliable scan.
// Native pseudo rendering inside a foreignObject varies by engine (Firefox paints no scoped
// ::marker colour), so module.pseudo.test.js pins the payload rule the same way, and pixel
// rendering under a readable scan is where those tests live.
describe('scoped ::marker and ::first-line under an unreliable scan', () => {
  it('an authored ::marker reaches the payload with its own colour', async () => {
    await linkCrossOriginSheet()
    const style = mount(document.createElement('style'))
    style.textContent = '.us-list li::marker{color:#c000c0;font-size:40px}'
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:160px;height:80px;background:#fff;font:16px Arial'
    root.innerHTML = '<ul class="us-list" style="margin:0;padding-left:60px"><li>x</li></ul>'
    const rule = await scopedPseudoRule(root, '::marker')
    expect(rule).toContain('rgb(192, 0, 192)')
    expect(rule).toContain('font-size:40px')
  })

  // ::first-line was SKIPPED entirely under an unreliable scan (the defect); now its scoped
  // rule reaches the payload with the pseudo's own colour. Asserted on the payload, not in
  // pixels: the same full-style read that the unreliable path forces pins the block's
  // measured `height`, and a foreignObject fragments its first line differently under an
  // explicit height — a render nuance downstream of the emission this fixes. In the ordinary
  // (readable-scan) case, module.pseudo.test.js pins that it paints.
  it('an authored ::first-line reaches the payload with its own colour', async () => {
    await linkCrossOriginSheet()
    const style = mount(document.createElement('style'))
    style.textContent = '.us-p::first-line{color:#c000c0;font-weight:700}'
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:200px;background:#fff;font:20px/1.2 Arial;color:#000'
    root.innerHTML = '<p class="us-p" style="margin:0">first line here and then a second line follows below</p>'
    const rule = await scopedPseudoRule(root, '::first-line')
    expect(rule).toContain('rgb(192, 0, 192)')
    expect(rule).toContain('font-weight:700')
  })
})
