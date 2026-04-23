import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { inlineBackgroundImages } from '../src/modules/background.js'

// #402: inlining the `mask` shorthand on the clone resets every mask-*
// longhand to its initial value. Longhands that snapdom wants to preserve
// (mask-mode, mask-composite, etc.) must be re-applied AFTER the shorthand.
describe('inlineBackgroundImages — mask longhands survive the shorthand (#402)', () => {
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

  it('preserves mask-mode after setting the mask shorthand', async () => {
    source.style.cssText =
      'width:50px;height:50px;background:red;' +
      'mask-image:linear-gradient(black,transparent);' +
      'mask-mode:luminance'
    await inlineBackgroundImages(source, clone, new WeakMap())
    expect(clone.style.getPropertyValue('mask-mode')).toBe('luminance')
  })

  it('preserves mask-composite after setting the mask shorthand', async () => {
    source.style.cssText =
      'width:50px;height:50px;background:red;' +
      'mask-image:linear-gradient(black,transparent);' +
      'mask-composite:subtract'
    await inlineBackgroundImages(source, clone, new WeakMap())
    const composite = clone.style.getPropertyValue('mask-composite') ||
                      clone.style.getPropertyValue('-webkit-mask-composite')
    expect(composite).toBe('subtract')
  })
})
