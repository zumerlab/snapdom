/**
 * Burst memoization: a scoped MutationObserver plus caching of the last result per
 * element, so repeated captures of an unchanged subtree return instantly (dashboard polling,
 * static UI export loops). Auto-engages on the first capture; mutated
 * subtrees rebuild via the differential path (diff.js).
 *
 * INVALIDATION MATRIX — every way a rendered frame can change, and who observes it
 * (ARCHITECTURE.md carries the prose version; THIS list is the wiring's source of truth):
 *  - DOM mutations ......... scoped MutationObserver (+ takeRecords flush pre-serve), below
 *  - opaque/frame sources .. video/canvas/iframe/SMIL and known animated images bypass burst
 *  - <img> loads/srcset .... pending load/error listeners plus currentSrc/dimensions signature
 *  - font loads ............ style-environment epoch (styles.js getStyleEnvEpoch)
 *  - scroll ................ capture-phase scroll listener per element (no records exist),
 *                            PLUS one per open shadow root: scroll is composed:false, so it
 *                            stops at the boundary; known offsets are also sampled so a
 *                            same-task programmatic scroll cannot beat event delivery
 *  - form-control state .... capture-phase input/change listeners (value/checked are
 *                            properties, not attributes — no records exist), plus a small
 *                            synchronous signature for programmatic writes. `change` is
 *                            composed:false, hence the per-shadow-root listener
 *  - :hover ................ scoped document/shadow signatures before a possible memo serve
 *  - outside selector state  root style stamp from styles.js after a synchronous flush
 *                            (ancestors/siblings/:has()/container dependencies)
 *  - window resize ......... env epoch (media queries flip with no mutation)
 *  - <head> CSS ............ env epoch (head observer)
 *  - same-tick <style> ..... flushStyleInvalidations at capture start (records are async)
 *  - CSS/WAAPI animations .. getAnimations({subtree}) per capture: memo never serves nor
 *                            persists while running; targeted subtrees become dirty roots
 *                            for the diff path with invalidateSnapshotsUnder per frame
 *  - mid-capture edits ..... records that land WHILE a capture runs are buffered and judged
 *                            once it ends (hasTornMutation): a net change that is not the
 *                            pipeline's own self-undoing work leaves the element dirty, so a
 *                            torn frame is never memoized
 *  - mid-capture EVENTS .... the record-less sources above (scroll/input/change/focus/pointer)
 *                            set `state.torn` instead of being dropped. There is nothing to
 *                            judge afterwards — no target, no oldValue — and nothing to
 *                            judge: the pipeline never types, scrolls or moves focus inside
 *                            the captured subtree, so any of these is external by
 *                            construction and the frame is torn
 *  - shadow DOM ............ one observer per open root, plus the composed:false listeners
 *                            and the <img> tracker (querySelectorAll does not cross
 *                            the boundary either), rescanned per capture so a root attached
 *                            after the memo is also caught (trackShadowRoots).
 *                            Costs one subtree walk per capture: ~1ms at 8k nodes, against
 *                            a memo that replaces a ~100ms pipeline. Closed roots cannot
 *                            be observed by anyone → `invalidate: true` territory.
 *  - canvas pixel draws .... bypass burst (invisible to every observer)
 *  - CSSOM rule edits ...... EXCLUDED (insertRule/rule.style.*) → `invalidate: true`
 *  - impure render plugins . suspend auto memo/diff (plugins.js hasImpureRenderPlugins)
 *
 * State lives in a WeakMap and a bounded 64-entry LRU. Eviction disconnects every observer
 * and listener, including pending-image listeners.
 * @module burst
 */

import {
  isExternalRecord,
  getStyleEnvEpoch,
  getStyleEpoch,
  getStyleStamp,
  getOutsideMutationCount,
  flushStyleInvalidations,
  invalidateHoverChanges,
  invalidateStyleCaches,
  invalidateSnapshotsUnder,
} from '../modules/styles.js'
import { tryDiffCapture } from './diff.js'

/** Per-element state lookup; the bounded LRU below retains and disposes live memos. */
const burstStates = new WeakMap()
/** Open roots found by the API's safety scan, consumed by create/run tracking so one call
 *  does not walk the same subtree twice before deciding a memo hit. */
const safetyScans = new WeakMap()
/** Roots whose fetched bytes revealed an opaque animation only after inlining. Once known,
 *  keep them on the fresh path instead of rebuilding and immediately disposing state on
 *  every capture. Weak ownership means detaching the root still frees the entry. */
const knownFrameDriven = new WeakSet()
// Data URLs are immutable; classify each element's current sources only when they change.
// Weak keys release the last payload with the element. Pinned by core.burst.inlineImages.
const animationSources = new WeakMap()

/**
 * Memoization engages on an element's FIRST capture (api/snapdom.js): there is no threshold
 * to trip, because an unchanged element is served and a changed one is invalidated or
 * rebuilt through the diff path either way (there used to be one, three captures in two
 * seconds, decided 2026-09-04 to go). What the threshold was really guarding is guarded
 * here instead: how many elements keep a live memo at once. Past the cap the least recently
 * served memo is torn down (disposeState); its element captures fresh next time and
 * re-enters at the back. Pinned by __tests__/core.burst.firstCapture.test.js.
 */
const MAX_LIVE_MEMOS = 64
/** Elements with a live memo, oldest first. A Map keeps insertion order; re-insert to bump. */
const liveMemos = new Map()

/** The element's listeners on itself (createState), all capture-phase. */
const ELEMENT_EVENTS = [
  'scroll', 'input', 'change', 'focusin', 'focusout',
  'pointerdown', 'pointerup', 'pointercancel',
  'keydown', 'keyup', 'beforetoggle', 'toggle',
]

