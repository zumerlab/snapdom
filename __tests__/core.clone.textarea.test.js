import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

/**
 * A textarea's child nodes ARE its default value, so deepClone's normal child recursion
 * clones that text and appends it. The live value is therefore assigned AFTER that append
 * (src/core/clone.js), which wipes the children and leaves exactly the value.
 *
 * The ordering is the whole fix. Moving the assignment up next to the other textarea
 * handling, where it reads like it belongs, puts it before the append and the default text
 * lands after the value: the capture then shows the value twice. That bug is invisible on a
 * textarea with no default content, which is most of them, so these cases pin it.
 */

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mount(html) {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  mounted.push(host)
  return host
}

const svgOf = async (host) => decodeURIComponent((await snapdom(host, { cache: 'disabled' })).url.split(',')[1])
const count = (s, needle) => (s.match(new RegExp(needle, 'g')) || []).length

describe('textarea value survives the clone exactly once', () => {
  it('default content appears once, not twice', async () => {
    const host = mount('<textarea>PLANTILLA</textarea>')
    expect(count(await svgOf(host), 'PLANTILLA')).toBe(1)
  })

  it('a typed value replaces the default instead of joining it', async () => {
    const host = mount('<textarea>PLANTILLA</textarea>')
    host.querySelector('textarea').value = 'ESCRITO'
    const svg = await svgOf(host)
    expect(count(svg, 'ESCRITO')).toBe(1)
    expect(count(svg, 'PLANTILLA')).toBe(0)
  })

  it('clearing it captures empty, not the default', async () => {
    // Empty string is a real value, which is why the guard tests against null rather than
    // truthiness: `if (value)` would fall through here and leak the default back.
    const host = mount('<textarea>PLANTILLA</textarea>')
    host.querySelector('textarea').value = ''
    expect(count(await svgOf(host), 'PLANTILLA')).toBe(0)
  })

  it('multiline content keeps its line breaks and appears once', async () => {
    const host = mount('<textarea></textarea>')
    host.querySelector('textarea').value = 'UNO\nDOS\nTRES'
    const svg = await svgOf(host)
    expect(count(svg, 'UNO')).toBe(1)
    expect(svg).toContain('UNO\nDOS\nTRES')
  })

  it('a value that looks like markup is escaped, not injected', async () => {
    const host = mount('<textarea></textarea>')
    host.querySelector('textarea').value = '</textarea><script>BAD</script>'
    const svg = await svgOf(host)
    // One closing tag in the whole document: the value's copy was escaped into text.
    expect(count(svg, '</textarea>')).toBe(1)
    expect(count(svg, '<script>')).toBe(0)
  })

  it('two textareas do not bleed into each other', async () => {
    // pendingTextAreaValue is per-invocation, not module state. A shared one would give the
    // second textarea the first one's text.
    const host = mount('<textarea>A-DEF</textarea><textarea>B-DEF</textarea>')
    const [a, b] = host.querySelectorAll('textarea')
    a.value = 'A-VAL'
    b.value = 'B-VAL'
    const svg = await svgOf(host)
    expect(count(svg, 'A-VAL')).toBe(1)
    expect(count(svg, 'B-VAL')).toBe(1)
    expect(count(svg, 'DEF')).toBe(0)
  })
})
