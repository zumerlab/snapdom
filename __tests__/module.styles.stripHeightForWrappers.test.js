import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'
import { inlineAllStyles } from '../src/modules/styles.js'

/**
 * Regression net for `stripHeightForWrappers()` in src/modules/styles.js.
 *
 * The pass deletes `height` / `block-size` from the captured style snapshot of elements it
 * judges to be *transparent flow wrappers*, so the clone can reflow (margin-collapsing in
 * particular) instead of being pinned to a used height that was only ever an auto height.
 *
 * Everything below asserts an observable: either the CSS the capture emits for the element
 * (`session.styleMap`, i.e. the snapshot after the pass ran) or the geometry of the rasterized
 * capture. Every guard test is a PAIR — the guarded element must keep its height AND an
 * otherwise-identical control that lacks the guard property must lose it. The pair is what makes
 * the test discriminate: drop the guard from the source and the first half goes red; break the
 * strip path entirely and the second half goes red.
 */

function freshSession() {
  return { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() }
}

/** The declaration block snapdom would emit for `el` (the post-strip snapshot). */
async function styleKeyFor(el) {
  const clone = el.cloneNode(true)
  const session = freshSession()
  await inlineAllStyles(el, clone, session)
  return session.styleMap.get(clone) || ''
}

/** `height` value in an emitted key, or null when the pass stripped it. */
function emittedHeight(key) {
  const m = key.match(/(?:^|;)height:([^;]+)/)
  return m ? m[1] : null
}
function emittedBlockSize(key) {
  const m = key.match(/(?:^|;)block-size:([^;]+)/)
  return m ? m[1] : null
}

/**
 * Both logical and physical height survived.
 *
 * `block-size` is asserted only WHEN THE BRANCH EMITS IT. The two properties are
 * deleted together by the pass, so `height` alone already discriminates every
 * guard; but which properties reach the snapshot in the first place is decided
 * upstream of this function and differs between branches — `main` carries
 * `block-size`, `experimental` does not carry it for any element at all. Asserting
 * it unconditionally tests that upstream list, not this pass.
 */
async function expectKeepsHeight(el, expected) {
  const key = await styleKeyFor(el)
  expect(emittedHeight(key), `height for ${el.className || el.tagName}`).toBe(expected)
  const logical = emittedBlockSize(key)
  if (logical !== null) {
    expect(logical, `block-size for ${el.className || el.tagName}`).toBe(expected)
  }
}

/** The pass removed the used height. */
async function expectStripsHeight(el) {
  const key = await styleKeyFor(el)
  expect(emittedHeight(key), `height for ${el.className || el.tagName}`).toBe(null)
  expect(emittedBlockSize(key), `block-size for ${el.className || el.tagName}`).toBe(null)
}

/** Vertical runs of non-white ink in a canvas: [[startY, endY], ...]. */
function inkBands(canvas) {
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data
  const rows = []
  for (let y = 0; y < height; y++) {
    let ink = false
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] === 0) continue
      if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) { ink = true; break }
    }
    rows.push(ink)
  }
  const bands = []
  let start = -1
  for (let y = 0; y < rows.length; y++) {
    if (rows[y] && start < 0) start = y
    if (!rows[y] && start >= 0) { bands.push([start, y - 1]); start = -1 }
  }
  if (start >= 0) bands.push([start, rows.length - 1])
  return bands
}

