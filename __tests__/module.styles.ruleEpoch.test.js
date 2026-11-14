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
import { universeFor, pseudoGatesFor, flushStyleInvalidations, invalidateStyleCaches } from '../src/modules/styles.js'

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

// The memo stays keyed on the DOM epoch, but a re-scan first compares a census of the sheets
// (rule list, length, first and last rule per sheet, the child count of each rule of a short
// sheet, WAAPI-animated props) with the one the last scan read, and keeps that scan when they
// are equal. A card on a page with a 10,000-rule sheet, one node mutated before each capture:
// 21.9 ms per capture before, 7.9 after (Chromium). These pin what the census must still see,
// and what it gives up to `invalidate: true`.
describe('a DOM mutation that touches no stylesheet reuses the scan', () => {
  const gates = (el) => { flushStyleInvalidations(); return pseudoGatesFor(el) }
  const mutate = (el) => el.setAttribute('data-ruleepoch', String(Math.random()))
  function sheet(css) {
    const s = document.createElement('style')
    s.textContent = css
    document.head.appendChild(s)
    trash.push(s)
    return s.sheet
  }

  it('keeps the same scan across a plain mutation, and drops it when a sheet arrives', () => {
    const el = target()
    sheet('.ruleepoch-probe::before { content: "x" }')
    const before = gates(el)
    mutate(el)
    expect(gates(el)).toBe(before)
    sheet('.ruleepoch-probe::after { content: "y" }')
    expect(gates(el)).not.toBe(before)
  })

  it('sees insertRule at the next mutation', () => {
    const el = target()
    const s = sheet('.ruleepoch-probe { color: red }')
    expect(universeHas(el, 'scroll-snap-stop')).toBe(false)
    s.insertRule('.ruleepoch-probe { scroll-snap-stop: always }', s.cssRules.length)
    mutate(el)
    expect(universeHas(el, 'scroll-snap-stop')).toBe(true)
  })

  it('sees a rule swapped for another, same count, at the next mutation', () => {
    const el = target()
    const s = sheet('.ruleepoch-probe { color: red } .ruleepoch-probe { color: blue }')
    expect(universeHas(el, 'ruby-align')).toBe(false)
    s.deleteRule(1)
    s.insertRule('.ruleepoch-probe { ruby-align: center }', 1)
    mutate(el)
    expect(universeHas(el, 'ruby-align')).toBe(true)
  })

  it('sees a rule inserted into a group of a short sheet at the next mutation', () => {
    // Where a library that keeps its rules inside a few @media or @layer groups inserts them.
    const el = target()
    const s = sheet('@media all { .ruleepoch-probe { color: red } } @layer zz { .ruleepoch-probe { color: blue } }')
    expect(universeHas(el, 'scroll-snap-stop')).toBe(false)
    s.cssRules[0].insertRule('.ruleepoch-probe { scroll-snap-stop: always }', 1)
    mutate(el)
    expect(universeHas(el, 'scroll-snap-stop')).toBe(true)
    expect(universeHas(el, 'ruby-align')).toBe(false)
    s.cssRules[1].insertRule('.ruleepoch-probe { ruby-align: center }', 0)
    mutate(el)
    expect(universeHas(el, 'ruby-align')).toBe(true)
  })

  it('sees an adopted sheet, and its replaceSync, at the next mutation', () => {
    const el = target()
    const adopted = new CSSStyleSheet()
    adopted.replaceSync('.ruleepoch-probe { text-emphasis-color: red }')
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, adopted]
    mutate(el)
    expect(universeHas(el, 'text-emphasis-color')).toBe(true)
    adopted.replaceSync('.ruleepoch-probe { text-emphasis-position: under }')
    mutate(el)
    expect(universeHas(el, 'text-emphasis-position')).toBe(true)
  })

  it('re-scans every time while a sheet imports another', async () => {
    const el = target()
    const s = document.createElement('style')
    s.textContent = '@import url("data:text/css,.x{color:red}"); .ruleepoch-probe::before { content: "x" }'
    document.head.appendChild(s)
    trash.push(s)
    // Firefox exposes the sheet only once its import has loaded.
    await expect.poll(() => s.sheet?.cssRules.length).toBe(2)
    const before = gates(el)
    mutate(el)
    expect(gates(el)).not.toBe(before)
  })

  it('a swap that keeps the count and both ends needs the escape hatch', () => {
    const el = target()
    const s = sheet('.ruleepoch-probe { color: red } .ruleepoch-probe { color: blue } .ruleepoch-probe { color: green }')
    expect(universeHas(el, 'text-emphasis-position')).toBe(false)
    s.deleteRule(1)
    s.insertRule('.ruleepoch-probe { text-emphasis-position: under }', 1)
    mutate(el)
    expect(universeHas(el, 'text-emphasis-position')).toBe(false)
    invalidateStyleCaches()
    expect(universeHas(el, 'text-emphasis-position')).toBe(true)
  })

  it('a rule edited in place needs the escape hatch, like every unobserved CSSOM edit', () => {
    // Before the census a DOM mutation happened to re-read it. The count and both ends of the
    // sheet are unchanged, so the census cannot tell; `invalidate: true` is the contract.
    const el = target()
    const s = sheet('.ruleepoch-probe { color: red }')
    expect(universeHas(el, 'text-emphasis-style')).toBe(false)
    s.cssRules[0].style.setProperty('text-emphasis-style', 'dot')
    mutate(el)
    expect(universeHas(el, 'text-emphasis-style')).toBe(false)
    invalidateStyleCaches()
    expect(universeHas(el, 'text-emphasis-style')).toBe(true)
  })
})