// Browser preferences can flip synchronously without a DOM record or resize event. Width,
// height, DPR and orientation are represented separately in renderStateOf.
const MEDIA_QUERIES = [
  '(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)',
  '(prefers-contrast: more)', '(forced-colors: active)',
  '(inverted-colors: inverted)', '(prefers-reduced-transparency: reduce)',
  '(hover: hover)', '(any-hover: hover)', '(pointer: coarse)', '(any-pointer: coarse)',
  '(color-gamut: p3)', '(dynamic-range: high)',
]
function mediaEnvironmentSignature(doc) {
  const view = doc?.defaultView
  if (typeof view?.matchMedia !== 'function') return ''
  return MEDIA_QUERIES.map((query) => {
    try { return view.matchMedia(query).matches ? '1' : '0' } catch { return '?' }
  }).join('')
}

/** Geometry can change because a flex/grid sibling outside the capture changed. The global
 * style epoch is the cheap gate; layout is read only after some external state actually moved. */
function geometrySignature(element) {
  const values = []
  for (let el = element; el;) {
    try {
      const rect = el.getBoundingClientRect()
      values.push(rect.x, rect.y, rect.width, rect.height)
    } catch { values.push('?') }
    if (el.parentElement) el = el.parentElement
    else el = el.getRootNode?.()?.host || null
  }
  return values.join('|')
}

function touchMemo(element, state) {
  if (state.disposed) return
  liveMemos.delete(element)
  liveMemos.set(element, state)
  if (liveMemos.size <= MAX_LIVE_MEMOS) return
  const [oldest, oldState] = liveMemos.entries().next().value
  disposeState(oldest, oldState)
}

/** Tear a state down: observers, listeners and the memo go; the element captures fresh. */
function disposeState(element, state) {
  state.disposed = true
  liveMemos.delete(element)
  burstStates.delete(element)
  for (const o of state.observers) { try { o.disconnect() } catch { /* gone */ } }
  for (const type of ELEMENT_EVENTS) element.removeEventListener(type, state.onMediaDirty, true)
  for (const root of state.trackedShadowRoots.keys()) {
    for (const type of SHADOW_LOCAL_EVENTS) root.removeEventListener(type, state.onMediaDirty, true)
  }
  for (const [img, once] of state.trackedImages) {
    img.removeEventListener('load', once)
    img.removeEventListener('error', once)
  }
  state.trackedImages.clear()
  state.trackedShadowRoots.clear()
  state.images.length = 0
  state.controls.length = 0
  state.scrollNodes.length = 0
  state.observers.length = 0
  state.last = null
  state.retained = null
  state.retainedFrameDriven = false
}

/** Sources whose next painted frame cannot be inferred from DOM/events. Keep auto-burst for
 *  normal DOM, but bypass it entirely for these uncommon trees. One traversal also crosses
 *  open shadow roots; it replaces the old canvas-only traversal on the same hot path. */
export function isAutoBurstSafe(element) {
  if (knownFrameDriven.has(element)) return false
  safetyScans.delete(element)
  const scopes = [element]
  const controls = []
  const images = []
  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i]
    const nodes = []
    if (scope?.nodeType === 1) nodes.push(scope)
    try { nodes.push(...scope.querySelectorAll('*')) } catch { return false }
    for (const el of nodes) {
      if (el.shadowRoot) scopes.push(el.shadowRoot)
      const tag = String(el.localName || el.tagName || '').toLowerCase()
      if (/^(?:iframe|canvas|video|audio|object|embed|marquee|blink)$/.test(tag)) return false
      if (tag === 'progress' && !el.hasAttribute('value')) return false
      if (/^(?:animate|animatetransform|animatemotion|set)$/.test(tag)) return false
      let src = ''
      if (tag === 'img') {
        images.push(el)
        try { src = el.currentSrc || el.src || '' } catch { }
      }
      if (/^(?:input|textarea|select|option)$/.test(tag)) controls.push(el)
      const style = el.getAttribute?.('style') || ''
      let record = animationSources.get(el)
      if (src || style) {
        if (!record || record.src !== src || record.style !== style) {
          record = { src, style, animated: containsAnimatedUrl(src) || containsAnimatedUrl(style) }
          animationSources.set(el, record)
        }
        if (record.animated) return false
      } else if (record) animationSources.delete(el)
    }
  }
  safetyScans.set(element, { roots: scopes.slice(1), controls, images })
  return true
}

/**
 * A MutationObserver with `subtree: true` does NOT cross a shadow boundary, so every web
 * component's internal updates were invisible to the memo and auto mode served pre-update
 * frames indefinitely. Each open root gets its own observer, feeding the same markDirty.
 * Re-scanned per capture, which also catches roots attached AFTER the memo was taken —
 * those are content the retained clone never saw, so they invalidate on sight.
 * Closed roots stay unreachable by design; nothing can observe them.
 */
