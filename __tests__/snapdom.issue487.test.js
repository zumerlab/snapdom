// #487 — `fill` (and `currentColor`) did not reach an icon drawn through <use href="#symbol">.
//
// A <use> instance inherits paint from the <use> element, so `<svg fill="red"><use href="#icon">`
// paints the referenced <symbol>'s shapes red. snapdom emits a per-tag "base reset" built from
// `all: initial` for every tag it captures, and <symbol> was in that list: the generated
// `symbol { fill: rgb(0,0,0); color: rgb(0,0,0); … }` rule matched the referenced element, and a
// declaration on the instance beats anything inherited from the <use> site — so every sprite icon
// rasterized black. <symbol> is a template that is never painted on its own (like <defs>, <g>,
// <use>, <pattern>…), so it now generates no base rule and no class at all.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/index'

const SPRITE = `
  <svg aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">
    <symbol id="i487-plain" viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100"></rect></symbol>
    <symbol id="i487-cc" viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100" fill="currentColor"></rect></symbol>
    <symbol id="i487-blue" viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100" fill="blue"></rect></symbol>
    <g id="i487-g"><rect x="0" y="0" width="100" height="100"></rect></g>
    <defs><path id="i487-defs-path" d="M0 0 H100 V100 H0 Z"></path></defs>
  </svg>`

/** Colour of the captured icon at its centre. */
async function centerPixel(el) {
  const canvas = await snapdom.toCanvas(el, { dpr: 1, scale: 1 })
  const d = canvas.getContext('2d').getImageData(Math.round(canvas.width / 2), Math.round(canvas.height / 2), 1, 1).data
  return `${d[0]},${d[1]},${d[2]},${d[3]}`
}

describe('#487 fill reaches icons drawn with <use> + <symbol>', () => {
  let host, style
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    style = document.createElement('style')
    style.textContent = '.i487-red{fill:red}'
    document.head.appendChild(style)
  })
  afterEach(() => { host.remove(); style.remove() })

  function mount(icon) {
    host.innerHTML = SPRITE + `<span style="display:flex;width:40px;height:40px">${icon}</span>`
    return host.querySelector('span')
  }

  it('honors a fill presentation attribute on the wrapping <svg>', async () => {
    const el = mount('<svg viewBox="0 0 100 100" fill="red"><use xlink:href="#i487-plain"></use></svg>')
    expect(await centerPixel(el)).toBe('255,0,0,255')
  })

  it('honors currentColor inside the symbol', async () => {
    const el = mount('<svg viewBox="0 0 100 100" style="color:red"><use xlink:href="#i487-cc"></use></svg>')
    expect(await centerPixel(el)).toBe('255,0,0,255')
  })

  it('honors a fill coming from a CSS rule on the wrapping <svg>', async () => {
    const el = mount('<svg viewBox="0 0 100 100" class="i487-red"><use xlink:href="#i487-plain"></use></svg>')
    expect(await centerPixel(el)).toBe('255,0,0,255')
  })

  it('does not override a fill declared inside the symbol', async () => {
    const el = mount('<svg viewBox="0 0 100 100" fill="red"><use xlink:href="#i487-blue"></use></svg>')
    expect(await centerPixel(el)).toBe('0,0,255,255')
  })

  it('keeps working for <g> and <defs> targets (unchanged behaviour)', async () => {
    const g = mount('<svg viewBox="0 0 100 100" fill="red"><use xlink:href="#i487-g"></use></svg>')
    expect(await centerPixel(g)).toBe('255,0,0,255')
    const p = mount('<svg viewBox="0 0 100 100" fill="red"><use xlink:href="#i487-defs-path"></use></svg>')
    expect(await centerPixel(p)).toBe('255,0,0,255')
  })

  // #164 (fixed by the #365 paint-props inlining) is the neighbouring case: a plain inline <svg>,
  // no <use> involved. It had no regression test of its own, and the base-reset change touches the
  // same cascade, so pin it here.
  it('keeps currentColor on a plain inline <svg> (#164)', async () => {
    const el = mount('<svg viewBox="0 0 100 100" style="color:red"><rect x="0" y="0" width="100" height="100" fill="currentColor"></rect></svg>')
    expect(await centerPixel(el)).toBe('255,0,0,255')
  })

  it('keeps a CSS-driven fill on a plain inline <svg> (#164)', async () => {
    const el = mount('<svg viewBox="0 0 100 100" class="i487-red"><rect x="0" y="0" width="100" height="100"></rect></svg>')
    expect(await centerPixel(el)).toBe('255,0,0,255')
  })

  it('emits no base reset rule for <symbol>', async () => {
    mount('<svg viewBox="0 0 100 100" fill="red"><use xlink:href="#i487-plain"></use></svg>')
    const raw = await snapdom.toRaw(host)
    const svg = decodeURIComponent(raw.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
    const css = (svg.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || []).join('\n')
    for (const m of css.matchAll(/([^{}]+)\{[^}]*\}/g)) {
      const selectors = m[1].split(',').map((s) => s.trim().replace(/^<style[^>]*>/, ''))
      expect(selectors).not.toContain('symbol')
    }
  })
})
