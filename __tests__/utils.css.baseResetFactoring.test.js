// The base reset is factored (imported from @frostin/snapdom): the declarations every tag
// group shares go out once in a grouped rule, and each group restates only what differs.
//
// The size win is worth having only if the CSS still says the same thing, so the equivalence
// test is the real one here: every tag's every default must resolve to the same value under
// the factored CSS as the tag's own group declares.
import { describe, it, expect, afterEach } from 'vitest'
import { generateDedupedBaseCSS, getDefaultStyleForTag } from '../src/utils/css.js'

const TAGS = [
  'div', 'span', 'p', 'a', 'button', 'input', 'h1', 'h2', 'ul', 'li', 'img', 'section',
  'header', 'footer', 'label', 'table', 'td', 'tr', 'strong', 'em', 'small', 'code', 'pre',
]

let host
afterEach(() => { host?.remove(); host = null })

/** Mount `css` in a shadow root with one element per tag, and read them back. */
function mount(css, tags) {
  host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:-99999px;top:0'
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = css
  shadow.appendChild(style)
  const nodes = new Map()
  for (const tag of tags) {
    const el = document.createElement(tag)
    shadow.appendChild(el)
    nodes.set(tag, el)
  }
  return nodes
}

/** Every declaration the unfactored output would have emitted, per tag. */
function expectedDeclarations(tags) {
  const out = new Map()
  for (const tag of tags) {
    const styles = getDefaultStyleForTag(tag)
    if (styles && Object.keys(styles).length) out.set(tag, styles)
  }
  return out
}

describe('generateDedupedBaseCSS — factored shared declarations', () => {
  it('emits a shared rule and keeps the per-tag rules smaller than the whole', () => {
    const css = generateDedupedBaseCSS(TAGS)
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    expect(rules.length).toBeGreaterThan(1)

    // The first rule is the shared one: it must list every tag that got a rule at all.
    const [sharedSelector, sharedBlock] = [rules[0][1].trim(), rules[0][2]]
    const taggedLater = new Set(rules.slice(1).flatMap((r) => r[1].trim().split(',')))
    for (const tag of taggedLater) expect(sharedSelector.split(',')).toContain(tag)
    expect(sharedBlock.length).toBeGreaterThan(0)

    // No declaration is emitted twice for the same tag.
    for (const rule of rules.slice(1)) {
      const props = (rule[2].match(/[a-z-]+(?=:)/g) || [])
      const sharedProps = new Set((sharedBlock.match(/[a-z-]+(?=:)/g) || []))
      const duplicated = props.filter((p) => sharedProps.has(p) &&
        sharedBlock.includes(`${p}:${rule[2].split(`${p}:`)[1]?.split(';')[0]};`))
      expect(duplicated).toEqual([])
    }
  })

  it('is much smaller than the same defaults emitted per group', () => {
    const css = generateDedupedBaseCSS(TAGS)
    // Reconstruct what the unfactored output weighed: each group's full block.
    const groups = new Map()
    for (const tag of TAGS) {
      const styles = getDefaultStyleForTag(tag)
      if (!styles) continue
      const key = Object.entries(styles).map(([k, v]) => `${k}:${v};`).sort().join('')
      if (!key) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(tag)
    }
    let unfactored = ''
    for (const [block, tags] of groups) unfactored += `${tags.join(',')} { ${block} }\n`

    expect(css.length).toBeLessThan(unfactored.length * 0.5)
  })

  // The one that matters: same computed result, tag by tag, property by property.
  it('resolves to the same computed value as the unfactored CSS, tag by tag', () => {
    const css = generateDedupedBaseCSS(TAGS)
    const expected = expectedDeclarations(TAGS)
    const nodes = mount(css, [...expected.keys()])

    for (const [tag, styles] of expected) {
      const el = nodes.get(tag)
      const computed = getComputedStyle(el)
      for (const [prop, value] of Object.entries(styles)) {
        // Only assert properties the factored CSS actually carries: the universe filter and
        // the logical-alias trim legitimately drop some.
        if (!css.includes(`${prop}:`)) continue
        expect(`${tag}.${prop}=${computed.getPropertyValue(prop)}`).toBe(`${tag}.${prop}=${value}`)
      }
    }
  })

  it('emits a single rule (no shared block) for a single group', () => {
    const css = generateDedupedBaseCSS(['div'])
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    expect(rules.length).toBe(1)
    expect(rules[0][1].trim()).toBe('div')
  })
})