function trackShadowRoots(element, state) {
  if (!element.querySelectorAll) return false
  const scanned = safetyScans.get(element)
  safetyScans.delete(element)
  const roots = new Set(scanned?.roots || [])
  if (scanned) {
    state.controls = scanned.controls
    state.scannedImages = scanned.images
  }
  if (!scanned) {
    const bases = [element]
    for (let i = 0; i < bases.length; i++) {
      const base = bases[i]
      if (base.shadowRoot && !roots.has(base.shadowRoot)) {
        roots.add(base.shadowRoot)
        bases.push(base.shadowRoot)
      }
      for (const el of base.querySelectorAll('*')) {
        if (el.shadowRoot && !roots.has(el.shadowRoot)) {
          roots.add(el.shadowRoot)
          bases.push(el.shadowRoot)
        }
      }
    }
  }
  for (const [root, obs] of state.trackedShadowRoots) {
    if (!roots.has(root)) {
      try { obs.disconnect() } catch { /* already gone */ }
      for (const type of SHADOW_LOCAL_EVENTS) root.removeEventListener(type, state.onMediaDirty, true)
      state.trackedShadowRoots.delete(root)
      const i = state.observers.indexOf(obs)
      if (i >= 0) state.observers.splice(i, 1)
    }
  }
  for (const root of roots) {
    if (state.trackedShadowRoots.has(root)) continue
    try {
      const o = new MutationObserver(state.markDirty)
      o.observe(root, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true })
      o.__flush = state.markDirty
      state.observers.push(o)
      state.trackedShadowRoots.set(root, o)
      // The record-less half of the matrix needs its own wiring here. The listeners on the
      // captured element cover the light DOM and, through composition, `input` and focus from
      // inside a shadow tree — but `scroll` and `change` are composed:false, so they stop AT
      // the shadow boundary and never reached it. A scrolled pane inside a web component
      // served its pre-scroll frame forever. The root itself is where those events end up.
      for (const type of SHADOW_LOCAL_EVENTS) root.addEventListener(type, state.onMediaDirty, { capture: true, passive: true })
      // Newly seen root: its content was never part of the retained capture.
      if (state.retained) state.dirtyAll()
    } catch { /* degrade: this root's changes won't invalidate */ }
  }
  return !!scanned
}

/** Events that do NOT compose out of a shadow tree, so the host's listeners never see them. */
const SHADOW_LOCAL_EVENTS = ['scroll', 'change', 'beforetoggle', 'toggle']

/** The light tree plus each recursively discovered OPEN shadow root. */
function scopesOf(element, state) {
  return [element, ...state.trackedShadowRoots.keys()]
}

/**
 * Image loads change layout and paint WITHOUT any DOM mutation — a memo taken while a
 * subtree <img> was still loading must not survive the load. Listeners live on the imgs
 * themselves (GC'd with the subtree) and set dirty unconditionally: even a capture in
 * flight used the pre-load layout, so its memo is stale the moment the image arrives.
 */
function trackPendingImages(element, state) {
  let imgs = state.scannedImages
  state.scannedImages = null
  if (!imgs) {
    imgs = []
    if (element.tagName === 'IMG') imgs.push(element)
    for (const scope of scopesOf(element, state)) {
      if (scope.querySelectorAll) imgs.push(...scope.querySelectorAll('img'))
    }
  }
  state.images = imgs
  // Drop the ones that are gone. `once` removes an image from the set when its load or
  // error fires, but an <img> detached while still in flight never fires either — it stayed
  // in this strong Set with two live listeners, and a list that swaps its rows faster than
  // they load accumulated them for as long as the captured element was alive.
  if (state.trackedImages.size) {
    const live = new Set(imgs)
    for (const [img, once] of state.trackedImages) {
      if (!live.has(img)) {
        img.removeEventListener('load', once)
        img.removeEventListener('error', once)
        state.trackedImages.delete(img)
      }
    }
  }
  for (const img of imgs) {
    if (img.complete || state.trackedImages.has(img)) continue
    const once = () => {
      // A load that lands WHILE a capture runs tears that frame: the pipeline read the
      // pre-load layout, so the clone it is building is already wrong. Marking only `dirty`
      // was not enough — the commit block clears `dirty` unconditionally and the finally's
      // tear check judges MutationRecords and `state.torn`, neither of which an image load
      // produces. The pre-load frame was therefore committed as clean and, since `once`
      // de-arms itself, served for every later capture. `torn` routes it through the
      // existing arm below, which drops the memo. Same reasoning as onMediaDirty.
      if (state.capturing) state.torn = true
      state.dirty = true
      state.dirtyRoots = null
      img.removeEventListener('load', once)
      img.removeEventListener('error', once)
      state.trackedImages.delete(img)
    }
    state.trackedImages.set(img, once)
    img.addEventListener('load', once)
    img.addEventListener('error', once)
  }
}

/**
 * Do the records collected during a capture describe a real change? Dropping them wholesale
 * (the old behaviour) let a concurrent external mutation vanish, so a TORN frame (half
 * pre-mutation, half post) was memoized and served as fresh. Flagging every external-looking
 * record instead would kill the memo outright on any page using text-overflow, line-clamp or
 * content-visibility:auto: the pipeline mutates those LIVE nodes and undoes them again
 * (measured: 10 such records on a two-div page).
 * A mutation whose NET effect is zero cannot change what renders, and that is the test:
 * attributes and character data compare the OLDEST recorded value against the current one, and
 * text-only childList records balance the text they added against the text they removed.
 * Anything else is a real change: an element added or removed. Character data belongs in the
 * net-zero group since the truncation bake writes `textNode.data` rather than `textContent`
 * (#485), so the ellipsis measurement now reports characterData records where it used to report
 * balanced childList pairs. Once per capture, over that capture's own records.
 * @param {MutationRecord[]} records
 * @returns {boolean}
 */
function hasTornMutation(records) {
  const attrs = new Map() // target → (attribute name → oldest recorded value)
  const chars = new Map() // text node → oldest recorded data
  const texts = new Map() // target → (text → +1 added / -1 removed)
  for (const rec of records) {
    if (!isExternalRecord(rec)) continue
    if (rec.type === 'attributes') {
      let byName = attrs.get(rec.target)
      if (!byName) attrs.set(rec.target, byName = new Map())
      if (!byName.has(rec.attributeName)) byName.set(rec.attributeName, rec.oldValue)
    } else if (rec.type === 'characterData') {
      if (!chars.has(rec.target)) chars.set(rec.target, rec.oldValue)
    } else if (rec.type === 'childList') {
      let delta = texts.get(rec.target)
      if (!delta) texts.set(rec.target, delta = new Map())
      for (const n of rec.addedNodes) {
        if (n.nodeType !== 3) return true
        delta.set(n.data, (delta.get(n.data) || 0) + 1)
      }
      for (const n of rec.removedNodes) {
        if (n.nodeType !== 3) return true
        delta.set(n.data, (delta.get(n.data) || 0) - 1)
      }
    } else return true
  }
  for (const [target, byName] of attrs) {
    for (const [name, old] of byName) if (target.getAttribute(name) !== old) return true
  }
  for (const [node, old] of chars) if (node.data !== old) return true
  for (const delta of texts.values()) {
    for (const n of delta.values()) if (n !== 0) return true
  }
  return false
}

