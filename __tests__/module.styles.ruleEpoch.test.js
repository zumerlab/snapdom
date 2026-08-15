// The scanned property universe and the pseudo gates are memoized against the DOM epoch,
// which bumps on ANY external mutation. That is deliberately conservative, and it is the
// decision this file guards.
//
// A narrower "rule epoch" was tried: memoize against author-rule changes only, so an
// ordinary text mutation would not re-scan every stylesheet. It works, and it is faster in
// isolation. But three ways the rules can change emit NO mutation record at all
// (adoptedStyleSheets assignment, a <link> finishing its load, insertRule), so keeping it
// correct required a census of every stylesheet in the document, once per capture, reading
// cssRules.length on each. Measured under three concurrent browsers on a long suite, where
// the document accumulates sheets, that census cost more than the split saved: it timed out
// module.pseudo on webkit while the pre-split code ran clean. Removing the census removed
// the timeouts and broke the three correctness cases below, which is the whole trade in one
// sentence.
//
// So: do not narrow this memo again without measuring the invalidation cost under load, not
// just the scan cost in isolation. These tests pin the cases that must keep working.
import { describe, it, expect, afterEach } from 'vitest'
import { universeFor, flushStyleInvalidations, invalidateStyleCaches } from '../src/modules/styles.js'

const trash = []
afterEach(() => {
  while (trash.length) trash.pop().remove()
  document.adoptedStyleSheets = []
})

function target() {
  const el = document.createElement('div')
  el.className = 'ruleepoch-probe'
  document.body.appendChild(el)
  trash.push(el)
  return el
}

/** The universe is the set of properties the page's author rules can touch. */
function universeHas(el, prop) {
  flushStyleInvalidations()
  const u = universeFor(el)
  return !!u && u.has(prop)
}

describe('author-rule changes always reach the scanned universe', () => {
  it('re-scans when a <style> is injected', () => {
    const el = target()
    expect(universeHas(el, 'ruby-position')).toBe(false)
    const s = document.createElement('style')
    s.textContent = '.ruleepoch-probe { ruby-position: over }'
    document.head.appendChild(s)
    trash.push(s)
    expect(universeHas(el, 'ruby-position')).toBe(true)
  })

  it('adoptedStyleSheets needs the escape hatch, like insertRule', () => {
    // Assigning adoptedStyleSheets emits no mutation record, so nothing observes it. This
    // is a documented limit, not a regression: it is what the pre-split code did too, and
    // it is the reason `invalidate: true` exists. Pinned so the limit stays visible.
    const el = target()
    expect(universeHas(el, 'text-emphasis-color')).toBe(false)
    const sheet = new CSSStyleSheet()
    sheet.replaceSync('.ruleepoch-probe { text-emphasis-color: red }')
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    expect(universeHas(el, 'text-emphasis-color')).toBe(false) // unobserved, by design
    invalidateStyleCaches()
    expect(universeHas(el, 'text-emphasis-color')).toBe(true)
  })

  it('re-scans after insertRule once the caller says so', () => {
    // insertRule is observable by nothing, which is what `invalidate: true` exists for.
    const el = target()
    const s = document.createElement('style')
    document.head.appendChild(s)
    trash.push(s)
    expect(universeHas(el, 'scroll-snap-stop')).toBe(false)
    s.sheet.insertRule('.ruleepoch-probe { scroll-snap-stop: always }', 0)
    // Nothing observed it; the escape hatch is the contract.
    invalidateStyleCaches()
    expect(universeHas(el, 'scroll-snap-stop')).toBe(true)
  })
})
