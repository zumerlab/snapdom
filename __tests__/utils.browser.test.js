import { describe, it, expect} from 'vitest'
import { isSafari, idle } from '../src/utils'

describe('isSafari', () => {
  it('returns a boolean', () => {
    expect(typeof isSafari()).toBe('boolean')
  })
})

describe('idle', () => {
  it('calls fn immediately if fast is true', () => {
    let called = false
    idle(() => { called = true }, { fast: true })
    expect(called).toBe(true)
  })
  it('uses requestIdleCallback if available', () => {
    const orig = window.requestIdleCallback
    let called = false
    window.requestIdleCallback = (fn) => { called = true; fn() }
    idle(() => { called = true })
    expect(called).toBe(true)
    window.requestIdleCallback = orig
  })
  it('falls back to setTimeout if requestIdleCallback not available', async () => {
    const orig = window.requestIdleCallback
    delete window.requestIdleCallback
    let called = false
    idle(() => { called = true })
    await new Promise(r => setTimeout(r, 10))
    expect(called).toBe(true)
    window.requestIdleCallback = orig
  })
})
