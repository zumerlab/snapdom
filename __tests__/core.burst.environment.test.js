// Record-less and out-of-subtree render state must invalidate automatic burst before it can
// serve. Every visual assertion is paired with a fresh `{ burst:false }` capture of the same
// live state: green means the automatic path followed the reference, not merely that it ran.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index.js'
import { isAutoBurstSafe } from '../src/core/burst.js'
import { __diffStats } from '../src/core/diff.js'
import { flushStyleInvalidations, getOutsideMutationCount, observeShadowRoot } from '../src/modules/styles.js'

const mounted = []
afterEach(() => {
  while (mounted.length) mounted.pop().remove()
  try { history.replaceState(null, '', location.pathname + location.search) } catch { }
  vi.restoreAllMocks()
})

const OPTS = { dpr: 1, scale: 1, embedFonts: false }

function hits(canvas, [r, g, b]) {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - r) < 35 && Math.abs(data[i + 1] - g) < 35 && Math.abs(data[i + 2] - b) < 35) n++
  }
  return n
}

async function expectFreshColor(el, rgb, minimum = 1000) {
  const automatic = await snapdom.toCanvas(el, OPTS)
  const full = await snapdom.toCanvas(el, { ...OPTS, burst: false })
  const autoHits = hits(automatic, rgb)
  const fullHits = hits(full, rgb)
  expect(fullHits).toBeGreaterThan(minimum)
  expect(autoHits).toBeGreaterThanOrEqual(fullHits * 0.95)
}

function mount(markup) {
  const host = document.createElement('div')
  host.innerHTML = markup
  document.body.appendChild(host)
  mounted.push(host)
  return host
}

