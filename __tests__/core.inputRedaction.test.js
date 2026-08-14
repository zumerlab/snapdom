import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { redactInputs } from '../packages/plugins/redact-inputs.js'

/**
 * Core is fidelity-first: it captures what the browser PAINTS. An email/tel field shows its
 * value in the clear on screen, so the capture shows it too. Core used to mask those, which
 * silently made the image disagree with the page.
 *
 * The one mask core keeps is type="password", and only because it is fidelity-NEUTRAL: the
 * control already paints bullets, so a same-length bullet mask renders identically while the
 * typed secret stays out of the serialized SVG string.
 *
 * Everything else is opt-in through the redactInputs plugin.
 */

const mounted = []

function mount(html) {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  mounted.push(host)
  return host.firstElementChild
}

/** The serialized SVG is the thing that leaks: it is a string callers log, upload and cache. */
function payload(res) {
  return decodeURIComponent(res.url.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
}

afterEach(() => {
  while (mounted.length) mounted.pop().remove()
})

describe('core input handling is fidelity-first', () => {
  it('captures email and tel values verbatim', async () => {
    const el = mount(`<div>
      <input type="email" value="ada@example.com">
      <input type="tel" value="+54 11 5555 1234">
    </div>`)
    const out = payload(await snapdom(el))
    expect(out).toContain('ada@example.com')
    expect(out).toContain('+54 11 5555 1234')
  })

  it('captures cc-* and one-time-code values verbatim', async () => {
    const el = mount(`<div>
      <input autocomplete="cc-number" value="4111111111111111">
      <input autocomplete="one-time-code" value="123456">
    </div>`)
    const out = payload(await snapdom(el))
    expect(out).toContain('4111111111111111')
    expect(out).toContain('123456')
  })

  it('still masks type=password, same length, secret absent', async () => {
    const el = mount('<div><input type="password" value="hunter2"></div>')
    const out = payload(await snapdom(el))
    expect(out).not.toContain('hunter2')
    expect(out).toContain('•'.repeat('hunter2'.length))
  })

  it('masks a password even when it IS the capture root', async () => {
    const el = mount('<input type="password" value="s3cret">')
    const out = payload(await snapdom(el))
    expect(out).not.toContain('s3cret')
  })
})

describe('redactInputs plugin', () => {
  it('redacts email and tel by default, preserving length', async () => {
    const el = mount(`<div>
      <input type="email" value="ada@example.com">
      <input type="tel" value="5551234">
    </div>`)
    const out = payload(await snapdom(el, { plugins: [redactInputs()] }))
    expect(out).not.toContain('ada@example.com')
    expect(out).not.toContain('5551234')
    expect(out).toContain('•'.repeat('ada@example.com'.length))
  })

  it('redacts cc-* and one-time-code by autocomplete token', async () => {
    const el = mount(`<div>
      <input autocomplete="cc-number" value="4111111111111111">
      <input autocomplete="shipping one-time-code" value="123456">
    </div>`)
    const out = payload(await snapdom(el, { plugins: [redactInputs()] }))
    expect(out).not.toContain('4111111111111111')
    expect(out).not.toContain('123456')
  })

  it('reads the type ATTRIBUTE, so an unimplemented type is still matched', async () => {
    // el.type reflects an unknown type as 'text'; the attribute is the authoring intent.
    const el = mount('<div><input type="EMAIL" value="ada@example.com"></div>')
    const out = payload(await snapdom(el, { plugins: [redactInputs()] }))
    expect(out).not.toContain('ada@example.com')
  })

  it('redacts the capture root itself', async () => {
    const el = mount('<input type="email" value="ada@example.com">')
    const out = payload(await snapdom(el, { plugins: [redactInputs()] }))
    expect(out).not.toContain('ada@example.com')
  })

  it('redacts a textarea through selector, keeping its length', async () => {
    const el = mount('<div><textarea data-secret>line one</textarea></div>')
    const out = payload(await snapdom(el, { plugins: [redactInputs({ selector: '[data-secret]' })] }))
    expect(out).not.toContain('line one')
    expect(out).toContain('•'.repeat('line one'.length))
  })

  it('all:true redacts every field, including ones no list names', async () => {
    const el = mount('<div><input type="text" value="ordinary"><textarea>notes</textarea></div>')
    const out = payload(await snapdom(el, { plugins: [redactInputs({ all: true })] }))
    expect(out).not.toContain('ordinary')
    expect(out).not.toContain('notes')
  })

  it('honours a custom mask, including blanking outright', async () => {
    const el = mount('<div><input type="email" value="ada@example.com"></div>')
    const out = payload(await snapdom(el, { plugins: [redactInputs({ mask: () => '' })] }))
    expect(out).not.toContain('ada@example.com')
    expect(out).not.toContain('•')
  })

  it('leaves fields it was not asked to touch alone', async () => {
    const el = mount(`<div>
      <input type="email" value="ada@example.com">
      <input type="text" value="keep-me">
    </div>`)
    const out = payload(await snapdom(el, { plugins: [redactInputs()] }))
    expect(out).not.toContain('ada@example.com')
    expect(out).toContain('keep-me')
  })
})
