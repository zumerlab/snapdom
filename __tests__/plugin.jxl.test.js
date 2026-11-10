import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { registerPlugins, clearPlugins } from '../src/core/plugins.js'
import { jxl as plugin } from '../packages/plugins/jxl.js'
import { createCodec } from 'rapier-jxl/codec'
import { createCodec as createDecoder } from 'rapier-jxl/codec/decode'

// A real rapier-jxl encoder that records what the plugin asked of it, and where the red text is on
// the canvas it was given.
function recording(module = 'rapier-jxl/capture-complete') {
  const real = createCodec({ module })
  // Each encoder holds a worker: closed after its test, or a long run runs out of them.
  made.push(() => { real.close() })
  const calls = []
  return {
    calls,
    prepare: (kind) => real.prepare(kind),
    capture: (canvas, options) => {
      calls.push({ canvas, width: canvas.width, height: canvas.height, ink: inkOf(canvas), ...options })
      return real.capture(canvas, options)
    },
  }
}

function inkOf(canvas) {
  const { width: w, height: h } = canvas
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data
  const px = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    if (d[i] - d[i + 1] > 60 && d[i] - d[i + 2] > 60) px.push(x, y)
  }
  return px
}

// Every red pixel inside an exact rectangle, and those rectangles within `slack` of the text.
function check(call, slack = 18, photos = true) {
  const { ink, exactRects = [] } = call
  expect(ink.length, 'the fixture drew its text').toBeGreaterThan(40)
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, out = 0
  for (let i = 0; i < ink.length; i += 2) {
    const x = ink[i], y = ink[i + 1]
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    if (!exactRects.some((r) => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height)) out++
  }
  expect(out, 'red pixels outside every exact rectangle').toBe(0)
  for (const r of exactRects.filter((r) => !r.edge && r.x <= maxX && r.y <= maxY && r.x + r.width > minX && r.y + r.height > minY)) {
    expect(r.x).toBeGreaterThanOrEqual(minX - slack)
    expect(r.y).toBeGreaterThanOrEqual(minY - slack)
    expect(r.x + r.width).toBeLessThanOrEqual(maxX + 1 + slack)
    expect(r.y + r.height).toBeLessThanOrEqual(maxY + 1 + slack)
  }
  if (photos) expect(call.photoRects.length, 'the photo still takes the quality').toBeGreaterThan(0)
}

const made = []
afterEach(async () => { while (made.length) await made.pop()(); clearPlugins() })

// Every plugin a test makes closes the encoder it created afterwards.
const jxl = (options) => { const p = plugin(options); made.push(() => p.close()); return p }
// toJxl() shows JPEG XL through a decoder where the browser cannot.
const decoding = () => { const d = createDecoder({ module: 'rapier-jxl/decode' }); made.push(() => d.close()); return d }

function card(style = '', text = 'Exact text', parent = document.body) {
  const el = document.createElement('div')
  el.style.cssText = 'position:absolute;left:60px;top:60px;width:260px;height:130px;background:#fff;' +
    'font:22px sans-serif;color:rgb(230,0,0);' + style
  const photo = document.createElement('canvas')
  photo.width = 96; photo.height = 96
  photo.style.cssText = 'position:absolute;right:8px;top:14px;width:96px;height:96px'
  const g = photo.getContext('2d')
  for (let y = 0; y < 96; y += 4) for (let x = 0; x < 96; x += 4) {
    g.fillStyle = `rgb(0,${(x * 7 + y * 3) % 255},${(x * 5 + y * 9) % 255})`
    g.fillRect(x, y, 4, 4)
  }
  const span = document.createElement('span')
  span.textContent = text
  span.style.cssText = 'position:absolute;left:14px;top:50px'
  el.append(photo, span)
  parent.appendChild(el)
  made.push(() => el.remove())
  return el
}

const isJxl = (bytes) => (bytes[0] === 0xff && bytes[1] === 0x0a) ||
  (bytes[4] === 0x4a && bytes[5] === 0x58 && bytes[6] === 0x4c && bytes[7] === 0x20)

// The text box in canvas pixels: element-local CSS pixels, moved to the canvas through the capture's geometry.
function textBox(el, span, meta) {
  const e = el.getBoundingClientRect(), t = span.getBoundingClientRect()
  const x = t.left - e.left - (meta.clip?.x ?? 0) + meta.contentX
  const y = t.top - e.top - (meta.clip?.y ?? 0) + meta.contentY
  return { x, y, width: t.width, height: t.height }
}

// A rectangle covers the text and stays close to it: an offset or a stretch of the shadow's size fails.
const covers = (rects, box, slack = 12) => rects.some((r) =>
  r.x <= Math.floor(box.x) + 1 && r.y <= Math.floor(box.y) + 1 &&
  r.x + r.width >= Math.ceil(box.x + box.width) - 1 && r.y + r.height >= Math.ceil(box.y + box.height) - 1 &&
  r.x >= box.x - slack && r.y >= box.y - slack &&
  r.x + r.width <= box.x + box.width + slack && r.y + r.height <= box.y + box.height + slack)

async function run(el, captureOptions = {}, exportOptions = {}) {
  const codec = recording()
  const result = await snapdom(el, { plugins: [jxl({ codec })], ...captureOptions })
  await result.toBlob({ format: 'jxl', dpr: 1, quality: 0.8, ...exportOptions })
  return { result, call: codec.calls[0], codec }
}

