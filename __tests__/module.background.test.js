import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { inlineBackgroundImages } from '../src/modules/background.js'

describe('inlineBackgroundImages', () => {
  let source, clone
  beforeEach(() => {
    source = document.createElement('div')
    clone = document.createElement('div')
    document.body.appendChild(source)
    document.body.appendChild(clone)
  })
  afterEach(() => {
    document.body.removeChild(source)
    document.body.removeChild(clone)
  })

  it('does not fail if there is no background-image', async () => {
    source.style.background = 'none'
    await expect(inlineBackgroundImages(source, clone, new WeakMap())).resolves.toBeUndefined()
  })

  it('processes a valid background-image', async () => {
    source.style.backgroundImage = 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9p6Q2wAAAABJRU5ErkJggg==")'
    await expect(inlineBackgroundImages(source, clone, new WeakMap())).resolves.toBeUndefined()
  })
})
