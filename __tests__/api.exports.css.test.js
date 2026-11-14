import { it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { detectDrawApi } from '../src/engines/htmlInCanvas.js'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) root.remove() })
const options = { embedFonts: false, dpr: 1 }

// Fine stripes under text: a restored or resampled photo shows.
async function scene() {
  const raster = document.createElement('canvas')
  raster.width = raster.height = 400
  const ctx = raster.getContext('2d')
  for (let x = 0; x < 400; x++) {
    ctx.fillStyle = x % 2 ? '#c84' : '#246'
    ctx.fillRect(x, 0, 1, 400)
  }
  const root = document.createElement('div')
  root.style.cssText = 'position:relative;width:200px;height:120px;background:white'
  root.innerHTML = '<img style="position:absolute;inset:0;width:200px;height:120px"><b data-mark style="position:absolute;left:10px;top:40px;font:700 28px sans-serif;color:#fff">Headline</b>'
  root.querySelector('img').src = raster.toDataURL()
  document.body.append(root)
  roots.push(root)
  await root.querySelector('img').decode()
  return root
}

const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
function differing(a, b) {
  expect([a.width, a.height]).toEqual([b.width, b.height])
  const x = pixels(a), y = pixels(b)
  let n = 0
  for (let i = 0; i < x.length; i += 4) if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2] || x[i + 3] !== y[i + 3]) n++
  return n
}
const hide = 'b{color:transparent!important}'
const ring = '[data-mark]{outline:4px solid #f0f!important}'
const exportsOf = async (root) => {
  let facade
  const result = await snapdom(root, { ...options, plugins: [{ name: 'probe', defineExports(ctx) { facade = ctx.exports } }] })
  return { result, facade }
}
const sizes = [{}, { dpr: 2 }, { width: 400 }, { scale: 3 }, { crop: { x: 20, y: 30, width: 150, height: 60 } }]

it('an empty rule set draws the same pixels as none, at every size, through restore and crop', async () => {
  const { result, facade } = await exportsOf(await scene())
  for (const o of sizes) {
    expect(differing(await result.toCanvas(o), await result.toCanvas({ ...o, css: '/* none */' }))).toBe(0)
    expect(differing(await facade.canvas(o), await facade.canvas({ ...o, css: '/* none */' }))).toBe(0)
  }
})

it('a styled export at twice the size draws the restored original: its 1 px stripes survive', async () => {
  const { result } = await exportsOf(await scene())
  // Width 400 restores the original; only it keeps 1 px stripes.
  const styled = await result.toCanvas({ width: 400, css: '[data-mark]{outline:2px solid #f0f!important}' })
  const row = styled.getContext('2d').getImageData(20, 220, 360, 1).data
  let edges = 0
  for (let i = 4; i < row.length; i += 4) if (Math.abs(row[i] - row[i - 4]) > 60) edges++
  expect(edges).toBeGreaterThan(300)
})

it('an inline style with !important: the rules either win or leave that text as it was, never part of it', async () => {
  const root = await scene()
  root.querySelector('b').style.setProperty('color', 'rgb(0, 255, 0)', 'important')
  const { result } = await exportsOf(root)
  const plain = await result.toCanvas(), styled = await result.toCanvas({ css: 'b{color:transparent!important}' })
  const green = c => { const d = pixels(c); let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 200 && d[i] < 60 && d[i + 2] < 60) n++; return n }
  expect(green(plain)).toBeGreaterThan(20)
  // WebKit keeps the style inline, so it wins there.
  expect(green(styled) === 0 || differing(plain, styled) === 0).toBe(true)
})

it('the rules win over an author !important stylesheet rule in the capture', async () => {
  const root = await scene()
  root.insertAdjacentHTML('afterbegin', '<style>#x b, b[data-mark]{color:#0f0!important}</style>')
  const { result } = await exportsOf(root)
  const plain = await result.toCanvas(), hidden = await result.toCanvas({ css: hide })
  const reference = await (await snapdom(root, { ...options, burst: false })).toCanvas({ css: 'b{visibility:hidden!important}' })
  expect(differing(plain, hidden)).toBeGreaterThan(0)
  expect(differing(hidden, reference)).toBe(0)
})

