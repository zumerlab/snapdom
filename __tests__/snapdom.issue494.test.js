import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { isDocument, isShadowRoot } from '../src/utils/helpers.js'
import { scanAuthorStyles } from '../src/modules/styleScan.js'

// #494: a node that belongs to another window fails every `instanceof` test against the
// parent realm's constructors, because each realm owns its own. The form-control branches
// already go through isTag/isHTMLEl/isSVGEl (pinned by regression.reviewP1.test.js); this
// file pins the checks that were still realm-blind: the text-field selection gate, the
// ShadowRoot tests behind the composed-ancestor walk and the fixed/sticky freeze, the
// Document test of the counter context, and the @container gate of the author-style scan.

function decodeSvg(result) {
  const raw = result.toRaw()
  return decodeURIComponent(raw.slice(raw.indexOf(',') + 1))
}

let wraps = []

afterEach(() => {
  for (const w of wraps) w.remove()
  wraps = []
})

function makeIframe(html, { width = 320, height = 200 } = {}) {
  const wrap = document.createElement('div')
  wrap.style.cssText = `width:${width}px;padding:8px;background:#fff`
  const iframe = document.createElement('iframe')
  iframe.style.cssText = `width:${width}px;height:${height}px;border:0;display:block`
  wrap.appendChild(iframe)
  document.body.appendChild(wrap)
  wraps.push(wrap)
  const doc = iframe.contentDocument
  doc.open()
  doc.write(html)
  doc.close()
  return { wrap, iframe, doc }
}

describe('realm-safe predicates (#494)', () => {
  it('recognise a Document and a ShadowRoot from another realm', () => {
    const { doc } = makeIframe('<html><body><div id="h"></div></body></html>')
    const sr = doc.getElementById('h').attachShadow({ mode: 'open' })
    // Preconditions: the parent realm's constructors do not claim the iframe's objects.
    expect(doc instanceof Document).toBe(false)
    expect(sr instanceof ShadowRoot).toBe(false)

    expect(isDocument(doc)).toBe(true)
    expect(isShadowRoot(sr)).toBe(true)
    // Same-realm objects and non-matches.
    expect(isDocument(document)).toBe(true)
    expect(isShadowRoot(document.createElement('div').attachShadow({ mode: 'open' }))).toBe(true)
    expect(isDocument(document.body)).toBe(false)
    expect(isShadowRoot(document.createDocumentFragment())).toBe(false)
    expect(isShadowRoot(null)).toBe(false)
    expect(isDocument(undefined)).toBe(false)
  })
})

