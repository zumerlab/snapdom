// The svg engine keeps the page's line breaks in the clone while it serializes it under the
// layout zoom (src/modules/lineBreaks.js). Firefox lays zoomed text out up to a third of a
// pixel wider than the page, and a nearly full line broke a word early. The runner has no such
// drift, so the capture tests widen the clone's text through a plugin, the #516 technique, and
// stub a hi-DPI screen so the clone is zoomed at all (helpers/hidpi.js).
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { prepareClone } from '../src/core/prepare.js'
import { createContext } from '../src/core/context.js'
import { __diffStats } from '../src/core/diff.js'
import { freezeLineBreaks } from '../src/modules/lineBreaks.js'
import { ONE_LINE_PROP } from '../src/modules/styleFreeze.js'
import { isSafari } from '../src/utils/browser.js'
import { stubHiDPI } from './helpers/hidpi.js'

const PINS = ONE_LINE_PROP === 'text-wrap-mode'
// WebKit lays the clone out without the zoom, so nothing there needs the page's breaks.
const ZOOMS = PINS && !isSafari()
const JOINER = '\u2060'
const FONT = 'font:14px/20px Arial,sans-serif'
const TEXT = 'The quick brown fox jumps over the lazy dog, and the dog does not mind it at all today.'
const LONG = 'A flat colour or a filter layer needs no tiles, and the wave clears the veil off the ' +
  'screenshot from the click outwards as it goes. Pack my box with five dozen liquor jugs, then ' +
  'judge the sphinx of black quartz by its vow, and keep every line where the page put it.'

const mounted = []
const own = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
const ownGCS = window.getComputedStyle
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove()
  if (own) Object.defineProperty(window, 'devicePixelRatio', own)
  else delete window.devicePixelRatio
  window.getComputedStyle = ownGCS
})

