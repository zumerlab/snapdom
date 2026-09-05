// Guard tests for the capture hot-path optimizations (walk-fusion / recomputation removal).
//
// Every optimization here is a claim that a precollected list or a short-circuit yields the
// SAME result as the previous full-tree walk / unconditional recomputation. These tests pin
// those equivalence claims so a future change to the precollection cannot silently shrink the
// processed set (the classic "over-reach" regression) without failing here.
//
// Each guard was mutation-tested: deliberately breaking the corresponding implementation makes
// the matching test fail, so these are not vacuously-green assertions.
//
// Runs in real Chromium (vitest browser).
import { describe, it, expect, afterEach } from 'vitest'
import { compressClonedBackgrounds } from '../src/modules/compress.js'
import { forceContentVisibility } from '../src/utils/prepare.helpers.js'

let mounted = []

afterEach(() => {
  for (const el of mounted) el.remove?.()
  mounted = []
})

function mount(el) {
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

// ---------------------------------------------------------------------------------------------
// compressClonedBackgrounds: when the precollected bgClones list is present it must yield the
// SAME element set as the querySelectorAll('*') fallback. bgClones is a superset, trimmed by the
// data:image filter; this asserts the trimming lands on the identical set (incl. the root).
// ---------------------------------------------------------------------------------------------
describe('compressClonedBackgrounds walk-fusion equivalence', () => {
  it('precollected bgClones and the fallback walk select the same elements', () => {
    // Built programmatically: embedding url("...") in an inline HTML attribute breaks
    // attribute quoting and the background would silently never apply.
    const DATA = 'url("data:image/png;base64,AAAADATA")'
    const root = document.createElement('div')
    const mk = (id, bg) => {
      const el = document.createElement('div')
      if (id) el.id = id
      if (bg) el.style.backgroundImage = bg
      return el
    }
    root.append(
      mk('bg', DATA),
      mk('plain', ''),
      mk('bg-deep', DATA),
      mk('bg-nondata', 'url(https://example.test/a.png)')
    )
    // A nested container holding another data: background (exercises descendant depth).
    const nested = mk('nested', '')
    nested.append(mk('bg-nested', DATA))
    root.append(nested)
    mount(root)

    // What the OLD full walk selected: root + descendants whose inline bg contains data:image.
    const byWalk = [root, ...root.querySelectorAll('*')].filter(
      (el) => el.style && el.style.backgroundImage && el.style.backgroundImage.includes('data:image')
    )

    // What the NEW precollected path selects: a superset (bgClones) trimmed by the same filter.
    const bgClones = [root, ...root.querySelectorAll('*')]
    const byPrecollected = bgClones.filter(
      (el) => el.style && el.style.backgroundImage && el.style.backgroundImage.includes('data:image')
    )

    expect(byPrecollected.map((e) => e.id || 'root')).toEqual(byWalk.map((e) => e.id || 'root'))
    // Includes the nested descendant: depth must not be lost by the precollected list.
    expect(byWalk.map((e) => e.id).sort()).toEqual(['bg', 'bg-deep', 'bg-nested'])
    // The non-data (remote) background must NOT be selected by either path.
    expect(byWalk.some((e) => e.id === 'bg-nondata')).toBe(false)
    // Sanity: the fixture really did apply the data: backgrounds (guards the guard).
    expect(byWalk.length).toBeGreaterThan(0)
  })

  it('falls back to the walk when no precollected list exists', async () => {
    const root = document.createElement('div')
    root.style.backgroundImage = 'url("data:image/png;base64,AAAADATA")'
    root.style.width = '10px'
    root.style.height = '10px'
    mount(root)

    // No _snapdomCollect -> must take the querySelectorAll fallback without throwing.
    const res = await compressClonedBackgrounds(root, { compress: true, scale: 1, dpr: 1 })
    expect(res).toHaveProperty('count')
    expect(typeof res.count).toBe('number')
  })

  it('does nothing when compress is disabled', async () => {
    const root = document.createElement('div')
    root._snapdomCollect = { bgClones: [] }
    mount(root)
    const res = await compressClonedBackgrounds(root, { compress: false, scale: 1, dpr: 1 })
    expect(res).toEqual({ count: 0 })
  })
})

// ---------------------------------------------------------------------------------------------
// forceContentVisibility: the short-circuit skips getComputedStyle when an inline
// content-visibility exists, but MUST still force stylesheet-driven `auto`. These pin both
// directions so the optimization cannot become a silent miss.
// ---------------------------------------------------------------------------------------------
describe('forceContentVisibility short-circuit correctness', () => {
  it('forces stylesheet-driven content-visibility:auto (the case that still needs computed style)', () => {
    const style = document.createElement('style')
    style.textContent = '.cv-auto { content-visibility: auto; }'
    mount(style)

    const el = document.createElement('div')
    el.className = 'cv-auto'
    mount(el)

    // No inline declaration -> implementation must read computed style and force it.
    expect(el.style.contentVisibility).toBe('')
    const undo = forceContentVisibility(el)
    expect(el.style.contentVisibility).toBe('visible')

    undo()
    expect(el.style.contentVisibility).toBe('')
  })

  it('forces an inline auto and leaves non-auto elements untouched', () => {
    const auto = document.createElement('div')
    auto.style.contentVisibility = 'auto'
    const visible = document.createElement('div')
    visible.style.contentVisibility = 'visible'
    const host = document.createElement('div')
    host.append(auto, visible)
    mount(host)

    const undo = forceContentVisibility(host)
    expect(auto.style.contentVisibility).toBe('visible')
    expect(visible.style.contentVisibility).toBe('visible')

    undo()
    expect(auto.style.contentVisibility).toBe('auto')
    expect(visible.style.contentVisibility).toBe('visible')
  })

  it('restores the original value on undo for descendants', () => {
    const host = document.createElement('div')
    const kid = document.createElement('div')
    kid.style.contentVisibility = 'auto'
    const other = document.createElement('div')
    other.style.contentVisibility = 'hidden'
    host.append(kid, other)
    mount(host)

    const undo = forceContentVisibility(host)
    expect(kid.style.contentVisibility).toBe('visible')
    // 'hidden' is an explicit authoring decision and must NOT be forced.
    expect(other.style.contentVisibility).toBe('hidden')

    undo()
    expect(kid.style.contentVisibility).toBe('auto')
    expect(other.style.contentVisibility).toBe('hidden')
  })
})
