/**
 * `snapdom.stream(el)`: a live element as a canvas that repaints only what changed.
 *
 * A browser compositor does not repaint the page when one button changes; it repaints that
 * layer. This does the same over captures. The first frame is a full capture. After that,
 * every change (mutation records, typing, focus, hover, running animations) is attributed to
 * the nearest ancestor that can be painted standalone over the previous pixels: an opaque
 * box, with no ancestor effect (opacity, filter, transform, blend, mask) between it and the
 * root, inside every clipping ancestor and under no positioned element. A box that moved or
 * was restyled hands the change to the enclosing box that did not; an absolutely positioned
 * box over a solid or clear backdrop may move and resize itself, since it pushes nothing.
 * Only that subtree is captured, laid out at its subpixel phase, and drawn over its backdrop
 * or where it is fully opaque. A change with no such box (a value on a glass card, a row
 * under a badge) repaints a window of the root: a `clip` capture of the box the change stayed
 * inside, which has everything that paints there. Anything this cannot prove is a full
 * frame, with the reason on the frame. The pointer counts only through `:hover` rules: a move
 * repaints the elements whose match it changed.
 *
 * Measured 2026-10-23, 1000px grid, one card's text changed per frame, median ms per frame
 * (full / patch): 400 cards Chromium 11.7 / 4.2, Firefox 28 / 4, WebKit 20 / 4; 2000 cards
 * 52.9 / 4.9, 119 / 5, 90 / 4. The patch cost tracks the changed box, not the page.
 *
 * Output: `stream.canvas` is updated in place; `onFrame` receives the dirty rects in canvas
 * pixels, so a WebGL consumer can `texSubImage2D` just those and a video consumer can use
 * `canvas.captureStream()`. Pinned by __tests__/plugin.stream.test.js, which compares every
 * patched frame against a full capture of the same DOM state.
 *
 * Built on the public capture API plus one engine contract, the internal `__subpixel` option
 * (src/engines/svg.js), which lays a patch out at the page's subpixel offset.
 * @module plugins/stream
 */
import { snapdom as capture } from '@zumer/snapdom'

// WebKit keeps toCanvas, whose draw workarounds a raw decode would skip. Every iOS browser is
// WebKit; elsewhere WebKit is AppleWebKit without a Chromium token.
const WEBKIT = typeof navigator !== 'undefined' && (/ipad|iphone|ipod/i.test(navigator.userAgent) ||
  (/applewebkit/i.test(navigator.userAgent) && !/chrome|chromium|crios|edg|opr|android/i.test(navigator.userAgent)))

const EVENTS = ['input', 'change', 'focusin', 'focusout', 'pointerover', 'pointerout', 'scroll', 'toggle']
const HOVER_EVENTS = new Set(['pointerover', 'pointerout'])
/** :hover selectors x nodes one hover query may cost. A query is linear in both: 200 x 1400
 *  took 1.5 to 1.75 ms on all three engines, 2000 x 1400 took 13 to 30. Past it the pointer
 *  repaints whatever it crosses, as it did before the query. */
const HOVER_BUDGET = 300_000
/** Cut from a :hover selector, so it matches the box the pseudo-element hangs from. */
const PSEUDO_ELEMENT = /::?(?:before|after|first-line|first-letter)\b|::[\w-]+(?:\([^)]*\))?/g
/** A patch larger than this share of the frame costs about what a full frame does. */
const MAX_PATCH_AREA = 0.5
/** Self-healing keyframe: anything the heuristics missed lasts at most this long, or 50
 *  full frames' worth of time, so the safety net costs under 2% of the main thread (a
 *  3000-card lab frame took 235 ms: every 2 s it froze the page 7 times in 8 s). */
const KEYFRAME_MS = 2000
const KEYFRAME_COST = 50

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

/** A filter that carries a change past the box it happened in. */
function spreads(cs) {
  return /blur|drop-shadow|url\(/.test(cs.filter)
}

function clips(cs) {
  return cs.overflowX !== 'visible' || cs.overflowY !== 'visible'
}

/** Visible overflow paints outside the box. */
function overflows(el, cs) {
  return !clips(cs) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
}

/** A shadow or outline paints outside the box. */
function outerInk(cs) {
  return cs.boxShadow !== 'none' || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)
}