it('rules with &, < and > keep the SVG well formed', async () => {
  const { result } = await exportsOf(await scene())
  const nested = await result.toCanvas({ css: 'b[data-mark]:not([title="<&>"]){color:transparent!important} b{&[data-mark]{content:"<&>"}}' })
  expect(differing(nested, await result.toCanvas({ css: hide }))).toBe(0)
})

it('concurrent exports with different rules each draw their own', async () => {
  const { facade } = await exportsOf(await scene())
  for (const o of sizes) {
    const alone = [await facade.canvas(o), await facade.canvas({ ...o, css: hide }), await facade.canvas({ ...o, css: ring })]
    const together = await Promise.all([facade.canvas(o), facade.canvas({ ...o, css: hide }), facade.canvas({ ...o, css: ring })])
    for (let k = 0; k < 3; k++) expect(differing(alone[k], together[k])).toBe(0)
    expect(differing(alone[0], alone[1])).toBeGreaterThan(0)
    expect(differing(alone[0], alone[2])).toBeGreaterThan(0)
  }
})

it('two beforeExport plugins add their rules to one export', async () => {
  const add = (name, rule) => ({ name, beforeExport(_ctx, { options }) { options.css = (options.css || '') + rule } })
  const root = await scene()
  const both = await snapdom(root, { ...options, plugins: [add('hide', hide), add('ring', ring)] })
  const plain = await snapdom(root, { ...options, burst: false })
  expect(differing(await both.toCanvas(), await plain.toCanvas({ css: hide + ring }))).toBe(0)
  expect(differing(await plain.toCanvas(), await plain.toCanvas({ css: '' }))).toBe(0)
})

it('a wrong css value rejects only its own export', async () => {
  const { result } = await exportsOf(await scene())
  const before = await result.toCanvas()
  await expect(result.toCanvas({ css: { color: 'red' } })).rejects.toThrow(/css must be a string/)
  expect(differing(before, await result.toCanvas())).toBe(0)
})

it('selectors match the page: an id, a class, an attribute and a tag name each reach the same element', async () => {
  const root = await scene()
  root.insertAdjacentHTML('beforeend', '<i id="mark" class="mark" data-mark-i style="position:absolute;left:10px;top:80px;font:700 20px sans-serif;color:#0f0">Mark</i>')
  const { result } = await exportsOf(root)
  const plain = await result.toCanvas()
  const byId = await result.toCanvas({ css: '#mark{color:transparent!important}' })
  expect(differing(plain, byId)).toBeGreaterThan(0)
  // SnapDOM adds its own classes; the page's still match.
  for (const selector of ['.mark', '[data-mark-i]', 'i']) {
    expect(differing(byId, await result.toCanvas({ css: `${selector}{color:transparent!important}` })), selector).toBe(0)
  }
})

it('the engine\'s own <style> is there and first: an empty capture, and content holding <style> and "</style>"', async () => {
  const empty = document.createElement('div')
  empty.style.cssText = 'width:40px;height:30px'
  document.body.append(empty)
  roots.push(empty)
  const blank = await snapdom(empty, options)
  expect(differing(await blank.toCanvas(), await blank.toCanvas({ css: '/* none */' }))).toBe(0)
  expect(differing(await blank.toCanvas(), await blank.toCanvas({ css: 'div{background:#f00!important}' }))).toBeGreaterThan(0)

  const root = await scene()
  root.insertAdjacentHTML('afterbegin', '<style>.decoy{color:#00f}</style><i class="decoy" title="</style>">&lt;/style&gt;</i>' +
    '<svg width="10" height="10"><style><![CDATA[ rect{fill:#0f0} ]]></style><rect width="10" height="10"/></svg>')
  const { result } = await exportsOf(root)
  const plain = await result.toCanvas()
  expect(differing(plain, await result.toCanvas({ css: '/* none */' }))).toBe(0)
  expect(differing(plain, await result.toCanvas({ css: hide }))).toBeGreaterThan(0)
  const svg = decodeURIComponent(result.url.slice(result.url.indexOf(',') + 1))
  // The engine's <style> comes first.
  expect(svg.indexOf('<style')).toBeLessThan(svg.indexOf('decoy'))
  expect(svg.indexOf('</style>')).toBeLessThan(svg.indexOf('decoy'))
})

