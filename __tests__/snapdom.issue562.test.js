// #562: kept light-DOM <style> clones re-run in the SVG, where `:root` is the <svg> and a
// var() set outside the capture resolves differently. A rule tying snapDOM's generated class
// won by coming later and painted the light theme on a dark page.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

async function pixel(el, opts = {}, x = 20, y = 20) {
  const res = await snapdom(el, { dpr: 1, scale: 1, ...opts })
  const c = await res.toCanvas()
  return [...c.getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3)
}

const THEME = `
  :root { --s562: #ffffff; }
  :root[data-theme562="dark"] { --s562: #202020; }
  .card562 { width: 160px; height: 80px; background: var(--s562); }`

describe('#562 kept <style> rules lose to the generated classes', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('data-theme562')
  })

  it('a :root theme variable keeps the live theme', async () => {
    document.documentElement.setAttribute('data-theme562', 'dark')
    const host = document.createElement('div')
    host.innerHTML = `<style>${THEME}</style><div class="card562"></div>`
    document.body.appendChild(host)
    expect(await pixel(host, { cache: 'disabled' })).toEqual([32, 32, 32])
  })

  it('a variable set by an ancestor outside the capture keeps its live value', async () => {
    const outer = document.createElement('section')
    outer.style.setProperty('--o562', 'rgb(200, 10, 10)')
    outer.innerHTML = '<div><style>.o562 { width: 80px; height: 40px; background: var(--o562); }</style><div class="o562"></div></div>'
    document.body.appendChild(outer)
    expect(await pixel(outer.firstChild, { cache: 'disabled' })).toEqual([200, 10, 10])
  })

  it('capturing the documentElement keeps a <head> theme rule (the report)', async () => {
    const frame = document.createElement('iframe')
    frame.style.cssText = 'width:300px;height:200px;border:0'
    document.body.appendChild(frame)
    const doc = frame.contentDocument
    doc.open()
    doc.write(`<!doctype html><html data-theme562="dark"><head><style>${THEME}
      body { margin: 0; padding: 16px; background: #808080; }</style></head>
      <body><div class="card562"></div></body></html>`)
    doc.close()
    expect(await pixel(doc.documentElement, { cache: 'disabled' }, 40, 40)).toEqual([32, 32, 32])
  })

  it('a kept rule still paints what no class carries', async () => {
    const host = document.createElement('div')
    host.innerHTML = '<style>.k562::before { content: ""; display: block; width: 60px; height: 60px; background: rgb(10, 120, 10); }</style><div class="k562"></div>'
    document.body.appendChild(host)
    expect(await pixel(host, { cache: 'disabled' })).toEqual([10, 120, 10])
  })
})
