import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'

// CSSOM edits (sheet.insertRule, rule.style.x = …) mutate no DOM node, so no MutationObserver
// fires and the style epoch never bumps — every epoch-scoped memo (property universe, style
// snapshots) keeps serving the pre-edit CSS world. `invalidate: true` is the documented escape
// hatch for exactly this, but it only dirtied the BURST state: the style memos live below
// burst, so `{ burst: false, invalidate: true }` still rendered the stale styles.
describe('invalidate: true — purges the style caches, not just the burst memo', () => {
  let el, style
  afterEach(() => {
    el?.remove()
    style?.remove()
  })

  function setup() {
    style = document.createElement('style')
    style.textContent = '.cssom-probe { color: rgb(10, 20, 30) }'
    document.head.appendChild(style)
    el = document.createElement('div')
    el.className = 'cssom-probe'
    el.textContent = 'cssom'
    document.body.appendChild(el)
  }

  // The sharp edge is the PROPERTY UNIVERSE, not the value: the engine snapshots only the
  // properties the scanned author CSS can actually touch. A property the page never used is
  // absent from that universe, so a rule introducing it via CSSOM is invisible to the capture
  // no matter what its value is. `color` would NOT catch this — it is always in the universe
  // and re-reads fine, which is why this test uses a property nothing else in the document
  // mentions.
  it('picks up a property the scanned CSS universe had never seen', async () => {
    setup()
    // Prime every epoch-scoped memo against the current CSS world.
    const before = decodeURIComponent((await snapdom(el, { burst: false })).url)
    expect(before).not.toContain('vertical-rl')

    // No DOM mutation: nothing can observe this.
    style.sheet.insertRule('.cssom-probe { writing-mode: vertical-rl }', style.sheet.cssRules.length)

    const after = decodeURIComponent((await snapdom(el, { burst: false, invalidate: true })).url)
    expect(after).toContain('vertical-rl')
  })

  it('picks up a direct rule.style edit on the next capture', async () => {
    setup()
    await snapdom(el, { burst: false })
    style.sheet.cssRules[0].style.color = 'rgb(7, 7, 7)'
    const after = decodeURIComponent((await snapdom(el, { burst: false, invalidate: true })).url)
    expect(after).toContain('rgb(7, 7, 7)')
  })
})