describe('jxl plugin', () => {
  let el, span

  beforeEach(() => {
    el = document.createElement('div')
    el.style.cssText = 'position:absolute;left:40px;top:40px;width:240px;height:120px;background:#fff;' +
      'box-shadow:-36px -28px 0 4px rgba(0,0,0,.4);font:20px sans-serif;color:#111;padding:0'
    const photo = document.createElement('canvas')
    photo.width = 96; photo.height = 96
    photo.style.cssText = 'position:absolute;right:8px;top:12px;width:96px;height:96px'
    const g = photo.getContext('2d')
    for (let y = 0; y < 96; y += 4) for (let x = 0; x < 96; x += 4) {
      g.fillStyle = `rgb(${(x * 7 + y * 3) % 255},${(x * 2 + y * 9) % 255},${(x * 5 + y) % 255})`
      g.fillRect(x, y, 4, 4)
    }
    span = document.createElement('span')
    span.textContent = 'Exact text'
    span.style.cssText = 'position:absolute;left:14px;top:46px'
    el.append(photo, span)
    document.body.appendChild(el)
  })

  afterEach(() => { el.remove() })

  it('is a pure plugin with JPEG XL exports', () => {
    const p = jxl()
    expect(p.name).toBe('jxl')
    expect(p.pure).toBe(true)
    expect(typeof p.afterClone).toBe('function')
    expect(jxl({ module: 'rapier-jxl/capture', codec: recording('rapier-jxl/capture') }).afterClone).toBeUndefined()
    const exports = p.defineExports({ exports: {} })
    expect(Object.keys(exports).sort()).toEqual(['blob', 'download', 'jxl'])
  })

  it('the upload module encodes with your codec; an unknown module is refused', async () => {
    expect(() => jxl({ module: 'rapier-jxl' })).toThrow(/module/)
    // One codec door: the exact and upload encoders come as your own codec.
    expect(() => jxl({ module: 'rapier-jxl/upload' })).toThrow(/rapier-jxl\/codec\/upload/)
    const codec = createCodec({ module: 'rapier-jxl/upload' })
    made.push(() => codec.close())
    const result = await snapdom(el, { plugins: [jxl({ module: 'rapier-jxl/upload', codec })] })
    expect((await result.toBlob({ format: 'jxl', dpr: 1, quality: 0.8 })).type).toBe('image/jxl')
  })

  it('toBlob({ format: "jxl" }) gives a JPEG XL file; other formats stay SnapDOM\'s', async () => {
    const result = await snapdom(el, { plugins: [jxl()] })
    const file = await result.toBlob({ format: 'jxl', dpr: 1 })
    expect(file.type).toBe('image/jxl')
    expect(isJxl(new Uint8Array(await file.arrayBuffer()))).toBe(true)
    const png = await result.toBlob({ format: 'png', dpr: 1 })
    expect(png.type).toBe('image/png')
  })

  it('keeps the text rectangles on the text when an outer shadow moves the content', async () => {
    const codec = recording()
    const result = await snapdom(el, { plugins: [jxl({ codec })], outerShadows: true })
    expect(result.meta.contentX).toBeGreaterThan(20)
    expect(result.meta.contentY).toBeGreaterThan(20)
    await result.toBlob({ format: 'jxl', dpr: 1, quality: 0.8 })
    const [call] = codec.calls
    expect(call.width).toBe(Math.floor(result.meta.vbW))
    expect(call.exactRects.length).toBeGreaterThan(0)
    expect(call.photoRects.length).toBeGreaterThan(0)
    expect(covers(call.exactRects, textBox(el, span, result.meta))).toBe(true)
  })

  it('keeps the text rectangles on the text inside a clip window', async () => {
    const codec = recording()
    // The clip option is in page coordinates; this window holds the text whole.
    const box = el.getBoundingClientRect()
    const clip = { x: box.left + scrollX + 6, y: box.top + scrollY + 30, width: 180, height: 60 }
    const result = await snapdom(el, { plugins: [jxl({ codec })], clip })
    expect(result.meta.clip).not.toBeNull()
    await result.toBlob({ format: 'jxl', dpr: 1, quality: 0.8 })
    expect(covers(codec.calls[0].exactRects, textBox(el, span, result.meta))).toBe(true)
  })

  it('measures an unchanged repeat capture the same way', async () => {
    const codec = recording()
    const plugin = jxl({ codec })
    const first = await snapdom(el, { plugins: [plugin] })
    await first.toBlob({ format: 'jxl', dpr: 1, quality: 0.8 })
    const second = await snapdom(el, { plugins: [plugin] })
    await second.toBlob({ format: 'jxl', dpr: 1, quality: 0.8 })
    expect(codec.calls).toHaveLength(2)
    expect(codec.calls[1].exactRects).toEqual(codec.calls[0].exactRects)
    expect(codec.calls[1].photoRects).toEqual(codec.calls[0].photoRects)
  })

  it('quality 1 is exact', async () => {
    const codec = recording()
    const result = await snapdom(el, { plugins: [jxl({ codec })] })
    let record = null
    await result.toBlob({ format: 'jxl', dpr: 1, quality: 1, onEncoded: (r) => { record = r } })
    expect(codec.calls[0].fidelity).toBe('exact')
    expect(record.exact).toBe(true)
  })

  it('toJxl() returns an image at the capture\'s size', async () => {
    const result = await snapdom(el, { plugins: [jxl({ decoder: decoding() })] })
    const img = await result.toJxl({ dpr: 1 })
    expect(img).toBeInstanceOf(HTMLImageElement)
    expect(img.naturalWidth).toBe(Math.floor(result.meta.vbW))
  })

  it('an export effort above the preset finds the edges measured with the page', async () => {
    el.style.border = '3px solid #333'
    const codec = recording()
    const result = await snapdom(el, { plugins: [jxl({ codec })] })
    el.style.border = '0' // the page changes before the export
    await result.toBlob({ format: 'jxl', dpr: 1, quality: 0.8, effort: 5 })
    const edges = codec.calls[0].exactRects.filter((r) => r.edge)
    const { vbW, vbH } = result.meta
    expect(edges.length).toBeGreaterThan(0)
    expect(edges.some((r) => r.width >= Math.floor(vbW) && r.height >= Math.floor(vbH))).toBe(false)
    expect(edges.some((r) => r.x <= 1 && r.width <= 5)).toBe(true) // the left border as it was captured
  })

  it('efforts 6-9 need no JPEG XL decoder', async () => {
    const wolf = Object.assign(document.createElement('img'), { src: '/demos/assets/wolf.jpg' })
    wolf.style.cssText = 'position:absolute;left:120px;top:0;width:120px;height:120px'
    el.append(wolf)
    await wolf.decode()
    const encode = async (codec) => {
      let file = null
      const spy = { prepare: (k) => codec.prepare(k), capture: async (c, o) => (file = await codec.capture(c, o)) }
      const result = await snapdom(el, { plugins: [jxl({ codec: spy })] })
      const blob = await result.toBlob({ format: 'jxl', dpr: 1, quality: 0.8, effort: 7 })
      expect(file.measurements.map((m) => m.domain)).not.toContain('decoded-output')
      return new Uint8Array(await blob.arrayBuffer())
    }
    // Text and photo rectangles measure photos on the encoder's own reconstruction: the default worker
    // (no decoder on a browser without JPEG XL) and a module given a decoder write the same file.
    const own = createCodec({ module: 'rapier-jxl/capture-complete' })
    made.push(() => own.close())
    const worker = await encode(own)
    const direct = await import('rapier-jxl/capture-complete')
    const { decode } = await import('rapier-jxl/decode')
    direct.configureDecoder(decode)
    try {
      expect(await encode(direct)).toEqual(worker)
    } finally { direct.configureDecoder(null) }
  })

  it('an aborted export rejects with the signal\'s reason', async () => {
    const result = await snapdom(el, { plugins: [jxl()] })
    const controller = new AbortController()
    const reason = new Error('stopped')
    controller.abort(reason)
    await expect(result.toBlob({ format: 'jxl', signal: controller.signal })).rejects.toBe(reason)
  })
})

