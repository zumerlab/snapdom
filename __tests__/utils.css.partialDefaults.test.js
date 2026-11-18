// A capture reads a tag's defaults only for the property universe its snapshots were pruned by,
// and more from the same probe when something asks for a prop outside it. That is a speed-up
// only: the values read, the style keys and the base reset must be those of the full read,
// which read every enumerated prop of a fresh `all: initial` probe.
import { describe, it, expect, afterEach } from 'vitest'
import { cache } from '../src/core/cache.js'
import { ALWAYS_PROPS } from '../src/modules/styleScan.js'
import { generateDedupedBaseCSS, getDefaultStyleForTag, getStyleKey, shouldIgnoreProp } from '../src/utils/css.js'

// Replaced elements, form controls, tables, bidi, ruby, MathML and a custom element: the tags
// whose initial computed values differ from a span's.
const TAGS = [
  'div', 'span', 'p', 'a', 'img', 'video', 'audio', 'canvas', 'iframe', 'embed', 'object',
  'input', 'textarea', 'select', 'button', 'meter', 'progress', 'table', 'td', 'th', 'tr',
  'bdi', 'bdo', 'ruby', 'rt', 'li', 'ul', 'summary', 'details', 'dialog', 'marquee', 'math',
  'mi', 'fieldset', 'legend', 'html', 'body', 'partial-defaults-el',
]

afterEach(() => { cache.defaultStyle.clear() })

/** The full read as it was: every enumerated prop, then ALWAYS_PROPS the enumeration skips. */
function fullRead(tag) {
  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0px;height:0px;overflow:hidden'
  document.body.appendChild(host)
  const el = document.createElement(tag.includes('-') ? 'span' : tag)
  el.style.all = 'initial'
  host.appendChild(el)
  const styles = getComputedStyle(el)
  const out = {}
  for (const prop of styles) if (!shouldIgnoreProp(prop)) out[prop] = styles.getPropertyValue(prop)
  for (const prop of ALWAYS_PROPS) if (!(prop in out) && !shouldIgnoreProp(prop)) out[prop] = styles.getPropertyValue(prop)
  host.remove()
  return out
}

const sorted = (map) => Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : 1)))

describe('partial tag defaults', () => {
  it('reads the universe first and ends equal to the full read', () => {
    const universe = new Set(['display', 'margin-inline-start', 'gap', 'not-a-property'])
    for (const tag of TAGS) {
      const partial = getDefaultStyleForTag(tag, universe)
      const full = fullRead(tag)
      expect(Object.keys(partial).length).toBeLessThan(Object.keys(full).length)
      for (const prop of Object.keys(partial)) expect([tag, prop, partial[prop]]).toEqual([tag, prop, full[prop]])
      expect(partial['margin-inline-start']).toBe(full['margin-inline-start'])
      expect('not-a-property' in partial).toBe(false)
      // Asked for whole, the same map is completed in place.
      expect(getDefaultStyleForTag(tag)).toBe(partial)
      expect(sorted(partial)).toEqual(sorted(full))
    }
  })

  it('leaves no probe in the document between reads', () => {
    getDefaultStyleForTag('section', new Set(['display']))
    getDefaultStyleForTag('section', new Set(['display', 'row-gap', 'scroll-margin-top']))
    getDefaultStyleForTag('section')
    const sandbox = document.getElementById('snapdom-sandbox')
    expect(sandbox && sandbox.children.length).toBe(0)
  })

  it('reads what a universe Set gained since the map was read for it', () => {
    // The shadow-root universe is one Set that grows as the capture meets shadow roots.
    const universe = new Set(['display'])
    const defaults = getDefaultStyleForTag('article', universe)
    expect('shape-margin' in defaults).toBe(false)
    universe.add('shape-margin')
    expect(getDefaultStyleForTag('article', universe)['shape-margin']).toBe(fullRead('article')['shape-margin'])
  })

  it('gives the style key of the full read for a snapshot with props outside the universe', () => {
    // An inline style can put any prop into a snapshot, whatever the universe holds.
    const snapshot = {
      display: 'block', width: '120px', 'margin-top': '0px', color: 'rgb(0, 0, 0)',
      'scroll-margin-top': '0px', 'shape-margin': '4px', 'column-count': 'auto', border: 'none',
    }
    const universe = new Set(['display', 'width'])
    const keys = {}
    for (const tag of ['div', 'span', 'td', 'img']) keys[tag] = getStyleKey(snapshot, tag, true, false, '', universe)
    cache.defaultStyle.clear()
    for (const tag of ['div', 'span', 'td', 'img']) expect([tag, keys[tag]]).toEqual([tag, getStyleKey(snapshot, tag)])
    expect(keys.div).toContain('shape-margin:4px')
    expect(keys.div).not.toContain('scroll-margin-top')
  })

  it('reads the props a twin snapshot inherits from the shared one', () => {
    // styles.js builds a twin's snapshot with Object.create(shared snapshot).
    const twin = Object.create({ display: 'block', 'shape-margin': '0px', 'column-count': '3' })
    twin.width = '120px'
    const key = getStyleKey(twin, 'div', true, false, '', new Set(['display', 'width']))
    expect(key).not.toContain('shape-margin')
    expect(key).toContain('column-count:3')
  })

  it('emits the base reset of the full read for a universe', () => {
    const universe = new Set(['display', 'margin-top', 'margin-block-start', 'padding-inline-end', 'overscroll-behavior-inline', 'overflow-x', 'width', 'unicode-bidi', 'gap', 'column-count', 'shape-margin'])
    for (const tag of TAGS) getDefaultStyleForTag(tag, new Set(['display']))
    const fromPartial = generateDedupedBaseCSS(TAGS, universe)
    cache.defaultStyle.clear()
    for (const tag of TAGS) getDefaultStyleForTag(tag)
    expect(fromPartial).toBe(generateDedupedBaseCSS(TAGS, universe))
  })
})
