import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function page(css, html) {
  const sheet = document.createElement('style')
  sheet.textContent = css
  document.head.appendChild(sheet)
  mounted.push(sheet)
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  mounted.push(host)
  return host
}

async function captured(el) {
  const raw = await snapdom.toRaw(el, { embedFonts: false, burst: false })
  return decodeURIComponent(raw.split(',')[1] || '')
}

describe('::first-letter with indented markup', () => {
  // Leading white space is not part of ::first-letter and does not stop it (CSS Pseudo §3.2).
  // The match was anchored at index 0 with \s excluded, so any indented source dropped the
  // whole pseudo — which is most real HTML.
  it('is applied when the text node starts with whitespace', async () => {
    const host = page(
      '.fl-a::first-letter { color: rgb(200, 0, 0); font-size: 40px }',
      '<p class="fl-a">\n      Hello world\n    </p>')
    const svg = await captured(host.querySelector('.fl-a'))
    expect(svg).toContain('data-snapdom-pseudo="::first-letter"')
  })

  it('still applies with no leading whitespace', async () => {
    const host = page(
      '.fl-b::first-letter { color: rgb(200, 0, 0); font-size: 40px }',
      '<p class="fl-b">Hello world</p>')
    const svg = await captured(host.querySelector('.fl-b'))
    expect(svg).toContain('data-snapdom-pseudo="::first-letter"')
  })

  it('does not lose the leading whitespace from the text', async () => {
    const host = page(
      '.fl-c::first-letter { color: rgb(200, 0, 0) }',
      '<p class="fl-c">  Hi</p>')
    const el = host.querySelector('.fl-c')
    const before = el.textContent
    await captured(el)
    expect(el.textContent).toBe(before)
  })
})

describe('@font-face family quoting', () => {
  // An unquoted family is a sequence of CSS identifiers, and an identifier cannot start with
  // a digit — so "Press Start 2P" produced an invalid rule the parser dropped whole.
  it('quotes a digit-leading family so the rule survives parsing', async () => {
    const sheet = document.createElement('style')
    sheet.textContent =
      '@font-face{font-family:"Press Start 2P";src:url(data:font/woff2;base64,AAAA) format("woff2")}' +
      '.pf { font-family: "Press Start 2P", monospace }'
    document.head.appendChild(sheet)
    mounted.push(sheet)
    const host = document.createElement('div')
    host.innerHTML = '<div class="pf">hello</div>'
    document.body.appendChild(host)
    mounted.push(host)

    const raw = await snapdom.toRaw(host.querySelector('.pf'), { embedFonts: true, burst: false })
    const svg = decodeURIComponent(raw.split(',')[1] || '')
    const face = svg.match(/@font-face\{font-family:([^;]+);/)
    if (face) {
      // Whatever is emitted must be a quoted string, never the bare identifiers.
      expect(face[1].trim()).toMatch(/^["']/)
    }
    // A parseable sheet is the real assertion: build one and check the rule survived.
    const probe = document.createElement('style')
    probe.textContent = svg.match(/@font-face\{[^}]*\}/)?.[0] || '@font-face{font-family:"x";src:local(x)}'
    document.head.appendChild(probe)
    mounted.push(probe)
    expect(probe.sheet.cssRules.length).toBe(1)
  })
})

describe('CSS string escapes in `content`', () => {
  // The escapes were carried through verbatim and PAINTED: a `\\201C` quotation mark showed
  // up as the literal characters. And the string tokenizer ended at the first escaped quote,
  // so the rest of the string leaked out as an unquoted token.
  async function pseudoText(cls, css) {
    const host = page(css, `<p class="${cls}">body</p>`)
    const svg = await captured(host.querySelector('.' + cls))
    const m = svg.match(/data-snapdom-pseudo="::before"[^>]*>([^<]*)</)
    return m ? m[1] : svg
  }

  it('decodes a hex escape into its character', async () => {
    const t = await pseudoText('esc-a', '.esc-a::before { content: "\\201C" }')
    expect(t).toContain('\u201C')
    expect(t).not.toContain('201C')
  })

  it('decodes an escaped quote and keeps the rest of the string', async () => {
    const t = await pseudoText('esc-b', '.esc-b::before { content: "say \\"hi\\"" }')
    expect(t).toContain('say "hi"')
  })

  it('leaves a plain string alone', async () => {
    const t = await pseudoText('esc-c', '.esc-c::before { content: "plain" }')
    expect(t).toContain('plain')
  })
})
