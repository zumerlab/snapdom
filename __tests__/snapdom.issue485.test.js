// #485 — the ellipsis / line-clamp measurement must not replace the live text nodes.
//
// snapdom bakes CSS truncation (`text-overflow: ellipsis`, `-webkit-line-clamp`) by measuring the
// LIVE element: it writes a candidate string, reads scrollWidth/scrollHeight, and binary-searches
// the cut. Doing that through `el.textContent = …` drops every child text node and inserts a new
// one, so a virtual-DOM framework holding the original node (React fiber, Vue vnode) later throws
//   NotFoundError: Failed to execute 'removeChild' on 'Node'
// on its next reconciliation — long after the capture returned. The measurement now writes
// `textNode.data` instead, which mutates in place and keeps node identity.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/index'

const ELLIPSIS = 'display:block;width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
const CLAMP = 'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;width:80px'

function svgOf(raw) {
  return decodeURIComponent(raw.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
}

describe('#485 truncation measurement keeps live text nodes alive', () => {
  let host
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host) })
  afterEach(() => host.remove())

  it('keeps the same text node instance across an ellipsis capture', async () => {
    host.innerHTML = `<span style="${ELLIPSIS}">Alpha Beta Gamma Delta</span>`
    const span = host.querySelector('span')
    const node = span.firstChild
    expect(node.nodeType).toBe(Node.TEXT_NODE)

    await snapdom.toRaw(host)

    expect(span.firstChild).toBe(node)          // identity survived
    expect(span.childNodes.length).toBe(1)
    expect(node.data).toBe('Alpha Beta Gamma Delta') // value restored
  })

  it('keeps the same text node instance across a line-clamp capture', async () => {
    host.innerHTML = `<div style="${CLAMP}">Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota</div>`
    const box = host.querySelector('div')
    const node = box.firstChild

    await snapdom.toRaw(host)

    expect(box.firstChild).toBe(node)
    expect(node.data).toBe('Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota')
  })

  it('keeps every node when the text is split across several text nodes', async () => {
    host.innerHTML = `<span style="${ELLIPSIS}"></span>`
    const span = host.querySelector('span')
    const a = document.createTextNode('1234')
    const b = document.createTextNode(' unidades por caja')
    span.append(a, b)

    await snapdom.toRaw(host)

    expect(span.childNodes.length).toBe(2)
    expect(span.firstChild).toBe(a)
    expect(span.lastChild).toBe(b)
    expect(a.data).toBe('1234')
    expect(b.data).toBe(' unidades por caja')
  })

  it('lets the framework remove the node it still holds (the React removeChild crash)', async () => {
    host.innerHTML = `<span style="${ELLIPSIS}">Alpha Beta Gamma Delta</span>`
    const span = host.querySelector('span')
    const fiberNode = span.firstChild // what React's fiber points at

    await snapdom.toRaw(host)

    // Before the fix this threw NotFoundError: the node was no longer a child of span.
    expect(() => span.removeChild(fiberNode)).not.toThrow()
    expect(span.childNodes.length).toBe(0)
  })

  it('still bakes the ellipsis into the captured markup', async () => {
    host.innerHTML = `<span style="${ELLIPSIS}">Alpha Beta Gamma Delta</span>`
    const svg = svgOf(await snapdom.toRaw(host))
    const text = (svg.match(/<span[^>]*>([^<]*)<\/span>/) || [])[1] || ''
    expect(text).toMatch(/…$/)
    expect(text.length).toBeLessThan('Alpha Beta Gamma Delta'.length)
  })

  it('still bakes the line clamp into the captured markup', async () => {
    host.innerHTML = `<div style="${CLAMP}">Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota</div>`
    const svg = svgOf(await snapdom.toRaw(host))
    expect(svg).toMatch(/…/)
  })
})