describe('jxl plugin: text rectangles stay on the text', () => {
  it('plain card', async () => {
    const { call } = await run(card())
    check(call, 18)
  })

  for (const [name, shadow] of [
    ['left and top', '-30px -24px 0 4px'], ['right and bottom', '30px 24px 0 4px'],
    ['all sides', '0 0 0 22px'], ['blurred', '12px -10px 16px 2px'],
  ]) {
    it(`outer shadow, ${name}`, async () => {
      const { call, result } = await run(card(`box-shadow:${shadow} rgba(0,0,0,.4)`), { outerShadows: true })
      expect(call.width).toBe(Math.floor(result.meta.vbW))
      check(call, 18)
    })
  }

  for (const outerTransforms of [true, false]) {
    for (const [name, t, extra = ''] of [['rotated', 'rotate(9deg)'], ['scaled', 'scale(1.5)'], ['skewed', 'skewX(12deg)'],
      ['rotated about a corner', 'rotate(-14deg)', 'transform-origin:0 0'], ['translated', 'translate(30px, 10px)']]) {
      it(`${name} root, outerTransforms ${outerTransforms}`, async () => {
        const { call } = await run(card(`transform:${t};${extra}`), { outerTransforms })
        // Without the rotation, the page's rotated text box turns back into a larger one (Firefox draws the
        // glyphs a pixel further inside it).
        check(call, !outerTransforms && t.startsWith('rotate') ? 42 : 22)
      })
    }
  }

  it('root with the individual rotate and scale properties', async () => {
    const { call } = await run(card('rotate:7deg;scale:1.2'))
    check(call, 22)
  })

  it('inside a scaled ancestor', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:0;top:0;transform:scale(0.6);transform-origin:0 0'
    document.body.appendChild(host); made.push(() => host.remove())
    const { call } = await run(card('', 'Exact text', host))
    check(call, 22)
  })

  it('clip window inside the card', async () => {
    const el = card()
    const b = el.getBoundingClientRect()
    const clip = { x: b.left + scrollX + 6, y: b.top + scrollY + 30, width: 220, height: 80 }
    const { call } = await run(el, { clip })
    // Safari keeps a second rectangle where SnapDOM means the text, since WebKit draws it at the element's
    // corner instead (WebKit 26, 47 px apart here): that one may graze the ink.
    const safari = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent)
    check(call, safari ? 48 : 18)
  })

  it('clip window at the card\'s edge', async () => {
    const el = card()
    const b = el.getBoundingClientRect()
    const clip = { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height }
    const { call } = await run(el, { clip })
    check(call, 18)
  })

  it('clip window on a rotated root', async () => {
    const el = card('transform:rotate(6deg)')
    const b = el.getBoundingClientRect()
    const clip = { x: b.left + scrollX + 4, y: b.top + scrollY + 20, width: 240, height: 110 }
    const { call } = await run(el, { clip })
    check(call, 22)
  })

  for (const scale of [0.5, 2]) {
    it(`capture scale ${scale}`, async () => {
      const { call } = await run(card(), { scale })
      check(call, 18 * scale + 2)
    })
    it(`export scale ${scale}`, async () => {
      const { call } = await run(card(), {}, { scale })
      check(call, 18 * scale + 2)
    })
  }

  for (const [name, size] of [['width', { width: 520 }], ['height', { height: 260 }], ['width and height', { width: 520, height: 200 }]]) {
    it(`capture ${name}`, async () => {
      const { call } = await run(card(), size)
      check(call, 40)
    })
    it(`export ${name}`, async () => {
      const { call } = await run(card(), {}, size)
      check(call, 40)
    })
  }

  for (const dpr of [1, 2, 3]) {
    it(`dpr ${dpr}`, async () => {
      const { call } = await run(card(), {}, { dpr })
      expect(call.width).toBe(260 * dpr)
      check(call, 18 * dpr)
    })
  }

  it('capture width and height, drawn the Safari way (stretched, not fitted)', async () => {
    // Gecko fits any svg image drawn into another shape, so a Safari user agent there is drawn fitted.
    if (CSS.supports('-moz-appearance', 'none')) return
    const ua = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent')
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', configurable: true })
    made.push(() => { delete navigator.userAgent; void ua })
    const { call } = await run(card(), { width: 520, height: 200 })
    check(call, 40)
  })

  // WebKit draws a clip window's positioned boxes as if it began at the element's corner (WebKit 26):
  // in Safari the text keeps an exact rectangle there too.
  it('a clip window in Safari also protects the text where WebKit draws it', async () => {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', configurable: true })
    made.push(() => { delete navigator.userAgent })
    const el = card()
    const b = el.getBoundingClientRect()
    const { call, result } = await run(el, { clip: { x: b.left + scrollX + 6, y: b.top + scrollY + 30, width: 220, height: 80 } })
    const span = el.querySelector('span')
    expect(covers(call.exactRects, textBox(el, span, result.meta)), 'where SnapDOM means it').toBe(true)
    expect(covers(call.exactRects, textBox(el, span, { contentX: 0, contentY: 0, clip: null })), 'where WebKit draws it').toBe(true)
  })

  it('an export crop off the origin keeps the text on its rectangles', async () => {
    // The text sits over the photo's band; the crop is a window of the viewBox lower and to the right.
    const el = card('', 'Cropped text')
    el.querySelector('span').style.cssText = 'position:absolute;left:120px;top:70px'
    const { call } = await run(el, {}, { crop: { x: 100, y: 50, width: 150, height: 60 } })
    expect(call.width).toBe(150)
    // WebKit draws the window from the capture's corner instead (SnapDOM 3.7.2), so there the file stays exact.
    if (/AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent)) return expect(call.fidelity).toBe('exact')
    check(call, 18)
  })

  it('an explicit small width (below 1:1)', async () => {
    const { call } = await run(card(), {}, { width: 130 })
    expect(call.width).toBe(130)
    check(call, 10)
  })
})