describe('stripHeightForWrappers', () => {
  let root, sheet
  afterEach(() => { root?.remove(); sheet?.remove() })

  function mount(css, html) {
    sheet = document.createElement('style')
    sheet.textContent = css
    document.head.appendChild(sheet)
    root = document.createElement('div')
    root.innerHTML = html
    document.body.appendChild(root)
    return root
  }

  // The metrics below assume a predictable line box; every fixture pins font + line-height.
  const HOST = '.sw-host{width:200px;background:#fff;color:#000;font:16px/20px Arial}'

  // ---------------------------------------------------------------------------------------
  // 1. The behaviour the pass exists to produce.
  // ---------------------------------------------------------------------------------------

  it('strips the used height of a genuinely auto-height transparent flow wrapper', async () => {
    mount(HOST, '<div class="sw-host"><div class="sw-plain">wrapper text</div></div>')
    await expectStripsHeight(root.querySelector('.sw-plain'))
  })

  it('keeps margin collapse-through, so a following sibling lands where the live DOM puts it', async () => {
    // A transparent wrapper around a <p> with a bottom margin. Because the wrapper's height is
    // auto, the <p>'s 40px bottom margin collapses OUT of the wrapper and then collapses with
    // the next sibling's 10px top margin → the sibling sits 60px below the paragraph.
    //
    // Freeze the wrapper at its used height (20px) and CSS 2.1 stops collapsing the bottom
    // margin through it (collapse-through requires `height: auto`); the sibling jumps up to
    // +30px. Measured: stripped → ink bands 30px apart matches live; frozen → 30px too high.
    mount(
      HOST +
      '.sw-mc{}' +
      '.sw-mc > p{margin:0 0 40px}' +
      '.sw-after{margin-top:10px}',
      '<div class="sw-host sw-mc-host"><div class="sw-mc"><p>AAA</p></div>' +
      '<div class="sw-after">BBB</div></div>',
    )
    const host = root.querySelector('.sw-mc-host')

    // Sanity: the wrapper really is one the pass strips.
    await expectStripsHeight(host.querySelector('.sw-mc'))

    const hostTop = host.getBoundingClientRect().top
    const liveTops = [...host.querySelectorAll('p, .sw-after')]
      .map((e) => e.getBoundingClientRect().top - hostTop)
    const liveGap = liveTops[1] - liveTops[0]
    expect(Math.round(liveGap)).toBe(60)

    const canvas = await snapdom(host, { scale: 1, dpr: 1 }).then((r) => r.toCanvas())
    expect(canvas.height).toBe(Math.round(host.getBoundingClientRect().height))

    const bands = inkBands(canvas)
    expect(bands.length, 'two text runs in the capture').toBe(2)
    // The capture must reproduce the live spacing. A frozen wrapper height halves it to ~30.
    expect(Math.abs((bands[1][0] - bands[0][0]) - liveGap)).toBeLessThanOrEqual(3)
  })

  // ---------------------------------------------------------------------------------------
  // 2. Guard: author height written inline.
  // ---------------------------------------------------------------------------------------

  it('respects a height the author wrote inline', async () => {
    // 80px of box around one 20px line: the used height is nowhere near the auto height, so an
    // author fixed it and the capture must keep it.
    mount(HOST,
      '<div class="sw-host">' +
      '<div class="sw-inline" style="height:80px">text</div>' +
      '<div class="sw-auto">text</div>' +
      '</div>')
    await expectKeepsHeight(root.querySelector('.sw-inline'), '80px')
    await expectStripsHeight(root.querySelector('.sw-auto'))
  })

  // ---------------------------------------------------------------------------------------
  // 3. Guard: tag allow-list (div/section/article/main/aside/header/footer/nav — NOT lists).
  // ---------------------------------------------------------------------------------------

  it('never touches list boxes: ul and li are deliberately outside the allow-list', async () => {
    // The <ul> is stripped of its UA margin/padding so the ONLY difference from the control
    // <div> is the tag name. Both are auto-height with one line of text.
    mount(HOST +
      '.sw-ul{margin:0;padding:0;list-style:none}' +
      '.sw-li{list-style:none}',
      '<div class="sw-host">' +
      '<ul class="sw-ul"><li class="sw-li">item</li></ul>' +
      '<div class="sw-divctl">item</div>' +
      '</div>')
    await expectKeepsHeight(root.querySelector('.sw-ul'), '20px')
    await expectKeepsHeight(root.querySelector('.sw-li'), '20px')
    // Same box, allowed tag → stripped. This is what proves the tag name is doing the work.
    await expectStripsHeight(root.querySelector('.sw-divctl'))
  })

  it('strips the allow-listed wrapper tags', async () => {
    mount(HOST,
      '<div class="sw-host">' +
      ['section', 'article', 'main', 'aside', 'header', 'footer', 'nav']
        .map((t) => `<${t} class="sw-t-${t}">text</${t}>`).join('') +
      '</div>')
    for (const t of ['section', 'article', 'main', 'aside', 'header', 'footer', 'nav']) {
      await expectStripsHeight(root.querySelector(`.sw-t-${t}`))
    }
  })

  // ---------------------------------------------------------------------------------------
  // 4. Guard: aspect-ratio.
  // ---------------------------------------------------------------------------------------

  it('respects a height derived from aspect-ratio', async () => {
    // 100px wide, 2/1 → used height 50px. The height is derived, not authored and not content-
    // driven, and re-deriving it in the clone is not something the pass may assume.
    mount(HOST +
      '.sw-ar{width:100px;aspect-ratio:2/1}' +
      '.sw-noar{width:100px}',
      '<div class="sw-host"><div class="sw-ar">x</div><div class="sw-noar">x</div></div>')
    await expectKeepsHeight(root.querySelector('.sw-ar'), '50px')
    await expectStripsHeight(root.querySelector('.sw-noar'))
  })

  // ---------------------------------------------------------------------------------------
  // 5. Guard: flex/grid containers and flex/grid items ("Orbit").
  // ---------------------------------------------------------------------------------------

  it('keeps the height of flex and grid CONTAINERS', async () => {
    mount(HOST +
      '.sw-flex{display:flex}' +
      '.sw-grid{display:grid}' +
      '.sw-block{display:block}',
      '<div class="sw-host">' +
      '<div class="sw-flex"><span>x</span></div>' +
      '<div class="sw-grid"><span>x</span></div>' +
      '<div class="sw-block"><span>x</span></div>' +
      '</div>')
    await expectKeepsHeight(root.querySelector('.sw-flex'), '20px')
    await expectKeepsHeight(root.querySelector('.sw-grid'), '20px')
    await expectStripsHeight(root.querySelector('.sw-block'))
  })

  it('keeps the height of flex and grid ITEMS', async () => {
    // The items are identical divs; only the parent's display differs. A flex/grid item that
    // loses its height re-resolves against the line, which is how Orbit's layout broke.
    mount(HOST +
      '.sw-frow{display:flex}' +
      '.sw-grow{display:grid}' +
      '.sw-brow{display:block}',
      '<div class="sw-host">' +
      '<div class="sw-frow"><div class="sw-fitem">x</div></div>' +
      '<div class="sw-grow"><div class="sw-gitem">x</div></div>' +
      '<div class="sw-brow"><div class="sw-bitem">x</div></div>' +
      '</div>')
    await expectKeepsHeight(root.querySelector('.sw-fitem'), '20px')
    await expectKeepsHeight(root.querySelector('.sw-gitem'), '20px')
    await expectStripsHeight(root.querySelector('.sw-bitem'))
  })

  // ---------------------------------------------------------------------------------------
  // 6. Guard: out-of-flow boxes.
  // ---------------------------------------------------------------------------------------

  it('keeps the height of absolute / fixed / sticky boxes', async () => {
    mount(HOST +
      '.sw-anchor{position:relative}' +
      '.sw-abs{position:absolute;top:0;left:0}' +
      '.sw-fix{position:fixed;top:0;left:0}' +
      '.sw-sticky{position:sticky;top:0}' +
      '.sw-static{position:static}' +
      '.sw-relative{position:relative}',
      '<div class="sw-host">' +
      '<div class="sw-anchor"><div class="sw-abs">x</div></div>' +
      '<div class="sw-fix">x</div>' +
      '<div class="sw-sticky">x</div>' +
      '<div class="sw-static">x</div>' +
      '<div class="sw-relative">x</div>' +
      '</div>')
    await expectKeepsHeight(root.querySelector('.sw-abs'), '20px')
    await expectKeepsHeight(root.querySelector('.sw-sticky'), '20px')
    const fixKey = await styleKeyFor(root.querySelector('.sw-fix'))
    expect(emittedHeight(fixKey)).toBe('20px')
    // `relative` and `static` are in flow, so they are still fair game.
    await expectStripsHeight(root.querySelector('.sw-static'))
    await expectStripsHeight(root.querySelector('.sw-relative'))
  })

  // ---------------------------------------------------------------------------------------
  // 7. Guard: replaced elements.
  // ---------------------------------------------------------------------------------------

  it('never strips the height of a replaced element', async () => {
    // NOTE: `isReplaced()` is currently unreachable — every replaced tag (img/canvas/video/
    // iframe/svg/object/embed) already fails the allow-list check above it, and modern engines
    // also give them a non-visible overflow, which hasBox() rejects. This test therefore pins
    // the OBSERVABLE (a replaced box keeps its box) rather than which guard delivers it, so it
    // survives either implementation. Deleting `isReplaced()` alone does NOT turn it red.
    const PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='
    mount(HOST + '.sw-media{display:block;width:60px;height:40px}',
      '<div class="sw-host">' +
      `<img class="sw-media sw-img" src="${PX}">` +
      '<canvas class="sw-media sw-canvas" width="60" height="40"></canvas>' +
      '<svg class="sw-media sw-svg" viewBox="0 0 60 40"></svg>' +
      '<div class="sw-media sw-notmedia">x</div>' +
      '</div>')
    await expectKeepsHeight(root.querySelector('.sw-img'), '40px')
    await expectKeepsHeight(root.querySelector('.sw-canvas'), '40px')
    expect(emittedHeight(await styleKeyFor(root.querySelector('.sw-svg')))).toBe('40px')
    // The <div> twin carries the exact same stylesheet-authored 40px height and is only here to
    // show the fixture is otherwise strip-shaped. Whether IT keeps that height is the
    // author-height question owned by module.styles.stylesheet-height — not asserted here.
    expect(root.querySelector('.sw-notmedia')).toBeTruthy()
  })

  // ---------------------------------------------------------------------------------------
  // 8. Guard: non-visible overflow (and its hasBox twin).
  // ---------------------------------------------------------------------------------------

  it('keeps the height of a wrapper whose overflow is not visible', async () => {
    // `overflow:hidden` is caught twice (hasBox() also rejects a non-visible block overflow).
    // `overflow-x:clip` with `overflow-y:visible` is the one combination CSS keeps asymmetric,
    // so it slips past hasBox() and isolates the overflow guard itself.
    mount(HOST +
      '.sw-ovh{overflow:hidden}' +
      '.sw-ovs{overflow:auto}' +
      '.sw-clipx{overflow-x:clip;overflow-y:visible}' +
      '.sw-ovv{overflow:visible}',
      '<div class="sw-host">' +
      '<div class="sw-ovh">x</div>' +
      '<div class="sw-ovs">x</div>' +
      '<div class="sw-clipx">x</div>' +
      '<div class="sw-ovv">x</div>' +
      '</div>')
    await expectKeepsHeight(root.querySelector('.sw-ovh'), '20px')
    await expectKeepsHeight(root.querySelector('.sw-ovs'), '20px')
    // Isolated: hasBox() sees overflow-y:visible here, so only the overflow guard can fire.
    expect(getComputedStyle(root.querySelector('.sw-clipx')).overflowY).toBe('visible')
    await expectKeepsHeight(root.querySelector('.sw-clipx'), '20px')
    await expectStripsHeight(root.querySelector('.sw-ovv'))
  })

  // ---------------------------------------------------------------------------------------
  // 9. Guard: hiding / accessibility wrappers (KaTeX, screen-reader hacks).
  // ---------------------------------------------------------------------------------------

  it('keeps the height of visibility:hidden and opacity:0 wrappers', async () => {
    // KaTeX renders the same formula twice and hides one copy; dropping the hidden copy's height
    // let it collapse and dragged the visible layout with it.
    mount(HOST +
      '.sw-vh{visibility:hidden}' +
      '.sw-vv{visibility:visible}' +
      '.sw-op0{opacity:0}' +
      '.sw-op1{opacity:1}',
      '<div class="sw-host">' +
      '<div class="sw-vh">x</div><div class="sw-vv">x</div>' +
      '<div class="sw-op0">x</div><div class="sw-op1">x</div>' +
      '</div>')
    await expectKeepsHeight(root.querySelector('.sw-vh'), '20px')
    await expectKeepsHeight(root.querySelector('.sw-op0'), '20px')
    await expectStripsHeight(root.querySelector('.sw-vv'))
    await expectStripsHeight(root.querySelector('.sw-op1'))
  })

  it('keeps the height of a clip-rect wrapper', async () => {
    // The legacy `clip: rect(...)` screen-reader hack. Applied to a static box so no other
    // guard (position/overflow/hasBox) can fire — `clip` alone has to hold the line.
    mount(HOST +
      '.sw-clip{clip:rect(0px,10px,10px,0px)}' +
      '.sw-noclip{clip:auto}',
      '<div class="sw-host"><div class="sw-clip">x</div><div class="sw-noclip">x</div></div>')
    const clipped = root.querySelector('.sw-clip')
    expect(getComputedStyle(clipped).position).toBe('static')
    expect(getComputedStyle(clipped).overflowY).toBe('visible')
    await expectKeepsHeight(clipped, '20px')
    await expectStripsHeight(root.querySelector('.sw-noclip'))
  })

  it('keeps the height of a real .sr-only wrapper', async () => {
    // The canonical visually-hidden recipe, verbatim. Several guards overlap here on purpose:
    // this pins the end-to-end behaviour authors actually depend on.
    mount(HOST +
      '.sw-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;' +
      'clip:rect(0,0,0,0);white-space:nowrap;border:0}',
      '<div class="sw-host"><div class="sw-sr">screen reader only</div><div class="sw-vis">visible</div></div>')
    await expectKeepsHeight(root.querySelector('.sw-sr'), '1px')
    await expectStripsHeight(root.querySelector('.sw-vis'))
  })

  // ---------------------------------------------------------------------------------------
  // 10. Guard: transform.
  // ---------------------------------------------------------------------------------------

  it('keeps the height of a transformed box', async () => {
    mount(HOST + '.sw-tr{transform:translate(0)}' + '.sw-notr{transform:none}',
      '<div class="sw-host"><div class="sw-tr">x</div><div class="sw-notr">x</div></div>')
    await expectKeepsHeight(root.querySelector('.sw-tr'), '20px')
    await expectStripsHeight(root.querySelector('.sw-notr'))
  })

  // ---------------------------------------------------------------------------------------
  // 11. Guard: hasBox — the wrapper paints something, so it is not "transparent".
  // ---------------------------------------------------------------------------------------

  it('keeps the height of a wrapper that actually paints a box', async () => {
    mount(HOST +
      '.sw-pad{padding:4px 0}' +
      '.sw-bg{background:#eee}' +
      '.sw-bd{border-top:2px solid #000}' +
      '.sw-bare{padding:0;background:none;border:0}',
      '<div class="sw-host">' +
      '<div class="sw-pad">x</div><div class="sw-bg">x</div>' +
      '<div class="sw-bd">x</div><div class="sw-bare">x</div>' +
      '</div>')
    await expectKeepsHeight(root.querySelector('.sw-pad'), '20px')
    await expectKeepsHeight(root.querySelector('.sw-bg'), '20px')
    await expectKeepsHeight(root.querySelector('.sw-bd'), '20px')
    await expectStripsHeight(root.querySelector('.sw-bare'))
  })

  // ---------------------------------------------------------------------------------------
  // 12. Guard: hasFlowFast — nothing in flow means the height is not content-derived.
  // ---------------------------------------------------------------------------------------

  it('keeps the height of a wrapper with no in-flow content', async () => {
    mount(HOST +
      '.sw-noflow{position:relative}' +
      '.sw-noflow > *{position:absolute;inset:0}' +
      '.sw-flow{position:relative}',
      '<div class="sw-host">' +
      '<div class="sw-noflow"><div>out of flow</div></div>' +
      '<div class="sw-flow"><div>in flow</div></div>' +
      '</div>')
    // Both wrappers contain text, so any probe that trusts textContent (or a scrollHeight that
    // sees the out-of-flow child's overflow) reads them as identical. Only hasFlowFast() —
    // which asks whether THIS element has flow content of its own — separates them.
    await expectKeepsHeight(root.querySelector('.sw-noflow'), '0px')
    await expectStripsHeight(root.querySelector('.sw-flow'))
  })
})
