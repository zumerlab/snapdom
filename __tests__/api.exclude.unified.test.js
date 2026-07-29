// v3 exclude unification: one option accepts selectors and/or predicates (true = exclude);
// legacy filter (keep-polarity) still works and composes. The polarity flip at the alias
// boundary is the load-bearing assertion — a mistake would silently invert captures.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

function page() {
  const host = document.createElement('div')
  host.innerHTML = '<p class="keep">keep-me</p><p class="drop">drop-me</p>'
  document.body.appendChild(host)
  return host
}
const svgOf = async (el, opts) => decodeURIComponent((await snapdom(el, { cache: 'disabled', ...opts })).url.split(',')[1])

describe('unified exclude', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('selector string excludes', async () => {
    const svg = await svgOf(page(), { exclude: '.drop', excludeMode: 'remove' })
    expect(svg).toContain('keep-me')
    expect(svg).not.toContain('drop-me')
  })

  it('predicate excludes (true = exclude, matching the option name)', async () => {
    const svg = await svgOf(page(), { exclude: (el) => el.classList?.contains('drop'), excludeMode: 'remove' })
    expect(svg).toContain('keep-me')
    expect(svg).not.toContain('drop-me')
  })

  it('mixed array of selectors and predicates', async () => {
    const host = page()
    const extra = document.createElement('span')
    extra.className = 'also-drop'
    extra.textContent = 'also-me'
    host.appendChild(extra)
    const svg = await svgOf(host, { exclude: ['.drop', (el) => el.classList?.contains('also-drop')], excludeMode: 'remove' })
    expect(svg).toContain('keep-me')
    expect(svg).not.toContain('drop-me')
    expect(svg).not.toContain('also-me')
  })

  it('legacy filter keeps its KEEP polarity exactly (v2 compat)', async () => {
    const svg = await svgOf(page(), { filter: (el) => !el.classList?.contains('drop'), filterMode: 'remove' })
    expect(svg).toContain('keep-me')
    expect(svg).not.toContain('drop-me')
  })

  it('legacy filter and new exclude compose when both are passed', async () => {
    const host = page()
    const extra = document.createElement('span')
    extra.className = 'also-drop'
    extra.textContent = 'also-me'
    host.appendChild(extra)
    const svg = await svgOf(host, {
      exclude: '.drop',
      excludeMode: 'remove',
      filter: (el) => !el.classList?.contains('also-drop'),
      filterMode: 'remove',
    })
    expect(svg).toContain('keep-me')
    expect(svg).not.toContain('drop-me')
    expect(svg).not.toContain('also-me')
  })
})