// GIF/APNG are explicitly frame-oriented URL formats. WebP/AVIF/SVG may be animated too,
// but treating every asset in those widely-static formats as a stream would disable the main
// optimization on ordinary galleries/icons. Inline SVG animation is detected structurally.
const ANIMATED_IMAGE_RE = /(?:^data:image\/(?:gif|apng)|\.(?:gif|apng)(?=[?#)'"\s;]|$))/i
const signatureRef = (value) => value && (typeof value === 'object' || typeof value === 'function') ? refTag(value) : '-'

function dataHead(url, maxBytes = 131072) {
  url = String(url || '').trim()
  if (!/^data:/i.test(url)) return ''
  const comma = url.indexOf(',')
  if (comma < 0) return ''
  const meta = url.slice(0, comma)
  const body = url.slice(comma + 1)
  try {
    if (/;base64/i.test(meta)) {
      const chars = Math.ceil(maxBytes / 3) * 4
      return atob(body.slice(0, chars - (chars % 4)))
    }
    // Decode escapes independently instead of decodeURIComponent(chunk): truncating a large
    // UTF-8 data URL can split its final escape sequence and make decodeURIComponent throw,
    // hiding an animation marker that appeared much earlier in the payload. The signatures
    // below are ASCII, so byte-wise `%xx` decoding is sufficient and cannot fail at the cut.
    return body.slice(0, maxBytes * 3)
      .replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .slice(0, maxBytes)
  } catch { return '' }
}

function animatedDataUrl(url) {
  const mime = (url.match(/^data:([^;,]+)/i)?.[1] || '').toLowerCase()
  if (mime === 'image/gif' || mime === 'image/apng') return true
  if (!/image\/(?:png|webp|avif|svg\+xml)/.test(mime)) return false
  const head = dataHead(url)
  if (mime === 'image/png') return head.includes('acTL')
  if (mime === 'image/webp') return head.includes('ANIM') || head.includes('ANMF') ||
    (head.includes('VP8X') && !!(head.charCodeAt(head.indexOf('VP8X') + 8) & 0x02))
  if (mime === 'image/avif') return head.includes('avis')
  return /<(?:animate|animateTransform|animateMotion|set)\b|@keyframes\b|animation(?:-name)?\s*:/i.test(head)
}

function animatedUrl(value) {
  const url = String(value || '').trim()
  if (!url) return false
  if (ANIMATED_IMAGE_RE.test(url)) return true
  if (/^data:/i.test(url)) return animatedDataUrl(url)
  return false
}

/** A direct URL or any quote-aware CSS url(). Apostrophes and closing parentheses are legal
 *  inside the other quote style (and encodeURIComponent leaves apostrophes intact), so a
 *  generic "until quote/paren" character class silently truncated valid SVG data URLs. */
function containsAnimatedUrl(value) {
  const text = String(value || '')
  if (animatedUrl(text)) return true
  for (const match of text.matchAll(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)/gi)) {
    if (animatedUrl(match[1] ?? match[2] ?? match[3])) return true
  }
  return false
}

/** The completed clone already contains fetched images/backgrounds as data URLs, including
 *  blob and extensionless endpoints. Classify their container metadata once per full commit;
 *  steady memo hits never rescan base64. */
function retainedHasFrameDriven(retained, sourceRoots = null) {
  const clone = retained && retained.clone
  if (!clone) return false
  const roots = sourceRoots
    ? sourceRoots.map((source) => retained.srcToClone?.get(source)).filter(Boolean)
    : [clone]
  for (const root of roots) for (const el of elementsOf(root)) {
    if (containsAnimatedUrl(el.getAttribute?.('src')) || containsAnimatedUrl(el.getAttribute?.('href')) ||
        containsAnimatedUrl(el.getAttribute?.('style')) || containsAnimatedUrl(retained.styleMap?.get(el))) return true
  }
  return false
}

function elementsOf(scope) {
  const out = []
  if (scope && scope.nodeType === 1) out.push(scope)
  try { out.push(...scope.querySelectorAll('*')) } catch { }
  return out
}

function collectControls(element, state) {
  const controls = []
  const seen = new Set()
  const add = (el) => {
    if (el && !seen.has(el)) { seen.add(el); controls.push(el) }
  }
  if (element.matches?.('input,textarea,select,option')) add(element)
  for (const scope of scopesOf(element, state)) {
    try { for (const el of scope.querySelectorAll('input,textarea,select,option')) add(el) } catch { }
  }
  state.controls = controls
}

/** Discover scroll offsets that can repaint without a MutationRecord. The layout reads happen
 *  only when state is created or a full capture commits; memo hits sample the short list. */
function collectScrollNodes(element, state) {
  const out = []
  const seen = new Set()
  const add = (el, force = false) => {
    if (!el || seen.has(el)) return
    seen.add(el)
    try {
      if (force || el.scrollLeft || el.scrollTop || el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight) out.push(el)
    } catch { }
  }
  for (let el = element; el; el = el.parentElement) add(el, true)
  for (const scope of scopesOf(element, state)) for (const el of elementsOf(scope)) add(el)
  state.scrollNodes = out
}

/** State that can change what paints while producing no MutationRecord. It is sampled before
 *  every possible memo serve, so same-task property writes and browser preference changes do
 *  not depend on asynchronous event delivery. Sample the tracked controls/images/scrollers;
 *  compare their fields directly so a data URL or long textarea is not serialized per hit. */
function renderStateOf(element, state) {
  const doc = element.ownerDocument || document
  const view = doc.defaultView
  const style = [
    view?.location?.hash || '',
    mediaEnvironmentSignature(doc),
    view?.innerWidth || 0,
    view?.innerHeight || 0,
    view?.devicePixelRatio || 1,
    view?.screen?.orientation?.type || '',
  ]
  try { style.push(...[...(doc.adoptedStyleSheets || [])].map(signatureRef)) } catch { }
  for (const root of state.trackedShadowRoots.keys()) {
    try { style.push('#shadow', ...[...(root.adoptedStyleSheets || [])].map(signatureRef)) } catch { }
  }
  const active = doc.activeElement
  const fullscreen = doc.fullscreenElement
  if (active?.contains(element) || element.contains(active)) style.push(signatureRef(active))
  if (fullscreen?.contains(element) || element.contains(fullscreen)) style.push(signatureRef(fullscreen))
  const scroll = [view?.scrollX || 0, view?.scrollY || 0]
  for (const el of state.scrollNodes) scroll.push(el.scrollLeft || 0, el.scrollTop || 0)
  const controls = []
  for (const el of state.controls) {
    const tag = String(el.localName || '').toLowerCase()
    if (tag === 'input') controls.push(el.type, el.value, el.checked ? 1 : 0, el.indeterminate ? 1 : 0)
    else if (tag === 'textarea') controls.push(el.value)
    else if (tag === 'select') controls.push(el.selectedIndex, el.value)
    else controls.push(el.selected ? 1 : 0)
  }
  const images = []
  for (const img of state.images) {
    let src = ''
    try { src = img.currentSrc || img.src || '' } catch { }
    images.push(src, img.complete ? 1 : 0, img.naturalWidth || 0, img.naturalHeight || 0)
  }
  return {
    style: style.join('|'),
    scroll: scroll.join('|'),
    controls,
    images,
    frameDriven: state.retainedFrameDriven,
  }
}

function sameRenderState(a, b, key) {
  if (!a) return false
  const before = a[key], after = b[key]
  if (before === after) return true
  if (!Array.isArray(before) || before.length !== after.length) return false
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) return false
  return true
}

function animationsInScopes(element, state) {
  const out = new Set()
  for (const scope of scopesOf(element, state)) {
    try {
      const animations = scope.getAnimations?.(scope.nodeType === 1 ? { subtree: true } : undefined) || []
      for (const animation of animations) out.add(animation)
    } catch { }
  }
  return [...out]
}

function animationSignature(animations) {
  return animations.map((animation) => [
    signatureRef(animation),
    animation.playState,
    Math.round((Number(animation.currentTime) || 0) * 10),
    animation.playbackRate,
  ].join(':')).join('|')
}

function targetScope(element, state, target) {
  if (!target || target.nodeType !== 1) return null
  if (target === element || element.contains(target)) return element
  for (const root of state.trackedShadowRoots.keys()) if (root.contains(target)) return root
  return null
}

/**
 * Build the tracking state for one element: the scoped MutationObserver, the capture-phase
 * listeners for the record-less half of the matrix, and the shadow and image
 * trackers. Runs once per element; captureWithBurst keeps the result in burstStates.
 */
function createState(element) {
  const state = {
    dirty: true,
    pending: [],           // records seen while capturing, judged by hasTornMutation after
    torn: false,           // a record-less interaction/scroll event landed mid-capture
    dirtyRoots: new Set(), // scoped dirty subtree roots; null = everything is dirty
    retained: null,        // artifacts from the last full capture (clone, maps, css) for diff
    retainedFrameDriven: false, // animated fetched assets classified once on full commit
    disposed: false,
    capturing: false,
    last: null,
    inflight: Promise.resolve(),
    observers: [],
    trackedShadowRoots: new Map(),
    trackedImages: new Map(),
    images: [],
    scannedImages: null,
    scrollNodes: [],
    controls: [],
    envEpoch: getStyleEnvEpoch(), // shared head+fonts environment epoch (styles.js)
    styleEpoch: getStyleEpoch(),
    styleStamp: getStyleStamp(element),
    outsideMutations: getOutsideMutationCount(element),
    geometry: null,
    renderState: null,      // synchronous record-less state, committed with the memo
  }

  const dirtyAll = () => { state.dirty = true; state.dirtyRoots = null }
  const noteDirtyRoot = (n) => {
    if (!state.dirtyRoots) return
    const el = n && (n.nodeType === 1 ? n : n.parentElement)
    // Root's own attrs, nodes outside the capture, or too many scattered roots → treat as
    // fully dirty (a class change on the root re-styles everything by inheritance anyway).
    if (!el || el === element || !element.contains(el) || state.dirtyRoots.size >= 12) {
      state.dirtyRoots = null
      return
    }
    state.dirtyRoots.add(el)
  }
  const markDirty = (records) => {
    // Mutations during a capture are MOSTLY the capture's own transient DOM work (line-clamp
    // bake, content-visibility force, …) which always undoes itself, but not all of them:
    // an external edit landing mid-capture makes the frame torn. Buffer the batch and judge
    // it once the capture ends (hasTornMutation), instead of dropping it unseen.
    if (state.capturing) {
      for (const rec of records) state.pending.push(rec)
      return
    }
    for (const rec of records) {
      if (!isExternalRecord(rec)) continue
      state.dirty = true
      noteDirtyRoot(rec.target)
    }
  }
  // The record-less half of the invalidation matrix (scroll, input/change, focus, pointer)
  // needs the same mid-capture handling markDirty gives mutations — it did not have
  // it, and simply DROPPED anything that arrived while `capturing` was true. The capture
  // then committed as a clean memo, so an <input> that went OLD → NEW during a capture was
  // answered with OLD on the next call, forever, since nothing was left to invalidate it.
  //
  // Unlike a mutation record there is nothing to judge afterwards (no target, no oldValue),
  // but there is also nothing to judge: the listeners sit on the captured element itself
  // and the pipeline never types, scrolls or moves focus inside it — its own DOM work
  // happens on clones in a sandbox outside the subtree. So the frame is torn, full stop.
  const onMediaDirty = () => {
    if (state.capturing) { state.torn = true; return }
    dirtyAll()
  }
  state.dirtyAll = dirtyAll

  try {
    const o = new MutationObserver(markDirty)
    // attributeOldValue / characterDataOldValue: hasTornMutation reads them to tell the
    // pipeline's own self-undoing edits (content-visibility force, ellipsis bake) from a real one.
    o.observe(element, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true })
    o.__flush = markDirty
    state.observers.push(o)
  } catch { /* degrade to always-dirty */ }

  state.markDirty = markDirty
  state.onMediaDirty = onMediaDirty
  // Scroll positions change rendering with NO DOM mutation (scrollTop isn't an attribute):
  // a scrolled container inside the memoized element would serve its pre-scroll frame
  // forever. scroll doesn't bubble but does capture-phase propagate — one listener covers
  // the element and every scrollable descendant. GC'd with the element like the observers.
  try {
    for (const type of ELEMENT_EVENTS) element.addEventListener(type, onMediaDirty, { capture: true, passive: true })
  } catch { /* degrade: record-less interactions won't invalidate */ }
  const usedSafetyScan = trackShadowRoots(element, state)
  if (!usedSafetyScan) collectControls(element, state)
  collectScrollNodes(element, state)
  trackPendingImages(element, state)
  return state
}

