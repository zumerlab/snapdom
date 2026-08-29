// Logical box properties in the generated CSS (imported from @frostin/snapdom).
//
// Computed style lists both forms of every box property. Two consequences, both measured on a
// real capture rather than on a hand-built snapshot: the class restates most of a box twice,
// and the per-side logical longhands survive the zero-border normalization (#362) — they are
// enumerated after the `border` shorthand it rewrites — re-declaring a border the source does
// not have.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const LOGICAL = /(?:^|;)(block-size|inline-size|(?:min|max)-(?:block|inline)-size|(?:margin|padding|inset|border)-(?:block|inline)-(?:start|end)[a-z-]*|overflow-(?:block|inline)):/

let mounted, sheet
afterEach(() => {
  mounted?.remove(); mounted = null
  sheet?.remove(); sheet = null
})

/** The declarations of every generated class in a capture of `html` under `css`. */
async function classDeclarations(css, html) {
  sheet = document.createElement('style')
  sheet.textContent = css
  document.head.appendChild(sheet)
  mounted = document.createElement('div')
  mounted.innerHTML = html
  document.body.appendChild(mounted)

  const raw = await snapdom.toRaw(mounted, { embedFonts: false })
  const svg = decodeURIComponent(raw.split(',')[1] || '')
  const styleText = [...svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
  return [...styleText.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((rule) => rule[1].trim().startsWith('.'))
    .map((rule) => rule[2])
}

describe('logical properties are not restated in the generated CSS', () => {
  it('drops the logical form when the physical one already says it', async () => {
    const blocks = await classDeclarations(
      '.lp { padding-inline: 12px; padding-block: 8px; inline-size: 260px; margin-block: 4px }',
      '<div class="lp">logical</div>',
    )
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) expect(block).not.toMatch(LOGICAL)
    // and the physical values are still there, so nothing was lost with them
    expect(blocks.join(';')).toMatch(/width:\s*260px/)
    expect(blocks.join(';')).toMatch(/padding-left:\s*12px/)
  })

  it('keeps a logical declaration that its physical twin does not cover', async () => {
    // Chrome resolves min-width:auto to 0px on a flex item while min-inline-size reports
    // auto. The two forms say different things there, so the logical one is load-bearing.
    const blocks = await classDeclarations(
      '.lp-flex { display: flex } .lp-item { flex: 1 }',
      '<div class="lp-flex"><div class="lp-item">item</div></div>',
    )
    const all = blocks.join(';')
    const hasDivergence = /min-inline-size:\s*auto/.test(all) || !/min-inline-size/.test(all)
    expect(hasDivergence).toBe(true)
  })

  // The universe is scanned from the page's own CSS, so the second rule is what puts the
  // logical longhands in play at all.
  it('no logical border longhand survives the zero-border normalization (#362)', async () => {
    const blocks = await classDeclarations(
      '* { border: 0 solid } .lp-edge { border-inline-start: 3px solid red } .lp-zero { padding: 4px }',
      '<div class="lp-zero">zero border</div><span class="lp-edge">edge</span>',
    )
    const zeroBordered = blocks.filter((block) => /border:\s*none/.test(block))
    expect(zeroBordered.length).toBeGreaterThan(0)
    for (const block of zeroBordered) {
      expect(block).not.toMatch(/border-(?:block|inline)-(?:start|end)[a-z-]*:/)
    }
  })

  it('keeps the authored border on the element that has one', async () => {
    const blocks = await classDeclarations(
      '* { border: 0 solid } .lp-edge { border-inline-start: 3px solid rgb(255, 0, 0) }',
      '<div class="lp-edge">edge</div>',
    )
    const all = blocks.join(';')
    expect(all).toMatch(/border-left-width:\s*3px/)
    expect(all).toMatch(/border-left-color:\s*rgb\(255, 0, 0\)/)
  })
})
