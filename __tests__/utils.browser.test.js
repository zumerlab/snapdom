import { describe, it, expect} from 'vitest'
import { isSafari } from '../src/utils'

describe('isSafari', () => {
  it('returns a boolean', () => {
    expect(typeof isSafari()).toBe('boolean')
  })
})