/** Identity tags for values that have no structural form (functions, class instances, DOM
 *  nodes). Different references must never collide. Identity does not prove that external
 *  state stayed unchanged: the public entry bypasses this memo for capture callbacks,
 *  while render-affecting plugins follow their explicit purity contract. */
let __refSeq = 0
const __refTags = new WeakMap()
function refTag(value) {
  let tag = __refTags.get(value)
  if (!tag) {
    tag = '@' + (++__refSeq)
    __refTags.set(value, tag)
  }
  return tag
}

/** Deterministic serializer for the options signature. Hand-rolled instead of
 *  `JSON.stringify(rest, sortedKeys)` because an ARRAY replacer applies at every depth: it
 *  filtered nested keys against the TOP-LEVEL key list, so `{clip:{x:0,…}}` and
 *  `{clip:{x:900,…}}` both serialized to `{"clip":{}}` and a memo taken for one rect was
 *  served for the other. Functions were dropped outright, which is how two different
 *  `exclude` predicates collided on one memo. Returns null only when nothing comparable can
 *  be built, and the caller treats that as a one-off. */
function stableStringify(value, seen) {
  const t = typeof value
  if (t === 'undefined') return null
  if (value === null || t === 'boolean' || t === 'number' || t === 'string') return JSON.stringify(value)
  if (t === 'function' || t === 'symbol') return t === 'symbol' ? null : JSON.stringify(refTag(value))
  if (t !== 'object') return null
  // DOM nodes and other host objects have no stable structural form: compare by identity.
  if (typeof value.nodeType === 'number') return JSON.stringify(refTag(value))
  if (seen.has(value)) return null // cycle
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const parts = []
      for (const v of value) {
        const s = stableStringify(v, seen)
        if (s === null) return null
        parts.push(s)
      }
      return '[' + parts.join(',') + ']'
    }
    // Class instances (plugin objects, Map/Set/Date…) carry state Object.keys can't see:
    // identity, not structure.
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return JSON.stringify(refTag(value))
    const parts = []
    for (const k of Object.keys(value).sort()) {
      const v = value[k]
      if (v === undefined) continue // matches JSON.stringify: absent key, not a distinct value
      const s = stableStringify(v, seen)
      if (s === null) return null
      parts.push(JSON.stringify(k) + ':' + s)
    }
    return '{' + parts.join(',') + '}'
  } finally {
    seen.delete(value)
  }
}

