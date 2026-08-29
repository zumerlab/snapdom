// #491 — a row of inline boxes line-wrapped in the capture (ilios/frontend header buttons).
//
// snapdom freezes the used width of every box it does not soften. A fractional width was rounded
// UP to the next 1/16px so that Blink's 1/1000-rounded serialization could never leave a
// shrink-to-fit box a hair BELOW its true width and re-wrap its own text (#429).
//
// That ceil is paid PER BOX, and the shrink-to-fit parent that has to contain a row of them is
// only paid ONCE. The reporter's header is exactly that shape:
//
//   .header (flex) > .actions (shrink-to-fit) > <a><button>…</button></a> <a><button>…</button></a>
//
// live: 154.703125 + 188.515625 buttons inside a 347.671875 parent — 4.45px of slack, which is
// precisely the width of the whitespace between the two anchors. In the capture the two buttons
// grew 0.094px while their parent grew 0.016px, the space no longer fit, and "Upload Multiple
// Users" wrapped to a second line — outside the parent's frozen height, painting over the search
// box below it.
//
// The fix: nowrap boxes are frozen exactly (they can only clip sub-pixel, never re-wrap — the
// #474 rule, now independent of tag/display), and the nudge for the rest is the 1/1000 the
// serialization error actually needs instead of the 1/16 it used.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/index'
import { prepareClone } from '../src/core/prepare.js'
import { getStyleKey } from '../src/utils/css.js'

const STYLES = `
  .i491 * { box-sizing: border-box }
  .i491 { width: 900px; font-family: Arial, Helvetica, sans-serif; font-size: 16px }
  .i491 .header { display: flex; align-items: center; justify-content: space-between }
  .i491 .title { margin: 0; font-size: 20px }
  .i491 .actions a { text-decoration: none }
  .i491 button {
    display: inline-block; white-space: nowrap; border: none; border-radius: 3px;
    padding: 4.8px 16px; background: #2d7086; color: #fafafa; font: inherit;
  }
  /* control: same packed row, but the items CAN wrap → they keep the width nudge */
  .i491 .wrappable span { display: inline-block; background: #eee; padding: 2px 6px }
`
// The whitespace between the two anchors is load-bearing: it is the inline space that the
// parent's shrink-to-fit width accounts for and that the per-box round-ups used to eat.
const MARKUP = `
  <div class="header">
    <h2 class="title">Ilios Users (View All)</h2>
    <div class="actions">
        <a href="#"><button type="button">Create New User</button></a>
          <a href="#"><button type="button">Upload Multiple Users</button></a>
    </div>
  </div>
`

/**
 * Mounts the clone offscreen with its generated CSS so its layout can be measured with the same
 * engine as the live DOM. The mount goes in a SHADOW ROOT: cloned nodes keep their class names,
 * so in the light DOM this fixture's own rules would style them and the row would never wrap
 * regardless of what snapdom emitted.
 */
async function mountClone(root) {
  const { clone, classCSS } = await prepareClone(root, { embedFonts: false })
  const host = document.createElement('div')
  host.dataset.testCloneHost = '1'
  host.style.cssText = `position:absolute;left:-99999px;top:0;width:${root.getBoundingClientRect().width}px`
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })
  const styleEl = document.createElement('style')
  styleEl.textContent = classCSS || ''
  shadow.append(styleEl, clone)
  return shadow
}

/** Row index of every box, counted in line boxes from the top of their container. */
function lineOf(container, els) {
  const top = container.getBoundingClientRect().top
  return els.map((el) => Math.round((el.getBoundingClientRect().top - top) / 10))
}

function svgOf(raw) {
  return decodeURIComponent(raw.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
}
function classRules(svg) {
  const css = (svg.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [])[1] || ''
  const rules = {}
  css.replace(/\.(c\d+)\s*\{([^}]*)\}/g, (_, n, b) => { rules[n] = b; return _ })
  return rules
}
/** Declarations of every generated class on the first element matching `sel` in the SVG. */
function ruleFor(svg, sel) {
  const rules = classRules(svg)
  const m = svg.match(new RegExp(`<${sel}\\b[^>]*class="([^"]*)"[^>]*>`))
  const cls = (m || [])[1] || ''
  return cls.split(/\s+/).filter(Boolean).map((c) => rules[c] || '').join(';')
}