/** Every selector that names :hover; null when a sheet cannot be read (cross origin) or a
 *  nested `&` rule cannot be queried, and then any hover may restyle. Pseudo-elements are
 *  cut: `.dot:hover::after` repaints with `.dot`. */
function hoverSelectors(root) {
  const list = []
  const walk = (rules) => {
    for (const rule of rules) {
      const sel = rule.selectorText
      if (sel?.includes(':hover')) {
        if (sel.includes('&')) throw new Error('nested')
        list.push(sel.replace(PSEUDO_ELEMENT, ''))
      }
      if (rule.cssRules) walk(rule.cssRules)
      if (rule.styleSheet) walk(rule.styleSheet.cssRules)
    }
  }
  const scope = root.getRootNode()
  try {
    for (const sheet of [...scope.styleSheets, ...(scope.adoptedStyleSheets || [])]) walk(sheet.cssRules)
  } catch { return null }
  return list
}

function inside(a, b) {
  return a.left >= b.left - 0.5 && a.top >= b.top - 0.5 && a.right <= b.right + 0.5 && a.bottom <= b.bottom + 0.5
}

/** Whether a clipping ancestor cuts into `r`: past its edges, or into a rounded corner. A
 *  clock flush with the end of a rounded scoreboard drew square corners where the page
 *  clipped them round. */