/** Stable signature of every option except burst/invalidate themselves, so a one-off call
 *  with different options (e.g. `{ burst: true, scale: 2 }` once) is detected as such.
 *  null means "can't be compared" — every such call is a one-off. */
function optionsSignature(userOptions, plugins) {
  const { burst: _burst, invalidate: _invalidate, ...rest } = userOptions || {}
  try {
    const serialized = stableStringify(rest, new Set())
    // Use the list attached to this capture before any awaited preparation. The current
    // global registry may have changed while Safari waited for fonts.
    return serialized === null ? null : `${(plugins || []).map(signatureRef).join(',')}:${serialized}`
  } catch {
    return null
  }
}

/**
 * Run a capture through the burst memoization for this element.
 *
 * Calls for the same element are serialized on one queue. Options that differ from the
 * element's baseline make the call a one-off: it captures fresh and leaves the memo alone,
 * until a second call repeats the new options and they become the baseline. A frame that
 * tore mid-capture is never memoized. This is where v3's large wins live: a mutating poll
 * went from 563 ms to 16 and an animated one from 39 to 7.5 (the polling scene in
 * docs/compare/live/harness.js). Pinned by __tests__/core.capture.burst.test.js,
 * __tests__/core.burst.transactional.test.js and __tests__/core.capture.autoburst.rebase.test.js.
 * @param {Element} element
 * @param {object} userOptions - the raw options passed to this call (pre-normalization)
 * @param {object} context - normalized capture context (reads context.invalidate)
 * @param {() => Promise<object>} runCapture - performs the actual full capture + export build
 * @param {(url: string) => Promise<object>} [makeResult] - builds an export result from a URL (differential path)
 * @returns {Promise<object>} the memoized or freshly captured result
 */