const exportOf = (result, options = {}) => result.toBlob({ format: 'jxl', dpr: 1, quality: 0.8, ...options })

describe('jxl plugin: SnapDOM features', () => {
  // SnapDOM 3.7.2 draws <html> without the top margins that collapse through its first children, <body>'s own
  // included, so its text is not where the page has it: such a capture stays exact. Without them it is measured.
  for (const [name, bodyCss, firstMargin, exact] of [['no collapsing margin', 'margin:0', 0, false],
    ['a collapsing first margin', 'margin:0', 14, true], ['body margin 8px', 'margin:8px', 0, true]]) {
    it(`captures document.documentElement with ${name}`, async () => {
      const saved = document.body.style.cssText
      document.body.style.cssText = bodyCss
      made.push(() => { document.body.style.cssText = saved })
      const top = document.createElement('div')
      top.style.cssText = `margin-top:${firstMargin}px;height:240px`
      const flow = card('position:relative;left:0;top:0;margin:0 0 0 20px')
      document.body.prepend(top, flow)
      made.push(() => top.remove())
      const codec = recording()
      const result = await snapdom(document.documentElement, { plugins: [jxl({ codec })] })
      await exportOf(result)
      if (exact) expect(codec.calls[0].fidelity).toBe('exact')
      else check(codec.calls[0], 18)
    })
  }

  it('captures document.documentElement and document.body', async () => {
    const el = card()
    const saved = document.body.style.cssText
    document.body.style.cssText = 'margin:0'
    made.push(() => { document.body.style.cssText = saved })
    for (const root of [document.documentElement, document.body]) {
      const codec = recording()
      const result = await snapdom(root, { plugins: [jxl({ codec })] })
      await exportOf(result)
      check(codec.calls[0], 18)
      void el
    }
  })

  it('backgroundColor null and set', async () => {
    for (const backgroundColor of [null, '#ffeedd']) {
      const codec = recording()
      const result = await snapdom(card('background:transparent'), { plugins: [jxl({ codec })] })
      await exportOf(result, { backgroundColor })
      check(codec.calls[0])
    }
  })

  it('webfonts', async () => {
    const style = document.createElement('style')
    style.textContent = "@font-face{font-family:SD1Inter;font-weight:700;src:url(/__tests__/fixtures/fonts/inter-700.woff2) format('woff2')}"
    document.head.append(style)
    made.push(() => style.remove())
    await document.fonts.load('700 26px SD1Inter')
    const codec = recording()
    const result = await snapdom(card('font:700 26px SD1Inter'), { plugins: [jxl({ codec })] })
    await exportOf(result)
    check(codec.calls[0], 24)
  })

  it('images: <img> and CSS backgrounds are photos', async () => {
    const el = card()
    el.querySelector('canvas').remove()
    const img = Object.assign(document.createElement('img'), { src: '/demos/assets/wolf.jpg' })
    img.style.cssText = 'position:absolute;right:8px;top:14px;width:96px;height:48px'
    const bg = document.createElement('div')
    bg.style.cssText = 'position:absolute;right:8px;top:70px;width:96px;height:48px;background:url(/demos/assets/wolf.jpg) center/cover'
    el.append(img, bg)
    await img.decode()
    const codec = recording()
    const result = await snapdom(el, { plugins: [jxl({ codec })] })
    await exportOf(result)
    check(codec.calls[0])
    expect(codec.calls[0].photoRects.length).toBeGreaterThanOrEqual(2)
  })

  it('a same-origin <iframe> stays exact', async () => {
    const el = card()
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:absolute;left:10px;top:90px;width:120px;height:36px;border:0'
    frame.srcdoc = '<body style="margin:0;font:16px sans-serif;color:rgb(230,0,0)">framed</body>'
    await new Promise((resolve) => { frame.onload = resolve; el.append(frame) })
    const codec = recording()
    const result = await snapdom(el, { plugins: [jxl({ codec })] })
    await exportOf(result)
    check(codec.calls[0], 40)
  })

  it('engine html-in-canvas', async () => {
    const codec = recording()
    const result = await snapdom(card(), { plugins: [jxl({ codec })], engine: 'html-in-canvas' })
    await exportOf(result)
    check(codec.calls[0])
  })

  it('a recapture after the page changed follows the new text', async () => {
    const el = card()
    const codec = recording()
    const plugin = jxl({ codec })
    await exportOf(await snapdom(el, { plugins: [plugin] }))
    el.querySelector('span').style.top = '90px'
    await exportOf(await snapdom(el, { plugins: [plugin] }))
    el.querySelector('span').textContent = 'Changed text'
    await exportOf(await snapdom(el, { plugins: [plugin] }))
    for (const call of codec.calls) check(call)
    expect(codec.calls[1].exactRects).not.toEqual(codec.calls[0].exactRects)
  })

  it('a delayed export from an older result uses the page as it was captured', async () => {
    const el = card()
    const codec = recording()
    const plugin = jxl({ codec })
    const older = await snapdom(el, { plugins: [plugin] })
    el.querySelector('span').style.top = '90px'
    const newer = await snapdom(el, { plugins: [plugin] })
    await exportOf(older)
    await exportOf(newer)
    check(codec.calls[0]); check(codec.calls[1])
  })

  it('two results export at once', async () => {
    const codec = recording()
    const plugin = jxl({ codec })
    const a = await snapdom(card(), { plugins: [plugin] })
    const b = await snapdom(card('left:400px;top:300px', 'Other words'), { plugins: [plugin] })
    const [fa, fb] = await Promise.all([exportOf(a), exportOf(b)])
    expect(fa.type).toBe('image/jxl'); expect(fb.type).toBe('image/jxl')
    for (const call of codec.calls) check(call)
  })

  it('a globally registered plugin', async () => {
    const codec = recording()
    registerPlugins(jxl({ codec }))
    const result = await snapdom(card())
    expect(typeof result.toJxl).toBe('function')
    await exportOf(result)
    check(codec.calls[0])
  })

  it('two instances with different modules', async () => {
    const exact = recording('rapier-jxl/capture'), mixed = recording()
    const a = await snapdom(card(), { plugins: [jxl({ module: 'rapier-jxl/capture', codec: exact })] })
    const b = await snapdom(card(), { plugins: [jxl({ codec: mixed })] })
    await exportOf(a); await exportOf(b)
    expect(exact.calls[0].fidelity).toBe('exact')
    check(mixed.calls[0])
  })

  it('helpers', async () => {
    for (const helpers of [true, false, { count: 2, memoryBytes: 256 << 20 }]) {
      const result = await snapdom(card(), { plugins: [jxl({ helpers })] })
      expect((await exportOf(result, { effort: 5 })).type).toBe('image/jxl')
    }
  })

  it('aborting while drawing and while encoding keeps the reason', async () => {
    const result = await snapdom(card(), { plugins: [jxl()] })
    const drawing = new AbortController(), reason = new Error('drawing')
    const p = exportOf(result, { signal: drawing.signal })
    queueMicrotask(() => drawing.abort(reason))
    await expect(p).rejects.toBe(reason)
    const encoding = new AbortController(), why = new Error('encoding')
    await expect(exportOf(result, { effort: 5, signal: encoding.signal, onProgress: () => encoding.abort(why) })).rejects.toBe(why)
  })

  it('onProgress rises to 1 and onEncoded runs once, at 1:1 and below it', async () => {
    for (const options of [{}, { width: 130 }]) {
      const result = await snapdom(card(), { plugins: [jxl()] })
      const seen = [], records = []
      await exportOf(result, { ...options, onProgress: (f) => seen.push(f), onEncoded: (r) => records.push(r) })
      expect(seen.at(-1)).toBe(1)
      for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
      expect(records).toHaveLength(1)
    }
  })

  it('download names the file', async () => {
    const names = []
    const click = HTMLAnchorElement.prototype.click
    const hrefs = []
    HTMLAnchorElement.prototype.click = function () { names.push(this.download); hrefs.push(this.href.slice(0, 15)) }
    made.push(() => { HTMLAnchorElement.prototype.click = click })
    const result = await snapdom(card(), { plugins: [jxl()] })
    await result.download({ format: 'jxl', filename: 'card' })
    await result.download({ format: 'jxl', filename: 'card.jxl' })
    await result.download({ format: 'jxl', filename: 'card.png' })
    await result.download({ format: 'png', filename: 'card' })
    await result.download({ format: 'jpg', filename: 'card' })
    expect(names).toEqual(['card.jxl', 'card.jxl', 'card.jxl', 'card.png', 'card.jpeg'])
    // PNG and JPEG are SnapDOM's own download (its anchor takes the canvas's data URL).
    // PNG and JPEG are saved as SnapDOM saves them: its encoder's Blob, its file name.
    expect(hrefs.slice(3).every((h) => h.startsWith('blob:'))).toBe(true)
  })

  it('other toBlob formats stay SnapDOM\'s', async () => {
    const result = await snapdom(card(), { plugins: [jxl()] })
    const plain = await snapdom(card())
    for (const format of ['png', 'jpeg', 'webp', 'svg']) {
      expect((await result.toBlob({ format })).type).toBe((await plain.toBlob({ format })).type)
    }
  })

  it('a page past the canvas limit is drawn smaller and keeps its text exact', async () => {
    // What the plugin asks for is the question here; the real 34,000 px encode is a stress run.
    const calls = []
    const codec = { prepare: async () => {}, capture: async (canvas, o) => { calls.push({ height: canvas.height, ...o }); return { fits: true, bytes: new Uint8Array([0xff, 0x0a]) } } }
    const result = await snapdom(card('height:34000px'), { plugins: [jxl({ codec })] })
    await exportOf(result)
    expect(calls[0].height).toBeLessThan(34000)
    expect(calls[0].fidelity).toBe('exact')
  })
})