describe('captures inside a same-origin iframe (#494)', () => {
  it('paints the selection of a focused text field that lives in the iframe', async () => {
    const { doc } = makeIframe(`<html><body style="margin:0">
      <input id="t" style="width:200px;font:14px monospace;padding:4px;background:#fff">
    </body></html>`)
    const input = doc.getElementById('t')
    expect(input instanceof HTMLInputElement).toBe(false)
    input.value = 'hello world'
    input.focus()
    input.setSelectionRange(0, 5)
    expect(doc.activeElement).toBe(input)

    const svg = decodeSvg(await snapdom(doc.body, { captureSelection: true, embedFonts: false }))
    const styleAttr = svg.match(/<input[^>]*style="([^"]*)"/)?.[1] ?? ''
    // The field highlight is painted as a background layer on the clone (module.selection).
    expect(styleAttr).toContain('linear-gradient')
  })

  it('freezes a fixed box inside a shadow tree of the iframe', async () => {
    const { doc } = makeIframe(`<html><body style="margin:0">
      <div id="host" style="position:relative;width:200px;height:120px;background:#eee"></div>
    </body></html>`)
    const host = doc.getElementById('host')
    const sr = host.attachShadow({ mode: 'open' })
    sr.innerHTML = '<div id="fx" style="position:fixed;top:10px;left:20px;width:30px;height:30px;background:#f00"></div>'

    // Clip mode is the trigger of freezeViewportPositioned that no other pass shadows: a
    // scrolled root would also get its fixed children rewritten by wrapScrolledClone. The
    // rect is in the iframe's own page coordinates (resolveClipRect reads its window).
    const svg = decodeSvg(await snapdom(host, { embedFonts: false, clip: { x: 0, y: 0, width: 200, height: 120 } }))
    const styleAttr = svg.match(/id="fx"[^>]*style="([^"]*)"/)?.[1] ?? svg.match(/style="([^"]*)"[^>]*id="fx"/)?.[1] ?? ''
    // The freeze rewrites the box to absolute so the SVG viewport cannot re-anchor it. The
    // walk that decides whether #fx belongs to the capture root crosses the shadow boundary
    // through getRootNode(), which is a ShadowRoot of the iframe realm.
    expect(styleAttr).toContain('position: absolute')
  })

  it('resolves CSS counters for pseudo content in the iframe', async () => {
    const { doc } = makeIframe(`<html><head><style>
      .n { counter-reset: c; font: 14px monospace; }
      .n div { counter-increment: c; }
      .n div::before { content: counter(c) "-COUNT "; }
    </style></head><body style="margin:0">
      <div class="n"><div>a</div><div>b</div><div>c</div></div>
    </body></html>`)

    const svg = decodeSvg(await snapdom(doc.querySelector('.n'), { embedFonts: false }))
    expect(svg).toContain('1-COUNT')
    expect(svg).toContain('3-COUNT')
  })

  it('gates the selectors of an @container block in the iframe stylesheet', () => {
    const { doc } = makeIframe(`<html><head><style>
      .wrap { container-type: inline-size; }
      @container (min-width: 1px) { .cq { color: red; } }
    </style></head><body><div class="wrap"><div class="cq">x</div></div></body></html>`)
    const rule = doc.styleSheets[0].cssRules[1]
    expect(rule.constructor.name).toBe('CSSContainerRule')
    expect(typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule).toBe(false)

    const scan = scanAuthorStyles(doc)
    // A selector inside @container must never share its computed snapshot across twins:
    // the container decides, not the selector. The scan marks it share-unsafe.
    expect(JSON.stringify(scan.shareGate)).toContain('.cq')
  })

  it('freezes typed values through the real path (parent captures the <iframe>)', async () => {
    const { wrap, doc } = makeIframe(`<html><body style="margin:0">
      <input id="t" type="text">
      <input id="r" type="range" min="0" max="100" value="0">
    </body></html>`)
    doc.getElementById('t').value = '12'
    doc.getElementById('r').value = '80'

    // rasterizeIframe rasterizes the iframe document through context.snap.toPng, which
    // main() wires to snapdom.toPng. Wrap it to read the nested SVG before it becomes a PNG.
    let nestedSvg = ''
    const origToPng = snapdom.toPng
    snapdom.toPng = async (el, opts) => {
      const r = await snapdom(el, opts)
      nestedSvg = decodeSvg(r)
      return r.toPng()
    }
    let psvg
    try {
      psvg = decodeSvg(await snapdom(wrap, { embedFonts: false }))
    } finally {
      snapdom.toPng = origToPng
    }

    // The parent got the rasterized wrapper (an <img>), not a placeholder.
    expect(psvg).toContain('<img')
    expect(nestedSvg).not.toBe('')
    expect(nestedSvg).toMatch(/id="t"[^>]*value="12"|value="12"[^>]*id="t"/)
    // Firefox and WebKit swap a range input for an inline-SVG replacement (clone.js), so
    // its value is painted rather than serialized. Chromium keeps the <input value>.
    if (nestedSvg.includes('data-snapdom-input-replacement="range"')) {
      expect(nestedSvg).not.toMatch(/<input[^>]*type="range"/)
    } else {
      expect(nestedSvg).toMatch(/id="r"[^>]*value="80"|value="80"[^>]*id="r"/)
    }
  })
})