export function captureWithBurst(element, userOptions, context, runCapture, makeResult = null) {
  let state = burstStates.get(element)
  if (!state) {
    state = createState(element)
    state.baselineSignature = optionsSignature(userOptions, context.plugins)
    burstStates.set(element, state)
  }
  const sig = optionsSignature(userOptions, context.plugins)

  const run = async () => {
    // This call may have queued just before another element evicted its old memo. Capture it
    // fresh, but never let the detached state resurrect itself in the LRU.
    if (state.disposed) return runCapture()
    // Baseline adoption mutates shared state, so it belongs inside this same-element queue.
    // Deciding it at call time lets concurrent A,B,B calls label A's result as a B memo.
    let isOneOff = sig === null || sig !== state.baselineSignature
    if (isOneOff && sig !== null) {
      if (state.pendingSig === sig) {
        state.baselineSignature = sig
        state.last = null
        state.dirty = true
        state.dirtyRoots = null
        state.pendingSig = null
        isOneOff = false
      } else {
        state.pendingSig = sig
      }
    } else {
      state.pendingSig = null
    }
    // Before serving: a shadow root attached since the last capture produces no mutation
    // record anywhere, so it has to be discovered by scanning.
    trackShadowRoots(element, state)
    // Same for an <img> appended since the last capture's finally: it carries no load
    // listener yet, so its arrival would not invalidate the memo. Arming here as well as in
    // the finally closes the between-captures window, at one querySelectorAll('img') next
    // to the subtree walk trackShadowRoots already does.
    trackPendingImages(element, state)
    for (const o of state.observers) o.__flush(o.takeRecords())
    // The document-wide observer owns selector reach outside the capture. Drain it before a
    // memo decision so same-task sibling/ancestor mutations have already moved root's stamp.
    flushStyleInvalidations()
    const outsideMutations = getOutsideMutationCount(element)
    // A local dirty root cannot represent simultaneous ancestor/sibling/container changes.
    // Purely internal edits keep diff, including its geometry-reconcile path.
    if (state.dirty && state.outsideMutations !== outsideMutations) state.dirtyAll()
    state.outsideMutations = outsideMutations
    const root = element.getRootNode?.()
    const hoverRoots = [...state.trackedShadowRoots.keys()]
    if (root?.nodeType === 11 && !hoverRoots.includes(root)) hoverRoots.push(root)
    invalidateHoverChanges(element.ownerDocument || document, hoverRoots)
    const styleStamp = getStyleStamp(element)
    if (state.styleStamp !== styleStamp) {
      state.styleStamp = styleStamp
      // Local mutations were already scoped above; a clean root whose stamp moved was
      // restyled from outside and needs a full capture.
      if (!state.dirty) state.dirtyAll()
    }

    const liveRenderState = renderStateOf(element, state)
    const animations = animationsInScopes(element, state)
    liveRenderState.animation = animationSignature(animations)
    if (state.renderState) {
      const styleChanged = !sameRenderState(state.renderState, liveRenderState, 'style')
      if (styleChanged) {
        // Media queries, :active/:target/top-layer and programmatic form state also sit
        // below burst in the computed-style cache.
        invalidateStyleCaches()
        state.dirtyAll()
      }
      if (!sameRenderState(state.renderState, liveRenderState, 'scroll')) state.dirtyAll()
      if (!sameRenderState(state.renderState, liveRenderState, 'controls')) {
        invalidateSnapshotsUnder(element)
        state.dirtyAll()
      }
      if (!sameRenderState(state.renderState, liveRenderState, 'images') && !state.dirty) state.dirtyAll()
    }
    // Shared style-environment epoch (head CSS + font loads) — one observer stack for the
    // whole library instead of a per-element duplicate.
    const env = getStyleEnvEpoch()
    if (state.envEpoch !== env) { state.dirtyAll(); state.envEpoch = env }
    const styleEpoch = getStyleEpoch()
    if (state.styleEpoch !== styleEpoch) {
      state.styleEpoch = styleEpoch
      if (!state.dirty) {
        const geometry = geometrySignature(element)
        if (state.geometry !== null && geometry !== state.geometry) {
          invalidateSnapshotsUnder(element)
          state.dirtyAll()
        }
        state.geometry = geometry
      }
    }
    if (context.invalidate) state.dirtyAll()
    // CSS animations/transitions/WAAPI repaint every frame with NO mutation records: while
    // any runs in the subtree, every capture is a different frame — never serve OR store a
    // memo, and drop any memo taken before the animation started (it would be served as
    // soon as the animation ends, showing a pre-animation frame).
    let animationRunning = false
    let animationDirty = !!state.renderState &&
      !sameRenderState(state.renderState, liveRenderState, 'animation')
    try {
      let targets = new Set()
      if (animationDirty && animations.length === 0) targets = null
      for (const a of animations) {
        const running = a.playState === 'running'
        if (!running && !animationDirty) continue
        if (running) animationRunning = true
        animationDirty = true
        const t = a.effect?.target
        // Diff's retained source/clone maps can scope only light-DOM targets. An animation
        // in a shadow tree or iframe is still detected, but correctly falls back to full.
        if (targetScope(element, state, t) === element) targets.add(t)
        else { targets = null; break } // untargetable/non-light target → can't scope the frame
      }
      // Frame source: animated subtrees become dirty roots, so the DIFF path serves each
      // frame (styles re-snapshot at the current animation state) instead of the full
      // pipeline. Their snapshots must be invalidated per frame — animations repaint with
      // no mutation records, so the epoch never bumps.
      if (animationDirty && targets && targets.size && state.retained) {
        state.dirty = true
        for (const t of targets) {
          if (state.dirtyRoots) state.dirtyRoots.add(t)
          invalidateSnapshotsUnder(t)
        }
      } else if (animationDirty && !targets) state.dirtyAll()
    } catch { /* no Web Animations API — animations won't be detected */ }
    const frameDriven = liveRenderState.frameDriven
    const dynamic = animationRunning || frameDriven
    // Targetable WAAPI/CSS animations retain their scoped dirty roots and use diff per frame.
    // Video/GIF/SMIL sources are opaque to that machinery, so they require a full frame.
    if (dynamic) state.last = null
    if (frameDriven) {
      state.dirtyAll()
    }
    if (!isOneOff && !dynamic && !state.dirty && state.last) {
      touchMemo(element, state)
      return state.last
    }

    state.capturing = true
    let pendingRetained = null
    try {
      let result = null
      let usedDiff = false
      let diffRoots = null
      // Differential fast path: only SUBTREES are dirty and the last full capture's
      // artifacts are retained — rebuild just those subtrees and re-serialize. Any doubt
      // (null url) falls through to the full pipeline; correctness never depends on it.
      if (!isOneOff && state.dirty && state.retained && state.dirtyRoots && state.dirtyRoots.size && makeResult) {
        diffRoots = [...state.dirtyRoots]
        const url = await tryDiffCapture(element, state, context)
        if (url) {
          // buildResult is async (plugin defineExports may reject). Do not publish a clean
          // memo until that work has actually succeeded.
          result = await makeResult(url)
          usedDiff = true
        }
      }
      if (!result) {
        // Retain this full capture's artifacts for future differential recaptures, into a
        // local that is published below with the rest of the memo.
        if (!isOneOff) {
          context.__retain = (art) => {
            const srcToClone = new Map()
            for (const [cloneNode, srcNode] of art.nodeMap.entries()) srcToClone.set(srcNode, cloneNode)
            pendingRetained = { ...art, srcToClone }
          }
        }
        result = await runCapture()
      }
      // COMMIT, and only now: clearing the dirty flags before awaiting the capture marked
      // the element clean on a capture that then threw, and the next call served the
      // PREVIOUS frame as if it were fresh. A rejection leaves every flag as it was, so the
      // pending mutations stay pending and the stale memo stays unreachable.
      if (!isOneOff && !state.disposed) {
        state.dirty = false
        state.dirtyRoots = new Set()
        if (pendingRetained) {
          state.retained = pendingRetained
          state.retainedFrameDriven = retainedHasFrameDriven(pendingRetained)
          collectControls(element, state)
          collectScrollNodes(element, state)
        } else if (usedDiff) {
          // Diff mutates the retained clone/maps in place. Inspect only rebuilt roots: this
          // closes static→animated blob/extensionless changes without a whole-clone rescan.
          state.retainedFrameDriven ||= retainedHasFrameDriven(state.retained, diffRoots)
          collectControls(element, state)
          collectScrollNodes(element, state)
        }
        const committedRenderState = renderStateOf(element, state)
        committedRenderState.animation = animationSignature(animationsInScopes(element, state))
        const stableKeys = ['style', 'scroll', 'controls', 'images']
        if (!animationRunning) stableKeys.push('animation')
        const stableRenderState = stableKeys
          .every((key) => sameRenderState(liveRenderState, committedRenderState, key))
        state.renderState = committedRenderState
        state.styleEpoch = getStyleEpoch()
        state.styleStamp = getStyleStamp(element)
        state.geometry = geometrySignature(element)
        if (state.renderState.frameDriven) {
          // A fetched blob/extensionless asset can reveal that this tree is animated only
          // after the full pipeline has inlined its bytes. It can never publish a memo, so
          // keeping its retained clone/listeners outside the LRU would be an unbounded leak.
          knownFrameDriven.add(element)
          disposeState(element, state)
        } else if (!stableRenderState) {
          // A record-less state changed while the pipeline was reading it. The result may be
          // half old/half new, so return it to this caller but never publish it as a memo.
          state.dirtyAll()
          state.last = null
        } else if (!dynamic && !state.renderState.frameDriven) {
          state.last = result
          touchMemo(element, state)
        }
      }
      return result
    } finally {
      context.__retain = undefined
      for (const o of state.observers) for (const rec of o.takeRecords()) state.pending.push(rec)
      // Drain self-undoing preparation now, so it cannot appear as fresh outside work on the
      // next call. A real outside mutation during the capture still tears this frame.
      flushStyleInvalidations()
      const outsideAfterCapture = getOutsideMutationCount(element)
      // Mutations that landed mid-capture: the pipeline's own self-undoing edits are
      // ignored, a real one means the frame just built is torn: drop it and stay dirty.
      if (state.torn || hasTornMutation(state.pending) || outsideAfterCapture !== outsideMutations) {
        state.dirtyAll()
        state.last = null
      }
      state.outsideMutations = outsideAfterCapture
      state.styleEpoch = getStyleEpoch()
      state.styleStamp = getStyleStamp(element)
      state.pending.length = 0
      state.torn = false
      state.capturing = false
      if (!state.disposed) {
        trackShadowRoots(element, state) // open roots attached during capture
        trackPendingImages(element, state) // and <img>s still loading — their load must invalidate
      }
    }
  }

  // Two in-flight captures of the same element would race on this element's retained
  // burst/diff state (memo, retained clone, dirty-roots). Serialize concurrent calls on
  // one queue; a failed capture rejects only its own caller, not the whole queue.
  const next = state.inflight.then(run, run)
  state.inflight = next.catch(() => {})
  return next
}
