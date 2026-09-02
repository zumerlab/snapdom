// The pseudo pass snapshots a pseudo-element's computed style the way styles.js snapshots the
// element's: pruned to the property universe, and SHARED between identity twins with only the
// used-value props re-read per twin (pseudoSnapshotFor). Both are byte-exact by construction;
// these pin it, plus the one thing a twin must never inherit — a used width.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { flushStyleInvalidations } from '../src/modules/styles.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mount(html, css) {
  const st = document.createElement('style')
  st.textContent = css
  document.head.appendChild(st)
  mounted.push(st)
  const el = document.createElement('div')
  el.style.cssText = 'width:480px;background:#fff;font:14px Arial'
  el.innerHTML = html
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

async function settle() {
  await new Promise((r) => setTimeout(r, 0))
  flushStyleInvalidations()
}

async function dirty(el) {
  el.setAttribute('data-probe-dirty', '1')
  el.removeAttribute('data-probe-dirty')
  await settle()
}

describe('pseudo snapshots shared between identity twins', () => {
  it('a list of twin ::before is byte-identical with the share off', async () => {
    const el = mount(
      '<ul class="ps">' + '<li>item</li>'.repeat(40) + '</ul>',
      '.ps li::before{content:"\\2022";display:inline-block;width:12px;color:#c00;font-weight:700;margin-right:4px}')
    await settle()
    await snapdom.toRaw(el, { burst: false })
    await dirty(el)
    const on = await snapdom.toRaw(el, { burst: false })
    await dirty(el)
    const off = await snapdom.toRaw(el, { burst: false, __styleShare: false })
    expect(on).toBe(off)
  })

  it('a %-wide ::before keeps its own used width under a wider twin', async () => {
    // Twins under 120px and 320px grid columns; `width:50%` on the pseudo resolves to 60px
    // and 160px. A shared width would give the wide twin a 60px bar.
    const el = mount(
      '<div class="pg"><div class="pc"><div class="pt"></div></div><div class="pc"><div class="pt"></div></div></div>',
      '.pg{display:grid;grid-template-columns:120px 320px}.pt{height:20px}' +
      '.pt::before{content:"";display:block;width:50%;height:20px;background:#0000e0}')
    await settle()
    const c = await snapdom.toCanvas(el, { scale: 1, dpr: 1, burst: false })
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    // Blue run on the pseudo's row inside the WIDE column (x from 120 on): expect ~160px.
    let wide = 0
    for (let x = 120; x < c.width; x++) {
      const i = (10 * c.width + x) * 4
      if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0xe0) wide++
    }
    expect(wide).toBeGreaterThan(150)
    expect(wide).toBeLessThan(170)
  })
})
