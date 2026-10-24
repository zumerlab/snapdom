/**
 * `snapdom.stream(el)`: a live element as a canvas that repaints only what changed.
 *
 * A browser compositor does not repaint the page when one button changes; it repaints that
 * layer. This does the same over captures. The first frame is a full capture. After that,
 * every change (mutation records, typing, focus, hover, running animations) is attributed to
 * the nearest ancestor that can be painted standalone over the previous pixels: an opaque
 * box, with no ancestor effect (opacity, filter, transform, blend, mask) between it and the
 * root, inside every clipping ancestor and under no positioned element. A box that moved or
 * was restyled hands the change to the enclosing box that did not. Only that subtree is
 * captured, laid out at its subpixel phase, and drawn where it is fully opaque. Anything
 * this cannot prove is a full frame, with the reason on the frame.
 *
 * Measured 2026-10-23, 1000px grid, one card's text changed per frame, median ms per frame
 * (full / patch): 400 cards Chromium 11.7 / 4.2, Firefox 28 / 4, WebKit 20 / 4; 2000 cards
 * 52.9 / 4.9, 119 / 5, 90 / 4. The patch cost tracks the changed box, not the page.
 *
 * Output: `stream.canvas` is updated in place; `onFrame` receives the dirty rects in canvas
 * pixels, so a WebGL consumer can `texSubImage2D` just those and a video consumer can use
 * `canvas.captureStream()`. Pinned by __tests__/api.stream.test.js, which compares every
 * patched frame against a full capture of the same DOM state.
 * @module api/stream
 */
import { isSafari } from '../utils/browser.js'

/** The public capture entry, bound by api/snapdom.js at load (that module imports this one). */
let capture = null
export function bindStreamCapture(fn) { capture = fn }

const EVENTS = ['input', 'change', 'focusin', 'focusout', 'pointerover', 'pointerout', 'scroll', 'toggle']
const FORM_CONTROL = /^(?:INPUT|TEXTAREA|SELECT|BUTTON)$/
/** A patch larger than this share of the frame costs about what a full frame does. */
const MAX_PATCH_AREA = 0.5
/** Self-healing keyframe: anything the heuristics missed lasts at most this long. */
const KEYFRAME_MS = 2000

function opaqueColor(value) {
  if (!value || value === 'transparent') return false
  const m = value.match(/rgba?\(([^)]+)\)/)
  if (!m) return false
  const parts = m[1].split(/[\s,/]+/).filter(Boolean)
  return parts.length < 4 || parseFloat(parts[3]) >= 1
}

/** An ancestor effect the standalone subtree capture would not reproduce. */
function hasEffect(cs) {
  return parseFloat(cs.opacity) < 1 || cs.filter !== 'none' || cs.transform !== 'none' ||
    cs.mixBlendMode !== 'normal' || (cs.maskImage && cs.maskImage !== 'none') ||
    cs.clipPath !== 'none' || (cs.backdropFilter && cs.backdropFilter !== 'none')
}

function clips(cs) {
  return cs.overflowX !== 'visible' || cs.overflowY !== 'visible'
}

function inside(a, b) {
  return a.left >= b.left - 0.5 && a.top >= b.top - 0.5 && a.right <= b.right + 0.5 && a.bottom <= b.bottom + 0.5
}

