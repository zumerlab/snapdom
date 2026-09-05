import { afterEach, expect, it, vi } from 'vitest'
import { snapdom } from '../src/index.js'
import { contextExport } from '../packages/plugins/context-export.js'
import { agentMap } from '../packages/plugins/agent-map.js'
import { htmlExport } from '../packages/plugins/html-export.js'
import { __diffStats } from '../src/core/diff.js'

const nodes = []
afterEach(() => { vi.restoreAllMocks(); for (const node of nodes.splice(0)) node.remove() })
function mount(html = '') {
  const host = document.createElement('div')
  host.style.cssText = 'position:relative;width:200px;height:100px;background:white'
  host.innerHTML = html
  document.body.append(host)
  nodes.push(host)
  return host
}
const opts = { dpr: 1, embedFonts: false }
async function redPixels(url) {
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let red = 0
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 150 && pixels[i + 1] < 100 && pixels[i + 2] < 100) red++
  return red
}

it('context preserves factory format and does not expose its frozen arrays/state', async () => {
  const host = mount('<input type="checkbox" checked>')
  const result = await snapdom(host, { ...opts, plugins: [contextExport({ format: 'json' })] })
  const first = await result.toContext()
  expect(first.root).toBeDefined()
  const originalBox = [...first.root.box]
  first.root.box[0] = 999
  first.root.state.checked = false
  const next = await result.toContext()
  expect(next.root.box).toEqual(originalBox)
  expect(next.root.state.checked).toBe(true)
})

it('agent map keeps dimensions for a capture with no interactive elements', async () => {
  const result = await snapdom(mount('<p>Read only</p>'), { ...opts, plugins: [agentMap({ image: false })] })
  expect(await result.toAgentMap()).toEqual({ dimensions: { width: 200, height: 100 }, map: [] })
})

it('agent map exports independent state and attributes from the same captured instant', async () => {
  const host = mount('<input type="checkbox" checked aria-label="Original">')
  const result = await snapdom(host, { ...opts, plugins: [agentMap({ image: false, fields: 'full' })] })
  const first = await result.toAgentMap()
  first.map[0].s.checked = false
  first.map[0].a['aria-label'] = 'Edited'
  host.firstChild.checked = false
  host.firstChild.setAttribute('aria-label', 'Live change')
  const next = await result.toAgentMap()
  expect(next.map[0].s.checked).toBe(true)
  expect(next.map[0].a['aria-label']).toBe('Original')
})

it.each(['annotated', 'raw'])('agent map supports repeated raw/annotated overrides after %s capture', async image => {
  const host = mount('<button style="position:absolute;left:50px;top:20px;width:80px;height:40px;background:blue;border:0;color:white">Go</button>')
  const result = await snapdom(host, { ...opts, plugins: [agentMap({ image })] })
  host.firstChild.textContent = 'Changed after capture'
  const [raw, annotated, rawAgain] = await Promise.all([
    result.toAgentMap({ image: 'raw' }), result.toAgentMap({ image: 'annotated' }), result.toAgentMap({ image: 'raw' }),
  ])
  expect(await redPixels(raw.image)).toBe(0)
  expect(await redPixels(annotated.image)).toBeGreaterThan(100)
  expect(rawAgain.image).toBe(raw.image)
  expect(raw.map[0].n).toBe('Go')
})

it('agent map uses the clipped image coordinate system', async () => {
  const host = mount('<button style="position:absolute;left:100px;top:20px;width:40px;height:20px;padding:0;border:0">Go</button>')
  const rect = host.getBoundingClientRect()
  const result = await snapdom(host, { ...opts, clip: { x: rect.left + window.scrollX + 80, y: rect.top + window.scrollY + 10, width: 100, height: 60 }, plugins: [agentMap({ image: 'raw' })] })
  const out = await result.toAgentMap()
  expect(out.dimensions).toEqual({ width: 100, height: 60 })
  expect(out.map[0].b).toEqual([20, 10, 40, 20])
})

it('HTML export preserves author raw-text CSS when parsed as HTML', async () => {
  const host = mount('<style>.html-test > span::before { content:"A & B" }</style><span class="html-test"></span>')
  const expected = host.querySelector('style').textContent
  const result = await snapdom(host, { ...opts, plugins: [htmlExport()] })
  const html = await result.toHtml()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  expect(doc.body.querySelector('style').textContent).toBe(expected)
})

it.each(['transform:scale(2)', 'transform:rotate(90deg)', 'rotate:z 90deg', 'rotate:0.25turn', 'rotate:1.570796326794897rad'])('agent map maps the root %s into rendered coordinates', async transform => {
  const host = mount('<button style="position:absolute;left:50px;top:20px;width:40px;height:20px;padding:0;border:0;background:red"></button>')
  host.style.cssText += ';' + transform
  const result = await snapdom(host, { ...opts, plugins: [agentMap({ image: 'raw' })] })
  const out = await result.toAgentMap()
  const img = new Image()
  img.src = out.image
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const [x, y, w, h] = out.map[0].b
  expect(x + w / 2).toBeLessThan(canvas.width)
  expect(y + h / 2).toBeLessThan(canvas.height)
  const pixel = ctx.getImageData(x + w / 2, y + h / 2, 1, 1).data
  expect(pixel[0]).toBeGreaterThan(200)
  expect(pixel[1]).toBeLessThan(30)
})

