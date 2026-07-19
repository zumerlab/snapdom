// __tests__/utils.debug.test.js – debugWarn coverage
import { describe, it, expect, vi, afterEach } from 'vitest'
import { debugWarn } from '../src/utils/debug.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('debugWarn', () => {
  it('stays silent when debug is off', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    debugWarn({ debug: false }, 'nope')
    debugWarn(undefined, 'nope')
    debugWarn({}, 'nope')
    expect(warn).not.toHaveBeenCalled()
  })

  it('logs message with error when debug is on and err is provided', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const err = new Error('boom')
    debugWarn({ debug: true }, 'failed', err)
    expect(warn).toHaveBeenCalledWith('[snapdom]', 'failed', err)
  })

  it('logs message without error when err is undefined', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    debugWarn({ debug: true }, 'just a message')
    expect(warn).toHaveBeenCalledWith('[snapdom]', 'just a message')
  })

  it('reads debug from ctx.options wrapper shape', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    debugWarn({ options: { debug: true } }, 'wrapped')
    expect(warn).toHaveBeenCalledWith('[snapdom]', 'wrapped')
  })
})
