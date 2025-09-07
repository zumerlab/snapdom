import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { inlineExternalDefsAndSymbols } from '../src/modules/svgDefs.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Utility to create a global top-level <svg> holder for defs/symbols */
function createGlobalSvg() {
  const svg = document.createElementNS(SVG_NS, 'svg')
  document.body.appendChild(svg)
  return svg
}

function createRootContainer() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  return root
}

function createLocalUse(hrefValue) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  const use = document.createElementNS(SVG_NS, 'use')
  use.setAttribute('href', hrefValue)
  svg.appendChild(use)
  return { svg, use }
}

beforeEach(() => {
  // Clean slate between tests
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('inlineExternalDefsAndSymbols', () => {
  it('does nothing for null/undefined root', () => {
    // Should not throw
    inlineExternalDefsAndSymbols(null)
    inlineExternalDefsAndSymbols(undefined)
    // No container created
    expect(document.querySelector('svg.inline-defs-container')).toBeFalsy()
  })

  it('does nothing if there are no <use> references inside root', () => {
    const root = createRootContainer()
    // No <use> elements
    inlineExternalDefsAndSymbols(root)
    // Container must not be created (early return on empty usedIds)
    expect(root.querySelector('svg.inline-defs-container')).toBeFalsy()
  })

  it('inlines an external <symbol> referenced by <use href="#id">', () => {
    // Global symbol outside root
    const gsvg = createGlobalSvg()
    const sym = document.createElementNS(SVG_NS, 'symbol')
    sym.setAttribute('id', 'icon-star')
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', 'M0 0 L10 0 L5 10 Z')
    sym.appendChild(path)
    gsvg.appendChild(sym)

    // Root with a local <use>
    const root = createRootContainer()
    const { svg } = createLocalUse('#icon-star')
    root.appendChild(svg)

    inlineExternalDefsAndSymbols(root)

    const container = root.querySelector('svg.inline-defs-container')
    expect(container).toBeTruthy()
    // Container visibility/positioning attributes
    expect(container.getAttribute('aria-hidden')).toBe('true')
    expect(container.getAttribute('style')).toMatch(/width:\s*0/)
    expect(container.getAttribute('style')).toMatch(/height:\s*0/)

    const cloned = container.querySelector('symbol#icon-star')
    expect(cloned).toBeTruthy()
    // Ensure it is a clone (not the same node)
    expect(cloned).not.toBe(sym)
    // And child path is present
    expect(cloned.querySelector('path')).toBeTruthy()
  })

  it('inlines from global <defs> (e.g., linearGradient) when referenced', () => {
    // Global defs with a gradient
    const gsvg = createGlobalSvg()
    const defs = document.createElementNS(SVG_NS, 'defs')
    const grad = document.createElementNS(SVG_NS, 'linearGradient')
    grad.setAttribute('id', 'grad1')
    defs.appendChild(grad)
    gsvg.appendChild(defs)

    // Root referencing that id
    const root = createRootContainer()
    const { svg } = createLocalUse('#grad1')
    root.appendChild(svg)

    inlineExternalDefsAndSymbols(root)

    const container = root.querySelector('svg.inline-defs-container')
    expect(container).toBeTruthy()

    // A <defs> container should be created inside the hidden svg with the cloned element
    const localDefs = container.querySelector('defs')
    expect(localDefs).toBeTruthy()
    expect(localDefs.querySelector('#grad1')).toBeTruthy()
    expect(localDefs.querySelector('#grad1')).not.toBe(grad)
  })

  it('supports xlink:href on <use> (legacy attribute)', () => {
    // Global symbol
    const gsvg = createGlobalSvg()
    const sym = document.createElementNS(SVG_NS, 'symbol')
    sym.setAttribute('id', 'legacy-icon')
    gsvg.appendChild(sym)

    // Root with <use xlink:href>
    const root = createRootContainer()
    const svg = document.createElementNS(SVG_NS, 'svg')
    const use = document.createElementNS(SVG_NS, 'use')
    use.setAttribute('xlink:href', '#legacy-icon')
    svg.appendChild(use)
    root.appendChild(svg)

    inlineExternalDefsAndSymbols(root)

    const container = root.querySelector('svg.inline-defs-container')
    expect(container).toBeTruthy()
    expect(container.querySelector('symbol#legacy-icon')).toBeTruthy()
  })

  it('does not duplicate if a symbol/defs with the same id already exists in root', () => {
    // Global symbol
    const gsvg = createGlobalSvg()
    const sym = document.createElementNS(SVG_NS, 'symbol')
    sym.setAttribute('id', 'dup')
    gsvg.appendChild(sym)

    // Root already contains the same id
    const root = createRootContainer()
    const container = document.createElementNS(SVG_NS, 'svg')
    container.classList.add('inline-defs-container')
    const localSym = document.createElementNS(SVG_NS, 'symbol')
    localSym.setAttribute('id', 'dup')
    container.appendChild(localSym)
    root.appendChild(container)

    // And it references the same id
    const { svg } = createLocalUse('#dup')
    root.appendChild(svg)

    inlineExternalDefsAndSymbols(root)

    // Still only one symbol#dup in root
    const all = root.querySelectorAll('symbol#dup')
    expect(all.length).toBe(1)
  })

  it('clones elements with special characters in id (CSS.escape path)', () => {
    // Global symbol with special chars
    const gsvg = createGlobalSvg()
    const specialId = 'icon:weird.*'
    const sym = document.createElementNS(SVG_NS, 'symbol')
    sym.setAttribute('id', specialId)
    gsvg.appendChild(sym)

    // Root referencing it
    const root = createRootContainer()
    const { svg } = createLocalUse('#' + specialId)
    root.appendChild(svg)

    inlineExternalDefsAndSymbols(root)

    const container = root.querySelector('svg.inline-defs-container')
    expect(container).toBeTruthy()
    // querySelector with literal should still work because we test the existence of the cloned node
    const cloned = Array.from(container.querySelectorAll('symbol')).find(s => s.id === specialId)
    expect(cloned).toBeTruthy()
  })

  it('creates the hidden container even if no matches are found for used ids', () => {
    // No matching global defs/symbols, but there IS a <use>
    const root = createRootContainer()
    const { svg } = createLocalUse('#nope')
    root.appendChild(svg)

    inlineExternalDefsAndSymbols(root)

    const container = root.querySelector('svg.inline-defs-container')
    expect(container).toBeTruthy()
    // Empty container (no symbol/defs children)
    expect(container.querySelector('symbol, defs')).toBeFalsy()
  })
})
