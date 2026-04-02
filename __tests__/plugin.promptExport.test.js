import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promptExport } from '../packages/plugins/prompt-export.js'

describe('promptExport plugin', () => {
  let container

  beforeEach(() => {
    container = document.createElement('div')
    container.style.cssText = 'position:relative; width:400px; height:300px;'
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  /* ── Plugin structure ────────────────────────── */

  it('returns a valid plugin with required hooks', () => {
    const plugin = promptExport()
    expect(plugin.name).toBe('prompt-export')
    expect(typeof plugin.afterClone).toBe('function')
    expect(typeof plugin.defineExports).toBe('function')
  })

  it('defineExports returns a prompt key', () => {
    const plugin = promptExport()
    const exports = plugin.defineExports()
    expect(typeof exports.prompt).toBe('function')
  })

  /* ── Interactive element extraction ──────────── */

  it('extracts buttons and links as interactive', () => {
    const btn = document.createElement('button')
    btn.textContent = 'Click me'
    container.appendChild(btn)

    const link = document.createElement('a')
    link.href = 'https://example.com'
    link.textContent = 'Link'
    container.appendChild(link)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport().afterClone(ctx)

    const interactive = ctx.__promptMetadata.elements.filter(
      (e) => e.type === 'interactive'
    )
    expect(interactive.length).toBe(2)
    expect(interactive[0].tag).toBe('button')
    expect(interactive[0].text).toBe('Click me')
    expect(interactive[1].tag).toBe('a')
    expect(interactive[1].attributes.href).toBe('https://example.com')
  })

  it('extracts form elements as interactive', () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'email'
    input.placeholder = 'Enter email'
    container.appendChild(input)

    const select = document.createElement('select')
    select.innerHTML = '<option>A</option><option>B</option>'
    container.appendChild(select)

    const textarea = document.createElement('textarea')
    textarea.placeholder = 'Write here'
    container.appendChild(textarea)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport().afterClone(ctx)

    const interactive = ctx.__promptMetadata.elements.filter(
      (e) => e.type === 'interactive'
    )
    const tags = interactive.map((e) => e.tag)
    expect(tags).toContain('input')
    expect(tags).toContain('select')
    expect(tags).toContain('textarea')
  })

  it('extracts ARIA role elements as interactive', () => {
    const div = document.createElement('div')
    div.setAttribute('role', 'button')
    div.textContent = 'Custom button'
    container.appendChild(div)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport().afterClone(ctx)

    const el = ctx.__promptMetadata.elements.find((e) => e.text === 'Custom button')
    expect(el).toBeDefined()
    expect(el.type).toBe('interactive')
    expect(el.attributes.role).toBe('button')
  })

  /* ── Semantic element extraction ─────────────── */

  it('extracts headings and paragraphs as semantic', () => {
    const h1 = document.createElement('h1')
    h1.textContent = 'Title'
    container.appendChild(h1)

    const p = document.createElement('p')
    p.textContent = 'Paragraph text'
    container.appendChild(p)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport().afterClone(ctx)

    const semantic = ctx.__promptMetadata.elements.filter(
      (e) => e.type === 'semantic'
    )
    expect(semantic.length).toBe(2)
    expect(semantic[0].tag).toBe('h1')
    expect(semantic[0].text).toBe('Title')
    expect(semantic[1].tag).toBe('p')
  })

  it('extracts img alt text', () => {
    const img = document.createElement('img')
    img.alt = 'Company logo'
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    img.style.cssText = 'width:100px; height:50px;'
    container.appendChild(img)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport().afterClone(ctx)

    const el = ctx.__promptMetadata.elements.find((e) => e.tag === 'img')
    expect(el).toBeDefined()
    expect(el.type).toBe('semantic')
    expect(el.attributes.alt).toBe('Company logo')
  })

  /* ── Deduplication ───────────────────────────── */

  it('does not duplicate elements matching both interactive and semantic selectors', () => {
    const link = document.createElement('a')
    link.href = '/home'
    link.textContent = 'Home'
    container.appendChild(link)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport().afterClone(ctx)

    const matches = ctx.__promptMetadata.elements.filter((e) => e.text === 'Home')
    expect(matches.length).toBe(1)
    expect(matches[0].type).toBe('interactive')
  })

  /* ── Bounding boxes ─────────────────────────── */

  it('calculates bounding boxes relative to root', () => {
    const btn = document.createElement('button')
    btn.style.cssText = 'position:absolute; left:50px; top:30px; width:100px; height:40px;'
    btn.textContent = 'Test'
    container.appendChild(btn)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport().afterClone(ctx)

    const el = ctx.__promptMetadata.elements.find((e) => e.tag === 'button')
    expect(el).toBeDefined()
    expect(el.bbox.x).toBeGreaterThanOrEqual(0)
    expect(el.bbox.y).toBeGreaterThanOrEqual(0)
    expect(el.bbox.width).toBeGreaterThan(0)
    expect(el.bbox.height).toBeGreaterThan(0)
  })

  it('records root dimensions', () => {
    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport().afterClone(ctx)

    expect(ctx.__promptMetadata.dimensions.width).toBe(400)
    expect(ctx.__promptMetadata.dimensions.height).toBeGreaterThan(0)
  })

  /* ── Filtering edge cases ────────────────────── */

  it('skips zero-size (hidden) elements', () => {
    const btn = document.createElement('button')
    btn.style.display = 'none'
    btn.textContent = 'Hidden'
    container.appendChild(btn)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport().afterClone(ctx)

    const interactive = ctx.__promptMetadata.elements.filter(
      (e) => e.type === 'interactive'
    )
    expect(interactive.length).toBe(0)
  })

  it('handles empty container gracefully', () => {
    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport().afterClone(ctx)

    expect(ctx.__promptMetadata.elements.length).toBe(0)
    expect(ctx.__promptMetadata.dimensions.width).toBe(400)
  })

  it('truncates text content longer than 200 chars', () => {
    const p = document.createElement('p')
    p.textContent = 'A'.repeat(300)
    container.appendChild(p)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport().afterClone(ctx)

    const el = ctx.__promptMetadata.elements.find((e) => e.tag === 'p')
    expect(el.text.length).toBeLessThanOrEqual(200)
  })

  /* ── Attributes ─────────────────────────────── */

  it('captures relevant attributes', () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'search'
    input.placeholder = 'Search...'
    input.title = 'Search box'
    container.appendChild(input)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport().afterClone(ctx)

    const el = ctx.__promptMetadata.elements.find((e) => e.tag === 'input')
    expect(el.attributes.type).toBe('text')
    expect(el.attributes.name).toBe('search')
    expect(el.attributes.placeholder).toBe('Search...')
    expect(el.attributes.title).toBe('Search box')
  })

  it('captures aria attributes', () => {
    const btn = document.createElement('button')
    btn.setAttribute('aria-label', 'Close dialog')
    btn.setAttribute('aria-expanded', 'false')
    btn.textContent = 'X'
    container.appendChild(btn)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport().afterClone(ctx)

    const el = ctx.__promptMetadata.elements.find((e) => e.tag === 'button')
    expect(el.attributes['aria-label']).toBe('Close dialog')
    expect(el.attributes['aria-expanded']).toBe('false')
  })

  /* ── Annotations ────────────────────────────── */

  it('adds annotation overlay with badges when annotate=true', () => {
    const btn = document.createElement('button')
    btn.textContent = 'Click'
    container.appendChild(btn)

    const link = document.createElement('a')
    link.href = '#'
    link.textContent = 'Go'
    container.appendChild(link)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport({ annotate: true }).afterClone(ctx)

    const overlay = clone.querySelector('[data-snap-prompt-overlay]')
    expect(overlay).toBeTruthy()

    const labels = overlay.querySelectorAll('[data-snap-prompt-label]')
    expect(labels.length).toBe(2)
    expect(labels[0].textContent).toBe('0')
    expect(labels[1].textContent).toBe('1')
  })

  it('sets clone to position:relative for annotation overlay', () => {
    const btn = document.createElement('button')
    btn.textContent = 'Click'
    container.appendChild(btn)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport({ annotate: true }).afterClone(ctx)

    expect(clone.style.position).toBe('relative')
  })

  it('does not add annotations when annotate=false', () => {
    const btn = document.createElement('button')
    btn.textContent = 'Click'
    container.appendChild(btn)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport({ annotate: false }).afterClone(ctx)

    const overlay = clone.querySelector('[data-snap-prompt-overlay]')
    expect(overlay).toBeNull()
    expect(ctx.__promptMetadata.elements.length).toBe(1)
  })

  it('does not add overlay when no interactive elements exist', () => {
    const p = document.createElement('p')
    p.textContent = 'Just text'
    container.appendChild(p)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport({ annotate: true }).afterClone(ctx)

    const overlay = clone.querySelector('[data-snap-prompt-overlay]')
    expect(overlay).toBeNull()
  })

  it('applies custom label styles', () => {
    const btn = document.createElement('button')
    btn.textContent = 'Styled'
    container.appendChild(btn)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport({
      annotate: true,
      labelStyle: { backgroundColor: 'blue', fontSize: '14px' },
    }).afterClone(ctx)

    const label = clone.querySelector('[data-snap-prompt-label]')
    expect(label.style.backgroundColor).toBe('blue')
    expect(label.style.fontSize).toBe('14px')
  })

  /* ── Custom selectors ───────────────────────── */

  it('supports custom interactive selector', () => {
    const div = document.createElement('div')
    div.className = 'card'
    div.textContent = 'Card'
    div.style.cssText = 'width:100px; height:50px;'
    container.appendChild(div)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport({
      interactiveSelector: '.card',
      semanticSelector: 'nonexistent',
    }).afterClone(ctx)

    expect(ctx.__promptMetadata.elements.length).toBe(1)
    expect(ctx.__promptMetadata.elements[0].tag).toBe('div')
    expect(ctx.__promptMetadata.elements[0].type).toBe('interactive')
  })

  it('supports custom semantic selector', () => {
    const span = document.createElement('span')
    span.className = 'highlight'
    span.textContent = 'Important'
    span.style.cssText = 'display:inline-block; width:80px; height:20px;'
    container.appendChild(span)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport({
      interactiveSelector: 'nonexistent',
      semanticSelector: '.highlight',
    }).afterClone(ctx)

    expect(ctx.__promptMetadata.elements.length).toBe(1)
    expect(ctx.__promptMetadata.elements[0].type).toBe('semantic')
  })

  /* ── Multiple element types together ─────────── */

  it('assigns sequential IDs across interactive and semantic elements', () => {
    const btn = document.createElement('button')
    btn.textContent = 'Submit'
    container.appendChild(btn)

    const h2 = document.createElement('h2')
    h2.textContent = 'Section'
    container.appendChild(h2)

    const link = document.createElement('a')
    link.href = '#'
    link.textContent = 'More'
    container.appendChild(link)

    const p = document.createElement('p')
    p.textContent = 'Text'
    container.appendChild(p)

    const clone = container.cloneNode(true)
    const ctx = { element: container, clone }
    promptExport().afterClone(ctx)

    const ids = ctx.__promptMetadata.elements.map((e) => e.id)
    expect(ids).toEqual([...new Set(ids)]) // all unique
    // Interactive first, then semantic
    const types = ctx.__promptMetadata.elements.map((e) => e.type)
    const firstSemantic = types.indexOf('semantic')
    const lastInteractive = types.lastIndexOf('interactive')
    if (firstSemantic >= 0 && lastInteractive >= 0) {
      expect(lastInteractive).toBeLessThan(firstSemantic)
    }
  })
})