describe('#491 a packed inline row does not wrap in the capture', () => {
  let host, style
  beforeEach(() => {
    style = document.createElement('style')
    style.textContent = STYLES
    document.head.appendChild(style)
    host = document.createElement('div')
    host.className = 'i491'
    host.innerHTML = MARKUP
    document.body.appendChild(host)
  })
  afterEach(() => {
    host.remove()
    style.remove()
    document.querySelectorAll('[data-test-clone-host]').forEach((n) => n.remove())
  })

  it('keeps both buttons on one line, as they are live', async () => {
    const actions = host.querySelector('.actions')
    const liveLines = lineOf(actions, [...host.querySelectorAll('button')])
    expect(liveLines).toEqual([0, 0]) // guard: the fixture must not wrap live either

    const shadow = await mountClone(host)
    const cActions = shadow.querySelector('.actions')
    const cButtons = [...shadow.querySelectorAll('button')]
    expect(cButtons).toHaveLength(2)
    // pre-fix: [0, 3] — "Upload Multiple Users" on a second line, outside the frozen height
    expect(lineOf(cActions, cButtons)).toEqual([0, 0])
    expect(cActions.getBoundingClientRect().height)
      .toBeCloseTo(actions.getBoundingClientRect().height, 1)
  })

  it('does not inflate the frozen buttons past the width their parent was frozen at', async () => {
    const actions = host.querySelector('.actions')
    const liveSum = [...host.querySelectorAll('button')]
      .reduce((a, b) => a + b.getBoundingClientRect().width, 0)

    const shadow = await mountClone(host)
    const cloneSum = [...shadow.querySelectorAll('button')]
      .reduce((a, b) => a + b.getBoundingClientRect().width, 0)
    const parentGrowth = shadow.querySelector('.actions').getBoundingClientRect().width -
      actions.getBoundingClientRect().width

    // The row may never grow more than the box that has to hold it. Pre-fix: +0.094 vs +0.016.
    expect(cloneSum - liveSum).toBeLessThanOrEqual(parentGrowth + 1e-9)
  })

  it('freezes a nowrap box at its exact width, with no round-up to accumulate', async () => {
    const svg = svgOf(await snapdom.toRaw(host))
    const width = ruleFor(svg, 'button').match(/(?:^|;)width:([\d.]+)px/)
    expect(width).not.toBeNull()
    const live = host.querySelector('button').getBoundingClientRect().width
    // serialization rounds to 1/1000 in either direction; nothing else is added on top
    expect(Math.abs(parseFloat(width[1]) - live)).toBeLessThanOrEqual(0.0005)
  })
})

describe('#491 the width nudge stays big enough, and small enough', () => {
  it('still lifts a wrappable frozen width above the serialization error (#429)', () => {
    // 100.03px can stand for anything in [100.0295, 100.0305) — the frozen value must clear it.
    const key = getStyleKey({ display: 'block', width: '100.03px' }, 'div')
    const w = parseFloat(key.match(/(?:^|;)width:([\d.]+)px/)[1])
    expect(w).toBeGreaterThan(100.0305)
    expect(w).toBeLessThan(100.032) // and not a pixel more than that
  })

  it('accumulates less across a row than the single nudge its parent gets', () => {
    // Ten frozen siblings inside one frozen parent: the sum of their nudges must still be
    // smaller than the sub-pixel slack a shrink-to-fit parent realistically has (one space).
    const child = getStyleKey({ display: 'inline-block', width: '40.007px' }, 'div')
    const w = parseFloat(child.match(/(?:^|;)width:([\d.]+)px/)[1])
    expect((w - 40.007) * 10).toBeLessThan(0.05) // pre-fix: (40.0625 - 40.007) * 10 = 0.55px
  })

  it('adds nothing to a nowrap box, whatever its tag or display', () => {
    for (const [tag, display] of [['div', 'inline-block'], ['button', 'inline-block'], ['div', 'block']]) {
      const key = getStyleKey({ display, width: '77.777px', 'text-wrap-mode': 'nowrap' }, tag)
      expect(key).toContain('width:77.777px')
    }
  })

  it('reads white-space when the engine does not expose text-wrap-mode (WebKit)', () => {
    const key = getStyleKey({ display: 'inline-block', width: '77.777px', 'white-space': 'nowrap' }, 'div')
    expect(key).toContain('width:77.777px')
  })

  it('still nudges a box whose text can wrap, including pre-wrap and pre-line', () => {
    for (const ws of ['normal', 'pre-wrap', 'pre-line']) {
      const key = getStyleKey({ display: 'inline-block', width: '77.777px', 'white-space': ws }, 'div')
      expect(key).toContain('width:77.778px')
    }
  })
})
