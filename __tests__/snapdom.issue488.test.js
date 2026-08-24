import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

let mounted

afterEach(() => {
  mounted?.remove()
  mounted = null
})

function pixelAt(canvas, fx, fy) {
  const x = Math.min(canvas.width - 1, Math.floor(canvas.width * fx))
  const y = Math.min(canvas.height - 1, Math.floor(canvas.height * fy))
  return [...canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data]
}

const LAZY_ICON = 'calcite-icon'
const SLOT_HOST = 'snapdom-issue488-slot-host'

if (!customElements.get(LAZY_ICON)) {
  customElements.define(LAZY_ICON, class extends HTMLElement {
    constructor() {
      super()
      this.attachShadow({ mode: 'open' }).innerHTML = `
        <style>:host{display:block;width:160px;height:80px}svg{display:block;width:100%;height:100%;fill:rgb(16,185,129)}</style>
        <svg viewBox="0 0 160 80"><path d=""></path></svg>
      `
    }

    connectedCallback() {
      this.observer = new IntersectionObserver(([entry]) => {
        if (!entry?.isIntersecting) return
        this.observer.disconnect()
        this.timer = setTimeout(() => {
          this.shadowRoot.querySelector('path').setAttribute('d', 'M0 0H160V80H0Z')
        }, 80)
      })
      this.observer.observe(this)
    }

    disconnectedCallback() {
      this.observer?.disconnect()
      clearTimeout(this.timer)
    }
  })
}

if (!customElements.get(SLOT_HOST)) {
  customElements.define(SLOT_HOST, class extends HTMLElement {
    constructor() {
      super()
      this.attachShadow({ mode: 'open' }).innerHTML = `
        <style>:host{display:block;width:160px;height:80px}::slotted(*){display:block}</style>
        <slot></slot>
      `
    }
  })
}

function mountOffscreen(lazy) {
  const stage = document.createElement('div')
  stage.style.cssText = 'position:relative;width:320px;height:200px;overflow:hidden;margin:40px;'
  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:160px;height:80px;'

  if (lazy) {
    const slotHost = document.createElement(SLOT_HOST)
    const icon = document.createElement(LAZY_ICON)
    icon.setAttribute('data-issue488-action', '')
    slotHost.appendChild(icon)
    host.appendChild(slotHost)
  } else {
    host.style.background = 'rgb(16, 185, 129)'
  }

  stage.appendChild(host)
  document.body.appendChild(stage)
  mounted = stage
  return host
}

