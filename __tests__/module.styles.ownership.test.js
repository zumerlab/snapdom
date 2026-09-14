// Public data attributes are diagnostics/compatibility surface, not proof that snapdom owns a
// node. Author content using the same names must still invalidate style and burst caches.
import { describe, it, expect } from 'vitest'
import { hasExternalMutation } from '../src/modules/styles.js'

function recordsFor(el) {
  const observer = new MutationObserver(() => {})
  observer.observe(el, { subtree: true, attributes: true, childList: true })
  el.firstElementChild.setAttribute('data-change', 'yes')
  const records = observer.takeRecords()
  observer.disconnect()
  return records
}

describe('style invalidation ownership', () => {
  for (const marker of ['data-snapdom-internal', 'data-snapdom-sandbox', 'data-snapdom']) {
    it(`treats an authored ${marker} subtree as external`, () => {
      const el = document.createElement('div')
      el.setAttribute(marker, '')
      el.innerHTML = '<span></span>'
      const records = recordsFor(el)
      expect(records.length).toBeGreaterThan(0)
      expect(hasExternalMutation(records)).toBe(true)
    })
  }
})
