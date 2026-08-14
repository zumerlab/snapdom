// The burst memo as a transaction: a capture publishes its frame ONLY if it resolved and
// the DOM held still while it ran. Plus the diff path's plugin contract: `pure` does not
// mean subtree-local, so resolveNode/afterClone force the full pipeline.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { __diffStats } from '../src/core/diff.js'

afterEach(() => { document.body.innerHTML = '' })

const svgOf = (res) => decodeURIComponent(res.url.split(',')[1])
const settle = () => new Promise((r) => setTimeout(r, 0))

/** Grid whose cards carry a badge span inside the title, so a mutation scoped to one title
 *  produces a dirty subtree that CONTAINS plugin-transformed content. */
function buildGrid(cards = 12) {
  const container = document.createElement('div')
  container.style.cssText = 'width:600px;padding:16px;background:white;font-family:Arial;color:#222'
  const grid = document.createElement('div')
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px'
  for (let i = 0; i < cards; i++) {
    const card = document.createElement('div')
    card.style.cssText = 'padding:8px;background:#eee'
    const title = document.createElement('h3')
    title.style.cssText = 'margin:0;font-size:13px'
    title.append(`Card ${i} `)
    const badge = document.createElement('span')
    badge.setAttribute('data-badge', '')
    badge.style.cssText = 'font-size:11px;background:#cde;padding:1px 4px'
    badge.textContent = 'raw'
    title.appendChild(badge)
    card.appendChild(title)
    grid.appendChild(card)
  }
  container.appendChild(grid)
  document.body.appendChild(container)
  return container
}

describe('diff path × plugin hooks that are not subtree-local', () => {
  it('a pure resolveNode plugin still forces the full pipeline on a mutated subtree', async () => {
    const el = buildGrid()
    const plugin = {
      name: 'badge-resolve',
      pure: true,
      resolveNode(node) {
        if (node.nodeType !== 1 || !node.hasAttribute?.('data-badge')) return
        const b = document.createElement('b')
        b.textContent = 'RESOLVED'
        return b
      }
    }
    const opts = { plugins: [plugin], burst: true }
    await snapdom(el, opts)

    // Mutate INSIDE a title: the dirty subtree is the <h3>, which contains a badge the
    // plugin must transform. resolveNode hooks are collected inside captureDOM, so the
    // diff path (which never enters it) would rebuild that subtree without them.
    el.querySelectorAll('h3')[4].append(' updated')
    await settle()
    const attempts0 = __diffStats.attempts
    const res = await snapdom(el, opts)
    expect(__diffStats.attempts).toBeGreaterThan(attempts0) // the fast path WAS reached

    const svg = svgOf(res)
    expect(svg.split('RESOLVED').length - 1).toBe(12) // every badge, the rebuilt one included
    expect(svg).not.toContain('>raw<')
    const full = await snapdom(el, { ...opts, burst: false })
    expect(res.url).toBe(full.url)
  })

  it('a pure afterClone plugin that rewrites the whole clone forces the full pipeline too', async () => {
    const el = buildGrid()
    const plugin = {
      name: 'badge-stamp',
      pure: true,
      afterClone(state) {
        for (const b of state.clone.querySelectorAll('[data-badge]')) b.textContent = 'STAMPED'
        return state
      }
    }
    const opts = { plugins: [plugin], burst: true }
    await snapdom(el, opts)

    el.querySelectorAll('h3')[7].append(' updated')
    await settle()
    const res = await snapdom(el, opts)

    const svg = svgOf(res)
    expect(svg.split('STAMPED').length - 1).toBe(12) // the rebuilt subtree kept its stamp
    const full = await snapdom(el, { ...opts, burst: false })
    expect(res.url).toBe(full.url)
  })
})

describe('burst memo is transactional', () => {
  it('a capture that throws must not leave the element marked clean', async () => {
    const el = buildGrid()
    let boom = false
    const plugin = { name: 'boom', beforeSnap() { if (boom) throw new Error('boom') } }
    const opts = { plugins: [plugin], burst: true }

    const r1 = await snapdom(el, opts)
    expect(svgOf(r1)).not.toContain('MUTATED-9')

    el.querySelectorAll('h3')[2].append(' MUTATED-9')
    await settle()

    boom = true
    await expect(snapdom(el, opts)).rejects.toThrow('boom')
    boom = false

    // The failed capture cleared the dirty flags before awaiting: the memo (the PRE-mutation
    // frame) was then served as if it were fresh.
    const r3 = await snapdom(el, opts)
    expect(r3).not.toBe(r1)
    expect(svgOf(r3)).toContain('MUTATED-9')
  })

  it('an external mutation landing mid-capture leaves the element dirty', async () => {
    const el = buildGrid()
    let raced = false
    const plugin = {
      name: 'racer',
      beforeRender() {
        if (raced) return
        raced = true
        el.querySelectorAll('h3')[3].append(' RACE-7')
      }
    }
    const opts = { plugins: [plugin], burst: true }

    // The clone was taken before the mutation, so this frame is torn: it must not be memoized.
    const r1 = await snapdom(el, opts)
    expect(svgOf(r1)).not.toContain('RACE-7')

    const r2 = await snapdom(el, opts)
    expect(r2).not.toBe(r1)
    expect(svgOf(r2)).toContain('RACE-7')
  })

  it('the memo still engages on content the pipeline itself mutates (clamp / content-visibility)', async () => {
    // Speed guard: text-overflow, line-clamp and content-visibility:auto make the pipeline
    // edit LIVE nodes and undo them again (10 external-looking records on this tiny page).
    // Counting those as tears would disable the memo on very common CSS.
    const el = document.createElement('div')
    el.style.cssText = 'width:240px;font-family:Arial'
    const ellipsis = document.createElement('div')
    ellipsis.style.cssText = 'width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
    ellipsis.textContent = 'un texto bastante largo que no entra en ciento veinte pixeles'
    const clamped = document.createElement('div')
    clamped.style.cssText = 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;width:120px'
    clamped.textContent = 'otro texto largo que ocupa varias lineas y hay que recortar a dos'
    const lazy = document.createElement('div')
    lazy.style.cssText = 'content-visibility:auto;height:40px'
    lazy.textContent = 'contenido diferido'
    el.append(ellipsis, clamped, lazy)
    document.body.appendChild(el)

    const results = []
    for (let i = 0; i < 6; i++) results.push(await snapdom(el))
    // Auto-burst engages after 3 captures: a later call must return the SAME result object.
    expect(results.some((r, i) => i > 0 && r === results[i - 1])).toBe(true)
  })
})