describe('auto burst — render state outside MutationObserver scope', () => {
  it('follows a same-task mutation inside a nested same-origin iframe', async () => {
    const host = mount('<iframe style="width:200px;height:100px;border:0"></iframe>')
    const frame = host.querySelector('iframe')
    const doc = frame.contentDocument
    doc.open()
    doc.write('<body style="margin:0;width:200px;height:100px;background:rgb(255,0,0)"></body>')
    doc.close()
    await snapdom(host, OPTS)

    doc.body.style.background = 'rgb(0,0,255)'
    await expectFreshColor(host, [0, 0, 255], 5000)
  })

  it('follows an outside sibling selector in the same task', async () => {
    const style = document.createElement('style')
    style.textContent = '.burst-gate + .burst-target{background:rgb(0,0,255)}.burst-gate.on + .burst-target{background:rgb(255,0,0)}'
    document.head.appendChild(style)
    mounted.push(style)
    const host = mount('<div class="burst-gate"></div><div class="burst-target" style="width:200px;height:80px"></div>')
    const target = host.querySelector('.burst-target')
    await snapdom(target, OPTS)

    host.querySelector('.burst-gate').classList.add('on')
    await expectFreshColor(target, [255, 0, 0], 10_000)
  })

  it('refreshes untouched branches when an ancestor and a local subtree change together', async () => {
    const style = document.createElement('style')
    style.textContent = '.burst-theme-unchanged{background:rgb(0,0,255)}.burst-theme-on .burst-theme-unchanged{background:rgb(255,0,0)}'
    document.head.appendChild(style)
    mounted.push(style)
    const host = mount('<div style="width:200px;height:100px"><section style="width:200px;height:100px"><div class="burst-theme-mutable" style="width:200px;height:20px">before</div><div class="burst-theme-unchanged" style="width:200px;height:80px"></div></section></div>')
    const target = host.firstElementChild
    const mutable = host.querySelector('.burst-theme-mutable')
    const first = await snapdom(target, OPTS)
    expect(await snapdom(target, OPTS)).toBe(first)

    const served = __diffStats.served
    mutable.textContent = 'after'
    await expectFreshColor(target, [0, 0, 255], 10_000)
    expect(__diffStats.served).toBe(served + 1)

    host.classList.add('burst-theme-on')
    mutable.textContent = 'final'
    await expectFreshColor(target, [255, 0, 0], 10_000)
    expect(__diffStats.served).toBe(served + 1)
  })

  it('follows a stylesheet inserted in body in the same task', async () => {
    const host = mount('<div class="burst-body-rule" style="width:200px;height:80px;background:rgb(0,0,255)"></div>')
    const target = host.firstElementChild
    await snapdom(target, OPTS)

    const wrapper = document.createElement('div')
    wrapper.innerHTML = '<style>.burst-body-rule{background:rgb(255,0,0)!important}</style>'
    document.body.appendChild(wrapper)
    mounted.push(wrapper)
    await expectFreshColor(target, [255, 0, 0], 10_000)
  })

  it('follows an outside query-container resize in the same task', async () => {
    if (!CSS.supports('container-type:inline-size')) return
    const style = document.createElement('style')
    style.textContent = '.burst-container{container-type:inline-size}.burst-contained{background:rgb(0,0,255)}@container (min-width:300px){.burst-contained{background:rgb(255,0,0)}}'
    document.head.appendChild(style)
    mounted.push(style)
    const host = mount('<div class="burst-container" style="width:200px"><div class="burst-contained" style="width:100%;height:80px"></div></div>')
    const container = host.firstElementChild
    const target = container.firstElementChild
    await snapdom(target, OPTS)

    container.style.width = '400px'
    await expectFreshColor(target, [255, 0, 0], 20_000)
  })

  it('follows flex geometry changed by a deep mutation in an outside sibling', async () => {
    const host = mount('<div style="display:flex;width:400px;font:16px monospace"><div style="flex:0 1 auto;white-space:nowrap"><span><b class="burst-flex-source">x</b></span></div><div class="burst-flex-target" style="flex:1 1 0;min-width:0;height:80px;background:rgb(255,0,0)"></div></div>')
    const target = host.querySelector('.burst-flex-target')
    const first = await snapdom(target, OPTS)

    host.querySelector('.burst-flex-source').textContent = 'W'.repeat(36)
    const automatic = await snapdom(target, OPTS)
    const full = await snapdom(target, { ...OPTS, burst: false })
    expect(automatic).not.toBe(first)
    expect(automatic.meta.w0).toBeLessThan(first.meta.w0 - 100)
    expect(automatic.meta.w0).toBeCloseTo(full.meta.w0, 3)
    expect(automatic.url).toBe(full.url)
  })

  it('refreshes container-query paint when an outside sibling and a local subtree change together', async () => {
    const style = document.createElement('style')
    style.textContent = '.burst-query-paint{background:rgb(0,0,255)}@container (max-width:250px){.burst-query-paint{background:rgb(255,0,0)}}'
    document.head.appendChild(style)
    mounted.push(style)
    const host = mount('<div style="display:flex;width:400px;font:16px monospace"><div style="flex:0 1 auto;white-space:nowrap"><span><b class="burst-query-source">x</b></span></div><div style="flex:1 1 0;min-width:0;container-type:inline-size"><div class="burst-query-target" style="width:200px;height:100px"><section><div class="burst-query-mutable" style="width:200px;height:20px">before</div><div class="burst-query-paint" style="width:200px;height:80px"></div></section></div></div></div>')
    const target = host.querySelector('.burst-query-target')
    await expectFreshColor(target, [0, 0, 255], 10_000)

    const served = __diffStats.served
    host.querySelector('.burst-query-source').textContent = 'W'.repeat(36)
    host.querySelector('.burst-query-mutable').textContent = 'after'
    await expectFreshColor(target, [255, 0, 0], 10_000)
    expect(__diffStats.served).toBe(served)
  })

  it('follows :target/hash before hashchange event delivery', async () => {
    const style = document.createElement('style')
    style.textContent = '#burst-hash-target{background:rgb(0,0,255)}#burst-hash-target:target{background:rgb(255,0,0)}'
    document.head.appendChild(style)
    mounted.push(style)
    const host = mount('<div id="burst-hash-target" style="width:200px;height:80px"></div>')
    const target = host.firstElementChild
    await snapdom(target, OPTS)

    location.hash = '#burst-hash-target'
    await expectFreshColor(target, [255, 0, 0], 10_000)
  })

  it('invalidates when a media preference flips before change-event delivery', async () => {
    const nativeMatchMedia = window.matchMedia.bind(window)
    let dark = false
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(prefers-color-scheme: dark)' ? dark : nativeMatchMedia(query).matches,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return true },
    }))
    const host = mount('<div style="width:200px;height:80px;background:rgb(0,0,255)"></div>')
    const target = host.firstElementChild
    const first = await snapdom(target, OPTS)

    dark = true
    const automatic = await snapdom(target, OPTS)
    const full = await snapdom(target, { ...OPTS, burst: false })
    expect(automatic).not.toBe(first)
    expect(hits(await automatic.toCanvas(), [0, 0, 255])).toBe(hits(await full.toCanvas(), [0, 0, 255]))
  })

  it('follows replacement of adoptedStyleSheets without a mutation record', async () => {
    if (!('adoptedStyleSheets' in document) || typeof CSSStyleSheet !== 'function') return
    const previous = [...document.adoptedStyleSheets]
    const style = document.createElement('style')
    style.textContent = '.burst-adopted{background:rgb(0,0,255)}'
    document.head.appendChild(style)
    mounted.push(style)
    const host = mount('<div class="burst-adopted" style="width:200px;height:80px"></div>')
    const target = host.firstElementChild
    await snapdom(target, OPTS)

    const sheet = new CSSStyleSheet()
    sheet.replaceSync('.burst-adopted{background:rgb(255,0,0)!important}')
    try {
      document.adoptedStyleSheets = [...previous, sheet]
      await expectFreshColor(target, [255, 0, 0], 10_000)
    } finally {
      document.adoptedStyleSheets = previous
    }
  })

  it('follows native popover top-layer state', async () => {
    const host = mount('<div style="width:200px;height:80px;background:rgb(0,0,255)"><div popover="manual" style="width:200px;height:80px;margin:0;padding:0;border:0;background:rgb(255,0,0)"></div></div>')
    const target = host.firstElementChild
    const popover = target.firstElementChild
    if (typeof popover.showPopover !== 'function') return
    await snapdom(target, OPTS)

    popover.showPopover()
    await expectFreshColor(target, [255, 0, 0], 5000)
  })

  it('follows programmatic scroll before the scroll event task', async () => {
    const host = mount('<div style="width:200px;height:80px;overflow:auto"><div style="height:80px;background:rgb(255,0,0)"></div><div style="height:80px;background:rgb(0,0,255)"></div></div>')
    const target = host.firstElementChild
    await snapdom(target, OPTS)

    target.scrollTop = 80
    await expectFreshColor(target, [0, 0, 255], 10_000)
  })

  it('follows programmatic form state without requiring input/change events', async () => {
    const style = document.createElement('style')
    style.textContent = '.burst-form-box,.burst-ind-box{display:block;width:200px;height:80px;background:rgb(0,0,255)}.burst-form-check:checked + .burst-form-box{background:rgb(255,0,0)}.burst-form-ind:indeterminate + .burst-ind-box{background:rgb(0,128,0)}'
    document.head.appendChild(style)
    mounted.push(style)
    const host = mount('<div><input class="burst-form-text" value="before"><textarea>before</textarea><select><option>one</option><option>two</option></select><input class="burst-form-check" type="checkbox"><span class="burst-form-box"></span><input class="burst-form-ind" type="checkbox"><span class="burst-ind-box"></span></div>')
    const target = host.firstElementChild
    const first = await snapdom(target, OPTS)

    target.querySelector('.burst-form-text').value = 'after'
    target.querySelector('textarea').value = 'after'
    target.querySelector('select').selectedIndex = 1
    target.querySelector('.burst-form-check').checked = true
    target.querySelector('.burst-form-ind').indeterminate = true
    const automatic = await snapdom(target, OPTS)
    const full = await snapdom(target, { ...OPTS, burst: false })
    expect(automatic.url).not.toBe(first.url)
    expect(automatic.url).toBe(full.url)
    expect(hits(await automatic.toCanvas(), [255, 0, 0])).toBeGreaterThan(10_000)
    expect(hits(await automatic.toCanvas(), [0, 128, 0])).toBeGreaterThan(10_000)
  })
})

