import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'
import { timestampOverlay } from '../packages/plugins/timestamp-overlay.js'
import { filter } from '../packages/plugins/filter.js'
import { replaceText } from '../packages/plugins/replace-text.js'
import { colorTint } from '../packages/plugins/color-tint.js'
import { redactInputs } from '../packages/plugins/redact-inputs.js'

const mounted = []
function mount(html, css = 'width:200px;height:100px;background:white;color:black;font:16px Arial;box-sizing:border-box') {
  const root = document.createElement('div')
  root.style.cssText = css
  root.innerHTML = html
  document.body.appendChild(root)
  mounted.push(root)
  return root
}
afterEach(() => { for (const root of mounted.splice(0)) root.remove() })
const options = { dpr: 1, scale: 1, embedFonts: false }
function xml(result) {
  return new DOMParser().parseFromString(decodeURIComponent(result.url.slice(result.url.indexOf(',') + 1)), 'image/svg+xml')
}
async function rgba(result) {
  const canvas = await result.toCanvas()
  return { width: canvas.width, height: canvas.height, data: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data }
}
async function samePixels(a, b) {
  const before = await rgba(a), after = await rgba(b)
  expect([after.width, after.height]).toEqual([before.width, before.height])
  let differentBytes = 0
  for (let i = 0; i < before.data.length; i++) if (after.data[i] !== before.data[i]) differentBytes++
  expect(differentBytes).toBe(0)
}

