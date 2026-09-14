// Regression: ::after { content: ' Pro' } position parity
//
// Reproduces the avatar-meta case from the snapVisual demo:
//   .avatar-meta strong { display: block }
//   .avatar-meta strong::after { content: ' Pro'; color: #6f5cff }
//
// Verifies that the cloned <span data-snapdom-pseudo="::after"> renders at the
// same position and width as the live ::after pseudo-element. If snapdom drops
// the leading space, fails to inherit font-weight from <strong>, or applies a
// different display, the strong's bbox will diverge between live and clone.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prepareClone } from '../src/core/prepare.js'
import { captureDOM } from '../src/core/capture.js'

const STYLES = `
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .avatar-meta strong { display: block; }
  .avatar-meta span.zlab { opacity: .7; font-size: 12px; }
  .mutated .avatar-meta strong::after { content: ' Pro'; color: #6f5cff; }
`

function mountFixture() {
  const styleEl = document.createElement('style')
  styleEl.textContent = STYLES
  document.head.appendChild(styleEl)

  const live = document.createElement('div')
  live.className = 'mutated'
  live.innerHTML = `
    <div class="avatar-row">
      <div class="avatar-meta">
        <strong>Juan Martin</strong>
        <span class="zlab">zumerlab</span>
      </div>
    </div>
  `
  document.body.appendChild(live)
  return { styleEl, live }
}

async function mountClone(originalRoot) {
  const { clone, classCSS } = await prepareClone(originalRoot, { embedFonts: false })

  // Host the clone offscreen but in the same doc so layout uses the same
  // font metrics as the live tree. Width matches live so wrapping is identical.
  const host = document.createElement('div')
  host.style.position = 'absolute'
  host.style.left = '-99999px'
  host.style.top = '0'
  host.style.width = `${originalRoot.getBoundingClientRect().width}px`
  host.dataset.testCloneHost = '1'

  // Inject the snapshot CSS so the generated class names on cloned nodes resolve.
  const styleEl = document.createElement('style')
  styleEl.textContent = classCSS || ''
  host.appendChild(styleEl)
  host.appendChild(clone)
  document.body.appendChild(host)
  return { host, clone }
}

