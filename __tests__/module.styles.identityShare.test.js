// The identity-share fast path (styles.js): one full style read per structural identity,
// per-node re-reads only for the layout-varying props. Fidelity is gated, and every gate
// here is asserted in PIXELS or in bytes — never on the flag itself.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { flushStyleInvalidations } from '../src/modules/styles.js'
import { bigTableHTML } from './category.libs.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mount(html, css) {
  if (css) {
    const st = document.createElement('style')
    st.textContent = css
    document.head.appendChild(st)
    mounted.push(st)
  }
  const el = document.createElement('div')
  // Sized to its content: a full-width block container would put the fractional sample
  // points into empty space beside the spans (the object-test trap, again).
  el.style.display = 'inline-block'
  el.innerHTML = html
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

/** Drain pending mutation records (the mount itself queues some) and settle stamps. A
 *  capture whose assets phase runs while the MOUNT record is still pending trips
 *  needsBackgroundInline's conservative stamps-moved fallback, which inlines extra inert
 *  longhands — byte noise that is pixel-neutral, pre-existing, and ORDER-dependent (verified
 *  by swapping arm order: the asymmetry swaps with it). Settling makes byte comparison
 *  meaningful. */
async function settle() {
  await new Promise((r) => setTimeout(r, 0))
  flushStyleInvalidations()
}

async function px(el, fx, fy, opts = {}) {
  const c = await snapdom.toCanvas(el, { embedFonts: false, scale: 1, dpr: 1, burst: false, ...opts })
  const d = c.getContext('2d').getImageData(
    Math.min(c.width - 1, Math.round(c.width * fx)),
    Math.min(c.height - 1, Math.round(c.height * fy)), 1, 1).data
  return `${d[0]},${d[1]},${d[2]}`
}

describe('identity share — the fast path itself', () => {
  it('produces a BYTE-identical payload to the full-read path', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:640px;font-family:Arial,sans-serif;font-size:13px'
    el.innerHTML = bigTableHTML(120)
    document.body.appendChild(el)
    mounted.push(el)
    await settle()
    await snapdom.toRaw(el, { burst: false }) // warm: absorbs first-capture stamp churn
    await settle()
    const on = await snapdom.toRaw(el, { burst: false })
    await settle()
    const off = await snapdom.toRaw(el, { burst: false, __styleShare: false })
    expect(on).toBe(off)
  })
})

describe('identity share — the gates, in pixels', () => {
  // Every scene below has two elements with IDENTICAL tag + attributes + chain that the
  // author CSS styles DIFFERENTLY. If the gate ever fails and the snapshot is shared, the
  // second element paints the first one's colour — which is exactly what each test would
  // catch.
  const BOX = 'display:inline-block;width:40px;height:40px'

  it(':nth-child differentiates identical siblings', async () => {
    const el = mount(
      '<span class="nth-g"></span><span class="nth-g"></span>',
      `.nth-g { ${BOX}; background: rgb(0,0,255) } .nth-g:nth-child(2) { background: rgb(255,0,0) }`)
    expect(await px(el, 0.2, 0.5)).toBe('0,0,255')
    expect(await px(el, 0.75, 0.5)).toBe('255,0,0')
  })

  it('sibling combinators differentiate identical siblings', async () => {
    const el = mount(
      '<span class="sib-g"></span><span class="sib-g"></span>',
      `.sib-g { ${BOX}; background: rgb(0,0,255) } .sib-g + .sib-g { background: rgb(255,0,0) }`)
    expect(await px(el, 0.75, 0.5)).toBe('255,0,0')
  })

  it(':has() differentiates by content', async () => {
    const el = mount(
      '<div class="has-g"><i></i></div><div class="has-g"></div>',
      `.has-g { ${BOX}; background: rgb(0,0,255) } .has-g:has(i) { background: rgb(255,0,0) }`)
    expect(await px(el, 0.2, 0.5)).toBe('255,0,0')
    expect(await px(el, 0.75, 0.5)).toBe('0,0,255')
  })

  it('the focused element keeps its focus styling', async () => {
    const el = mount(
      '<button class="foc-g">a</button><button class="foc-g">a</button>',
      `.foc-g { ${BOX}; border:0; background: rgb(0,0,255) } .foc-g:focus { background: rgb(255,0,0) }`)
    el.querySelectorAll('button')[1].focus()
    // Dominance, not equality: the UA focus ring blends over the button at some sample
    // points, so exact red is engine-dependent — red-vs-blue dominance is not.
    const [fr, , fb] = (await px(el, 0.75, 0.5)).split(',').map(Number)
    expect(fr).toBeGreaterThan(120)
    expect(fb).toBeLessThan(80)
    const [ur, , ub] = (await px(el, 0.2, 0.5)).split(',').map(Number)
    expect(ub).toBeGreaterThan(120)
    expect(ur).toBeLessThan(80)
  })

  it('layout-varying values stay per-node even when the identity matches', async () => {
    // Identical identities, different content: the second cell is wider. A shared width
    // would squeeze or stretch one of them.
    const el = mount(
      '<table style="border-collapse:collapse"><tr>' +
      '<td style="padding:4px;background:rgb(0,0,255)">x</td>' +
      '<td style="padding:4px;background:rgb(255,0,0)">a much longer cell that stretches wide</td>' +
      '</tr></table>')
    await settle()
    await snapdom.toRaw(el, { burst: false })
    await settle()
    const raw = await snapdom.toRaw(el, { burst: false })
    await settle()
    const off = await snapdom.toRaw(el, { burst: false, __styleShare: false })
    expect(raw).toBe(off)
  })
})