describe('jxl plugin: cancellation and saving', () => {
  // Counts every way a download could leave the page.
  function watchSaving() {
    const seen = { clicks: 0, urls: 0, revoked: 0, shares: 0 }, ours = new Set(), waiting = []
    const { click } = HTMLAnchorElement.prototype, { createObjectURL, revokeObjectURL } = URL
    HTMLAnchorElement.prototype.click = function () { seen.clicks++ }
    URL.createObjectURL = (b) => { seen.urls++; const u = createObjectURL(b); ours.add(u); return u }
    URL.revokeObjectURL = (u) => {
      if (ours.has(u)) seen.revoked++
      revokeObjectURL(u)
      for (const w of waiting.filter((w) => seen.revoked >= w.n)) { waiting.splice(waiting.indexOf(w), 1); w.resolve() }
    }
    made.push(() => { HTMLAnchorElement.prototype.click = click; URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL })
    // Resolves once n of the page's object URLs are revoked.
    Object.defineProperty(seen, 'revokedAll', { value: (n) => seen.revoked >= n ? Promise.resolve() : new Promise((resolve) => waiting.push({ n, resolve })) })
    return seen
  }

  it('an encoder that finishes after the abort loses to it, and nothing is saved', async () => {
    const real = createCodec({ module: 'rapier-jxl/capture-complete' })
    made.push(() => real.close())
    let late = null
    const codec = {
      prepare: (k) => real.prepare(k),
      // Ignores the signal: waits for the abort, then answers with a good file.
      capture: async (canvas, options) => {
        const { signal: _signal, ...rest } = options
        const file = await real.capture(canvas, rest)
        if (late) late()
        return file
      },
    }
    const result = await snapdom(card(), { plugins: [jxl({ codec })] })
    const seen = watchSaving()
    for (const run of [(o) => result.toBlob({ format: 'jxl', ...o }), (o) => result.download({ format: 'jxl', filename: 'x', ...o })]) {
      const controller = new AbortController(), reason = new Error('stop')
      late = () => controller.abort(reason)
      await expect(run({ signal: controller.signal })).rejects.toBe(reason)
    }
    expect(seen).toEqual({ clicks: 0, urls: 0, revoked: 0, shares: 0 })
    late = null
    expect((await result.toBlob({ format: 'jxl' })).type).toBe('image/jxl')
  })

  it('a download whose anchor fails rejects and still revokes its URL', async () => {
    const result = await snapdom(card(), { plugins: [jxl()] })
    const seen = watchSaving()
    // Only the anchor fails: SnapDOM itself mounts helpers in <body> while it draws (Safari).
    const append = document.body.appendChild
    document.body.appendChild = function (node) { if (node instanceof HTMLAnchorElement) throw new Error('append'); return append.call(this, node) }
    await expect(result.download({ format: 'jxl', filename: 'a' })).rejects.toThrow('append')
    document.body.appendChild = append
    HTMLAnchorElement.prototype.click = () => { throw new Error('click') }
    await expect(result.download({ format: 'jxl', filename: 'b' })).rejects.toThrow('click')
    await seen.revokedAll(2)
    expect(seen.urls).toBe(2)
    expect(seen.revoked).toBe(2)
    expect(document.querySelectorAll('a[download]').length).toBe(0)
    expect((await result.toBlob({ format: 'jxl' })).type).toBe('image/jxl')
  })

  it('on iOS a refused share rejects; closing the sheet does not', async () => {
    const result = await snapdom(card(), { plugins: [jxl()] })
    const seen = watchSaving()
    let refusal = null
    const stub = { userAgentData: { platform: 'iOS' }, canShare: () => true, share: async () => { seen.shares++; if (refusal) throw refusal } }
    for (const [k, value] of Object.entries(stub)) Object.defineProperty(navigator, k, { value, configurable: true })
    made.push(() => { for (const k of Object.keys(stub)) delete navigator[k] })
    for (const name of ['NotAllowedError', 'DataError']) {
      refusal = new DOMException('refused', name)
      await expect(result.download({ format: 'jxl', filename: 'c' })).rejects.toBe(refusal)
    }
    refusal = new DOMException('closed', 'AbortError')
    await result.download({ format: 'jxl', filename: 'c' })
    refusal = null
    await result.download({ format: 'png', filename: 'c' })
    expect(seen.shares).toBe(4)
    expect(seen.clicks).toBe(0)
    expect((await result.toBlob({ format: 'jxl' })).type).toBe('image/jxl')
    expect((await result.toBlob({ format: 'png' })).type).toBe('image/png')
  })
})

