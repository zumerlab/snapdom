import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

const counts = { conn: 0 }
customElements.define('issue523-widget', class extends HTMLElement {
  connectedCallback() { counts.conn++ }
})

let host
afterEach(() => host?.remove())

function mount() {
  host = document.createElement('div')
  host.innerHTML = `<style>issue523-widget{display:inline-block;width:100px;height:20px;background:red}</style>
    <p style="margin:0">before</p><issue523-widget id="w"></issue523-widget>`
  document.body.appendChild(host)
  return host
}

describe('measurement mounts never connect page custom elements (#523)', () => {
  it('reconcile: true does not run connectedCallback', async () => {
    mount()
    const before = counts.conn
    await snapdom(host, { reconcile: true, cache: 'disabled' })
    expect(counts.conn).toBe(before)
  })

  it('a body capture does not run it either, with or without reconcile', async () => {
    mount()
    const before = counts.conn
    await snapdom(document.body, { cache: 'disabled' })
    await snapdom(document.body, { reconcile: true, cache: 'disabled' })
    expect(counts.conn).toBe(before)
  })

  it('the span stand-in measures like the custom box, so reconcile keeps it painted', async () => {
    mount()
    const canvas = await snapdom.toCanvas(host, { dpr: 1, reconcile: true, embedFonts: false, cache: 'disabled' })
    const r = host.querySelector('#w').getBoundingClientRect()
    const hr = host.getBoundingClientRect()
    const ctx = canvas.getContext('2d')
    const at = (x) => Array.from(ctx.getImageData(Math.round(r.left - hr.left + x), Math.round(r.top - hr.top + 10), 1, 1).data)
    expect(at(95)).toEqual([255, 0, 0, 255])
    expect(at(105)[0]).not.toBe(255)
  })
})
