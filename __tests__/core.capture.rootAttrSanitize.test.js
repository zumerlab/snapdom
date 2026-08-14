import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { __diffStats } from '../src/core/diff.js'
import { sanitizeCloneForXHTML } from '../src/utils/capture.helpers.js'

/**
 * #8: the XHTML sanitizer walked descendants only, so a framework directive or an
 * unknown namespace prefix sitting on the CAPTURE ROOT reached XMLSerializer verbatim.
 * The serialized SVG then failed to parse and surfaced as "EncodingError: The source
 * image cannot be decoded" at img.decode() time.
 */

const mounted = []

// Attribute names like "@click" cannot be set through setAttribute (they fail the XML
// Name production), so they are parsed in the way a framework actually produces them.
const DIRTY_ATTRS = '@click="go" v-if="ok" on:click="go" bind:value="v" :class="c" foo:bar="b" x-data="{}"'

function mount(html) {
  const host = document.createElement('div')
  host.innerHTML = html
  const el = host.firstElementChild
  document.body.appendChild(host)
  mounted.push(host)
  return el
}

afterEach(() => {
  while (mounted.length) mounted.pop().remove()
})

describe('root attribute sanitizing (#8)', () => {
  it('parses the dirty attribute names onto the root (control)', () => {
    const el = mount(`<div ${DIRTY_ATTRS}></div>`)
    for (const name of ['@click', 'v-if', 'on:click', 'bind:value', ':class', 'foo:bar', 'x-data']) {
      expect(el.hasAttribute(name), name).toBe(true)
    }
  })

  it('decodes and rasterizes with real ink when the root carries invalid attribute names', async () => {
    const el = mount(`<div ${DIRTY_ATTRS} style="width:60px;height:40px;background:rgb(0,128,0)"></div>`)

    const res = await snapdom(el)
    const canvas = await res.toCanvas()
    const ctx = canvas.getContext('2d')
    const d = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
    expect([d[0], d[1], d[2], d[3]]).toEqual([0, 128, 0, 255])
  })

  it('decodes when the diff path rebuilds a subtree whose own root carries them', async () => {
    // The subtree root handed to sanitizeCloneForXHTML by the diff path is a rebuilt
    // clone of a mid-tree node, so it escaped the descendant-only walk as well.
    const el = mount(
      '<div style="width:200px;background:#fff">' +
      `<section><div ${DIRTY_ATTRS} style="background:rgb(0,128,0);padding:8px">` +
      `<p ${DIRTY_ATTRS} style="margin:0;color:#fff">before</p></div></section></div>`
    )
    for (let i = 0; i < 4; i++) await snapdom(el) // engage auto-burst

    el.querySelector('p').textContent = 'after'
    await new Promise((r) => setTimeout(r, 0))
    const served0 = __diffStats.served
    const res = await snapdom(el)
    expect(__diffStats.served, 'diff path must actually serve this capture').toBe(served0 + 1)
    const canvas = await res.toCanvas()
    expect(canvas.width).toBeGreaterThan(0)
  })

  it('scrubs the root the same way it scrubs descendants', () => {
    const root = mount(`<div ${DIRTY_ATTRS} id="keep" class="c"><span ${DIRTY_ATTRS}></span></div>`)
    sanitizeCloneForXHTML(root)
    for (const node of [root, root.firstElementChild]) {
      for (const name of ['@click', 'v-if', 'on:click', 'bind:value', ':class', 'foo:bar', 'x-data']) {
        expect(node.hasAttribute(name), `${node.tagName} ${name}`).toBe(false)
      }
    }
    expect(root.getAttribute('id')).toBe('keep')
    expect(root.getAttribute('class')).toBe('c')
  })

  it('keeps root framework directives when stripFrameworkDirectives is false, drops the XML-invalid ones', () => {
    const root = mount(`<div ${DIRTY_ATTRS}></div>`)
    sanitizeCloneForXHTML(root, { stripFrameworkDirectives: false })
    expect(root.hasAttribute('v-if')).toBe(true)
    expect(root.hasAttribute('x-data')).toBe(true)
    expect(root.hasAttribute('@click')).toBe(false)
    expect(root.hasAttribute('foo:bar')).toBe(false)
    // ":" prefixed names are XML-invalid regardless of the framework gate
    expect(root.hasAttribute(':class')).toBe(false)
    expect(root.hasAttribute('on:click')).toBe(false)
  })
})