// Where a photo is on the canvas the encoder receives, and whether an exact rectangle lies over it.
const over = (r, p, inset = 2) => r.x < p.x + p.width - inset && r.y < p.y + p.height - inset &&
  r.x + r.width > p.x + inset && r.y + r.height > p.y + inset

describe('jxl plugin: what the page clips and leaves out', () => {
  it('a shadow entering an overflow box from text clipped out of it is covered', async () => {
    const el = card('', '')
    const box = document.createElement('div')
    box.style.cssText = 'position:absolute;left:14px;top:40px;width:120px;height:40px;overflow:hidden;font:22px sans-serif'
    box.innerHTML = '<span style="position:relative;left:-110px;color:#fff;text-shadow:120px 0 0 rgb(230,0,0)">Shadow</span>'
    el.appendChild(box)
    // The reach is the same on every side, so the 40 px box bounds it.
    check((await run(el)).call, 24)
  })

  it('nothing for what SnapDOM leaves out: exclude, data-capture="exclude", filter and unslotted children', async () => {
    const el = card()
    const onPhoto = (html) => {
      const d = document.createElement('div')
      d.style.cssText = 'position:absolute;left:160px;top:24px;font:16px sans-serif'
      d.innerHTML = html
      el.appendChild(d)
      return d
    }
    onPhoto('<span class="secret">Secret</span>')
    onPhoto('<span data-capture="exclude" style="position:absolute;top:24px">Hidden</span>')
    onPhoto('<span class="filtered" style="position:absolute;top:48px;border:2px solid #222">Gone</span>')
    const host = onPhoto('<span style="position:absolute;top:66px">Unslotted</span>')
    host.attachShadow({ mode: 'open' }).innerHTML = '<i></i>'
    const shot = document.createElement('canvas')
    shot.width = shot.height = 30
    shot.dataset.capture = 'exclude'
    shot.style.cssText = 'position:absolute;left:10px;top:10px;width:30px;height:30px'
    el.appendChild(shot)
    const codec = recording()
    const result = await snapdom(el, { plugins: [jxl({ codec })], exclude: ['.secret'], filter: (n) => !n.classList?.contains('filtered') })
    await exportOf(result, { effort: 4 })
    const call = codec.calls[0]
    check(call)
    expect(call.exactRects.filter((r) => over(r, call.photoRects.find((p) => p.x > 100))), 'exact rectangles over the photo').toEqual([])
    expect(call.photoRects.filter((p) => p.x < 50), 'the excluded canvas').toEqual([])
  })

  it('SVG <image> is a photo; background-clip: text is not', async () => {
    const el = card()
    el.querySelector('canvas').remove()
    el.insertAdjacentHTML('beforeend',
      '<svg width="96" height="96" style="position:absolute;right:8px;top:14px"><image href="/demos/assets/wolf.jpg" width="96" height="96" preserveAspectRatio="xMidYMid slice"/></svg>' +
      '<div style="position:absolute;left:14px;top:90px;font:bold 28px sans-serif;background:url(/demos/assets/wolf.jpg) center/cover;' +
      '-webkit-background-clip:text;background-clip:text;color:transparent">Clipped</div>')
    const codec = recording()
    const result = await snapdom(el, { plugins: [jxl({ codec })] })
    await exportOf(result)
    const { photoRects } = codec.calls[0]
    expect(photoRects.some((p) => p.x >= 150 && p.width >= 90 && p.height >= 90), 'the SVG image').toBe(true)
    expect(photoRects.filter((p) => p.x < 100), 'the clipped text').toEqual([])
  })
  it('text and borders scrolled out of an overflow box stay out; an absolute child escapes a static one', async () => {
    const el = card('', '')
    const scroller = document.createElement('div')
    scroller.style.cssText = 'position:absolute;left:14px;top:10px;width:130px;height:40px;overflow:auto'
    scroller.innerHTML = '<div style="position:relative;height:300px">' +
      '<span style="position:absolute;left:4px;top:60px">Shown</span>' +
      '<span style="position:absolute;left:150px;top:120px;border:2px solid #222">Hidden</span></div>'
    // A static overflow box does not clip an absolute child whose containing block is the card.
    const box = document.createElement('div')
    box.style.cssText = 'margin:84px 0 0 14px;width:20px;height:10px;overflow:hidden'
    box.innerHTML = '<span style="position:absolute;left:14px;top:90px">Escapes</span>'
    el.append(scroller, box)
    scroller.scrollTop = 55
    const codec = recording()
    const result = await snapdom(el, { plugins: [jxl({ codec, effort: 4 })] })
    await exportOf(result, { effort: 4 })
    const call = codec.calls[0]
    check(call)
    const photo = call.photoRects[0]
    expect(call.exactRects.filter((r) => over(r, photo)), 'exact rectangles over the photo').toEqual([])
  })
})

