import { afterEach, describe, expect, it, vi } from 'vitest'

function freshSession() {
  return { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() }
}

async function freshStylesModule() {
  vi.resetModules()
  return import('../src/modules/styles.js')
}

async function styleKeyFor(inlineAllStyles, source) {
  const clone = source.cloneNode(true)
  const session = freshSession()
  await inlineAllStyles(source, clone, session)
  return session.styleMap.get(clone) || ''
}

function propertyFromKey(key, property) {
  const match = key.match(new RegExp(`(?:^|;)${property}:([^;]+)`))
  return match ? match[1] : null
}

describe('stylesheet scan fidelity regressions', () => {
  const mounted = []

  afterEach(() => {
    for (const node of mounted) node.remove()
    mounted.length = 0
    delete window.__SNAPDOM_FULL_PROPS
    vi.restoreAllMocks()
  })

  function mount(css, html) {
    const sheet = document.createElement('style')
    sheet.textContent = css
    document.head.appendChild(sheet)
    const root = document.createElement('div')
    root.innerHTML = html
    document.body.appendChild(root)
    mounted.push(root, sheet)
    return root
  }

  it('falls back to the full computed-style read when any stylesheet is CSSOM-inaccessible', async () => {
    const root = mount(
      '.jr-cross{letter-spacing:7px;text-transform:uppercase;font-style:italic;text-indent:11px}',
      '<p class="jr-cross">cross origin styles</p>',
    )
    const source = root.firstElementChild
    expect(getComputedStyle(source).letterSpacing).toBe('7px')

    const deniedSheet = {}
    Object.defineProperty(deniedSheet, 'cssRules', {
      get() { throw new DOMException('Cannot access rules', 'SecurityError') },
    })
    vi.spyOn(Document.prototype, 'styleSheets', 'get').mockReturnValue([deniedSheet])

    const { inlineAllStyles, notifyStyleEpoch } = await freshStylesModule()
    const restrictedKey = await styleKeyFor(inlineAllStyles, source)

    window.__SNAPDOM_FULL_PROPS = true
    notifyStyleEpoch()
    const fullKey = await styleKeyFor(inlineAllStyles, source)

    for (const property of ['letter-spacing', 'text-transform', 'font-style', 'text-indent']) {
      expect(fullKey, `full read control contains ${property}`).toMatch(new RegExp(`(?:^|;)${property}:`))
      expect(restrictedKey, `CSSOM denial preserves ${property}`).toMatch(new RegExp(`(?:^|;)${property}:`))
    }
  })

  it('preserves UA styles that differ from CSS initial values without author CSS', async () => {
    const root = mount(
      '',
      '<pre>a  b\n c</pre><em>emphasis</em>' +
      '<table><tbody><tr><th>heading</th></tr></tbody></table>' +
      '<ol><li>numbered</li></ol>',
    )
    const { inlineAllStyles } = await freshStylesModule()
    const pre = root.querySelector('pre')
    const em = root.querySelector('em')
    const th = root.querySelector('th')
    const ol = root.querySelector('ol')

    expect(getComputedStyle(pre).whiteSpace).toBe('pre')
    expect(getComputedStyle(em).fontStyle).toBe('italic')
    expect(parseInt(getComputedStyle(th).fontWeight, 10)).toBeGreaterThanOrEqual(700)
    expect(getComputedStyle(ol).listStyleType).toBe('decimal')

    const preKey = await styleKeyFor(inlineAllStyles, pre)
    const preservesPreWhitespace = /(?:^|;)white-space:pre(?:;|$)/.test(preKey) ||
      (/(?:^|;)white-space-collapse:preserve(?:;|$)/.test(preKey) &&
       /(?:^|;)text-wrap-mode:nowrap(?:;|$)/.test(preKey))
    expect(preservesPreWhitespace, `UA <pre> whitespace survives in ${preKey}`).toBe(true)
    expect(await styleKeyFor(inlineAllStyles, em)).toMatch(/(?:^|;)font-style:italic(?:;|$)/)
    expect(await styleKeyFor(inlineAllStyles, th)).toMatch(/(?:^|;)font-weight:(?:bold|700)(?:;|$)/)
    expect(await styleKeyFor(inlineAllStyles, ol)).toMatch(/(?:^|;)list-style-type:decimal(?:;|$)/)
  })

  it('does not share snapshots between siblings selected by position', async () => {
    const root = mount(
      '.jr-pos>li:nth-child(even){color:rgb(255,0,0);letter-spacing:5px}',
      '<ul class="jr-pos"><li>odd</li><li>even</li></ul>',
    )
    const [odd, even] = root.querySelectorAll('li')
    const { inlineAllStyles } = await freshStylesModule()

    expect(getComputedStyle(odd).color).not.toBe(getComputedStyle(even).color)
    const oddKey = await styleKeyFor(inlineAllStyles, odd)
    const evenKey = await styleKeyFor(inlineAllStyles, even)

    expect(evenKey).not.toBe(oddKey)
    expect(evenKey).toMatch(/(?:^|;)letter-spacing:5px(?:;|$)/)
  })

  it('does not share used geometry between same-class siblings with different content', async () => {
    const root = mount(
      '.jr-card{width:100px;background:#eee;font:16px/20px Arial}',
      '<div class="jr-cards"><div class="jr-card">one</div>' +
      '<div class="jr-card">one<br>two<br>three</div></div>',
    )
    const [shortCard, tallCard] = root.querySelectorAll('.jr-card')
    const { inlineAllStyles } = await freshStylesModule()
    const shortHeight = getComputedStyle(shortCard).height
    const tallHeight = getComputedStyle(tallCard).height

    expect(parseFloat(tallHeight)).toBeGreaterThan(parseFloat(shortHeight))
    const shortKey = await styleKeyFor(inlineAllStyles, shortCard)
    const tallKey = await styleKeyFor(inlineAllStyles, tallCard)

    expect(propertyFromKey(shortKey, 'height')).toBe(shortHeight)
    expect(propertyFromKey(tallKey, 'height')).toBe(tallHeight)
    expect(tallKey).not.toBe(shortKey)
  })
})
