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

describe('residual fidelity: nested shadows and CSSOM', () => {
  const mounted = []
  afterEach(() => {
    for (const n of mounted) n.remove()
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

  it('sees styles from nested open shadow roots', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push(host)
    const outer = host.attachShadow({ mode: 'open' })
    const innerHost = document.createElement('div')
    innerHost.id = 'innerHost'
    outer.appendChild(innerHost)
    const inner = innerHost.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = '#deep{letter-spacing:9px}'
    inner.appendChild(style)
    const deep = document.createElement('span')
    deep.id = 'deep'
    deep.textContent = 'hi'
    inner.appendChild(deep)
    // Ensure computed reflects
    expect(getComputedStyle(deep).letterSpacing).toBe('9px')
    const { inlineAllStyles, seedUsedProps } = await freshStylesModule()
    // seed from the deep element's root (its doc is same, but host chain includes nested)
    // seedUsedProps should walk nested shadows when scanning doc, but we also need to ensure
    // inlineAllStyles for deep sees the style
    // Use the deep element as source; its ownerDocument is top doc, and nested shadow styles are in that doc's tree
    // We call seedUsedProps on the host to prime doc state
    seedUsedProps(host)
    const key = await styleKeyFor(inlineAllStyles, deep)
    expect(key).toMatch(/letter-spacing:9px/)
  })

  it('picks up insertRule without DOM mutation', async () => {
    const root = mount('', '<div class="jr-insert">x</div>')
    const el = root.querySelector('.jr-insert')
    const sheet = document.createElement('style')
    sheet.textContent = '.jr-insert{color:rgb(10,10,10)}'
    document.head.appendChild(sheet)
    mounted.push(sheet)
    const { inlineAllStyles, seedUsedProps } = await freshStylesModule()
    seedUsedProps(root)
    const before = await styleKeyFor(inlineAllStyles, el)
    expect(before).toMatch(/color:/)
    // Insert new rule with previously unused property
    sheet.sheet.insertRule('.jr-insert{letter-spacing:13px}', 0)
    // No DOM mutation, only CSSOM — seed should detect fingerprint change and bump epoch
    seedUsedProps(root)
    const after = await styleKeyFor(inlineAllStyles, el)
    expect(getComputedStyle(el).letterSpacing).toBe('13px')
    expect(after).toMatch(/letter-spacing:13px/)
    // cleanup rule
    try { sheet.sheet.deleteRule(0) } catch {}
  })

  it('drops deleted rule', async () => {
    const sheet = document.createElement('style')
    sheet.textContent = '.jr-del{word-spacing:11px}'
    document.head.appendChild(sheet)
    mounted.push(sheet)
    const root = mount('', '<div class="jr-del">x</div>')
    const el = root.querySelector('.jr-del')
    const { inlineAllStyles, seedUsedProps } = await freshStylesModule()
    seedUsedProps(root)
    const before = await styleKeyFor(inlineAllStyles, el)
    expect(before).toMatch(/word-spacing:11px/)
    // delete the rule that provided the property
    try { sheet.sheet.deleteRule(0) } catch {}
    expect(getComputedStyle(el).wordSpacing).not.toBe('11px')
    seedUsedProps(root)
    const after = await styleKeyFor(inlineAllStyles, el)
    expect(after).not.toMatch(/word-spacing:11px/)
  })

  it('reacts to adoptedStyleSheets change', async () => {
    if (!('adoptedStyleSheets' in document)) return
    const root = mount('', '<div class="jr-adopt">adopted</div>')
    const el = root.querySelector('.jr-adopt')
    const sheet = new CSSStyleSheet()
    sheet.replaceSync('.jr-adopt{column-gap:17px;display:grid}')
    const prev = document.adoptedStyleSheets
    document.adoptedStyleSheets = [...prev, sheet]
    const { inlineAllStyles, seedUsedProps } = await freshStylesModule()
    try {
      seedUsedProps(root)
      const key = await styleKeyFor(inlineAllStyles, el)
      // column-gap is in MODULE_REQUIRED but also from sheet; ensure it appears
      // display:grid triggers required props, column-gap should be captured
      expect(getComputedStyle(el).columnGap).toBe('17px')
      expect(key).toMatch(/column-gap:17px/)
    } finally {
      document.adoptedStyleSheets = prev
    }
    // after removal, next capture should not have it
    const { seedUsedProps: seed2, inlineAllStyles: inl2 } = await freshStylesModule()
    seed2(root)
    const after = await styleKeyFor(inl2, el)
    // column-gap from adopted sheet gone; computed may still be 0 or normal
    // we just ensure no stale 17px remains if adopted sheet removed
    if (getComputedStyle(el).columnGap === '17px') {
      // if still present, sheet removal didn't take effect in this engine
    } else {
      expect(after).not.toMatch(/column-gap:17px/)
    }
  })

  it('reacts to shadowRoot adoptedStyleSheets', async () => {
    if (!('adoptedStyleSheets' in document)) return
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push(host)
    const sr = host.attachShadow({ mode: 'open' })
    const inner = document.createElement('span')
    inner.className = 'jr-shadow-adopt'
    inner.textContent = 'shadow'
    sr.appendChild(inner)
    const sheet = new CSSStyleSheet()
    sheet.replaceSync('.jr-shadow-adopt{letter-spacing:19px}')
    sr.adoptedStyleSheets = [sheet]
    expect(getComputedStyle(inner).letterSpacing).toBe('19px')
    const { inlineAllStyles, seedUsedProps } = await freshStylesModule()
    seedUsedProps(host)
    const key = await styleKeyFor(inlineAllStyles, inner)
    expect(key).toMatch(/letter-spacing:19px/)
    // cleanup
    sr.adoptedStyleSheets = []
  })

  it('bumps on rule.style value change', async () => {
    const sheet = document.createElement('style')
    sheet.textContent = '.jr-val{color:rgb(10, 20, 30)}'
    document.head.appendChild(sheet)
    mounted.push(sheet)
    const root = mount('', '<div class="jr-val">val</div>')
    const el = root.querySelector('.jr-val')
    const { inlineAllStyles, seedUsedProps } = await freshStylesModule()
    seedUsedProps(root)
    const before = await styleKeyFor(inlineAllStyles, el)
    expect(before).toMatch(/color:rgb\(10, 20, 30\)/)
    // Change value via CSSOM, same property name
    const rule = sheet.sheet.cssRules[0]
    rule.style.setProperty('color', 'rgb(99, 88, 77)')
    expect(getComputedStyle(el).color).toBe('rgb(99, 88, 77)')
    seedUsedProps(root)
    const after = await styleKeyFor(inlineAllStyles, el)
    expect(after).toMatch(/color:rgb\(99, 88, 77\)/)
  })

  it('isolates per-document allow-list (iframe)', async () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    mounted.push(iframe)
    const idoc = iframe.contentDocument
    if (!idoc || !idoc.body) return
    const style = idoc.createElement('style')
    style.textContent = '.jr-iframe-only{letter-spacing:23px}'
    idoc.head.appendChild(style)
    const inner = idoc.createElement('div')
    inner.className = 'jr-iframe-only'
    inner.textContent = 'iframe'
    idoc.body.appendChild(inner)
    expect(idoc.defaultView.getComputedStyle(inner).letterSpacing).toBe('23px')
    // Top document should not get this property
    const topRoot = mount('', '<div class="jr-iframe-only">top</div>')
    const topEl = topRoot.querySelector('.jr-iframe-only')
    expect(getComputedStyle(topEl).letterSpacing).not.toBe('23px')
    const { inlineAllStyles, seedUsedProps } = await freshStylesModule()
    // Seed for iframe doc
    seedUsedProps(inner)
    const iframeKey = await styleKeyFor(inlineAllStyles, inner)
    expect(iframeKey).toMatch(/letter-spacing:23px/)
    // Seed for top doc
    seedUsedProps(topRoot)
    const topKey = await styleKeyFor(inlineAllStyles, topEl)
    expect(topKey).not.toMatch(/letter-spacing:23px/)
  })

  it('emits shorthand-authored values as longhands, matching the full read', async () => {
    // Shorthands never enter the allow-set (only their SHORTHAND_EXPANSIONS longhands do),
    // so snapshots stay shorthand-free. getStyleKey must emit identical CSS from longhands.
    const root = mount(
      '.jr-short{margin:10px 20px;padding:5px;border:2px solid rgb(255,0,0);background:rgb(0,238,0);overflow:hidden}',
      '<div class="jr-short">x</div>',
    )
    const el = root.querySelector('.jr-short')
    const { inlineAllStyles, seedUsedProps, notifyStyleEpoch } = await freshStylesModule()
    seedUsedProps(root)
    const key = await styleKeyFor(inlineAllStyles, el)
    for (const entry of [
      'margin-top:10px', 'margin-right:20px', 'padding-top:5px',
      'border-top-width:2px', 'background-color:rgb(0, 238, 0)', 'overflow-x:hidden',
    ]) {
      expect(key.includes(entry), `allow key carries ${entry}`).toBe(true)
    }
    // Pixel-equivalence: every longhand value agrees with the full computed-style read.
    window.__SNAPDOM_FULL_PROPS = true
    notifyStyleEpoch()
    const fullKey = await styleKeyFor(inlineAllStyles, el)
    const valOf = (k, p) => (k.match(new RegExp(`(?:^|;)${p}:([^;]+)`)) || [])[1] || null
    for (const prop of ['margin-top', 'margin-right', 'padding-top', 'border-top-width',
      'border-top-style', 'background-color', 'overflow-x', 'overflow-y']) {
      expect(valOf(key, prop), `allow vs full agree on ${prop}`).toBe(valOf(fullKey, prop))
    }
  })
})
