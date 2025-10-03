import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from  '../src/index'

describe('snapdom capture attributes', () => {
  let container

  beforeEach(() => {
    container = document.createElement('div')
    container.style.width = '300px'
    container.style.height = '150px'
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  it('should exclude elements with data-capture="exclude"', async () => {
    const excluded = document.createElement('div')
    excluded.setAttribute('data-capture', 'exclude')
    excluded.textContent = 'Should be excluded'
    container.appendChild(excluded)

    const svgDataUrl = await snapdom.toRaw(container)
    const svgText = decodeURIComponent(svgDataUrl.split(',')[1])

    expect(svgText).not.toContain('Should be excluded')
  })

  it('should replace elements with data-capture="placeholder" and show placeholder text', async () => {
    const placeholder = document.createElement('div')
    placeholder.setAttribute('data-capture', 'placeholder')
    placeholder.setAttribute('data-placeholder-text', 'Placeholder here')
    placeholder.textContent = 'Original text'
    container.appendChild(placeholder)

    const svgDataUrl = await snapdom.toRaw(container)
    const svgText = decodeURIComponent(svgDataUrl.split(',')[1])

    expect(svgText).toContain('Placeholder here')
    expect(svgText).not.toContain('Original text')
  })
})
