import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { __diffStats } from '../src/core/diff.js'

const mounted = []
function mount(html, css) {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  mounted.push(host)
  if (css) {
    const sheet = document.createElement('style')
    sheet.textContent = css
    document.head.appendChild(sheet)
    mounted.push(sheet)
  }
  return host
}
afterEach(() => { for (const node of mounted.splice(0)) node.remove() })

async function pixel(res, x, y) {
  const canvas = await res.toCanvas({ dpr: 1, scale: 1 })
  return Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data)
}

/** The inline style the capture left on the first element matching `selector`. */
function inlineStyleOf(res, selector) {
  const doc = new DOMParser().parseFromString(decodeURIComponent(res.url.slice(res.url.indexOf(',') + 1)), 'image/svg+xml')
  return doc.querySelector(selector)?.getAttribute('style') || ''
}

const RED = [255, 0, 0, 255]
// A 92x72 box: 6px transparent border, 20px padding, 40x20 content. (10, 10) is padding.
const BADGE = 'display:block;background-color:rgb(255,0,0);padding:20px;border:6px dashed transparent;width:40px;height:20px'

describe('background pass on a colour-only node', () => {
  it('leaves the colour to the class when no author CSS travels with the clone', async () => {
    const host = mount(`<div style="width:92px"><p class="pl-leaf" style="margin:0;${BADGE}"></p></div>`)
    const res = await snapdom(host.firstChild, { burst: false })
    expect(inlineStyleOf(res, '.pl-leaf')).not.toMatch(/background-(clip|position|size|repeat|origin|attachment)/)
    expect(await pixel(res, 10, 10)).toEqual(RED)
  })

  it('copies the longhands when a kept <style> travels, and paints the same', async () => {
    const host = mount(`<div style="width:92px"><style>.pl-none{color:blue}</style><p class="pl-leaf" style="margin:0;${BADGE}"></p></div>`)
    const res = await snapdom(host.firstChild, { burst: false })
    expect(inlineStyleOf(res, '.pl-leaf')).toMatch(/background-clip/)
    expect(await pixel(res, 10, 10)).toEqual(RED)
  })

  it('keeps the live background-clip against a kept <style> the page overrode', async () => {
    const host = mount(
      `<div class="pl-theme"><div class="pl-root" style="width:92px"><style>.pl-badge{${BADGE};background-clip:content-box}</style><div class="pl-badge"></div></div></div>`,
      '.pl-theme .pl-badge{background-clip:border-box}'
    )
    const root = host.querySelector('.pl-root')
    expect(getComputedStyle(root.querySelector('.pl-badge')).backgroundClip).toBe('border-box')
    expect(await pixel(await snapdom(root, { burst: false }), 10, 10)).toEqual(RED)
  })

  // A rule that lists a scrollbar part next to ordinary selectors used to be copied whole
  // into the capture, where it outranked the class of the nodes it also names.
  it('keeps the live background-clip against a rule that also names a scrollbar part', async () => {
    const host = mount(
      `<div class="pl-theme"><div class="pl-card" style="width:92px"><div class="pl-sb" style="${BADGE}"></div></div></div>`,
      '.pl-card .pl-sb, .pl-card::-webkit-scrollbar{background-clip:content-box} .pl-theme .pl-card .pl-sb{background-clip:border-box}'
    )
    const root = host.querySelector('.pl-card')
    expect(getComputedStyle(root.firstElementChild).backgroundClip).toBe('border-box')
    expect(await pixel(await snapdom(root, { burst: false }), 10, 10)).toEqual(RED)
  })

  // The snapshot cache cannot see a pseudo-class a property flips: the cached flag says the
  // node has a colour alone, and the live reads of the pass are what still find the gradient.
  it('still inlines a gradient that arrived without a record', async () => {
    const host = mount(
      '<div style="width:40px"><input type="checkbox" class="pl-cb" style="display:none"><span class="pl-track"></span></div>',
      '.pl-track{display:block;width:40px;height:20px;background-color:rgb(0,0,255)} .pl-cb:checked + .pl-track{background-image:linear-gradient(rgb(255,0,0),rgb(255,0,0))}'
    )
    const root = host.firstElementChild
    expect(await pixel(await snapdom(root, { burst: false }), 10, 10)).toEqual([0, 0, 255, 255])
    root.querySelector('.pl-cb').checked = true
    expect(await pixel(await snapdom(root, { burst: false }), 10, 10)).toEqual(RED)
  })

  it('counts the <style> of an inline svg as author CSS too', async () => {
    const host = mount(
      `<div class="pl-theme"><div class="pl-root" style="width:92px"><svg width="0" height="0" style="position:absolute"><style>.pl-svg{background-clip:content-box}</style></svg><div class="pl-svg" style="${BADGE}"></div></div></div>`,
      '.pl-theme .pl-svg{background-clip:border-box}'
    )
    const root = host.querySelector('.pl-root')
    expect(getComputedStyle(root.querySelector('.pl-svg')).backgroundClip).toBe('border-box')
    expect(await pixel(await snapdom(root, { burst: false }), 10, 10)).toEqual(RED)
  })

  // Shadow rules are scoped inside :where(), which the base reset outranks. A nested rule
  // keeps its own specificity on top of that, and outranks the reset.
  it('keeps the live background-clip of a part the page overrode', async () => {
    const host = mount('<x-pl-card style="display:block;width:92px"></x-pl-card>', 'x-pl-card::part(badge){background-clip:border-box}')
    const card = host.firstChild
    card.attachShadow({ mode: 'open' }).innerHTML =
      `<style>.badge{${BADGE}}.wrap{.badge{background-clip:content-box}}</style><div class="wrap"><div class="badge" part="badge"></div></div>`
    expect(getComputedStyle(card.shadowRoot.querySelector('.badge')).backgroundClip).toBe('border-box')
    expect(await pixel(await snapdom(card, { burst: false }), 10, 10)).toEqual(RED)
  })

  it('keeps the live background-clip against a <style> a plugin adds in afterClone', async () => {
    const host = mount(`<div style="width:92px"><p class="pl-plug" style="margin:0;${BADGE}"></p></div>`)
    const plugin = {
      name: 'pl-style',
      afterClone(ctx) {
        const sheet = document.createElement('style')
        sheet.textContent = '.pl-plug{background-clip:content-box!important}'
        ctx.clone.prepend(sheet)
      }
    }
    const res = await snapdom(host.firstChild, { burst: false, plugins: [plugin] })
    expect(inlineStyleOf(res, '.pl-plug')).toMatch(/background-clip/)
  })

  it('still clips a colour to the text through the class alone', async () => {
    const host = mount('<div style="width:160px;height:60px;background-color:rgb(255,255,255)"><span class="pl-text" style="display:inline-block;font:700 40px/60px monospace;background-color:rgb(0,0,255);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent">WWW</span></div>')
    const res = await snapdom(host.firstChild, { burst: false })
    const canvas = await res.toCanvas({ dpr: 1, scale: 1 })
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    let blue = 0
    for (let i = 0; i < data.length; i += 4) if (data[i + 2] > 200 && data[i] < 60 && data[i + 1] < 60) blue++
    // The glyphs paint in the colour and the box around them does not.
    expect(blue).toBeGreaterThan(200)
    expect(blue).toBeLessThan(canvas.width * canvas.height * 0.25)
    expect(Array.from(data.slice(0, 3))).toEqual([255, 255, 255])
  })

  it('applies the capture verdict to a subtree the differential path rebuilds', async () => {
    const tree = (extra) => `<div style="width:200px;padding:10px;background-color:rgb(255,255,255)">${extra}<section><p class="pl-diff" style="margin:0;padding:4px;background-color:rgb(10,120,10)">one</p></section></div>`
    for (const [extra, expected] of [['', false], ['<style>.pl-none{color:blue}</style>', true]]) {
      const root = mount(tree(extra)).firstChild
      for (let i = 0; i < 3; i++) await snapdom(root)
      const served = __diffStats.served
      root.querySelector('.pl-diff').textContent = 'two'
      await new Promise((r) => setTimeout(r, 0))
      const res = await snapdom(root)
      expect(__diffStats.served).toBe(served + 1)
      expect(/background-clip/.test(inlineStyleOf(res, '.pl-diff'))).toBe(expected)
      expect(await pixel(res, 14, 14)).toEqual([10, 120, 10, 255])
    }
  })
})
