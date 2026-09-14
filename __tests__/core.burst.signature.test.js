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

  it('the same callback identity still runs on each capture', async () => {
    makeEl()
    const exclude = (n) => n.classList?.contains('a')
    const r1 = await snapdom(el, { burst: true, exclude })
    const r2 = await snapdom(el, { burst: true, exclude })
    expect(r2).not.toBe(r1)
    expect(decodeURIComponent(r2.url)).toContain('bravo')
    expect(decodeURIComponent(r2.url)).not.toContain('alpha')
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

// The render-state signature sampled before every memo serve pushed `el.value` for every
// tracked input, so a password typed and then cleared stayed in the memo's memory in
// plaintext. A password input pushes its value LENGTH instead: the clone renders a
// same-length bullet mask, so a same-length change is the same frame and a different
// length is not. The state is module-private, so this pins it through the public path.
describe('burst — password values never enter the render-state signature', () => {
  let form
  afterEach(() => form?.remove())

  it('serves the memo across a same-length password change, recaptures on a different length', async () => {
    form = document.createElement('form')
    form.style.cssText = 'width:200px;background:#fff'
    form.innerHTML = '<input type="password" value="hunter2">'
    document.body.appendChild(form)
    const input = form.firstElementChild
    const r1 = await snapdom(form, { burst: true })
    expect(decodeURIComponent(r1.url)).toContain('\u2022'.repeat(7))
    input.value = 'swordfi'
    // A memo hit hands back the SAME result object; a signature that compared plaintext
    // values would recapture here and build a new one.
    const r2 = await snapdom(form, { burst: true })
    expect(r2).toBe(r1)
    input.value = ''
    const r3 = await snapdom(form, { burst: true })
    expect(r3).not.toBe(r1)
    expect(decodeURIComponent(r3.url)).not.toContain('\u2022')
  })
})