describe('auto burst — frame-driven sources', () => {
  it('bypasses memoization for lowercase SVG SMIL elements', async () => {
    const host = mount('<div><svg width="40" height="40"><rect width="40" height="40" fill="red"><animate attributeName="fill" values="red;blue" dur="1s" repeatCount="indefinite"></animate></rect></svg></div>')
    const target = host.firstElementChild
    expect(isAutoBurstSafe(target)).toBe(false)
    const first = await snapdom(target, OPTS)
    const reads = vi.spyOn(window, 'getComputedStyle')
    const second = await snapdom(target, OPTS)
    expect(second).not.toBe(first)
    expect(reads).toHaveBeenCalled()
  })

  it('follows a programmatically advanced paused animation', async () => {
    const host = mount('<div style="width:200px;height:80px"></div>')
    const target = host.firstElementChild
    const animation = target.animate(
      [{ backgroundColor: 'rgb(0,0,255)' }, { backgroundColor: 'rgb(255,0,0)' }],
      { duration: 1000, fill: 'both' }
    )
    try {
      animation.pause()
      animation.currentTime = 0
      await snapdom(target, OPTS)
      animation.currentTime = 1000
      await expectFreshColor(target, [255, 0, 0], 10_000)
    } finally {
      animation.cancel()
    }
  })

  it('does not memoize a playing video between sparse timeupdate events', async () => {
    const host = mount('<div style="width:160px;height:90px"><video style="width:160px;height:90px"></video></div>')
    const video = host.querySelector('video')
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false })
    Object.defineProperty(video, 'ended', { configurable: true, get: () => false })
    await snapdom(host, OPTS)
    const reads = vi.spyOn(window, 'getComputedStyle')
    await snapdom(host, OPTS)
    expect(reads).toHaveBeenCalled()
  })

  it('does not memoize an animated-image source', async () => {
    const host = mount('<div style="width:20px;height:20px"><img style="width:20px;height:20px"></div>')
    const img = host.querySelector('img')
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
    await img.decode().catch(() => {})
    await snapdom(host, OPTS)
    const reads = vi.spyOn(window, 'getComputedStyle')
    await snapdom(host, OPTS)
    expect(reads).toHaveBeenCalled()
  })

  it('classifies an extensionless/blob GIF after the first pipeline inlines it', async () => {
    const bytes = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }))
    try {
      const host = mount('<div style="width:20px;height:20px"><img style="width:20px;height:20px"></div>')
      const img = host.querySelector('img')
      img.src = url
      await img.decode()
      const remove = vi.spyOn(host, 'removeEventListener')
      await snapdom(host, OPTS)
      expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), true)
      const add = vi.spyOn(host, 'addEventListener')
      const reads = vi.spyOn(window, 'getComputedStyle')
      await snapdom(host, OPTS)
      expect(reads).toHaveBeenCalled()
      expect(add).not.toHaveBeenCalled() // remembered as frame-driven: no throwaway state rebuild
    } finally {
      URL.revokeObjectURL(url)
    }
  })

  it('reclassifies rebuilt image/background roots after a static-to-animated diff', async () => {
    const bytes = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }))
    const source = document.createElement('canvas')
    source.width = source.height = 2
    source.getContext('2d').fillRect(0, 0, 2, 2)
    try {
      const host = mount('<div style="width:40px;height:20px"><div><img style="width:20px;height:20px"><span style="display:inline-block;width:20px;height:20px"></span></div></div>')
      const target = host.firstElementChild
      const img = target.querySelector('img')
      img.src = source.toDataURL('image/png')
      await img.decode()
      await snapdom(target, OPTS)

      img.src = url
      target.querySelector('span').style.backgroundImage = `url("${url}")`
      await img.decode()
      const served = __diffStats.served
      await snapdom(target, OPTS)
      expect(__diffStats.served).toBe(served + 1)

      const reads = vi.spyOn(window, 'getComputedStyle')
      await snapdom(target, OPTS)
      expect(reads).toHaveBeenCalled()
    } finally {
      URL.revokeObjectURL(url)
    }
  })

  it('classifies an animated image in a CSS background after inlining', async () => {
    const bytes = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }))
    try {
      const host = mount('<div style="width:20px;height:20px"></div>')
      const target = host.firstElementChild
      target.style.backgroundImage = `url("${url}")`
      await snapdom(target, OPTS)
      const reads = vi.spyOn(window, 'getComputedStyle')
      await snapdom(target, OPTS)
      expect(reads).toHaveBeenCalled()
    } finally {
      URL.revokeObjectURL(url)
    }
  })

  it('classifies a large percent-encoded animated SVG without truncation hiding its marker', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
      '<rect width="20" height="20" fill="red"><animate attributeName="fill" values="red;blue" dur="1s" repeatCount="indefinite"/></rect>' +
      `<!--${'é'.repeat(70_000)}--></svg>`
    const host = mount('<div style="width:20px;height:20px"><img style="width:20px;height:20px"></div>')
    const img = host.querySelector('img')
    img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`
    await img.decode()
    await snapdom(host, OPTS)

    const reads = vi.spyOn(window, 'getComputedStyle')
    await snapdom(host, OPTS)
    expect(reads).toHaveBeenCalled()
  })

  it('recognizes a quoted uppercase data SVG in CSS when its payload contains apostrophes', async () => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><rect width='20' height='20'><animate attributeName='fill' values='red;blue' dur='1s' repeatCount='indefinite'/></rect></svg>"
    const host = mount('<div style="width:20px;height:20px"></div>')
    const target = host.firstElementChild
    target.style.backgroundImage = `url("DATA:image/svg+xml,${encodeURIComponent(svg)}")`

    expect(isAutoBurstSafe(target)).toBe(false)
    await snapdom(target, OPTS)
    const reads = vi.spyOn(window, 'getComputedStyle')
    await snapdom(target, OPTS)
    expect(reads).toHaveBeenCalled()
  })

  it('keeps automatic memoization for a demonstrably static WebP', async () => {
    const source = document.createElement('canvas')
    source.width = source.height = 2
    source.getContext('2d').fillRect(0, 0, 2, 2)
    const host = mount('<div style="width:20px;height:20px"><img style="width:20px;height:20px"></div>')
    const img = host.querySelector('img')
    img.src = source.toDataURL('image/webp')
    await img.decode()
    const first = await snapdom(host, OPTS)
    const reads = vi.spyOn(window, 'getComputedStyle')
    const second = await snapdom(host, OPTS)
    expect(second).toBe(first)
    expect(reads).not.toHaveBeenCalled()
  })
})

describe('auto burst — transactional edges', () => {
  it('counts shadow mutations within their host subtree and keeps documents independent', () => {
    const host = mount('<div class="count-target"></div><iframe></iframe>')
    const target = host.firstElementChild
    const shadow = target.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<span>before</span>'
    observeShadowRoot(shadow)
    const frameDoc = host.querySelector('iframe').contentDocument
    const frameTarget = frameDoc.createElement('div')
    frameTarget.innerHTML = '<span>before</span>'
    frameDoc.body.appendChild(frameTarget)
    getOutsideMutationCount(frameTarget)
    flushStyleInvalidations()
    const mainCount = getOutsideMutationCount(target)
    const frameCount = getOutsideMutationCount(frameTarget)

    shadow.firstElementChild.textContent = 'after'
    frameTarget.firstElementChild.textContent = 'after'
    flushStyleInvalidations()
    expect(getOutsideMutationCount(target)).toBe(mainCount)
    expect(getOutsideMutationCount(frameTarget)).toBe(frameCount)

    host.classList.add('outside-main')
    flushStyleInvalidations()
    expect(getOutsideMutationCount(target)).toBe(mainCount + 1)
    expect(getOutsideMutationCount(frameTarget)).toBe(frameCount)
    frameDoc.body.classList.add('outside-frame')
    flushStyleInvalidations()
    expect(getOutsideMutationCount(target)).toBe(mainCount + 1)
    expect(getOutsideMutationCount(frameTarget)).toBe(frameCount + 1)
  })

  it('does not memoize a frame torn by an ancestor change during rendering', async () => {
    const style = document.createElement('style')
    style.textContent = '.burst-torn-color{background:rgb(0,0,255)}.burst-torn-theme .burst-torn-color{background:rgb(255,0,0)}'
    document.head.appendChild(style)
    mounted.push(style)
    const host = mount('<div class="burst-torn-color" style="width:200px;height:80px"></div>')
    const target = host.firstElementChild
    let enteredResolve, release
    const entered = new Promise((resolve) => { enteredResolve = resolve })
    const gate = new Promise((resolve) => { release = resolve })
    const options = { ...OPTS, plugins: [{
      name: 'outside-mutation-gate',
      pure: true,
      beforeRender() { enteredResolve(); return gate },
    }] }
    const pending = snapdom(target, options)
    await entered
    try { host.classList.add('burst-torn-theme') } finally { release() }
    const torn = await pending
    const automatic = await snapdom(target, options)
    const full = await snapdom(target, { ...options, burst: false })
    expect(automatic).not.toBe(torn)
    const fullHits = hits(await full.toCanvas(), [255, 0, 0])
    expect(fullHits).toBeGreaterThan(10_000)
    expect(hits(await automatic.toCanvas(), [255, 0, 0])).toBeGreaterThanOrEqual(fullHits * 0.95)
  })

  it('does not commit a diff whose async result construction rejects', async () => {
    const host = mount('<div style="width:200px;height:80px"><span>before</span></div>')
    const target = host.firstElementChild
    let rejectNext = false
    const plugin = {
      name: 'reject-diff-result-once',
      defineExports() {
        if (rejectNext) {
          rejectNext = false
          throw new Error('defineExports once')
        }
        return {}
      },
    }
    const options = { ...OPTS, plugins: [plugin] }
    await snapdom(target, options)
    target.querySelector('span').textContent = 'after'
    rejectNext = true
    await expect(snapdom(target, options)).rejects.toThrow('defineExports once')

    const recovered = await snapdom(target, options)
    expect(decodeURIComponent(recovered.url)).toContain('after')
  })

  it('does not create a memo state for fromString ephemeral mounts', async () => {
    const add = vi.spyOn(EventTarget.prototype, 'addEventListener')
    let ephemeral = null
    await snapdom.fromString('<div id="burst-ephemeral">one shot</div>', {
      burst: true,
      plugins: [{
        name: 'see-ephemeral-target',
        beforeSnap(context) { ephemeral = context.element },
      }],
    })
    expect(ephemeral?.isConnected).toBe(false)
    const ownTypes = add.mock.calls
      .map((args, i) => [add.mock.instances[i], args[0]])
      .filter(([instance]) => instance === ephemeral)
      .map(([, type]) => type)
    expect(ownTypes).not.toContain('scroll')
    expect(ownTypes).not.toContain('input')
  })
})
