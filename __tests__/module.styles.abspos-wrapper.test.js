import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'
import { inlineAllStyles } from '../src/modules/styles.js'

/**
 * A wrapper sized only by the viewport (height:100vh) whose children are all
 * absolutely positioned had its height/block-size stripped as a "transparent flow wrapper".
 * The site stylesheet is gone inside the foreignObject, so nothing restored that height and
 * the wrapper collapsed to 0: every following section shifted up and painted over it.
 */

function freshSession() {
  return { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() }
}

/** Size declaration snapdom emits for `el` in the exported SVG, or '' when absent. */
function sizeRuleFor(svg, selector) {
  // result.url is a data: URL — drop everything before the markup itself.
  const markup = svg.slice(svg.indexOf('<'))
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const el = doc.querySelector(`foreignObject ${selector}`)
  if (!el) return null
  const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n')
  const classes = (el.getAttribute('class') || '').split(/\s+/).filter((c) => /^c\d+$/.test(c))
  for (const c of classes) {
    const rule = css.match(new RegExp(`\\.${c}\\s*\\{([^}]*)\\}`))
    if (!rule) continue
    const size = rule[1].match(/(?:^|;)\s*(?:block-size|height)\s*:\s*([^;]+)/)
    if (size) return size[1].trim()
  }
  return ''
}

describe('stripHeightForWrappers — wrappers whose children are all out of flow', () => {
  let root, sheet
  afterEach(() => { root?.remove(); sheet?.remove() })

  function mount(css, html) {
    sheet = document.createElement('style')
    sheet.textContent = css
    document.head.appendChild(sheet)
    root = document.createElement('div')
    root.innerHTML = html
    document.body.appendChild(root)
    return root
  }

  it('keeps the height of a wrapper whose only children are absolutely positioned', async () => {
    // Height must come from a stylesheet: an inline height is already respected (guard 1).
    mount(
      '.sd-hero{position:relative;height:300px}' +
      '.sd-hero > .sd-slide{position:absolute;top:0;left:0;right:0;bottom:0}',
      '<div class="sd-hero"><div class="sd-slide">caption text</div></div>' +
      '<div class="sd-after">below the hero</div>',
    )

    const hero = root.querySelector('.sd-hero')
    expect(getComputedStyle(hero).height).toBe('300px')
    // The trap: textContent and scrollHeight both look like real in-flow content.
    expect(/\S/.test(hero.textContent)).toBe(true)
    expect(hero.scrollHeight).toBe(300)

    const svg = decodeURIComponent((await snapdom(root)).url)
    expect(sizeRuleFor(svg, '.sd-hero')).toBe('300px')
  })

  it('records the size on the clone style key rather than dropping it', async () => {
    mount(
      '.sd-hero2{position:relative;height:250px}' +
      '.sd-hero2 > .sd-slide{position:absolute;inset:0}',
      '<div class="sd-hero2"><div class="sd-slide">caption</div></div>',
    )
    const hero = root.querySelector('.sd-hero2')
    const clone = hero.cloneNode(true)
    const session = freshSession()

    await inlineAllStyles(hero, clone, session)

    expect(session.styleMap.get(clone)).toMatch(/(?:^|;)\s*(?:block-size|height)\s*:\s*250px/)
  })

  it('still strips the height of a genuinely transparent flow wrapper', async () => {
    // Negative control: in-flow child of the same height — the wrapper is redundant and
    // removing its height lets the clone reflow naturally, which is the point of the pass.
    mount(
      '.sd-wrap{position:relative;height:300px}' +
      '.sd-wrap > .sd-inner{height:300px}',
      '<div class="sd-wrap"><div class="sd-inner">in flow</div></div>',
    )
    const svg = decodeURIComponent((await snapdom(root)).url)
    expect(sizeRuleFor(svg, '.sd-wrap')).toBe('')
  })

  it('treats a wrapper holding only display:none children as having no flow content', async () => {
    mount(
      '.sd-hidden-host{position:relative;height:120px}' +
      '.sd-hidden-host > .sd-gone{display:none}',
      '<div class="sd-hidden-host"><div class="sd-gone">hidden</div></div>',
    )
    const svg = decodeURIComponent((await snapdom(root)).url)
    expect(sizeRuleFor(svg, '.sd-hidden-host')).toBe('120px')
  })
})