// Text a browser paints without a text node of its own, in red: every red pixel lies in an exact rectangle.
describe('jxl plugin: generated text and controls', () => {
  const sheet = (css) => {
    const s = document.createElement('style')
    s.textContent = css
    document.head.appendChild(s); made.push(() => s.remove())
  }
  const inCard = async (html, css = '') => {
    if (css) sheet(css)
    const el = card('', '')
    const box = document.createElement('div')
    box.style.cssText = 'position:absolute;left:14px;top:14px;width:130px;height:110px;font:16px sans-serif'
    box.innerHTML = html
    el.appendChild(box)
    return run(el)
  }

  it('list markers: right to left, vertical, display list-item and a custom ::marker', async () => {
    const { call } = await inCard(
      '<ul style="direction:rtl;margin:0;padding:0 26px 0 0;list-style:disc"><li style="color:#fff">x</li></ul>' +
      '<ul style="writing-mode:vertical-rl;height:60px;margin:0;padding:22px 0 0;list-style:square;position:absolute;right:10px;top:14px"><li style="color:#fff">x</li></ul>' +
      '<div style="display:list-item;list-style:decimal inside;color:#fff;margin-top:6px">x</div>' +
      '<ul style="margin:6px 0 0;padding-left:30px"><li class="m" style="color:#fff">x</li></ul>',
      'ul,div{--m:rgb(230,0,0)} li::marker,div::marker{color:var(--m)} .m::marker{content:"\\2605  "}')
    // A marker's box reaches 3 em either side of where the line starts.
    check(call, 3 * 16 + 2)
  })

  it('a positioned ::after badge outside its host', async () => {
    const { call } = await inCard('<div class="badge" style="position:absolute;left:10px;top:40px;width:30px;height:20px"></div>',
      '.badge::after{content:"NEW";position:absolute;left:44px;top:-24px;font:bold 14px sans-serif;color:rgb(230,0,0)}')
    check(call)
  })

  for (const [name, position] of [['a fixed', 'fixed'], ['an absolute', 'absolute']]) {
    it(`${name} ::after whose containing block is a transformed host`, async () => {
      const { call } = await inCard('<div class="moved" style="width:30px;height:16px;margin:30px 0 0 50px;transform:translateZ(0)"></div>',
        `.moved::after{content:"Moved";position:${position};left:0;top:40px;font:bold 14px sans-serif;color:rgb(230,0,0)}`)
      check(call)
    })
  }

  it('a positioned ::after under a scaled host is placed at the drawn scale', async () => {
    const { call } = await inCard('<div class="big" style="position:relative;width:15px;height:8px;transform:scale(2);transform-origin:0 0"></div>',
      '.big::after{content:"Big";position:absolute;left:24px;top:30px;font:bold 8px sans-serif;color:rgb(230,0,0)}')
    check(call)
  })

  it(':host::before in a shadow root', async () => {
    const el = card('', '')
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:20px;top:40px;width:40px;height:20px'
    host.attachShadow({ mode: 'open' }).innerHTML = '<style>:host::before{content:"Host";font:16px sans-serif;color:rgb(230,0,0)}</style>'
    el.appendChild(host)
    // Firefox and WebKit draw the generated text a few pixels further in than its host's box.
    check((await run(el)).call, 24)
  })

  it('a ::first-letter drop cap is covered, and its shadow makes the line not solid text', async () => {
    const { call } = await inCard('<p class="drop" style="margin:30px 0 0;color:rgb(230,0,0)">Drop cap</p>',
      '.drop::first-letter{font-size:48px;text-shadow:2px 2px 2px #000}')
    // Firefox places the large letter a few pixels further in than its line's start, and on
    // macOS its line box ends 29px under the last red pixel (the shadow and the descent).
    check(call, 30)
    const p = call.exactRects.filter((r) => !r.edge && r.y < 80)
    expect(p.length).toBeGreaterThan(0)
    expect(p.some((r) => r.solidText), 'a shadowed letter is not solid text').toBe(false)
  })

  it('checkbox, radio, range, color, meter and progress stay exact', async () => {
    const { call } = await inCard(
      '<input type="checkbox" checked><input type="radio" checked><br><input type="range" value="100" style="width:110px"><br>' +
      '<input type="color" value="#e60000"><meter value="1" style="width:100px"></meter><br><progress value="1" max="1" style="width:100px"></progress>',
      'input,meter,progress{accent-color:rgb(230,0,0);margin:3px}')
    // Every red pixel is exact. The bounds stay loose: Safari ignores accent-color on <meter>, so less of the row is red
    // than the controls' boxes the plugin keeps exact.
    check(call, Infinity)
  })

  it('<audio controls> stays exact', async () => {
    const el = card('', '')
    const audio = document.createElement('audio')
    audio.controls = true
    audio.style.cssText = 'position:absolute;left:10px;top:70px;width:140px'
    el.appendChild(audio)
    const { call, result } = await run(el)
    expect(covers(call.exactRects, textBox(el, audio, result.meta))).toBe(true)
  })
})

