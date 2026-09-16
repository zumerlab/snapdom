// Shadow-root content used to read every computed property of every node: its sheets were
// outside the document scan, so universeFor answered null. #503 (an ArcGIS table built from
// Calcite components, 281 shadow roots) spent most of its cold capture there. The capture now
// unions the sheets of the roots a node's style can come from, and each case below is one way
// a rule reaches a node from a root that is not its own.
import { describe, it, expect, afterEach } from 'vitest'
import { commands } from '@vitest/browser/context'
import { universeFor } from '../src/modules/styles.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

/**
 * document > outer host > root A (adopted sheet) > inner host > root B (<style>, a part, a slot)
 * plus a light child of the inner host that root B's slot takes. Every property below is outside
 * ALWAYS_PROPS and declared in exactly one root, so each assertion needs one specific join.
 */
function scene() {
  const outer = document.createElement('div')
  document.body.appendChild(outer)
  mounted.push(outer)
  const a = outer.attachShadow({ mode: 'open' })
  const sheetA = new CSSStyleSheet()
  sheetA.replaceSync('.frame{border-image:linear-gradient(red,red) 1}.inner::part(bar){column-rule-color:red}')
  a.adoptedStyleSheets = [sheetA]
  a.innerHTML = '<div class="frame"></div><div class="inner"><div class="s"></div></div>'
  const inner = a.querySelector('.inner')
  const b = inner.attachShadow({ mode: 'open' })
  b.innerHTML = '<style>:host{background-blend-mode:multiply}::slotted(.s){mask-image:linear-gradient(red,red)}</style><div part="bar"></div><slot></slot>'
  const bar = b.querySelector('[part="bar"]')
  const anim = bar.animate([{ columnWidth: '10px' }, { columnWidth: '20px' }], { duration: 100000 })
  anim.pause()
  return { a, b, inner, bar, slotted: inner.querySelector('.s') }
}

describe('universeFor on shadow-root content', () => {
  it('unions its own root, the roots above it and its root\'s WAAPI keyframes', () => {
    const { bar } = scene()
    const u = universeFor(bar, {})
    expect(u.has('mask-image')).toBe(true) // root B's own <style>
    expect(u.has('border-image-source')).toBe(true) // root A, above
    expect(u.has('column-rule-color')).toBe(true) // ::part, root A
    expect(u.has('column-width')).toBe(true) // bar.animate(), invisible to document.getAnimations()
    // No sheet names it, so it stays pruned: the point of the whole exercise.
    expect(u.has('shape-margin')).toBe(false)
  })

  it('joins a host\'s own shadow root for :host, read before anything inside it', () => {
    const { inner } = scene()
    expect(universeFor(inner, {}).has('background-blend-mode')).toBe(true)
  })

  it('joins the root of the slot a node is assigned to for ::slotted, read first', () => {
    const { slotted } = scene()
    expect(universeFor(slotted, {}).has('mask-image')).toBe(true)
  })

  it('keeps full reads without a capture session', () => {
    const { bar } = scene()
    expect(universeFor(bar)).toBe(null)
  })

  it('falls back to full reads for the rest of the capture when a root sheet is unreadable', async () => {
    const { b, bar, slotted } = scene()
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    const href = await commands.serveCrossOriginCss('.x{color:red}')
    await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; link.href = href; b.appendChild(link) })
    const session = {}
    expect(universeFor(bar, session)).toBe(null)
    expect(universeFor(slotted, session)).toBe(null)
  })
})