function escapesClip(r, clip, cs) {
  if (!inside(r, clip)) return true
  const radius = Math.max(...['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']
    .map((p) => parseFloat(cs[p]) || 0))
  if (!radius) return false
  return [[clip.left, clip.top], [clip.right - radius, clip.top], [clip.left, clip.bottom - radius], [clip.right - radius, clip.bottom - radius]]
    .some(([x, y]) => intersects(r, { left: x, top: y, right: x + radius, bottom: y + radius }))
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
 * @param {boolean} [options.animations=true] - false stops following running animations and
 *   transitions: an animated box keeps its last drawn pixels until a patch, a full frame or the
 *   keyframe repaints it. A transparent spinner has no host and turns its own box, so by default
 *   nearly every tick is a full frame (Zumly views at dpr 2, fps 5: 109 ms a frame, against
 *   9-13 ms patches without it).
 * @returns {{canvas: HTMLCanvasElement, stop: () => void, ready: Promise<void>, stats: object}}
 */
export function stream(element, options = {}) {
  const { onFrame, fps, patches = true, animations = true, ...rest } = options
  const opts = { ...rest, outerShadows: false, dpr: rest.dpr ?? (globalThis.devicePixelRatio || 1) }
  const k = (opts.scale ?? 1) * opts.dpr
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const dirty = new Set()
  const restyled = new Set() // elements whose own attributes changed: their box may have too
  const rects = new WeakMap() // element -> rect at the last paint that covered it
  const backdrops = new Map() // this frame's hosts that draw over a solid colour
  const movedFrom = new Map() // this frame's out-of-flow hosts that moved -> their old rect
  const regions = new Set() // this frame's hosts repainted as a window of the root
  const stats = { full: 0, patch: 0, skipped: 0, lastMs: 0 }
  let floaters = []
  let glass = [] // backdrop-filter boxes: a change under one shows through its blur
  let hoverList = null // the :hover selectors at the last full frame, null if unreadable
  let hovered = new Set() // what they matched at the last look
  let hoverMoved = false
  let forceFull = true
  let lastKeyframe = 0
  let keyframeDue = false // set from idle time once the keyframe interval has passed
  let fullMs = 0
  let idleAsked = false
  let stopped = false
  let busy = false
  let lastTick = 0
  let rootRect = null
  let animating = new Set() // targets of the animations running at the last tick
  let ox = 0, oy = 0 // canvas pixels from the canvas origin to the root's border box

  const observer = new MutationObserver(records => netTargets(records, dirty, restyled))
  observer.observe(element, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true })
  const onEvent = (e) => {
    // A pointer that crosses boxes no :hover rule matches changes no pixel. Moving over the
    // gaps of a 48-tile board made its root dirty, and every move a 300 ms full frame (Zumly,
    // dpr 2). A shadow tree's event arrives at its host, and its sheets were not read.
    if (hoverList !== null && HOVER_EVENTS.has(e.type) && e.composedPath()[0] === e.target) {
      hoverMoved = true
      return
    }
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

  /** `r` grown to whole canvas pixels, in the same root-relative CSS px. */
  function pixelRect(r) {
    return { left: (Math.floor(ox + r.left * k) - ox) / k, top: (Math.floor(oy + r.top * k) - oy) / k, right: (Math.ceil(ox + r.right * k) - ox) / k, bottom: (Math.ceil(oy + r.bottom * k) - oy) / k }
  }

  /** The nearest absolutely or fixed positioned ancestor: it leaves the flow, so its own
   *  changes of size or place move nothing else. Drawn only over a backdrop. */
  function positionedHost(node) {
    for (let el = node?.nodeType === 1 ? node : node?.parentElement; el && el !== element; el = el.parentElement) {
      const cs = getComputedStyle(el)
      if (cs.position !== 'absolute' && cs.position !== 'fixed') continue
      for (let a = el; a !== element; a = a.parentElement) {
        const as = getComputedStyle(a)
        if (hasEffect(as) || (a !== el && clips(as))) return null
      }
      return el
    }
    return null
  }

  /** Remember every box's rect and the positioned elements that can paint over others. */
  function snapshotLayout() {
    rootRect = element.getBoundingClientRect()
    floaters = []
    glass = []
    for (const el of element.querySelectorAll('*')) {
      rects.set(el, rectOf(el))
      const cs = getComputedStyle(el)
      if (cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'sticky' ||
        (cs.position === 'relative' && cs.zIndex !== 'auto') || cs.transform !== 'none') floaters.push(el)
      if (cs.backdropFilter && cs.backdropFilter !== 'none') glass.push(el)
    }
  }

  /** The elements the :hover rules match now, the root included. */
  function hoverMatches() {
    if (!hoverList) return new Set()
    const out = new Set(element.querySelectorAll(hoverList))
    if (element.matches(hoverList)) out.add(element)
    return out
  }

  /** The box a change to `node` can be repainted through, or null for a full frame. */
  function hostFor(node) {
    let el = node?.nodeType === 1 ? node : node?.parentElement
    if (!el || el === element || !element.contains(el)) return null
    const chain = [], styles = []
    for (let a = el; a && a !== element; a = a.parentElement) { chain.push(a); styles.push(getComputedStyle(a)) }
    // Search above the highest ancestor with an effect.
    let start = 0
    for (let i = 0; i < chain.length; i++) if (hasEffect(styles[i])) start = i + 1
    for (let i = start; i < chain.length; i++) {
      const cs = styles[i]
      if (!opaqueColor(cs.backgroundColor)) continue
      // Over pixels the patch does not repaint.
      if (overflows(chain[i], cs)) continue
      // A box a clipping ancestor cuts, past its edges or into a rounded corner, would be
      // drawn whole: a row half out of a 40px scroller painted its hidden half (19200 px
      // off). The host is the box itself, so the test is on its rect, not on the changed
      // node's. Resume at the outermost ancestor that cuts it.
      const r = rectOf(chain[i])
      let cut = -1
      for (let m = i + 1; m < chain.length; m++) if (clips(styles[m]) && escapesClip(r, rectOf(chain[m]), styles[m])) cut = m
      if (cut < 0) return chain[i]
      i = cut - 1
    }
    return null
  }

  /** The box a change to `node` stayed inside, to repaint as a window of the root, or null.
   *  The window has everything that paints in it, so the box needs no backdrop and may sit
   *  under positioned boxes; it must keep its rect, paint nothing new outside itself, and
   *  have no blur spread the change past it: a blurring ancestor, or a glass box over it. */
  function regionFor(node) {
    let el = node?.nodeType === 1 ? node : node?.parentElement
    for (let a = el; a; a = a === element ? null : a.parentElement) if (spreads(getComputedStyle(a))) return null
    for (; el && el !== element; el = el.parentElement) {
      const r = rectOf(el)
      const cs = getComputedStyle(el)
      if (!r.width || !r.height || !sameRect(rects.get(el) || {}, r) || overflows(el, cs)) continue
      if (restyled.has(el) && outerInk(cs)) continue
      for (const g of glass) if (!g.contains(el) && !el.contains(g) && intersects(rectOf(g), r)) return null
      return el
    }
    return null
  }

  async function full() {
    const t0 = performance.now()
    // Read before the capture, at every full frame. A pointer that moves while it runs is then
    // diffed next tick; read after it, the first capture left the events nothing to go by, and
    // a pointer over the Zumly board's gaps made the root dirty (a 400 ms full frame, 4 of 4).
    // A sheet added later counts from the next keyframe.
    const sels = hoverSelectors(element)
    hoverList = sels && sels.length * (element.getElementsByTagName('*').length + 1) <= HOVER_BUDGET ? sels.join(',') : null
    try { hovered = hoverMatches() } catch { hoverList = null }
    // A full frame is the one long task of a stream; 'auto' lets a long clone yield (#503).
    // Lab, 1000 cards under constant edits: worst frame gap 67 -> 33 ms. Under edits on
    // every frame a big tree tears and redoes in one task, which only the interval helps.
    const res = await capture(element, { fast: 'auto', ...opts })
    const { vbW, vbH, contentX = 0, contentY = 0 } = res.meta
    const src = WEBKIT ? await res.toCanvas() : await decode(res.url)
    const w = Math.round(vbW * k), h = Math.round(vbH * k)
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(src, 0, 0, w, h)
    ox = contentX * k
    oy = contentY * k
    snapshotLayout()
    lastKeyframe = performance.now()
    keyframeDue = false
    fullMs = lastKeyframe - t0
    stats.full++
    return [{ x: 0, y: 0, width: w, height: h }]
  }

  /** The solid colour behind `host` ('transparent' over a clear root) when the patch can be
   *  drawn over it and come out exact, edges and corners included; null otherwise. Needs no
   *  shadow or outline of its own (they paint outside the box, where the fill would erase
   *  them), only opaque or clear ancestor backgrounds up to the first opaque one, and no
   *  other box on the whole-pixel rect around the host, or around `old`, where a moved host
   *  was. */
  function backdropOf(host, old) {
    if (outerInk(getComputedStyle(host))) return null
    let color = null
    for (let a = host.parentElement; a && !color; a = a === element ? null : a.parentElement) {
      const s = getComputedStyle(a)
      if (s.backgroundImage !== 'none') return null
      if (opaqueColor(s.backgroundColor)) color = s.backgroundColor
      else if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') return null
    }
    const areas = [pixelRect(rectOf(host)), ...(old ? [pixelRect(old)] : [])]
    const others = [...host.parentElement.children, ...floaters]
    for (const other of others) {
      if (other === host || host.contains(other) || other.contains(host)) continue
      const or = rects.get(other)
      if (or && areas.some((a) => intersects(or, a))) return null
    }
    return color || 'transparent'
  }

  function paintBackdrop(backdrop, x, y, w, h) {
    ctx.clearRect(x, y, w, h)
    if (backdrop !== 'transparent') {
      ctx.fillStyle = backdrop
      ctx.fillRect(x, y, w, h)
    }
  }

  /** Capture one host at its subpixel phase and return its pixels, placed. */
  async function renderPatch(host) {
    const r = rectOf(host)
    // Lay the patch out at the page's subpixel phase (svg engine, options.__subpixel), so
    // its glyphs and snapped box edges land on the same pixels as in the full frame:
    // white cards on black at 1fr offsets differed on 596 pixels at phase zero.
    const left = ox + r.left * k, top = oy + r.top * k
    const x0 = Math.floor(left + 0.001), y0 = Math.floor(top + 0.001)
    const phase = { x: (left - x0) / k, y: (top - y0) / k }
    // Always passed, even at phase zero: it also lays the root out at its exact width.
    const res = await capture(host, { ...opts, __subpixel: phase })
    const { vbW, vbH, contentX = 0, contentY = 0 } = res.meta
    const x = Math.round(x0 - contentX * k), y = Math.round(y0 - contentY * k)
    const w = Math.round(vbW * k), h = Math.round(vbH * k)
    const src = WEBKIT ? await res.toCanvas() : await decode(res.url)
    const layer = document.createElement('canvas')
    layer.width = w
    layer.height = h
    const backdrop = backdrops.get(host)
    if (backdrop) {
      // Over its solid backdrop the patch is the full frame's pixels, edges included.
      const lctx = layer.getContext('2d')
      if (backdrop !== 'transparent') {
        lctx.fillStyle = backdrop
        lctx.fillRect(0, 0, w, h)
      }
      lctx.drawImage(src, 0, 0, w, h)
      return { layer, x, y, w, h, replace: true, host, drawnAt: r }
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
    return { layer, x, y, w, h, host, drawnAt: r }
  }

  /** Capture the root clipped to `host`'s box on whole canvas pixels: the full frame's
   *  pixels for that window. A value on a glass tile of the Zumly board (48 tiles, dpr 2):
   *  9 ms against 323 for the full frame, identical to it. A window over the tile's rounded
   *  corners differed on the antialiased arc, by up to 28 levels on 45 pixels (cause not
   *  found). Sixteen windows at once cost 101 ms; one window per row of them cost 149, since a
   *  row keeps every tile in it. */
  async function renderRegion(host) {
    const drawnAt = rectOf(host)
    const r = pixelRect(drawnAt)
    const res = await capture(element, { ...opts, clip: { x: rootRect.left + scrollX + r.left, y: rootRect.top + scrollY + r.top, width: r.right - r.left, height: r.bottom - r.top } })
    const { vbW, vbH, contentX = 0, contentY = 0, clip } = res.meta
    const src = WEBKIT ? await res.toCanvas() : await decode(res.url)
    const x = Math.round(ox + r.left * k), y = Math.round(oy + r.top * k)
    const w = Math.round(ox + r.right * k) - x, h = Math.round(oy + r.bottom * k) - y
    // The image starts contentX before the window, over pixels the clip culled: keep the window.
    const layer = document.createElement('canvas')
    layer.width = w
    layer.height = h
    layer.getContext('2d').drawImage(src, Math.round(ox + (clip.x - contentX) * k) - x, Math.round(oy + (clip.y - contentY) * k) - y, Math.round(vbW * k), Math.round(vbH * k))
    return { layer, x, y, w, h, replace: true, host, drawnAt }
  }

  async function patch(hosts) {
    // Captures and decodes overlap; the draws then land in one synchronous pass, so the
    // canvas never shows half a frame. Three hosts a frame (clock, KPI, list row) in
    // demos/stream-webgl.html: 11.9 ms one after another.
    const layers = await Promise.all(hosts.map((h) => regions.has(h) ? renderRegion(h) : renderPatch(h)))
    const out = []
    // The canvas clips draws past its edge; a reported rect must be clipped too, or a box
    // sliding off the stage (the lower third hides to left:-720px) hands texSubImage2D a
    // negative offset and the upload is rejected. Pinned by __tests__/plugin.stream.test.js.
    const report = (x, y, w, h) => {
      const x0 = Math.max(0, x), y0 = Math.max(0, y)
      const x1 = Math.min(canvas.width, x + w), y1 = Math.min(canvas.height, y + h)
      if (x1 > x0 && y1 > y0) out.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
    }
    for (const [host, old] of movedFrom) {
      const r = pixelRect(old)
      const x = Math.round(ox + r.left * k), y = Math.round(oy + r.top * k)
      const w = Math.round(ox + r.right * k) - x, h = Math.round(oy + r.bottom * k) - y
      paintBackdrop(backdrops.get(host), x, y, w, h)
      report(x, y, w, h)
    }
    for (const { layer, x, y, w, h, replace } of layers) {
      // A backdrop or window layer is the full frame's pixels for its whole rect: replace, not blend.
      if (replace) ctx.clearRect(x, y, w, h)
      ctx.drawImage(layer, x, y)
      report(x, y, w, h)
    }
    movedFrom.clear()
    // Remember where each host was drawn, not where it is now: a sliding box kept moving
    // while it was captured, and clearing its current rect next frame left a trail behind.
    for (const { host, drawnAt } of layers) {
      rects.set(host, drawnAt)
      for (const el of host.querySelectorAll('*')) rects.set(el, rectOf(el))
    }
    stats.patch++
    return out
  }

  /** Hosts for this frame, or the reason only a full frame is safe. */
  function plan() {
    if (!patches) return 'patches off'
    if (forceFull) return 'resize'
    if (keyframeDue) return 'keyframe'
    const now = element.getBoundingClientRect()
    if (!sameRect({ left: 0, top: 0, width: now.width, height: now.height }, { left: 0, top: 0, width: rootRect.width, height: rootRect.height })) return 'root resized'
    rootRect = now
    const hosts = new Set()
    regions.clear()
    for (const node of dirty) {
      if (!node?.isConnected) return 'node removed'
      let host = hostFor(node)
      // A box that moved or resized may have moved its siblings, and a restyled box may have
      // changed its own edges, which only a solid backdrop lets the patch redraw. If an
      // enclosing host kept its rect, the change stayed inside it: repaint that box instead.
      while (host && (!sameRect(rects.get(host) || {}, rectOf(host)) || (restyled.has(host) && !backdropOf(host)))) host = hostFor(host.parentElement)
      if (!host) {
        // Out of the flow, a box can move or resize freely: clear where it was, draw it
        // where it is. A lower third whose name got longer.
        const p = positionedHost(node)
        const old = p && rects.get(p)
        if (old && backdropOf(p, old)) {
          host = p
          // Always clear where it was last drawn: a slide's last step can be under the
          // half-pixel sameRect allows, and the column it left kept the old edge.
          movedFrom.set(p, old)
        }
      }
      if (!host && (host = regionFor(node))) regions.add(host)
      if (!host) return `no host for ${describe(node)}`
      hosts.add(host)
    }
    // Outermost hosts only: a box inside another dirty box is repainted by it.
    for (const h of [...hosts]) {
      for (let a = h.parentElement; a && a !== element; a = a.parentElement) if (hosts.has(a)) { hosts.delete(h); break }
    }
    let area = 0
    backdrops.clear()
    for (const h of movedFrom.keys()) if (!hosts.has(h)) movedFrom.delete(h)
    for (const h of hosts) {
      const after = rectOf(h)
      area += after.width * after.height
      if (regions.has(h)) continue
      const over = floaters.find((f) => f !== h && !h.contains(f) && !f.contains(h) && intersects(rectOf(f), after))
      if (over) {
        // The window has the positioned box in it too.
        if (movedFrom.has(h) || regionFor(h) !== h) return `${describe(over)} overlaps ${describe(h)}`
        regions.add(h)
        continue
      }
      const backdrop = backdropOf(h)
      if (backdrop) backdrops.set(h, backdrop)
    }
    if (area > MAX_PATCH_AREA * rootRect.width * rootRect.height) return 'patch area too large'
    return [...hosts]
  }

  async function tick() {
    if (stopped) return
    requestAnimationFrame(tick)
    const now = performance.now()
    if (busy || (fps && now - lastTick < 1000 / fps)) return
    // A running animation repaints its target every frame, and once more when it stops: the
    // frame before a pause or the end of a transition is not where it came to rest.
    if (animations) {
      const running = new Set()
      for (const a of element.getAnimations?.({ subtree: true }) || []) {
        if (a.playState === 'running') running.add(a.effect?.target || element)
      }
      for (const target of running) dirty.add(target)
      for (const target of animating) if (!running.has(target)) dirty.add(target)
      animating = running
    }
    if (hoverMoved) {
      hoverMoved = false
      const now = hoverMatches()
      for (const el of now) if (!hovered.has(el)) dirty.add(el)
      for (const el of hovered) if (!now.has(el) && el.isConnected) dirty.add(el)
      hovered = now
    }
    netTargets(observer.takeRecords(), dirty, restyled)
    // The keyframe waits for idle time, so it never lands on top of a burst of edits.
    if (!keyframeDue && !idleAsked && now - lastKeyframe > Math.max(KEYFRAME_MS, fullMs * KEYFRAME_COST)) {
      idleAsked = true
      const due = () => { keyframeDue = true; idleAsked = false }
      if (typeof requestIdleCallback === 'function') requestIdleCallback(due, { timeout: KEYFRAME_MS })
      else due()
    }
    if (!dirty.size && !forceFull && !keyframeDue) { stats.skipped++; return }
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
      forceFull = false
      // Edits from before the capture are in it. Edits landing while it runs may come after
      // it read the DOM: they stay dirty for the first tick. Dropping them here lost them
      // until a keyframe (a 1000-card lab under edits kept stale cards for seconds).
      await full()
      netTargets(observer.takeRecords(), dirty, restyled)
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
