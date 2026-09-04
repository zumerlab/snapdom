import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'

// The burst memo keys captures on a signature of the call's options. That signature used to
// be `JSON.stringify(rest, Object.keys(rest).sort())`, and an ARRAY replacer applies at every
// depth: it filtered NESTED keys against the top-level key list, and dropped function values
// outright. Two calls that differ only inside an object (or only in a callback) collapsed to
// the same signature, so the memo taken for one was served for the other.
describe('burst — options signature discriminates nested objects and callbacks', () => {
  let el
  afterEach(() => el?.remove())

  function makeEl() {
    el = document.createElement('div')
    el.style.cssText = 'width:200px;height:120px;background:#eef'
    el.innerHTML = '<span class="a">alpha</span><span class="b">bravo</span>'
    document.body.appendChild(el)
    return el
  }

  it('different clip rects are different captures', async () => {
    makeEl()
    const r1 = await snapdom(el, { burst: true, clip: { x: 0, y: 0, width: 40, height: 40 } })
    const r2 = await snapdom(el, { burst: true, clip: { x: 0, y: 0, width: 160, height: 100 } })
    // Same memo served for both rects is the bug: `{"clip":{}}` on both sides.
    expect(r2.url).not.toBe(r1.url)
  })

  it('different exclude predicates are different captures', async () => {
    makeEl()
    const r1 = await snapdom(el, { burst: true, exclude: (n) => n.classList?.contains('a') })
    const r2 = await snapdom(el, { burst: true, exclude: (n) => n.classList?.contains('b') })
    const s1 = decodeURIComponent(r1.url)
    const s2 = decodeURIComponent(r2.url)
    expect(s1).not.toBe(s2)
    // Assert on what each capture actually kept, not just on inequality.
    expect(s1).toContain('bravo')
    expect(s2).toContain('alpha')
  })

  it('the SAME callback identity still memoizes (the fast path is not lost)', async () => {
    makeEl()
    const exclude = (n) => n.classList?.contains('a')
    const r1 = await snapdom(el, { burst: true, exclude })
    const r2 = await snapdom(el, { burst: true, exclude })
    expect(r2).toBe(r1)
  })

  it('serializes baseline adoption for concurrent A, B, B calls', async () => {
    makeEl()
    const a = { burst: true, clip: { x: 0, y: 0, width: 40, height: 40 } }
    const b = { burst: true, clip: { x: 0, y: 0, width: 160, height: 100 } }
    const [resultA, resultB1, resultB2] = await Promise.all([
      snapdom(el, a),
      snapdom(el, b),
      snapdom(el, b),
    ])
    expect(resultA.meta.clip.width).toBe(40)
    expect(resultB1.meta.clip.width).toBe(160)
    expect(resultB2.meta.clip.width).toBe(160)
    expect(resultB2.url).toBe(resultB1.url)
  })
})