async function waitForWarmup(element) {
  const deadline = performance.now() + 500
  while (performance.now() < deadline) {
    if (element.style.getPropertyPriority('left') === 'important') return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('visibility warmup did not start')
}

describe('issue #488 — offscreen Shadow DOM', () => {
  it('captures an offscreen plain DOM host', async () => {
    const canvas = await snapdom.toCanvas(mountOffscreen(false), { dpr: 1, scale: 1 })
    expect(pixelAt(canvas, 0.5, 0.5)).toEqual([16, 185, 129, 255])
  })

  it('waits for async visibility-driven shadow content, keeps nested slots unique, and restores source styles', async () => {
    const host = mountOffscreen(true)
    const capture = snapdom(host, { dpr: 1, scale: 1 })
    setTimeout(() => host.style.setProperty('--app-update', 'preserved'), 30)
    const result = await capture
    const svg = decodeURIComponent(result.toRaw().slice(result.toRaw().indexOf(',') + 1))
    const canvas = await result.toCanvas()

    expect(pixelAt(canvas, 0.5, 0.5)).toEqual([16, 185, 129, 255])
    expect(svg.match(/data-issue488-action/g)).toHaveLength(1)
    expect(host.style.position).toBe('absolute')
    expect(host.style.left).toBe('-9999px')
    expect(host.style.top).toBe('-9999px')
    expect(host.style.getPropertyValue('--app-update')).toBe('preserved')
  })

  it('shares one source warmup between concurrent captures', async () => {
    const host = mountOffscreen(true)
    const [first, second] = await Promise.all([
      snapdom.toCanvas(host, { dpr: 1, scale: 1 }),
      snapdom.toCanvas(host, { dpr: 1, scale: 1 }),
    ])

    expect(pixelAt(first, 0.5, 0.5)).toEqual([16, 185, 129, 255])
    expect(pixelAt(second, 0.5, 0.5)).toEqual([16, 185, 129, 255])
    expect(host.style.position).toBe('absolute')
    expect(host.style.left).toBe('-9999px')
    expect(host.style.top).toBe('-9999px')
    expect(host.style.width).toBe('160px')
    expect(host.style.height).toBe('80px')
  })

  it('shares an ancestor warmup with an overlapping descendant capture', async () => {
    const host = mountOffscreen(true)
    const icon = host.querySelector(LAZY_ICON)
    const parentCapture = snapdom.toCanvas(host, { dpr: 1, scale: 1 })
    await waitForWarmup(host)
    const childCapture = snapdom.toCanvas(icon, { dpr: 1, scale: 1 })
    const [parent, child] = await Promise.all([parentCapture, childCapture])

    expect(pixelAt(parent, 0.5, 0.5)).toEqual([16, 185, 129, 255])
    expect(pixelAt(child, 0.5, 0.5)).toEqual([16, 185, 129, 255])
  })

  it('warms pending siblings after waiting for a descendant capture', async () => {
    const host = mountOffscreen(true)
    const slotHost = host.querySelector(SLOT_HOST)
    const icons = [slotHost.querySelector(LAZY_ICON), document.createElement(LAZY_ICON)]
    slotHost.appendChild(icons[1])

    const childCapture = snapdom(icons[0], { dpr: 1, scale: 1 })
    await waitForWarmup(icons[0])
    const parentCapture = snapdom(host, { dpr: 1, scale: 1 })
    const [, parent] = await Promise.all([childCapture, parentCapture])
    const svg = decodeURIComponent(parent.toRaw().slice(parent.toRaw().indexOf(',') + 1))
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')

    expect([...doc.querySelectorAll('path')].map(path => !!path.getAttribute('d')?.trim()))
      .toEqual([true, true])
  })

  it('waits for all overlapping child warmups before cloning their parent', async () => {
    const host = mountOffscreen(true)
    const slotHost = host.querySelector(SLOT_HOST)
    const icons = [slotHost.querySelector(LAZY_ICON), document.createElement(LAZY_ICON)]
    slotHost.appendChild(icons[1])

    const childCaptures = icons.map(icon => snapdom(icon, { dpr: 1, scale: 1 }))
    await Promise.all(icons.map(waitForWarmup))
    const parentCapture = snapdom(host, { dpr: 1, scale: 1 })
    const [, , parent] = await Promise.all([...childCaptures, parentCapture])
    const svg = decodeURIComponent(parent.toRaw().slice(parent.toRaw().indexOf(',') + 1))
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')

    expect([...doc.querySelectorAll('path')].map(path => !!path.getAttribute('d')?.trim()))
      .toEqual([true, true])
    for (const icon of icons) {
      expect(icon.style.getPropertyPriority('left')).toBe('')
      expect(icon.style.position).toBe('')
      expect(icon.style.opacity).toBe('')
    }
  })

  it('rechecks warmups started by concurrent parent captures', async () => {
    const host = mountOffscreen(true)
    const slotHost = host.querySelector(SLOT_HOST)
    const icons = [slotHost.querySelector(LAZY_ICON), document.createElement(LAZY_ICON)]
    slotHost.appendChild(icons[1])

    const childCapture = snapdom(icons[0], { dpr: 1, scale: 1 })
    await waitForWarmup(icons[0])
    const parentCaptures = [
      snapdom(host, { dpr: 1, scale: 1 }),
      snapdom(host, { dpr: 1, scale: 1 }),
    ]
    const [, ...parents] = await Promise.all([childCapture, ...parentCaptures])

    for (const parent of parents) {
      const svg = decodeURIComponent(parent.toRaw().slice(parent.toRaw().indexOf(',') + 1))
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
      expect([...doc.querySelectorAll('path')].map(path => !!path.getAttribute('d')?.trim()))
        .toEqual([true, true])
    }
  })

  it('does not wait for unrelated icon-like elements with empty paths', async () => {
    const tag = 'snapdom-issue488-empty-icon'
    if (!customElements.get(tag)) {
      customElements.define(tag, class extends HTMLElement {
        constructor() {
          super()
          this.attachShadow({ mode: 'open' }).innerHTML = '<svg width="20" height="20"><path d=""></path></svg>'
        }
      })
    }
    const host = document.createElement(tag)
    host.style.cssText = 'position:absolute;left:-9999px;top:-9999px;'
    document.body.appendChild(host)
    mounted = host

    const started = performance.now()
    await snapdom(host, { dpr: 1, scale: 1 })
    expect(performance.now() - started).toBeLessThan(500)
  })
})
