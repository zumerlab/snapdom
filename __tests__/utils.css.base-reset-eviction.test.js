import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'
import { cache } from '../src/core/cache.js'
import { generateDedupedBaseCSS, getDefaultStyleForTag } from '../src/utils/css.js'

/**
 * The per-tag base reset neutralizes UA defaults inside the foreignObject. It was built by
 * reading cache.defaultStyle — an EvictingMap — directly, so a document using more distinct
 * tags than MAX_DEFAULT_STYLE had its earliest-registered tags evicted before the reset was
 * generated. Those tags got no reset rule and the UA stylesheet applied instead, reflowing
 * the capture taller than the source.
 */

/** Tag names appearing in the selector of every non-class rule of the generated CSS. */
function resetTags(css) {
  const tags = new Set()
  for (const m of css.matchAll(/(?:^|\})\s*([a-z0-9][a-z0-9, ]*?)\s*\{/gi)) {
    for (const t of m[1].split(',')) tags.add(t.trim())
  }
  return tags
}

function svgCss(url) {
  const markup = decodeURIComponent(url)
  const doc = new DOMParser().parseFromString(markup.slice(markup.indexOf('<')), 'image/svg+xml')
  return [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n')
}

// Comfortably more distinct tags than MAX_DEFAULT_STYLE (30). These must each carry *distinct*
// UA styling: tags that compute identically (aside/section/nav/header/… are all plain blocks)
// collide on the style-key memo, never call getDefaultStyleForTag, and so never occupy a slot.
const MANY_TAGS = [
  'h1', 'h2', 'h4', 'h5', 'h6', 'p', 'pre', 'code', 'em', 'strong', 'small', 'sub', 'sup',
  'mark', 'del', 'ins', 'a', 'hr', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'form', 'label', 'input', 'button', 'select',
  'textarea', 'fieldset', 'legend', 'img', 'span', 'b', 'i', 'q', 'cite', 'abbr',
]

describe('generateDedupedBaseCSS — tags evicted from the defaultStyle cache', () => {
  let root, sheet
  afterEach(() => { root?.remove(); sheet?.remove() })

  it('emits a base reset for an early tag even when the document exceeds the cache cap', async () => {
    sheet = document.createElement('style')
    // Reset the heading margin to the CSS initial value, so the property is diffed away and
    // the element depends entirely on the base reset to neutralize the UA default.
    sheet.textContent = '#sd-cap h3{margin:0;font-size:16px;font-weight:400}'
    document.head.appendChild(sheet)

    root = document.createElement('div')
    root.id = 'sd-cap'
    // h3 first, so it is among the earliest tags registered and thus the first evicted.
    // Each filler needs real content: an empty, zero-sized element can be culled before the
    // style pass and would then never consume a defaultStyle slot.
    root.innerHTML = '<h3>Heading</h3>' + MANY_TAGS.map((t) => `<${t}>x</${t}>`).join('')
    document.body.appendChild(root)

    const distinct = new Set([...root.querySelectorAll('*')].map((e) => e.tagName.toLowerCase()))
    expect(distinct.size).toBeGreaterThan(30)

    // Start cold, as on a real page load: h3 is registered first and then evicted by the
    // tags that follow it. A cache warmed by earlier tests would already hold h3 and hide it.
    cache.defaultStyle.clear()

    const css = svgCss((await snapdom(root)).url)
    expect(resetTags(css)).toContain('h3')
  })

  it('covers every used tag that has defaults, not just the ones still cached', async () => {
    const used = ['h1', 'h2', 'h3', 'p', 'hr', 'strong', 'main', ...MANY_TAGS]
    // Simulate the end-of-capture state: the cache has been churned past its cap.
    cache.defaultStyle.clear()
    const css = generateDedupedBaseCSS([...used].sort())
    const emitted = resetTags(css)
    const expected = used.filter((t) => Object.keys(getDefaultStyleForTag(t)).length > 0)
    for (const tag of expected) expect(emitted).toContain(tag)
  })
})
