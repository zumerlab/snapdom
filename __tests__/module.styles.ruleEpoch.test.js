// The scanned property universe and the pseudo gates are derived from the author RULES
// alone, so they are memoized against the style-RULE epoch, not the DOM epoch: an ordinary
// DOM mutation must not re-scan every stylesheet, and every way the rules can actually
// change must still invalidate the memo.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { universeFor, flushStyleInvalidations } from '../src/modules/styles.js'

const trash = []
afterEach(() => {
  while (trash.length) trash.pop().remove()
  document.adoptedStyleSheets = []
})

function mount(html = 'probe') {
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.appendChild(el)
  trash.push(el)
  return el
}

/** The memoized universe, after draining anything pending. */
function currentUniverse(el) {
  flushStyleInvalidations()
  return universeFor(el)
}

describe('style-rule epoch', () => {
  it('does not re-scan the stylesheets when only DOM text changed', () => {
    const el = mount('<p>before</p>')
    const before = currentUniverse(el)
    expect(before).toBeInstanceOf(Set)

    el.firstChild.textContent = 'after'
    el.setAttribute('data-x', '1')
    el.appendChild(document.createElement('span'))

    // Same Set instance = the scan never ran again. Keyed on the DOM epoch this is a new one.
    expect(currentUniverse(el)).toBe(before)
  })

  it('re-scans for a <style> inserted outside <head>', () => {
    const el = mount()
    const before = currentUniverse(el)
    expect(before.has('column-count')).toBe(false)

    const style = document.createElement('style')
    style.textContent = '.re-probe-a { column-count: 3 }'
    document.body.appendChild(style)
    trash.push(style)

    const after = currentUniverse(el)
    expect(after).not.toBe(before)
    expect(after.has('column-count')).toBe(true)
  })

  it('re-scans when the CSS text of an existing <style> is rewritten', () => {
    const style = document.createElement('style')
    style.textContent = '.re-probe-b { color: red }'
    document.body.appendChild(style)
    trash.push(style)

    const el = mount()
    const before = currentUniverse(el)
    expect(before.has('column-span')).toBe(false)

    style.textContent = '.re-probe-b { column-span: all }'
    expect(currentUniverse(el).has('column-span')).toBe(true)
  })

  it('re-scans when a sheet is pushed into adoptedStyleSheets', () => {
    const el = mount()
    const before = currentUniverse(el)
    expect(before.has('text-orientation')).toBe(false)

    // No mutation record exists for this: only the per-capture sheet census sees it.
    const sheet = new CSSStyleSheet()
    sheet.replaceSync('.re-probe-c { text-orientation: upright }')
    document.adoptedStyleSheets = [sheet]

    expect(currentUniverse(el).has('text-orientation')).toBe(true)
  })

  it('re-scans when a <link rel=stylesheet> finishes loading', async () => {
    const el = mount()
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = URL.createObjectURL(new Blob(['.re-probe-d { background-blend-mode: multiply }'], { type: 'text/css' }))
    const loaded = new Promise((res) => { link.onload = res; link.onerror = res })
    document.body.appendChild(link)
    trash.push(link)

    // Consume the insertion record and re-prime the memo while the sheet is still empty,
    // so the assertion below can only pass through the census, not through that record.
    const beforeLoad = currentUniverse(el)
    expect(beforeLoad.has('background-blend-mode')).toBe(false)

    await loaded
    const after = currentUniverse(el)
    expect(after).not.toBe(beforeLoad)
    expect(after.has('background-blend-mode')).toBe(true)
  })

  it('paints a pseudo whose rule arrived after the gates were memoized', async () => {
    // The pseudo gates ride the same memo: a stale one gates every node out and the
    // ::after never reaches the capture at all.
    const el = mount()
    el.style.cssText = 'width:40px;height:40px;background:rgb(0,0,255)'
    await snapdom.toCanvas(el, { scale: 1, dpr: 1 })

    const style = document.createElement('style')
    style.textContent =
      '.re-gate::after { content:""; display:block; width:40px; height:40px; background:rgb(255,0,0) }'
    document.body.appendChild(style)
    trash.push(style)
    el.className = 're-gate'

    const canvas = await snapdom.toCanvas(el, { scale: 1, dpr: 1 })
    const d = canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(canvas.width >> 1, canvas.height - 2, 1, 1).data
    expect(`${d[0]},${d[1]},${d[2]}`).toBe('255,0,0')
  })
})