describe('jxl plugin: repeat captures', () => {
  it('equal options give one plugin, so an unchanged repeat with an inline jxl() reuses SnapDOM\'s result', async () => {
    // No <canvas>: SnapDOM never memoizes a capture holding one.
    const el = card()
    el.querySelector('canvas').remove()
    expect(jxl()).toBe(jxl({}))
    expect(jxl({ effort: 4, helpers: { memoryBytes: 1 << 26, count: 1 } })).toBe(jxl({ helpers: { count: 1, memoryBytes: 1 << 26 }, effort: 4 }))
    expect(jxl({ effort: 4 })).not.toBe(jxl({ effort: 5 }))
    const codec = recording()
    expect(jxl({ codec })).toBe(jxl({ codec }))
    expect(jxl({ codec })).not.toBe(jxl({ codec: recording() }))
    const first = await snapdom(el, { plugins: [jxl()] })
    expect(await snapdom(el, { plugins: [jxl()] })).toBe(first)
    expect((await first.toBlob({ format: 'jxl' })).type).toBe('image/jxl')
  })
})

describe('jxl plugin: export options', () => {
  it('a beforeExport plugin\'s options win, and a direct export call reads its own', async () => {
    const forced = { name: 'force-effort', pure: true, beforeExport(_ctx, { options }) { options.effort = 4 } }
    const codec = recording()
    const result = await snapdom(card(), { plugins: [forced, jxl({ codec })] })
    await exportOf(result)
    expect(codec.calls[0].effort).toBe(4)
    const exports = jxl({ codec }).defineExports({ exports: { canvas: (o) => result.toCanvas(o) } })
    let encoded = 0
    await exports.blob({ meta: result.meta }, { format: 'jxl', effort: 2, quality: 0.8, onEncoded: () => encoded++ })
    expect(codec.calls[1].effort).toBe(2)
    expect(encoded).toBe(1)
  })

  it('type: "jxl" works as format does', async () => {
    const result = await snapdom(card(), { plugins: [jxl()] })
    expect((await result.toBlob({ type: 'jxl' })).type).toBe('image/jxl')
    expect((await result.toBlob({ type: 'jxl', format: 'png' })).type).toBe('image/png')
  })

  it('a format a beforeExport plugin chooses wins over type: "jxl"', async () => {
    const png = { name: 'to-png', pure: true, beforeExport(_ctx, { options }) { options.format = 'png' } }
    const result = await snapdom(card(), { plugins: [png, jxl()] })
    expect((await result.toBlob({ type: 'jxl' })).type).toBe('image/png')
    // The capture's own format is a default: the export's type: 'jxl' wins over it.
    const captured = await snapdom(card(), { format: 'png', plugins: [jxl()] })
    expect((await captured.toBlob({ type: 'jxl' })).type).toBe('image/jxl')
  })

  it('toJxl() keeps the drawn canvas\'s CSS size at a fractional dpr', async () => {
    const result = await snapdom(card(), { plugins: [jxl({ decoder: decoding() })] })
    const canvas = await result.toCanvas({ width: 101, dpr: 1.5 })
    const img = await result.toJxl({ width: 101, dpr: 1.5 })
    expect(img.style.width).toBe(canvas.style.width)
    expect(img.style.height).toBe(canvas.style.height)
  })

  it('a canvas the app passes is drawn on and kept', async () => {
    const result = await snapdom(card(), { plugins: [jxl({ decoder: decoding() })] })
    for (const toJxl of [false, true]) {
      const canvas = document.createElement('canvas')
      if (toJxl) await result.toJxl({ dpr: 1, canvas }); else await result.toBlob({ format: 'jxl', dpr: 1, canvas })
      expect(canvas.width).toBeGreaterThan(0)
    }
  })

  it('a canvas the app passes is kept when the encoder fails', async () => {
    const failing = { prepare: async () => {}, capture: async () => { throw new Error('encoder down') } }
    const result = await snapdom(card(), { plugins: [jxl({ codec: failing, decoder: decoding() })] })
    for (const toJxl of [false, true]) {
      const canvas = document.createElement('canvas')
      await expect(toJxl ? result.toJxl({ dpr: 1, canvas }) : result.toBlob({ format: 'jxl', dpr: 1, canvas })).rejects.toThrow('encoder down')
      expect(canvas.width).toBeGreaterThan(0)
    }
  })

  it('where JPEG XL does not show, toJxl() says so, or shows the decoder\'s pixels and frees its canvases', async () => {
    const codec = recording()
    const plain = await snapdom(card(), { plugins: [jxl({ codec })] })
    const file = URL.createObjectURL(await plain.toBlob({ format: 'jxl', dpr: 1 }))
    const shows = await new Promise((resolve) => Object.assign(new Image(), { onload: () => resolve(true), onerror: () => resolve(false), src: file }))
    URL.revokeObjectURL(file)
    if (shows) return
    await expect(plain.toJxl({ dpr: 1 })).rejects.toMatchObject({ code: 'JXL_NOT_SHOWN' })
    // Known now: nothing more is encoded for it.
    const tried = codec.calls.length
    expect(tried).toBeLessThanOrEqual(2)
    await expect(plain.toJxl({ dpr: 1 })).rejects.toMatchObject({ code: 'JXL_NOT_SHOWN' })
    expect(codec.calls).toHaveLength(tried)
    const create = document.createElement, canvases = []
    // The plugin's canvases: the one it encodes, and the decoder's (SnapDOM draws with its own before).
    document.createElement = function (tag, ...rest) { const n = create.call(this, tag, ...rest); if (/canvas/i.test(tag) && codec.calls.length > tried) canvases.push(n); return n }
    made.push(() => { document.createElement = create })
    const result = await snapdom(card(), { plugins: [jxl({ codec, decoder: decoding() })] })
    for (const quality of [0.8, 1]) {
      const img = await result.toJxl({ dpr: 1, quality })
      expect(img.naturalWidth).toBe(260)
    }
    expect(canvases.length, 'the decoder\'s canvases').toBeGreaterThan(0)
    expect([...codec.calls.map((c) => c.canvas), ...canvases].filter((c) => c.width || c.height), 'canvases left holding pixels').toEqual([])
  })
})