it('a pseudo-element selector misses: the clone draws ::before as an element', async () => {
  const root = await scene()
  root.insertAdjacentHTML('afterbegin', '<style>[data-mark]::before{content:"AB";color:#0f0}</style>')
  const { result } = await exportsOf(root)
  const plain = await result.toCanvas()
  const green = c => { const d = pixels(c); let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 200 && d[i] < 60 && d[i + 2] < 60) n++; return n }
  expect(green(plain), 'the page drew its ::before').toBeGreaterThan(20)
  expect(differing(plain, await result.toCanvas({ css: '[data-mark]::before{color:transparent!important}' }))).toBe(0)
})

it('hides, does not remove: an SVG export still carries the hidden text', async () => {
  const { result } = await exportsOf(await scene())
  expect(await (await result.toBlob({ css: hide })).text()).toContain('Headline')
})

it.runIf(detectDrawApi())('a raster html-in-canvas capture refuses css on every export', async () => {
  const result = await snapdom(await scene(), { ...options, engine: 'html-in-canvas' })
  for (const k of ['toCanvas', 'toPng', 'toImg', 'toSvg', 'toBlob']) {
    await expect(result[k]({ css: hide })).rejects.toThrow(/Only SVG captures can be styled/)
    await expect(result[k]({ css: hide })).rejects.toBeInstanceOf(RangeError)
    await expect(result[k]({ css: false })).rejects.toBeInstanceOf(TypeError)
    await expect(result[k]({ css: {} })).rejects.toBeInstanceOf(TypeError)
  }
})

it('scrubs XML-illegal control characters (such as CSS form-feed whitespace) and unpaired surrogates', async () => {
  const { result } = await exportsOf(await scene())
  const ff = await result.toCanvas({ css: 'b{\fcolor:transparent!important}' })
  expect(differing(ff, await result.toCanvas({ css: hide }))).toBe(0)
  const halfEmoji = '🔥'.slice(0, 1)
  const surr = await result.toCanvas({ css: `b{color:transparent!important;content:"${halfEmoji}"}` })
  expect(differing(surr, await result.toCanvas({ css: hide }))).toBe(0)
})

it('refuses a URL that is not the engine\'s percent-encoded SVG with its <style>, as crop refuses', async () => {
  const swapped = url => {
    const root = document.body.appendChild(document.createElement('div'))
    roots.push(root)
    return snapdom(root, { ...options, plugins: [{ name: 'swap-url', afterRender(ctx) { ctx.dataURL = url(ctx.dataURL) } }] })
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40"/></svg>'
  for (const url of [
    () => 'data:image/png;base64,iVBORw0KGgo=',
    () => 'data:image/svg+xml;base64,' + btoa(svg),
    () => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
    u => u.replace('%3Cstyle', '%3Cstyle%2F%3E%3Cstyle'),
  ]) {
    const result = await swapped(url)
    await expect(result.toCanvas({ css: hide })).rejects.toThrow(/Only SVG captures can be styled/)
    await expect(result.toCanvas({ css: hide })).rejects.toBeInstanceOf(RangeError)
  }
})

it('a $ pattern in the rules survives Safari\'s shadow rewrite', async () => {
  const root = await scene()
  root.querySelector('b').style.boxShadow = '0 4px 8px #000'
  const { result } = await exportsOf(root)
  const styled = await result.toCanvas({ css: '[data-mark]::after{content:"$\'"!important}' })
  expect(differing(await result.toCanvas(), styled)).toBeGreaterThan(0)
})