describe("::after { content: ' Pro' } — position parity vs live DOM", () => {
  let mounted

  beforeEach(() => {
    mounted = mountFixture()
  })

  afterEach(() => {
    mounted.live.remove()
    mounted.styleEl.remove()
    document.querySelectorAll('[data-test-clone-host]').forEach((n) => n.remove())
  })

  it('cloned strong has the same bbox as the live strong (incl. ::after)', async () => {
    const liveStrong = mounted.live.querySelector('strong')
    const liveRect = liveStrong.getBoundingClientRect()

    const { clone } = await mountClone(mounted.live)

    const cloneStrong = clone.querySelector('strong')
    const cloneRect = cloneStrong.getBoundingClientRect()

    // Width parity is the strongest signal: if " Pro" lost its leading space,
    // or the span lost bold inheritance, width changes by several px.
    expect(Math.abs(cloneRect.width - liveRect.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(cloneRect.height - liveRect.height)).toBeLessThanOrEqual(1)
  })

  it('cloned strong contains the inlined pseudo span with leading-space text', async () => {
    const { clone } = await mountClone(mounted.live)
    const cloneStrong = clone.querySelector('strong')

    const pseudoSpan = cloneStrong.querySelector('[data-snapdom-pseudo="::after"]')
    expect(pseudoSpan).toBeTruthy()
    // Leading space must survive collapseCssContent.
    expect(pseudoSpan.textContent).toBe(' Pro')
    // Pseudo node must be the LAST child so layout matches a real ::after.
    expect(cloneStrong.lastElementChild).toBe(pseudoSpan)
  })

  it('cloned pseudo span inherits bold + adopts pseudo color', async () => {
    const { clone } = await mountClone(mounted.live)

    const cloneStrong = clone.querySelector('strong')
    const pseudoSpan = cloneStrong.querySelector('[data-snapdom-pseudo="::after"]')
    const cs = getComputedStyle(pseudoSpan)

    // Bold must be inherited from <strong> — if getStyleKey deduped font-weight
    // against the <span> default (400), this drops to 400 and width regresses.
    expect(parseInt(cs.fontWeight, 10)).toBeGreaterThanOrEqual(600)
    // ::after override must win.
    // #6f5cff → rgb(111, 92, 255)
    expect(cs.color.replace(/\s+/g, '')).toBe('rgb(111,92,255)')
  })

  it('matches the bbox of an isolated reference pseudo (sanity)', async () => {
    // Independent measurement: render a second live copy as ground truth and
    // ensure the helper itself is sound (catches issues with mountClone).
    const ref = mounted.live.cloneNode(true)
    document.body.appendChild(ref)
    const refRect = ref.querySelector('strong').getBoundingClientRect()
    const liveRect = mounted.live.querySelector('strong').getBoundingClientRect()
    expect(Math.abs(refRect.width - liveRect.width)).toBeLessThanOrEqual(0.5)
    ref.remove()
  })

  // The user-reported symptom: in the snapVisual capture, " Pro" overlaps the
  // sibling "zumerlab" span on the next line. That means the pseudo span
  // either escapes the strong's block or the strong loses display:block in
  // the clone, collapsing the two siblings onto the same line.
  it('cloned " Pro" does NOT overlap the next-line "zumerlab" sibling', async () => {
    const { clone } = await mountClone(mounted.live)
    const liveZlab = mounted.live.querySelector('span.zlab')
    const cloneZlab = clone.querySelector('span.zlab')
    const pseudo = clone.querySelector('[data-snapdom-pseudo="::after"]')

    const pseudoRect = pseudo.getBoundingClientRect()
    const cloneZlabRect = cloneZlab.getBoundingClientRect()

    // Pseudo bottom must sit at-or-above zumerlab top — same as in the live DOM.
    // If they overlap, this fires.
    expect(pseudoRect.bottom).toBeLessThanOrEqual(cloneZlabRect.top + 1)

    // Also: the vertical ordering must match live (strong block above span).
    const liveStrongRect = mounted.live.querySelector('strong').getBoundingClientRect()
    const liveZlabRect = liveZlab.getBoundingClientRect()
    expect(liveStrongRect.bottom).toBeLessThanOrEqual(liveZlabRect.top + 1)
  })

  it('cloned <strong> keeps display:block (so ::after stays on its line)', async () => {
    const { clone } = await mountClone(mounted.live)
    const cs = getComputedStyle(clone.querySelector('strong'))
    expect(cs.display).toBe('block')
  })

  // End-to-end check: actually run captureDOM, embed the resulting SVG into
  // the live doc (not as <img>, but as inline SVG so we can hit foreignObject
  // descendants from outside), and measure where the pseudo span lands
  // relative to the "zumerlab" sibling. This catches issues that prepareClone
  // alone can't surface: bbox math, classCSS being injected too late, or
  // foreignObject sizing that clips/overlaps content.
  it('captureDOM output: " Pro" does NOT overlap "zumerlab" inside the rendered SVG', async () => {
    const row = mounted.live.querySelector('.avatar-row')
    const dataURL = await captureDOM(row, { embedFonts: false })

    // Decode and inline the SVG so its foreignObject lays out in the same doc.
    const svgText = decodeURIComponent(dataURL.replace(/^data:image\/svg\+xml(?:;charset=utf-8)?,/, ''))
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:absolute;left:-99999px;top:0;'
    wrap.dataset.testCloneHost = '1'
    wrap.innerHTML = svgText
    document.body.appendChild(wrap)

    const svg = wrap.querySelector('svg')
    expect(svg).toBeTruthy()

    const pseudo = svg.querySelector('[data-snapdom-pseudo="::after"]')
    const zlab = svg.querySelector('span.zlab')
    expect(pseudo).toBeTruthy()
    expect(zlab).toBeTruthy()

    const pRect = pseudo.getBoundingClientRect()
    const zRect = zlab.getBoundingClientRect()
    // Same invariant as the live DOM: pseudo line ends before zumerlab line starts.
    expect(pRect.bottom).toBeLessThanOrEqual(zRect.top + 1)
  })

  // Capturing the avatar-row (outer container) vs avatar-meta (direct parent)
  // must give the same layout for the pseudo. If snapdom relies on ancestor
  // context that's lost when capturing only the inner container, the pseudo
  // span position diverges — that's what the user suspects.
  it('captured at avatar-meta vs avatar-row produces the same pseudo bbox', async () => {
    const meta = mounted.live.querySelector('.avatar-meta')
    const row = mounted.live.querySelector('.avatar-row')

    const { clone: cloneFromMeta } = await mountClone(meta)
    const { clone: cloneFromRow } = await mountClone(row)

    const pFromMeta = cloneFromMeta.querySelector('[data-snapdom-pseudo="::after"]')
    const pFromRow = cloneFromRow.querySelector('[data-snapdom-pseudo="::after"]')

    const rMeta = pFromMeta.getBoundingClientRect()
    const rRow = pFromRow.getBoundingClientRect()

    // Width should be identical (within sub-pixel font hinting).
    expect(Math.abs(rMeta.width - rRow.width)).toBeLessThanOrEqual(1)
    // Height too.
    expect(Math.abs(rMeta.height - rRow.height)).toBeLessThanOrEqual(1)
  })
})

// Exact repro of the snapVisual demo: capture the .card containing the avatar
// fixture, with the same grid+card+padding chain. User screenshot shows
// "Pro" wrapping to a 2nd line and overlapping "zumerlab" only in the rendered
// PNG/SVG — not in the live DOM.
const DEMO_STYLES = `
  body { margin: 0; padding: 32px; background: #f4f5f7;
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
    color: #1a1d24; }
  .grid { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  .card h2 { margin: 0 0 8px; font-size: 14px; }
  .avatar-row { display: flex; gap: 12px; align-items: center; }
  .avatar { width: 56px; height: 56px; border-radius: 50%;
    background: conic-gradient(from 220deg, #ff8a3d, #d63d4d, #6f5cff, #2f6df6, #ff8a3d);
    display: grid; place-items: center; color: white; font-weight: 700; font-size: 22px;
    box-shadow: inset 0 0 0 3px white, 0 4px 12px rgba(0,0,0,.15); }
  .avatar-meta strong { display: block; }
  .avatar-meta span.zlab { opacity: .7; font-size: 12px; }
  body.mutated .avatar-meta strong::after { content: ' Pro'; color: #6f5cff; }
`

describe('.card capture (full demo chain) — pseudo wrap repro', () => {
  let styleEl, grid, card

  beforeEach(() => {
    styleEl = document.createElement('style')
    styleEl.textContent = DEMO_STYLES
    document.head.appendChild(styleEl)
    document.body.classList.add('mutated')

    grid = document.createElement('div')
    grid.className = 'grid'
    grid.innerHTML = `
      <div class="card" data-test="avatar">
        <h2>Avatar</h2>
        <div class="avatar-row">
          <div class="avatar">JM</div>
          <div class="avatar-meta">
            <strong>Juan Martin</strong>
            <span class="zlab">zumerlab</span>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(grid)
    card = grid.querySelector('.card')
  })

  afterEach(() => {
    grid.remove()
    styleEl.remove()
    document.body.classList.remove('mutated')
    document.querySelectorAll('[data-test-clone-host]').forEach((n) => n.remove())
  })

  it('live DOM: " Pro" stays on the same line as "Juan Martin"', () => {
    const strong = card.querySelector('strong')
    const zlab = card.querySelector('span.zlab')
    const strongRect = strong.getBoundingClientRect()
    const zlabRect = zlab.getBoundingClientRect()
    // Strong is single-line: its height must equal one line-height (~21px @ 14*1.5).
    expect(strongRect.height).toBeLessThan(28)
    // And it must sit cleanly above zlab.
    expect(strongRect.bottom).toBeLessThanOrEqual(zlabRect.top + 1)
  })

  it('captureDOM(.card) embedFonts:true: rendered SVG keeps " Pro" on same line', async () => {
    const liveStrong = card.querySelector('strong')
    const liveStrongHeight = liveStrong.getBoundingClientRect().height

    // The snapVisual demo uses embedFonts:true. If the embedded font has wider
    // metrics than the system font, "Juan Martin Pro" can wrap inside the SVG
    // even though the live DOM doesn't wrap.
    const dataURL = await captureDOM(card, { embedFonts: true })
    const svgText = decodeURIComponent(dataURL.replace(/^data:image\/svg\+xml(?:;charset=utf-8)?,/, ''))

    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:absolute;left:-99999px;top:0;'
    wrap.dataset.testCloneHost = '1'
    wrap.innerHTML = svgText
    document.body.appendChild(wrap)

    const svg = wrap.querySelector('svg')
    const cloneStrong = svg.querySelector('strong')
    const cloneZlab = svg.querySelector('span.zlab')
    const pseudo = svg.querySelector('[data-snapdom-pseudo="::after"]')

    const cloneStrongHeight = cloneStrong.getBoundingClientRect().height
    // If pseudo wraps to a second line, strong height ~doubles. Catch that.
    expect(cloneStrongHeight).toBeLessThan(liveStrongHeight * 1.5)

    // And pseudo bottom must still be above zumerlab top.
    const pRect = pseudo.getBoundingClientRect()
    const zRect = cloneZlab.getBoundingClientRect()
    expect(pRect.bottom).toBeLessThanOrEqual(zRect.top + 1)
  })

  // The fix: when a multi-char inline pseudo is inlined into a single-line
  // host, snapdom pins white-space:nowrap on that host. This prevents the
  // wrap induced by SVG-as-<img> font metric drift (ui-sans-serif/system-ui
  // resolving to fonts with wider metrics in the isolated <img> context).
  // We assert directly on the cloned strong since pixel-level inspection in
  // chromium-headless doesn't manifest the metric drift this fix targets.
  it('fix: cloned <strong> gets white-space:nowrap when single-line + multi-char pseudo', async () => {
    const dataURL = await captureDOM(card, { embedFonts: false })
    const svgText = decodeURIComponent(dataURL.replace(/^data:image\/svg\+xml(?:;charset=utf-8)?,/, ''))
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:absolute;left:-99999px;top:0;'
    wrap.dataset.testCloneHost = '1'
    wrap.innerHTML = svgText
    document.body.appendChild(wrap)

    const cloneStrong = wrap.querySelector('svg strong')
    expect(cloneStrong).toBeTruthy()
    // Inline style attribute is the source of truth — class CSS can't override it.
    expect(cloneStrong.getAttribute('style') || '').toContain('white-space: nowrap')
    // The pseudo span must NOT carry an explicit white-space:normal that breaks
    // inheritance from the strong. computedStyle of the span should resolve to nowrap.
    const pseudoSpan = cloneStrong.querySelector('[data-snapdom-pseudo="::after"]')
    expect(pseudoSpan).toBeTruthy()
    expect(getComputedStyle(pseudoSpan).whiteSpace).toBe('nowrap')
  })

  it('fix: does NOT pin nowrap when host is multi-line in live', async () => {
    // Force the strong to wrap in live by giving it constrained width.
    const strong = card.querySelector('strong')
    strong.style.maxWidth = '40px'
    // sanity: live now has > 1 line
    expect(strong.getBoundingClientRect().height).toBeGreaterThan(28)

    const dataURL = await captureDOM(card, { embedFonts: false })
    const svgText = decodeURIComponent(dataURL.replace(/^data:image\/svg\+xml(?:;charset=utf-8)?,/, ''))
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:absolute;left:-99999px;top:0;'
    wrap.dataset.testCloneHost = '1'
    wrap.innerHTML = svgText
    document.body.appendChild(wrap)

    const cloneStrong = wrap.querySelector('svg strong')
    expect(cloneStrong.getAttribute('style') || '').not.toContain('white-space: nowrap')

    strong.style.maxWidth = ''
  })

  it('clone DOM (.card): width given to strong matches the live width', async () => {
    const liveStrong = card.querySelector('strong')
    const liveStrongRect = liveStrong.getBoundingClientRect()

    const { clone } = await mountClone(card)
    const cloneStrong = clone.querySelector('strong')
    const cloneStrongRect = cloneStrong.getBoundingClientRect()

    // The strong is display:block — its width should match the parent flex item
    // width. If snapdom narrows it (e.g. shrink-to-content), " Pro" wraps.
    expect(Math.abs(cloneStrongRect.width - liveStrongRect.width)).toBeLessThanOrEqual(1)
  })
})
