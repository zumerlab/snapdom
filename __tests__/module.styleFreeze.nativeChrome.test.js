// Every engine drops a control's native look for an author border or background, and the
// base reset and the class restated both: unstyled fields and buttons came out in a dark 2px
// frame, <progress> as a green slab. A shaded border lost its `currentcolor`, which Blink
// shades from a light grey: an <hr> came out near black. Found on html2pdf.js's all-tags page.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { inlineAllStyles } from '../src/modules/styles.js'

let host
afterEach(() => { host?.remove(); host = null })

function mount(html) {
  host = document.createElement('div')
  host.style.cssText = 'width:400px;background:white;color:rgb(0,0,0)'
  host.innerHTML = html
  document.body.appendChild(host)
  return host.lastElementChild
}

async function styleKeyFor(el) {
  const clone = el.cloneNode(true)
  const session = { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() }
  await inlineAllStyles(el, clone, session)
  return session.styleMap.get(clone) || ''
}

const REVERTED = /(?:^|;)background:revert;border-radius:revert;border:revert(?:;|$)/

describe('a control the page did not paint', () => {
  const controls = {
    'text field': '<input type="text" value="Value">',
    'submit button': '<input type="submit" value="Send">',
    button: '<button>Button</button>',
    select: '<select><option>One</option></select>',
    textarea: '<textarea>Text</textarea>',
    progress: '<progress value="0.6"></progress>',
    meter: '<meter value="0.6"></meter>',
    'disabled field': '<input type="text" disabled>',
  }
  for (const [name, html] of Object.entries(controls)) {
    it(`hands the ${name} its UA paint back`, async () => {
      const key = await styleKeyFor(mount(html))
      expect(key).toMatch(REVERTED)
      // Nothing of the paint is left frozen beside the three shorthands.
      expect(key).not.toMatch(/(?:^|;)(?:background-|border-(?!radius:revert|collapse|spacing))/)
    })
  }

  it('reaches the serialized capture', async () => {
    mount('<input type="text" value="Value">')
    const svg = decodeURIComponent((await snapdom(host, { cache: 'disabled' })).url.split(',')[1])
    expect(svg).toMatch(/border:revert/)
  })
})

describe('a control the page painted', () => {
  const painted = {
    border: '<style>.p{border:1px solid rgb(200,0,0)}</style><input class="p" type="text">',
    background: '<style>.p{background-color:rgb(250,240,200)}</style><input class="p" type="text">',
    'border radius': '<style>.p{border-radius:6px}</style><button class="p">Button</button>',
    'no border at all': '<style>.p{border:0}</style><input class="p" type="text">',
  }
  for (const [name, html] of Object.entries(painted)) {
    it(`keeps its frozen values: ${name}`, async () => {
      expect(await styleKeyFor(mount(html))).not.toMatch(/revert/)
    })
  }

  // Computed style cannot tell these from an unpainted control: the values are the UA's.
  // The engine still drops the native look, so the clone must keep the frozen frame.
  const declared = {
    'the UA background, declared': '<style>input{background-color:#fff}</style><input type="text">',
    'the UA border, declared': '<style>.p{border:2px inset rgb(118,118,118)}</style><input class="p" type="text">',
    'a style attribute': '<input type="text" style="background-color:rgb(255,255,255)">',
    'a rule under a media query that holds': '<style>@media all{input{background-color:#fff}}</style><input type="text">',
  }
  for (const [name, html] of Object.entries(declared)) {
    it(`keeps its frozen values: ${name}`, async () => {
      const el = mount(html)
      const live = getComputedStyle(el).backgroundColor
      const key = await styleKeyFor(el)
      expect(key).not.toMatch(/revert/)
      expect(key).toContain(`background-color:${live}`)
    })
  }

  const unpainted = {
    'a rule under a media query that does not hold': '<style>@media print{*{background:transparent!important}input{border:1px solid #999}}</style><input type="text">',
    'a rule for its pseudo-element': '<style>input::placeholder{background:yellow}</style><input type="text" placeholder="x">',
    'a keyframe that names a background': '<style>@keyframes k{from{background-color:red}to{background-color:blue}}</style><input type="text">',
    'a rule that paints something else': '<style>.other{background:red;border:1px solid}</style><input type="text">',
  }
  for (const [name, html] of Object.entries(unpainted)) {
    it(`still hands the paint back past ${name}`, async () => {
      expect(await styleKeyFor(mount(html))).toMatch(REVERTED)
    })
  }

  it('leaves the controls the clone draws itself alone', async () => {
    expect(await styleKeyFor(mount('<input type="checkbox">'))).not.toMatch(/revert/)
    expect(await styleKeyFor(mount('<input type="radio">'))).not.toMatch(/revert/)
  })
})

describe('a shaded border in the text colour', () => {
  it('keeps `currentcolor` on an unstyled <hr>', async () => {
    const key = await styleKeyFor(mount('<hr>'))
    for (const side of ['top', 'right', 'bottom', 'left']) expect(key).toContain(`border-${side}-color:currentcolor`)
  })

  it('keeps it on inset, outset, ridge and groove from a stylesheet', async () => {
    for (const style of ['inset', 'outset', 'ridge', 'groove']) {
      const key = await styleKeyFor(mount(`<style>.b{border:4px ${style}}</style><div class="b">x</div>`))
      expect(key, style).toContain('border-top-color:currentcolor')
      host.remove()
    }
  })

  it('keeps the colour an author named, though it is the text colour', async () => {
    const rule = await styleKeyFor(mount('<style>.b{border:4px ridge rgb(200,0,0);color:rgb(200,0,0)}</style><div class="b">x</div>'))
    expect(rule).toContain('border-top-color:rgb(200, 0, 0)')
    host.remove()
    const attr = await styleKeyFor(mount('<div style="border:4px ridge rgb(0,0,0)">x</div>'))
    expect(attr).not.toContain('currentcolor')
  })

  it('keeps the colour the UA sheet names for a button the page painted', async () => {
    // ButtonBorder resolves to the text colour in Chromium: the same rgb as `currentcolor`.
    const key = await styleKeyFor(mount('<style>button{background-color:#fff}</style><button>Button</button>'))
    expect(key).not.toContain('currentcolor')
    expect(key).not.toMatch(/revert/)
  })

  it('leaves a shaded border of another colour, and a solid one, as resolved', async () => {
    const other = await styleKeyFor(mount('<style>.b{border:4px ridge rgb(200,0,0)}</style><div class="b">x</div>'))
    expect(other).toContain('border-top-color:rgb(200, 0, 0)')
    host.remove()
    const solid = await styleKeyFor(mount('<style>.b{border:4px solid}</style><div class="b">x</div>'))
    expect(solid).not.toContain('currentcolor')
  })
})
