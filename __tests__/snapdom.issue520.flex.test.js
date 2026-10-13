import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'

const mounts = []
afterEach(() => { for (const mount of mounts.splice(0)) mount.remove() })

describe('#520 flex overflow preserves rendered widths', () => {
  it.each([1, 2, 4])('preserves fractional overflow across %s items', async count => {
    const fixture = document.createElement('div')
    fixture.style.cssText = 'display:flex;width:480px;gap:0.125px;font:16px monospace'
    fixture.innerHTML = '<span class="item" style="border:1px solid">00</span>'.repeat(count)
    document.body.append(fixture)
    mounts.push(fixture)
    const live = fixture.firstElementChild.getBoundingClientRect().width
    fixture.style.width = `${live * count + (count - 1) * 0.125 - 0.125}px`
    expect(fixture.scrollWidth - fixture.clientWidth).toBeLessThanOrEqual(1)
    const result = await snapdom(fixture, { embedFonts: false })
    const svg = new DOMParser().parseFromString(decodeURIComponent(result.url.slice(result.url.indexOf(',') + 1)), 'image/svg+xml').documentElement
    const mount = document.createElement('div')
    document.body.append(mount)
    mounts.push(mount)
    mount.attachShadow({ mode: 'open' }).append(document.importNode(svg, true))
    for (const item of mount.shadowRoot.querySelectorAll('.item')) expect(item.getBoundingClientRect().width).toBeCloseTo(live, 1)
  })
  it.each([
    ['original divs', 'div', ''],
    ['spans', 'span', ''],
    ['padded items', 'div', 'padding:5px'],
    ['border-box items', 'div', 'box-sizing:border-box;padding:5px'],
    ['non-scrollable clip items', 'span', 'overflow:clip'],
    ['hidden overflow stays shrinkable', 'span', 'overflow:hidden'],
    ['auto overflow stays shrinkable', 'span', 'overflow:auto'],
    ['scroll overflow stays shrinkable', 'span', 'overflow:scroll'],
    ['explicit min-width zero stays shrinkable', 'span', 'min-width:0'],
    ['fractional borders', 'span', 'border-width:1.5px;padding:5px'],
  ])('%s keep live widths in the serialized render', async (_name, tag, extra) => {
    const fixture = document.createElement('div')
    fixture.innerHTML = `<div style="width:160px;background:white;font:16px monospace"><div class="row" style="display:flex;gap:5px;margin:5px;padding:5px;background:yellow">${Array.from({ length: 10 }, (_, i) => `<${tag} class="item" style="border:1px solid;${extra}">${i}${i}</${tag}>`).join('')}</div><div class="row" style="display:flex;margin:5px;padding:5px"><${tag} class="item" style="border:1px solid;${extra}">123456789012345678901234567890</${tag}></div></div>`
    document.body.append(fixture)
    mounts.push(fixture)
    const root = fixture.firstElementChild
    const widths = [...root.querySelectorAll('.item')].map(el => el.getBoundingClientRect().width)
    const result = await snapdom(root, { embedFonts: false })
    const svg = new DOMParser().parseFromString(decodeURIComponent(result.url.slice(result.url.indexOf(',') + 1)), 'image/svg+xml').documentElement
    const mount = document.createElement('div')
    document.body.append(mount)
    mounts.push(mount)
    mount.attachShadow({ mode: 'open' }).append(document.importNode(svg, true))
    const cloned = [...mount.shadowRoot.querySelectorAll('.item')]
    expect(cloned.length).toBe(widths.length)
    cloned.forEach((el, i) => expect(el.getBoundingClientRect().width, `item ${i}`).toBeCloseTo(widths[i], 1))
    const canvas = await result.toCanvas({ dpr: 1 })
    expect(canvas.width).toBe(160)
  })
})