describe('official transform plugins against v3', () => {
  it('applies filter over retained author !important CSS', async () => {
    const root = mount('<style>#filter-author{filter:none!important}</style>')
    root.id = 'filter-author'
    root.style.background = 'rgb(255,0,0)'
    const result = await snapdom(root, { ...options, plugins: [filter({ preset: 'invert' })] })
    const painted = await rgba(result)
    let cyan = 0
    for (let i = 0; i < painted.data.length; i += 4) if (painted.data[i] < 20 && painted.data[i + 1] > 230 && painted.data[i + 2] > 230) cyan++
    expect(cyan).toBeGreaterThan(15000)
    expect(getComputedStyle(root).filter).toBe('none')
  })

  it('replaces visible text without rewriting retained stylesheet text', async () => {
    const root = mount('<style>#replace-box{background:red!important}</style><div id="replace-box" style="width:200px;height:80px">red</div>')
    const result = await snapdom(root, { ...options, plugins: [replaceText({ replacements: [{ find: 'red', replace: 'blue' }] })] })
    expect(xml(result).querySelector('#replace-box').textContent).toBe('blue')
    const painted = await rgba(result)
    let red = 0
    for (let i = 0; i < painted.data.length; i += 4) if (painted.data[i] > 230 && painted.data[i + 1] < 20 && painted.data[i + 2] < 20) red++
    expect(red).toBeGreaterThan(12000)
    expect(root.querySelector('#replace-box').textContent).toBe('red')
  })

  it('redacts types matched on the source even when core converts their clone to text', async () => {
    const root = mount('<input type="date" value="2026-09-04" style="width:180px;height:40px;appearance:none;border:0;background:white;color:black;font:20px Arial">')
    const result = await snapdom(root, { ...options, plugins: [redactInputs({ types: ['date'], autocomplete: [], mask: () => 'MASK' })] })
    const cloned = xml(result).querySelector('input')
    expect(cloned.getAttribute('value')).toBe('MASK')
    expect(cloned.getAttribute('type')).toBe('text')
    expect(root.querySelector('input').value).toBe('2026-09-04')
    // Chromium gives date/text controls different UA styles. Compare the two masks on the
    // same source control to prove the visible text is painted, without demanding identical
    // native metrics from different types.
    const blank = await rgba(await snapdom(root, { ...options, plugins: [redactInputs({ types: ['date'], autocomplete: [], mask: () => '' })] }))
    const masked = await rgba(result)
    let differentPixels = 0
    for (let i = 0; i < masked.data.length; i += 4) if (masked.data[i] !== blank.data[i]) differentPixels++
    expect(differentPixels).toBeGreaterThan(100)
  })

  it('shows the mask for number inputs whose native value sanitizer rejects bullets', async () => {
    const root = mount('<input type="number" value="1234" autocomplete="cc-number" style="width:180px;height:40px;appearance:none;border:0;background:white;color:black;font:20px Arial">')
    const result = await snapdom(root, { ...options, plugins: [redactInputs({ mask: () => 'MASK' })] })
    const cloned = xml(result).querySelector('input')
    expect(cloned.getAttribute('type')).toBe('text')
    expect(cloned.getAttribute('value')).toBe('MASK')
    root.querySelector('input').type = 'text'
    root.querySelector('input').value = 'MASK'
    await samePixels(result, await snapdom(root, options))
  })

  it('continues redacting later fields when a file input rejects the custom mask', async () => {
    const root = mount('<input type="file"><input type="email" value="secret@example.com">')
    const result = await snapdom(root, { ...options, plugins: [redactInputs({ all: true, mask: () => 'MASK' })] })
    expect(xml(result).querySelector('input[type="email"]').getAttribute('value')).toBe('MASK')
    expect(result.url).not.toContain('secret%40example.com')
  })

  it('evaluates a timestamp formatter for every repeated capture', async () => {
    const root = mount('fixed content')
    let calls = 0
    const plugin = timestampOverlay({ format: () => `stamp ${++calls}` })
    const results = []
    for (let i = 0; i < 4; i++) results.push(await snapdom(root, { ...options, plugins: [plugin] }))
    expect(calls).toBe(4)
    for (let i = 0; i < 4; i++) expect(xml(results[i]).documentElement.textContent).toContain(`stamp ${i + 1}`)
    expect(root.textContent).toBe('fixed content')
  })

  it('leaves capture geometry and pixels unchanged with a transparent tint', async () => {
    const root = mount('<div style="position:absolute;right:7px;bottom:9px;width:30px;height:20px;background:red"></div>', 'position:relative;width:200px;height:100px;padding:12px;border:3px solid blue;background:#aaa;transform:rotate(10deg);transform-origin:25% 75%')
    await samePixels(await snapdom(root, options), await snapdom(root, { ...options, plugins: [colorTint({ color: 'red', opacity: 0 })] }))
  })

  it.each([
    ['filter', () => filter({ preset: 'invert' }), 'rgb(255, 0, 0)'],
    ['color tint', () => colorTint({ color: 'red' }), 'rgb(128, 128, 128)'],
  ])('memoizes a fixed %s and rebuilds it after a source mutation', async (_name, factory, background) => {
    const root = mount('')
    root.style.background = background
    const plugins = [factory()]
    const first = await snapdom(root, { ...options, plugins })
    expect(await snapdom(root, { ...options, plugins })).toBe(first)
    const original = await rgba(await snapdom(root, options))
    const transformed = await rgba(first)
    expect(Array.from(transformed.data.slice(0, 3))).not.toEqual(Array.from(original.data.slice(0, 3)))
    root.style.background = 'rgb(0, 100, 200)'
    const changed = await snapdom(root, { ...options, plugins })
    expect(changed).not.toBe(first)
    expect(changed.url).not.toBe(first.url)
    await samePixels(changed, await snapdom(root, { ...options, plugins, burst: false }))
  })

  it('tints HTML clones owned by a different window', async () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    mounted.push(frame)
    const root = frame.contentDocument.createElement('div')
    root.style.cssText = 'width:100px;height:60px;background:rgb(128,128,128)'
    frame.contentDocument.body.appendChild(root)
    expect(root instanceof HTMLElement).toBe(false)
    const result = await snapdom(root, { ...options, plugins: [colorTint({ color: 'red' })] })
    const painted = await rgba(result)
    let tinted = 0
    for (let i = 0; i < painted.data.length; i += 4) if (painted.data[i] > painted.data[i + 1] + 50 && painted.data[i] > painted.data[i + 2] + 50) tinted++
    expect(tinted).toBeGreaterThan(5000)
  })

  it('keeps textarea properties and serialized text in sync after replacement', async () => {
    const root = mount('<textarea>default</textarea>')
    const textarea = root.querySelector('textarea')
    textarea.value = 'private private'
    let seen
    const replacements = [{ find: /private/g, replace: 'public' }]
    const plugin = replaceText({ replacements })
    const observer = { name: 'observe-textarea', afterClone(ctx) { const el = ctx.clone.querySelector('textarea'); seen = [el.value, el.textContent] } }
    const first = await snapdom(root, { ...options, plugins: [plugin, observer] })
    expect(seen).toEqual(['public public', 'public public'])
    expect(xml(first).querySelector('textarea').textContent).toBe('public public')
    replacements[0].replace = 'changed'
    const second = await snapdom(root, { ...options, plugins: [plugin] })
    const third = await snapdom(root, { ...options, plugins: [plugin] })
    expect(xml(second).querySelector('textarea').textContent).toBe('changed changed')
    expect(third).not.toBe(second)
    expect(textarea.value).toBe('private private')
  })

  it('redacts textarea autocomplete tokens and its live value for later plugins', async () => {
    const root = mount('<textarea autocomplete="section-payment cc-number">default</textarea>')
    root.querySelector('textarea').value = '123456'
    let seen
    const observer = { name: 'observe-redacted-textarea', afterClone(ctx) { const el = ctx.clone.querySelector('textarea'); seen = [el.value, el.textContent] } }
    const result = await snapdom(root, { ...options, plugins: [redactInputs(), observer] })
    expect(seen).toEqual(['••••••', '••••••'])
    expect(xml(result).querySelector('textarea').textContent).toBe('••••••')
    expect(root.querySelector('textarea').value).toBe('123456')
  })

  it('memoizes the default redactor and detects same-task input value changes', async () => {
    const root = mount('<input type="email" value="private@example.com">')
    const plugins = [redactInputs()]
    const first = await snapdom(root, { ...options, plugins })
    expect(await snapdom(root, { ...options, plugins })).toBe(first)
    root.querySelector('input').value = 'next@example.com'
    const changed = await snapdom(root, { ...options, plugins })
    expect(changed).not.toBe(first)
    expect(xml(changed).querySelector('input').getAttribute('value')).toBe('•'.repeat(16))
    expect(decodeURIComponent(changed.url)).not.toContain('next@example.com')
  })

  it('reruns a custom redaction mask on unchanged captures', async () => {
    const root = mount('<input type="email" value="private@example.com">')
    let calls = 0
    const plugins = [redactInputs({ mask: () => `MASK${++calls}` })]
    for (let i = 1; i <= 4; i++) {
      const result = await snapdom(root, { ...options, plugins })
      expect(xml(result).querySelector('input').getAttribute('value')).toBe(`MASK${i}`)
    }
    expect(calls).toBe(4)
  })

  it('matches selectors on an input capture root with ancestors outside the clone', async () => {
    const host = mount('<input type="text" value="private">')
    host.className = 'sensitive-fields'
    const root = host.querySelector('input')
    const plugins = [redactInputs({ types: [], autocomplete: [], selector: '.sensitive-fields input' })]
    const first = await snapdom(root, { ...options, plugins })
    expect(xml(first).querySelector('input').getAttribute('value')).toBe('•••••••')
    host.className = ''
    const changed = await snapdom(root, { ...options, plugins })
    expect(xml(changed).querySelector('input').getAttribute('value')).toBe('private')
  })

  it.each(['top-left', 'top-right', 'bottom-left', 'bottom-right'])('paints a timestamp at %s without moving the capture', async (position) => {
    const root = mount('', 'width:200px;height:100px;background:white;position:relative;box-sizing:border-box')
    const result = await snapdom(root, { ...options, plugins: [timestampOverlay({ format: () => 'STAMP', position, background: 'rgb(255,0,0)', color: 'rgb(255,0,0)', fontSize: 10 })] })
    const painted = await rgba(result)
    expect([painted.width, painted.height]).toEqual([200, 100])
    const reds = []
    for (let i = 0; i < painted.data.length; i += 4) if (painted.data[i] > 230 && painted.data[i + 1] < 20 && painted.data[i + 2] < 20) reds.push(i / 4)
    expect(reds.length).toBeGreaterThan(400)
    const xs = reds.map((p) => p % painted.width), ys = reds.map((p) => Math.floor(p / painted.width))
    if (position.endsWith('left')) expect(Math.min(...xs)).toBe(6)
    else expect(Math.max(...xs)).toBe(193)
    if (position.startsWith('top')) expect(Math.min(...ys)).toBe(6)
    else expect(Math.max(...ys)).toBe(93)
  })
})
