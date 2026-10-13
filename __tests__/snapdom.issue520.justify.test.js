import { it, expect } from 'vitest'
import { isFirefox } from '../src/utils/browser.js'
import { freezeInflatedFontSizes } from '../src/utils/clone.helpers.js'

it.runIf(isFirefox()).each(['ABC', '中日文字'])('preserves justified %s without false font inflation', text => {
  const ownViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
  const source = document.createElement('div')
  source.style.cssText = 'width:160px;font:16px sans-serif;text-align:justify;text-align-last:justify;text-justify:inter-character'
  source.textContent = text
  document.body.append(source)
  const clone = source.cloneNode(true)
  clone.style.removeProperty('font')
  try {
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => ({ scale: 0.42 }) })
    freezeInflatedFontSizes(new Map([[clone, source]]))
    expect(clone.style.fontSize).toBe('')
  } finally {
    source.remove()
    if (ownViewport) Object.defineProperty(window, 'visualViewport', ownViewport)
    else delete window.visualViewport
  }
})

it.runIf(isFirefox()).each(['ABC', '中日文字'])('retains genuine font inflation in justified %s', text => {
  const ownViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
  const ownGCS = window.getComputedStyle
  const source = document.createElement('div')
  source.style.cssText = 'width:160px;font:30px/45px sans-serif;text-align:justify;text-align-last:justify;text-justify:inter-character'
  source.textContent = text
  document.body.append(source)
  const clone = source.cloneNode(true)
  clone.style.removeProperty('font')
  try {
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => ({ scale: 0.42 }) })
    window.getComputedStyle = (node, pseudo) => {
      const cs = ownGCS.call(window, node, pseudo)
      if (node !== source) return cs
      return new Proxy(cs, {
        get: (target, key) => key === 'fontSize' ? '16px' : key === 'lineHeight' ? '24px'
          : key === 'getPropertyValue' ? p => p === 'font-size' ? '16px' : p === 'line-height' ? '24px' : target.getPropertyValue(p)
          : typeof target[key] === 'function' ? target[key].bind(target) : target[key]
      })
    }
    freezeInflatedFontSizes(new Map([[clone, source]]))
    expect(parseFloat(clone.style.fontSize)).toBeCloseTo(30, 0)
    expect(parseFloat(clone.style.lineHeight)).toBeCloseTo(45, 0)
  } finally {
    source.remove()
    window.getComputedStyle = ownGCS
    if (ownViewport) Object.defineProperty(window, 'visualViewport', ownViewport)
    else delete window.visualViewport
  }
})