function mount(html) {
  const host = document.createElement('div')
  host.innerHTML = html
  const el = host.firstElementChild
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

const isPin = (n) => n?.nodeType === 1 && /^all:unset;text-wrap-mode:nowrap;/.test(n.getAttribute('style') || '')
const pinsOf = (el) => [...el.querySelectorAll('span')].filter(isPin).map((n) => n.textContent)

/** Text nodes outside every pin: where the clone may still break. */
function loose(el) {
  const out = []
  for (const c of el.childNodes) {
    if (c.nodeType === 3) out.push(c.data)
    else if (c.nodeType === 1 && !isPin(c)) out.push(...loose(c))
  }
  return out
}

/** The page's lines of one text node, from its characters' boxes, white space trimmed. */
function liveLines(text) {
  const range = document.createRange()
  const lines = []
  let line = ''
  let top = null
  for (let i = 0; i < text.data.length; i++) {
    range.setStart(text, i)
    range.setEnd(text, i + 1)
    const r = range.getBoundingClientRect()
    if (r.height) {
      if (top !== null && Math.abs(r.top - top) > r.height / 2) {
        lines.push(line.trim())
        line = ''
      }
      top = r.top
    }
    line += text.data[i]
  }
  lines.push(line.trim())
  return lines
}

/**
 * The pass on the clone the clone stage built, with the clone as the tree to copy: the copy it
 * returns, after checking that the clone itself did not change.
 */
async function frozen(el) {
  const { clone, nodeMap } = await prepareClone(el, createContext({}))
  expect(clone.textContent).toBe(el.textContent)
  const before = clone.outerHTML
  const copy = freezeLineBreaks(clone, clone, nodeMap, document)
  expect(clone.outerHTML).toBe(before)
  return copy
}

describe.skipIf(!PINS)('freezeLineBreaks', () => {
  it('puts each line of the page in a nowrap pin, with the spaces it broke at between them', async () => {
    const p = mount(`<p style="width:220px;margin:0;${FONT}">${TEXT}</p>`)
    const lines = liveLines(p.firstChild)
    expect(lines.length).toBeGreaterThan(2)
    const copy = await frozen(p)
    expect(pinsOf(copy)).toEqual(lines)
    expect(loose(copy)).toEqual(lines.slice(1).map(() => ' '))
  })

  it('takes the spaces around a link or a <b> into the pins when its line goes on past them', async () => {
    const p = mount(`<p style="width:max-content;margin:0;${FONT}">Click <a href="#">this link</a> to open the <b>settings</b> panel</p>`)
    const copy = await frozen(p)
    // A lone word has nowhere to break, and the pins on either side hold the spaces.
    expect(pinsOf(copy)).toEqual(['Click ', 'this link', ' to open the ', ' panel'])
    expect(loose(copy)).toEqual(['settings'])
  })

  it('leaves the spaces around a link out of the pins where the page broke at them', async () => {
    const p = mount(`<p style="width:min-content;margin:0;${FONT}">Click <a href="#">this link</a> to open</p>`)
    const copy = await frozen(p)
    expect(pinsOf(copy)).toEqual(['this', 'link', 'to', 'open'])
    expect(loose(copy)).toEqual(['Click ', ' ', ' ', ' '])
  })

  it('turns a <wbr> and the seam after a slash into word joiners when the line goes on', async () => {
    const p = mount(`<p style="width:max-content;margin:0;${FONT}">See <a href="#">example.com/</a>docs/<wbr>guide now</p>`)
    const copy = await frozen(p)
    expect(copy.querySelector('wbr')).toBeNull()
    expect(copy.querySelector('a').lastChild.data).toBe(JOINER)
    expect(copy.textContent).toBe(`See example.com/${JOINER}docs/${JOINER}guide now`)
  })

  it('pins an inline-block or an image to the line it shares, and gives it back its own wrapping', async () => {
    // Firefox broke a full line beside an inline-block even with a word joiner there.
    const atoms = (copy) => [...copy.querySelectorAll('span,img')].filter((n) => !isPin(n))
    const p = mount(`<p style="width:max-content;margin:0;${FONT}">Tagged <span style="display:inline-block">two words</span> here<img alt="" width="10" height="10">and on</p>`)
    const [tag, img] = atoms(await frozen(p))
    expect(tag.textContent).toBe('two words')
    for (const atom of [tag, img]) expect(isPin(atom.parentNode)).toBe(true)
    expect(tag.style.getPropertyValue(ONE_LINE_PROP)).toBe('wrap')
    // Where the page broke beside it, it stays as it is.
    const q = mount(`<p style="width:min-content;margin:0;${FONT}">Tagged <span style="display:inline-block">two words</span> here</p>`)
    const [lone] = atoms(await frozen(q))
    expect(isPin(lone.parentNode)).toBe(false)
  })

  it('marks a break inside a word with a <wbr>', async () => {
    const p = mount(`<p style="width:120px;margin:0;word-break:break-all;${FONT}">https://example.com/a/very/long/path/to/some/resource</p>`)
    const lines = liveLines(p.firstChild)
    expect(lines.length).toBeGreaterThan(2)
    const copy = await frozen(p)
    expect(pinsOf(copy)).toEqual(lines)
    expect(copy.querySelectorAll('wbr').length).toBe(lines.length - 1)
  })

  it('leaves text it cannot pair with the page alone', async () => {
    const p = mount(`<p style="width:220px;margin:0;${FONT}">${TEXT}</p>`)
    const { clone, nodeMap } = await prepareClone(p, createContext({}))
    clone.firstChild.data += ' and more'
    expect(freezeLineBreaks(clone, clone, nodeMap, document)).toBeNull()
  })

  it('leaves vertical text and text that cannot wrap alone', async () => {
    for (const style of ['writing-mode:vertical-rl;height:120px', 'white-space:nowrap']) {
      const p = mount(`<p style="${style};width:220px;margin:0;${FONT}">${TEXT}</p>`)
      const { clone, nodeMap } = await prepareClone(p, createContext({}))
      expect(freezeLineBreaks(clone, clone, nodeMap, document)).toBeNull()
    }
  })

  it('pins a copy that serializes like the tree it copies, in another document', async () => {
    // The svg engine serializes the copy in place of its own foreignObject, so the two must
    // only differ by the pins: the namespaces each element declares, the style element's CSS.
    const p = mount(`<p style="width:220px;margin:0;${FONT}">${TEXT} <a href="#">a <i>link</i></a>, <img alt="" src="data:,"> <input value="x"> and <svg width="4" height="4"><rect width="4" height="4"/></svg>.</p>`)
    const { clone, nodeMap } = await prepareClone(p, createContext({}))
    const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
    const style = document.createElement('style')
    style.textContent = 'p{color:#000}'
    const container = document.createElement('div')
    container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
    container.appendChild(clone)
    fo.append(style, container)
    const copy = freezeLineBreaks(fo, clone, nodeMap, document)
    expect(copy.ownerDocument).not.toBe(document)
    // Take out what the pass adds: the pins, the wrapping an atom in one gets back, and the
    // joiner where "link" meets the comma.
    expect(copy.textContent).toContain(`link${JOINER},`)
    for (const pinned of [...copy.querySelectorAll('span')].filter(isPin)) {
      for (const atom of pinned.children) {
        atom.style.removeProperty(ONE_LINE_PROP)
        if (!atom.getAttribute('style')) atom.removeAttribute('style')
      }
      pinned.replaceWith(...pinned.childNodes)
    }
    const texts = copy.ownerDocument.createTreeWalker(copy, NodeFilter.SHOW_TEXT)
    for (let t = texts.nextNode(); t; t = texts.nextNode()) t.data = t.data.replaceAll(JOINER, '')
    copy.normalize()
    const own = fo.cloneNode(true)
    own.normalize()
    const xml = new XMLSerializer()
    expect(xml.serializeToString(copy)).toBe(xml.serializeToString(own))
  })
})

/** Widens every glyph of the clone by `drift` px (!important: the base reset restates letter-spacing per tag). */
const drifted = (drift) => ({
  name: 'drift',
  afterClone: (ctx) => {
    const style = document.createElement('style')
    style.textContent = `*{letter-spacing:${drift}px !important}`
    ctx.clone.appendChild(style)
  },
})

/** Lines of text in a capture: bands of rows with dark pixels in them. */
async function inkLines(el, options) {
  const canvas = await snapdom.toCanvas(el, { dpr: 1, embedFonts: false, burst: false, cache: 'disabled', ...options })
  const { width, height } = canvas
  const d = canvas.getContext('2d').getImageData(0, 0, width, height).data
  let lines = 0
  let inked = false
  for (let y = 0; y < height; y++) {
    let row = false
    for (let x = 0; x < width && !row; x++) {
      const i = (y * width + x) * 4
      row = d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100 && d[i + 3] > 128
    }
    if (row && !inked) lines++
    inked = row
  }
  return lines
}

const decode = (url) => decodeURIComponent(url.slice(url.indexOf(',') + 1))
const PIN_CSS = /all:unset;text-wrap-mode:nowrap;word-break:normal;line-break:auto/
const PARA = `width:300px;margin:0;padding:4px 8px;background:#fff;color:#000;${FONT}`

describe.skipIf(!ZOOMS)('the svg engine under the layout zoom', () => {
  it('keeps a paragraph on the page\'s lines when the clone lays its text out wider', async () => {
    // Room below the paragraph, so a line the clone adds is in the shot.
    const box = mount(`<div style="padding-bottom:60px;background:#fff"><p style="${PARA}">${LONG}</p></div>`)
    const lines = liveLines(box.firstChild.firstChild).length
    // At 1x there is no zoom and no pass: the wider text really takes more lines.
    expect(await inkLines(box, { plugins: [drifted(1)] })).toBeGreaterThan(lines)
    stubHiDPI(2)
    expect(await inkLines(box, { plugins: [drifted(1)] })).toBe(lines)
  })

  it('keeps the lines of text that word-break: break-all may split anywhere', async () => {
    // Firefox 160 broke a nowrap span at its spaces when it inherited break-all. 2px: the
    // text grows by more than a line, whatever room its last line had.
    const box = mount(`<div style="padding-bottom:60px;background:#fff"><p style="${PARA};word-break:break-all">${LONG}</p></div>`)
    const lines = liveLines(box.firstChild.firstChild).length
    expect(await inkLines(box, { plugins: [drifted(2)] })).toBeGreaterThan(lines)
    stubHiDPI(2)
    expect(await inkLines(box, { plugins: [drifted(2)] })).toBe(lines)
  })

  it('serializes the pins but leaves them out of the clone the stages keep', async () => {
    const p = mount(`<p style="${PARA}">${LONG}</p>`)
    stubHiDPI(2)
    let seen = null
    const probe = { name: 'line-pins', afterRender: (ctx) => { seen = { pins: pinsOf(ctx.clone).length, svg: ctx.svgString } } }
    await snapdom(p, { cache: 'disabled', burst: false, plugins: [probe] })
    expect(seen.pins).toBe(0)
    expect(seen.svg).toMatch(PIN_CSS)
  })

  it('pins nothing at a devicePixelRatio of 1', async () => {
    const p = mount(`<p style="${PARA}">${LONG}</p>`)
    const svg = decode((await snapdom(p, { cache: 'disabled', burst: false })).url)
    expect(svg).not.toMatch(PIN_CSS)
  })

  it('pins a differential recapture from the page as it is then, like a full capture', async () => {
    // One level down: the differential path sends a change to a direct child of the root to
    // the full pipeline. A fixed height: the path keeps the old transform-origin of a parent
    // whose height changed, with or without the pins.
    const box = mount(`<div style="width:320px;padding:8px;background:#fff;color:#000;${FONT}"><div style="height:400px">` +
      [TEXT, LONG, TEXT].map((t) => `<p style="margin:0 0 8px">${t}</p>`).join('') + '</div></div>')
    stubHiDPI(2)
    for (let i = 0; i < 4; i++) await snapdom(box)
    box.firstChild.children[1].textContent = `${TEXT} ${TEXT}`
    await new Promise((r) => setTimeout(r, 0))
    const served = __diffStats.served
    const res = await snapdom(box)
    expect(__diffStats.served).toBe(served + 1)
    expect(decode(res.url)).toMatch(PIN_CSS)
    expect(res.url).toBe((await snapdom(box, { burst: false })).url)
  })
})