function intersects(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

function sameRect(a, b) {
  return Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5
}

/** Targets whose records have a net effect. The capture pipeline writes to live nodes and
 *  undoes the write (text-overflow, line-clamp, content-visibility); those records cancel. */
function netTargets(records, out, restyled) {
  const attrs = new Map(), chars = new Map()
  for (const rec of records) {
    if (rec.type === 'attributes') {
      const key = rec.target
      let byName = attrs.get(key)
      if (!byName) attrs.set(key, byName = new Map())
      if (!byName.has(rec.attributeName)) byName.set(rec.attributeName, rec.oldValue)
    } else if (rec.type === 'characterData') {
      if (!chars.has(rec.target)) chars.set(rec.target, rec.oldValue)
    } else {
      let added = 0
      for (const n of rec.addedNodes) added += n.nodeType === 3 ? n.data.length : 1e6
      for (const n of rec.removedNodes) added -= n.nodeType === 3 ? n.data.length : 1e6
      if (added || rec.addedNodes.length !== rec.removedNodes.length) out.add(rec.target)
      else {
        const before = [...rec.removedNodes].map(n => n.data).join('')
        const after = [...rec.addedNodes].map(n => n.data).join('')
        if (before !== after) out.add(rec.target)
      }
    }
  }
  for (const [el, byName] of attrs) {
    for (const [name, old] of byName) if (el.getAttribute(name) !== old) { out.add(el); restyled?.add(el); break }
  }
  for (const [node, old] of chars) if (node.data !== old) out.add(node.parentElement)
}

function describe(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement
  if (!el) return 'a detached node'
  return `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList?.length ? '.' + [...el.classList].join('.') : ''}>`
}

async function decode(url) {
  const img = new Image()
  img.decoding = 'sync'
  img.src = url
  await img.decode()
  return img
}

/**
 * Stream an element into a canvas, repainting only the boxes that changed.
 * @param {Element} element
 * @param {object} [options] - capture options (scale, dpr, embedFonts, ...), plus:
 * @param {(frame: {full: boolean, reason: string|null, rects: {x:number,y:number,width:number,height:number}[], ms: number, canvas: HTMLCanvasElement}) => void} [options.onFrame]
 * @param {number} [options.fps] - cap on frames per second; default every animation frame.
 * @param {boolean} [options.patches=true] - false repaints full frames only (the baseline).
 * @returns {{canvas: HTMLCanvasElement, stop: () => void, ready: Promise<void>, stats: object}}
 */
export function stream(element, options = {}) {
  const { onFrame, fps, patches = true, ...rest } = options
  const opts = { ...rest, outerShadows: false, dpr: rest.dpr ?? (globalThis.devicePixelRatio || 1) }
  const k = (opts.scale ?? 1) * opts.dpr
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const dirty = new Set()
  const restyled = new Set() // elements whose own attributes changed: their box may have too
  const rects = new WeakMap() // element -> rect at the last paint that covered it
  const backdrops = new Map() // this frame's hosts that draw over a solid colour
  const stats = { full: 0, patch: 0, skipped: 0, lastMs: 0 }
  let floaters = []
  let forceFull = true
  let lastKeyframe = 0
  let stopped = false
  let busy = false
  let lastTick = 0
  let rootRect = null
  let ox = 0, oy = 0 // canvas pixels from the canvas origin to the root's border box

  const observer = new MutationObserver(records => netTargets(records, dirty, restyled))
  observer.observe(element, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true })
  const onEvent = (e) => {
    dirty.add(e.target)
    if (e.relatedTarget && element.contains(e.relatedTarget)) dirty.add(e.relatedTarget)
  }
  for (const type of EVENTS) element.addEventListener(type, onEvent, true)
  const onResize = () => { forceFull = true }
  addEventListener('resize', onResize)

  function rectOf(el) {
    const r = el.getBoundingClientRect()
    return { left: r.left - rootRect.left, top: r.top - rootRect.top, right: r.right - rootRect.left, bottom: r.bottom - rootRect.top, width: r.width, height: r.height }
  }

  /** Remember every box's rect and the positioned elements that can paint over others. */
  function snapshotLayout() {
    rootRect = element.getBoundingClientRect()
    floaters = []
    for (const el of element.querySelectorAll('*')) {
      rects.set(el, rectOf(el))
      const cs = getComputedStyle(el)
      if (cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'sticky' ||
        (cs.position === 'relative' && cs.zIndex !== 'auto') || cs.transform !== 'none') floaters.push(el)
    }
  }

  /** The box a change to `node` can be repainted through, or null for a full frame. */
  function hostFor(node) {
    let el = node?.nodeType === 1 ? node : node?.parentElement
    if (!el || el === element || !element.contains(el)) return null
    const chain = []
    for (let a = el; a && a !== element; a = a.parentElement) chain.push(a)
    // Search above the highest ancestor with an effect or a clip the box would escape.
    let start = 0
    for (let i = 0; i < chain.length; i++) {
      const cs = getComputedStyle(chain[i])
      if (hasEffect(cs)) start = i + 1
      else if (i > 0 && clips(cs) && !inside(rectOf(chain[0]), rectOf(chain[i]))) start = i
    }
    for (let i = start; i < chain.length; i++) {
      const cs = getComputedStyle(chain[i])
      if (!opaqueColor(cs.backgroundColor)) continue
      // A form control is never the capture root: in WebKit an <input> captured alone drew
      // its text lower than the same input captured inside its card (279 pixels differed).
      if (FORM_CONTROL.test(chain[i].tagName)) continue
      // Visible overflow paints outside the box, over pixels the patch does not repaint.
      if (!clips(cs) && (chain[i].scrollWidth > chain[i].clientWidth + 1 || chain[i].scrollHeight > chain[i].clientHeight + 1)) continue
      return chain[i]
    }
    return null
  }

  async function full() {
    const res = await capture(element, opts)
    const { vbW, vbH, contentX = 0, contentY = 0 } = res.meta
    // Safari keeps toCanvas, whose WebKit draw workarounds a raw decode would skip.
    const src = isSafari() ? await res.toCanvas() : await decode(res.url)
    const w = Math.round(vbW * k), h = Math.round(vbH * k)
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(src, 0, 0, w, h)
    ox = contentX * k
    oy = contentY * k
    snapshotLayout()
    lastKeyframe = performance.now()
    stats.full++
    return [{ x: 0, y: 0, width: w, height: h }]
  }

  /** The solid colour behind `host` when the patch can be drawn over it and come out exact,
   *  edges and corners included; null otherwise. Needs no shadow or outline of its own
   *  (they paint outside the box, where the fill would erase them), only opaque or clear
   *  ancestor backgrounds up to the first opaque one, and no other box on the pixels the
   *  patch's whole-pixel rect adds around the host. */
  function backdropOf(host) {
    const cs = getComputedStyle(host)
    if (cs.boxShadow !== 'none' || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)) return null
    let color = null
    for (let a = host.parentElement; a && !color; a = a === element ? null : a.parentElement) {
      const s = getComputedStyle(a)
      if (s.backgroundImage !== 'none') return null
      if (opaqueColor(s.backgroundColor)) color = s.backgroundColor
      else if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') return null
    }
    if (!color) return null
    const r = rectOf(host)
    const pad = { left: Math.floor(ox + r.left * k) / k - ox / k, top: Math.floor(oy + r.top * k) / k - oy / k, right: Math.ceil(ox + r.right * k) / k - ox / k, bottom: Math.ceil(oy + r.bottom * k) / k - oy / k }
    for (const sib of host.parentElement.children) {
      if (sib === host) continue
      const sr = rects.get(sib)
      if (sr && intersects(sr, pad)) return null
    }
    return color
  }

  /** Capture one host at its subpixel phase and return its pixels, placed. */
  async function renderPatch(host) {
    const r = rects.get(host)
    // Lay the patch out at the page's subpixel phase (svg engine, options.__subpixel), so
    // its glyphs and snapped box edges land on the same pixels as in the full frame:
    // white cards on black at 1fr offsets differed on 596 pixels at phase zero.
    const left = ox + r.left * k, top = oy + r.top * k
    const x0 = Math.floor(left + 0.001), y0 = Math.floor(top + 0.001)
    const phase = { x: (left - x0) / k, y: (top - y0) / k }
    const res = await capture(host, phase.x || phase.y ? { ...opts, __subpixel: phase } : opts)
    const { vbW, vbH, contentX = 0, contentY = 0 } = res.meta
    const x = Math.round(x0 - contentX * k), y = Math.round(y0 - contentY * k)
    const w = Math.round(vbW * k), h = Math.round(vbH * k)
    const src = isSafari() ? await res.toCanvas() : await decode(res.url)
    const layer = document.createElement('canvas')
    layer.width = w
    layer.height = h
    const backdrop = backdrops.get(host)
    if (backdrop) {
      // Over its solid backdrop the patch is the full frame's pixels, edges included.
      const lctx = layer.getContext('2d')
      lctx.fillStyle = backdrop
      lctx.fillRect(0, 0, w, h)
      lctx.drawImage(src, 0, 0, w, h)
      return { layer, x, y, w, h }
    }
    // Otherwise keep only the pixels the box covers fully. Inside an opaque box that is
    // everything; what is left are its antialiased edges and rounded corners, which did not
    // change (restyled hosts without a backdrop climb in plan) and which drawing again would
    // blend over themselves. Same scene: 36 pixels off without this, 0 with it.
    const lctx = layer.getContext('2d', { willReadFrequently: true })
    lctx.drawImage(src, 0, 0, w, h)
    const img = lctx.getImageData(0, 0, w, h)
    const px = img.data
    for (let i = 3; i < px.length; i += 4) if (px[i] < 255) px[i] = 0
    lctx.putImageData(img, 0, 0)
    return { layer, x, y, w, h }
  }

  async function patch(hosts) {
    // Captures and decodes overlap; the draws then land in one synchronous pass, so the
    // canvas never shows half a frame. Three hosts a frame (clock, KPI, list row) in
    // demos/stream-webgl.html: 11.9 ms one after another.
    const layers = await Promise.all(hosts.map(renderPatch))
    const out = []
    for (const { layer, x, y, w, h } of layers) {
      ctx.drawImage(layer, x, y)
      out.push({ x, y, width: w, height: h })
    }
    for (const host of hosts) {
      rects.set(host, rectOf(host))
      for (const el of host.querySelectorAll('*')) rects.set(el, rectOf(el))
    }
    stats.patch++
    return out
  }

  /** Hosts for this frame, or the reason only a full frame is safe. */
  function plan() {
    if (!patches) return 'patches off'
    if (forceFull) return 'resize'
    if (performance.now() - lastKeyframe > KEYFRAME_MS) return 'keyframe'
    const now = element.getBoundingClientRect()
    if (!sameRect({ left: 0, top: 0, width: now.width, height: now.height }, { left: 0, top: 0, width: rootRect.width, height: rootRect.height })) return 'root resized'
    rootRect = now
    const hosts = new Set()
    for (const node of dirty) {
      if (!node?.isConnected) return 'node removed'
      let host = hostFor(node)
      // A box that moved or resized may have moved its siblings, and a restyled box may have
      // changed its own edges, which only a solid backdrop lets the patch redraw. If an
      // enclosing host kept its rect, the change stayed inside it: repaint that box instead.
      while (host && (!sameRect(rects.get(host) || {}, rectOf(host)) || (restyled.has(host) && !backdropOf(host)))) host = hostFor(host.parentElement)
      if (!host) return `no host for ${describe(node)}`
      hosts.add(host)
    }
    // Outermost hosts only: a box inside another dirty box is repainted by it.
    for (const h of [...hosts]) {
      for (let a = h.parentElement; a && a !== element; a = a.parentElement) if (hosts.has(a)) { hosts.delete(h); break }
    }
    let area = 0
    backdrops.clear()
    for (const h of hosts) {
      const backdrop = backdropOf(h)
      if (backdrop) backdrops.set(h, backdrop)
      const after = rectOf(h)
      area += after.width * after.height
      for (const f of floaters) {
        if (f === h || h.contains(f) || f.contains(h)) continue
        if (intersects(rectOf(f), after)) return `${describe(f)} overlaps ${describe(h)}`
      }
    }
    if (area > MAX_PATCH_AREA * rootRect.width * rootRect.height) return 'patch area too large'
    return [...hosts]
  }

  async function tick() {
    if (stopped) return
    requestAnimationFrame(tick)
    const now = performance.now()
    if (busy || (fps && now - lastTick < 1000 / fps)) return
    for (const a of element.getAnimations?.({ subtree: true }) || []) {
      if (a.playState === 'running') dirty.add(a.effect?.target || element)
    }
    netTargets(observer.takeRecords(), dirty, restyled)
    if (!dirty.size && !forceFull && now - lastKeyframe <= KEYFRAME_MS) { stats.skipped++; return }
    busy = true
    lastTick = now
    try {
      const hosts = plan()
      dirty.clear()
      restyled.clear()
      const reason = typeof hosts === 'string' ? hosts : null
      forceFull = false
      const out = reason ? await full() : hosts.length ? await patch(hosts) : []
      // Records produced by our own capture are net-zero; anything else lands next frame.
      netTargets(observer.takeRecords(), dirty, restyled)
      stats.lastMs = performance.now() - now
      if (out.length) onFrame?.({ full: !!reason, reason, rects: out, ms: stats.lastMs, canvas })
    } finally {
      busy = false
    }
  }

  const ready = (async () => {
    busy = true
    try {
      await full()
      forceFull = false
      dirty.clear()
      restyled.clear()
      observer.takeRecords()
      onFrame?.({ full: true, reason: 'start', rects: [{ x: 0, y: 0, width: canvas.width, height: canvas.height }], ms: 0, canvas })
    } finally { busy = false }
    requestAnimationFrame(tick)
  })()

  return {
    canvas,
    ready,
    stats,
    stop() {
      stopped = true
      observer.disconnect()
      for (const type of EVENTS) element.removeEventListener(type, onEvent, true)
      removeEventListener('resize', onResize)
    },
  }
}
