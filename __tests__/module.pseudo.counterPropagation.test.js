import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

// A pseudo that paints nothing (`content: ""`, no box) is dropped from the clone, but its
// counter-increment still happened live. The sibling map must carry the value past it, or
// the list renumbers: 1, 3 live came out as 1, 2.

describe('pseudo counters past a pseudo that paints nothing', () => {
  afterEach(() => { document.body.innerHTML = ''; document.head.querySelectorAll('style').forEach(s => s.remove()) })

  it('keeps the increment of a dropped pseudo for the next sibling', async () => {
    const style = document.createElement('style')
    style.textContent = `
      ul.cp { list-style: none; counter-reset: item; }
      ul.cp li::before { counter-increment: item; content: "n" counter(item) "."; }
      ul.cp li.silent::before { content: ""; }
    `
    document.head.appendChild(style)
    const ul = document.createElement('ul')
    ul.className = 'cp'
    ul.innerHTML = '<li>a</li><li class="silent">b</li><li>c</li>'
    document.body.appendChild(ul)

    const res = await snapdom(ul, { cache: 'disabled' })
    const svg = decodeURIComponent(res.url.split(',')[1])
    expect(svg).toContain('n1.')
    expect(svg).toContain('n3.')
    expect(svg).not.toContain('n2.')
  })
})