it.each(['transform:scale(2)', 'scale:2'])('agent map aligns %s when outer transforms are stripped', async transform => {
  const host = mount('<button style="position:absolute;left:50px;top:20px;width:40px;height:20px;padding:0;border:0;background:red"></button>')
  host.style.cssText += ';' + transform
  const result = await snapdom(host, { ...opts, outerTransforms: false, plugins: [agentMap({ image: 'raw' })] })
  const out = await result.toAgentMap()
  expect(out.map[0].b).toEqual([result.meta.contentX + 100, result.meta.contentY + 40, 80, 40])
  const img = new Image()
  img.src = out.image
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const [x, y, w, h] = out.map[0].b
  expect([...ctx.getImageData(x + w / 2, y + h / 2, 1, 1).data]).toEqual([255, 0, 0, 255])
})

it('agent map keeps finite coordinates for a perspective root', async () => {
  const host = mount('<button>Go</button>')
  host.style.rotate = 'x 20deg'
  const result = await snapdom(host, { ...opts, plugins: [agentMap({ image: false })] })
  expect((await result.toAgentMap()).map[0].b.every(Number.isFinite)).toBe(true)
})

it.each(['jpg', 'webp'])('agent map applies the core opaque background default for %s', async imageFormat => {
  const host = mount('<button style="position:absolute;left:50px;top:20px">Go</button>')
  host.style.background = 'transparent'
  const result = await snapdom(host, { ...opts, plugins: [agentMap({ image: 'raw', imageFormat })] })
  const img = new Image()
  img.src = (await result.toAgentMap()).image
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  expect([...ctx.getImageData(0, 0, 1, 1).data]).toEqual([255, 255, 255, 255])
})

it('HTML download uses plugin filename unless this export supplies one', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const result = await snapdom(mount('Frozen HTML'), { ...opts, plugins: [htmlExport({ filename: 'plugin.html' })] })
  await result.toHtml({ download: true })
  expect(click.mock.instances[0].download).toBe('plugin.html')
  await result.toHtml({ download: true, filename: 'explicit.html' })
  expect(click.mock.instances[1].download).toBe('explicit.html')
})

it('agent map preserves custom badge CSS and skips badges for semantic entries', async () => {
  const host = mount('<h1>Heading</h1><button style="position:absolute;left:50px;top:40px;width:80px;height:40px">Go</button>')
  const plugin = agentMap({ image: 'annotated', semantic: true,
    labelStyle: { backgroundColor: 'rgb(0, 200, 0)', color: 'rgb(0, 200, 0)', width: '30px', height: '30px', borderRadius: '0', boxShadow: 'none' } })
  const out = await (await snapdom(host, { ...opts, plugins: [plugin] })).toAgentMap()
  const img = new Image()
  img.src = out.image
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const pixel = ctx.getImageData(90, 60, 1, 1).data
  expect([...pixel]).toEqual([0, 200, 0, 255])
  expect(await redPixels(out.image)).toBe(0)
  expect(out.map.find(entry => entry.r === 'heading').isSemanticOnly).toBe(true)
})

it('agent map uses export scale/DPR with aligned boxes and restores compressed detail', async () => {
  const source = document.createElement('canvas')
  source.width = source.height = 400
  const draw = source.getContext('2d')
  for (let x = 0; x < 400; x++) {
    draw.fillStyle = x % 2 ? 'white' : 'black'
    draw.fillRect(x, 0, 1, 400)
  }
  const host = mount('<button style="position:absolute;left:0;top:0;width:100px;height:100px;padding:0;border:0"><img style="display:block;width:100px;height:100px"></button>')
  host.querySelector('img').src = source.toDataURL()
  await host.querySelector('img').decode()
  const plugin = agentMap({ image: 'raw', maxImageWidth: 1000 })
  const plain = await snapdom(host, { ...opts, plugins: [plugin], compress: false })
  const compressed = await snapdom(host, { ...opts, plugins: [plugin] })
  const a = await plain.toAgentMap({ scale: 2, dpr: 2 })
  const b = await compressed.toAgentMap({ scale: 2, dpr: 2 })
  expect(b.dimensions).toEqual({ width: 800, height: 400 })
  expect(b.map[0].b).toEqual([0, 0, 400, 400])
  expect(b.image).toBe(a.image)
})

it('HTML exports stay frozen across concurrent captures, memo hits and differential updates', async () => {
  const a = mount('<section><p>Alpha</p></section>')
  const b = mount('<section><p>Beta</p></section>')
  const options = { ...opts, plugins: [htmlExport()] }
  const [first, other] = await Promise.all([snapdom(a, options), snapdom(b, options)])
  const frozen = await first.toHtml()
  expect(frozen).toContain('Alpha')
  expect(await other.toHtml()).toContain('Beta')
  expect(await snapdom(a, options)).toBe(first)
  const before = __diffStats.served
  a.querySelector('p').textContent = 'Updated'
  const next = await snapdom(a, options)
  expect(__diffStats.served).toBeGreaterThan(before)
  expect(await next.toHtml()).toContain('Updated')
  expect(await first.toHtml()).toBe(frozen)
})
