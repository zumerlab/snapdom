import { getStyleKey, softensWidth, softenNeedsAutoWidth, shouldIgnoreProp, getStyle } from '../utils/index.js'
import { cache } from '../core/cache.js'

const snapshotCache = new WeakMap()
const snapshotKeyCache = new Map()
/** PERF-4: evict snapshotKeyCache when it grows beyond this size.
 *  Each entry stores a long CSS signature string → key string. In SPAs with many
 *  unique element styles, this Map can grow without bound and leak memory. */
const MAX_SNAPSHOT_KEY_CACHE = 2000
let __epoch = 0
function bumpEpoch() {
  __epoch++
  // Evict when oversized — entries are cheap to rebuild on the next capture.
  if (snapshotKeyCache.size > MAX_SNAPSHOT_KEY_CACHE) snapshotKeyCache.clear()
}

export function notifyStyleEpoch() { bumpEpoch() }

/** Mutations on snapdom-owned helper nodes (sandbox, measure wrapper, warmup img, injected font
 *  links, …) must NOT invalidate the style epoch: every capture creates and removes them, so
 *  without this filter each capture poisons the snapshot cache for the next one — repeated
 *  captures (gif/video export, cached sessions) paid a full re-snapshot every time. */
const OWNED_SELECTOR = '[data-snapdom-sandbox],[data-snapdom-internal],[data-snapdom]'
function isOwnedNode(node) {
  const el = node && (node.nodeType === 1 ? node : node.parentElement)
  return !!(el && el.closest && el.closest(OWNED_SELECTOR))
}
export function hasExternalMutation(records) {
  for (const rec of records) {
    if (isOwnedNode(rec.target)) continue
    if (rec.type === 'childList') {
      let allOwned = true
      for (const n of rec.addedNodes) if (!isOwnedNode(n)) { allOwned = false; break }
      if (allOwned) for (const n of rec.removedNodes) if (!isOwnedNode(n)) { allOwned = false; break }
      if (allOwned) continue
    }
    return true
  }
  return false
}

let __wired = false
function setupInvalidationOnce(root = document.documentElement) {
  if (__wired) return
  __wired = true
  const onRecords = (records) => { if (hasExternalMutation(records)) bumpEpoch() }
  try {
    const domObs = new MutationObserver(onRecords)
    domObs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true })
  } catch { }
  try {
    const headObs = new MutationObserver(onRecords)
    headObs.observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true })
  } catch { }
  try {
    const f = document.fonts
    if (f) {
      f.addEventListener?.('loadingdone', bumpEpoch)
      f.ready?.then(() => bumpEpoch()).catch(() => { })
    }
  } catch { }
}

/** URL-bearing props that mean inlineBackgroundImages must visit the node. */
const BG_INLINE_FLAG_PROPS = [
  'mask', 'mask-image', '-webkit-mask', '-webkit-mask-image',
  'mask-source', 'mask-box-image-source', 'mask-border-source', '-webkit-mask-box-image-source',
  'border-image', 'border-image-source',
]

/**
 * Whether the background-inline pass has work on this element, per its cached style snapshot.
 * Unknown (no fresh snapshot — STYLE tags, SVG template descendants) → true, so callers fall
 * back to processing the node like before.
 * @param {Element} source
 * @returns {boolean}
 */
export function needsBackgroundInline(source) {
  const rec = snapshotCache.get(source)
  if (rec && rec.epoch === __epoch) {
    const f = rec.snapshot && rec.snapshot.__needsBgInline
    if (f !== undefined) return f
  }
  return true
}

function snapshotComputedStyleFull(style, options = {}) {
  const out = {}
  const excludeStyleProps = options.excludeStyleProps
  for (let i = 0; i < style.length; i++) {
    const prop = style[i]
    if (shouldIgnoreProp(prop)) continue
    if (excludeStyleProps) {
      if (excludeStyleProps instanceof RegExp && excludeStyleProps.test(prop)) continue
      if (typeof excludeStyleProps === 'function' && excludeStyleProps(prop)) continue
    }
    let val = style.getPropertyValue(prop)
    if ((prop === 'background-image' || prop === 'content') && val.includes('url(') && !val.includes('data:')) {
      val = 'none'
    }
    out[prop] = val
  }
    // Asegurar props de decoración de texto (algunos motores no las listan en la iteración)
  const EXTRA_TEXT_DECORATION_PROPS = [
    'text-decoration-line',
    'text-decoration-color',
    'text-decoration-style',
    'text-decoration-thickness',
    'text-underline-offset',
    'text-decoration-skip-ink'
  ]
  for (const prop of EXTRA_TEXT_DECORATION_PROPS) {
    if (out[prop]) continue
    try {
      const v = style.getPropertyValue(prop)
      if (v) out[prop] = v
    } catch {}
  }
  // #340: -webkit-text-stroke en Safari – asegurar que se capture aunque no esté en la iteración
  const TEXT_STROKE_PROPS = [
    '-webkit-text-stroke',
    '-webkit-text-stroke-width',
    '-webkit-text-stroke-color',
    'paint-order'
  ]
  for (const prop of TEXT_STROKE_PROPS) {
    if (out[prop]) continue
    try {
      const v = style.getPropertyValue(prop)
      if (v) out[prop] = v
    } catch {}
  }
  if (options.embedFonts) {
    const EXTRA_FONT_PROPS = [
      'font-feature-settings',
      'font-variation-settings',
      'font-kerning',
      'font-variant',
      'font-variant-ligatures',
      'font-optical-sizing',
    ]
    for (const prop of EXTRA_FONT_PROPS) {
      if (out[prop]) continue
      try {
        const v = style.getPropertyValue(prop)
        if (v) out[prop] = v
      } catch { }
    }
  }
  // Keep visibility as visibility. Unlike opacity, it is inherited but a child
  // may explicitly restore `visibility: visible`; flattening a hidden ancestor to
  // opacity:0 makes that legal, painted descendant impossible to recover.
  // content-visibility:hidden skips the element's CONTENTS while still painting the
  // element's own box (background, border, padding) — verified against real Chromium.
  // Carry the declaration itself so the rasterizer applies those exact semantics: mapping
  // it to visibility:hidden would erase the box too, and a descendant could override it
  // back, which the real property does not allow. Read explicitly because
  // content-visibility is not always enumerated in the style.length iteration.
  try {
    const cv = out['content-visibility'] || style.getPropertyValue('content-visibility')
    if (cv === 'hidden') out['content-visibility'] = 'hidden'
  } catch { /* ignore */ }

  // Flag whether inlineBackgroundImages has any work on this node (bg/mask/border-image or a
  // background-color that needs its layout longhands for background-clip:text). Read from the
  // live declaration (not `out`) so excludeStyleProps or the url()→none rewrite can't hide it.
  // Stored non-enumerable so key generation/signature iteration never sees it.
  let needsBg = false
  {
    const bgi = style.getPropertyValue('background-image')
    if (bgi && bgi !== 'none') needsBg = true
    if (!needsBg) {
      const bgc = style.getPropertyValue('background-color')
      if (bgc && bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent') needsBg = true
    }
    if (!needsBg) {
      for (const p of BG_INLINE_FLAG_PROPS) {
        const v = style.getPropertyValue(p)
        if (v && v !== 'none') { needsBg = true; break }
      }
    }
    if (!needsBg) {
      // #343: some engines report background-image:none while the shorthand carries url()
      const sh = style.getPropertyValue('background')
      if (sh && /url\s*\(/i.test(sh)) needsBg = true
    }
  }
  Object.defineProperty(out, '__needsBgInline', { value: needsBg, enumerable: false })

  // #362: Tailwind's * { border: 0 solid } renders incorrectly in capture.
  // When all border widths are 0, normalize to border: none for unambiguous output.
  const bt = parseFloat(style.getPropertyValue('border-top-width') || 0) || 0
  const br = parseFloat(style.getPropertyValue('border-right-width') || 0) || 0
  const bb = parseFloat(style.getPropertyValue('border-bottom-width') || 0) || 0
  const bl = parseFloat(style.getPropertyValue('border-left-width') || 0) || 0
  if (bt === 0 && br === 0 && bb === 0 && bl === 0) {
    // If border-image is being used (even with zero border widths), do NOT force
    // the shorthand `border: none` because it can override the intended rendering.
    // (Decorative border-image + 0 widths is valid CSS in some setups.)
    const bis = (style.getPropertyValue('border-image-source') || '').trim()
    const hasBorderImage = bis && bis !== 'none'
    const BORDER_PROPS = [
      'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
      'border-width', 'border-style', 'border-color',
      'border-top-width', 'border-top-style', 'border-top-color',
      'border-right-width', 'border-right-style', 'border-right-color',
      'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
      'border-left-width', 'border-left-style', 'border-left-color',
      'border-block', 'border-block-width', 'border-block-style', 'border-block-color',
      'border-inline', 'border-inline-width', 'border-inline-style', 'border-inline-color',
    ]
    for (const p of BORDER_PROPS) delete out[p]
    if (!hasBorderImage) out['border'] = 'none'
  }

  return out
}
/**
 * Cheap "is this box sized by its own content?" check: any child element or non-whitespace
 * direct text node. O(1) amortized (firstElementChild short-circuits); never reads textContent
 * so it can't go O(n²) on deep trees.
 * @param {Element} el
 */
function hasRenderedContent(el) {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 && /\S/.test(n.nodeValue || '')) return true
    // #454: an out-of-flow child doesn't size its parent — KaTeX's .hide-tail span
    // (width:100%, abspos svg inside) is sized by CSS, not content, so its width
    // must be kept verbatim instead of softened away.
    if (n.nodeType === 1) {
      const pos = getStyle(n).position
      if (pos !== 'absolute' && pos !== 'fixed') return true
    }
  }
  return false
}
/**
 * Whether the element's width is author-specified (a length/percentage) rather than derived from
 * its content or from the layout algorithm around it.
 *
 * `getComputedStyle().width` cannot answer this: it resolves to the USED width, so `auto` and
 * `width: 16px` both come back as `16px`. Typed OM reports the COMPUTED value, where `auto` stays
 * `auto` — that is the exact question, and it is available in Chromium and WebKit. Firefox has no
 * Typed OM, so there the answer is inferred from layout instead (see the two probes below).
 *
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs live computed style of `el`
 * @param {boolean} isFlexItem
 */
function hasSpecifiedWidth(el, cs, isFlexItem) {
  try {
    if (typeof el.computedStyleMap === 'function') {
      const v = el.computedStyleMap().get('width')
      if (v != null) return !isContentWidthKeyword(String(v).trim().toLowerCase())
    }
  } catch { /* fall through to the layout probes */ }
  const inlineWidth = el.style && (el.style.width || el.style.inlineSize)
  if (inlineWidth && !isContentWidthKeyword(String(inlineWidth).trim().toLowerCase())) return true
  // A box that hugs its content is sized by it — `width: max-content` / `fit-content` land here
  // too, and those must keep softening. For a block-level box, also require that the used width
  // is not simply the available width (that is what plain `width: auto` gives).
  if (!contentNarrowerThanBox(el, cs)) return false
  return isFlexItem || usedWidthDiffersFromAvailable(el, cs)
}

/** Computed `width` values that still let the box be sized by its content or its container. */
const CONTENT_WIDTH_KEYWORDS = new Set([
  'auto', 'min-content', 'max-content', 'stretch', 'fill-available', '-webkit-fill-available',
])
function isContentWidthKeyword(value) {
  // fit-content(<length>) too: the box still shrinks around its content.
  return CONTENT_WIDTH_KEYWORDS.has(value) || value.startsWith('fit-content')
}

/**
 * Fallback probe for flex/grid items: an item sized by its own content is exactly as wide as that
 * content, so a content box wider than everything inside it means the width came from CSS.
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs
 */
function contentNarrowerThanBox(el, cs) {
  const box = el.getBoundingClientRect().width -
    (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) -
    (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0)
  if (!(box > 0)) return false
  let left = Infinity, right = -Infinity, range = null
  for (let n = el.firstChild; n; n = n.nextSibling) {
    let r
    if (n.nodeType === 3) {
      if (!/\S/.test(n.nodeValue || '')) continue
      range = range || document.createRange()
      range.selectNode(n)
      r = range.getBoundingClientRect()
      if (!r.width && !r.height) continue
    } else if (n.nodeType === 1) {
      const s = getStyle(n)
      if (s.display === 'none' || s.position === 'absolute' || s.position === 'fixed') continue
      r = n.getBoundingClientRect()
    } else continue
    if (r.left < left) left = r.left
    if (r.right > right) right = r.right
  }
  if (right === -Infinity) return false
  return (right - left) < box - 0.5
}

/**
 * Fallback probe for block-level boxes in normal flow: with `width: auto` they fill the
 * containing block, so a used width that differs from the available width was authored.
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs
 */
function usedWidthDiffersFromAvailable(el, cs) {
  const parent = el.parentElement
  if (!parent) return false
  const pcs = getStyle(parent)
  const available = parent.getBoundingClientRect().width -
    (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0) -
    (parseFloat(pcs.borderLeftWidth) || 0) - (parseFloat(pcs.borderRightWidth) || 0) -
    (parseFloat(cs.marginLeft) || 0) - (parseFloat(cs.marginRight) || 0)
  if (!(available > 0)) return false
  return Math.abs(el.getBoundingClientRect().width - available) > 0.5
}

const __snapshotSig = new WeakMap()
function styleSignature(snap) {
  let sig = __snapshotSig.get(snap)
  if (sig) return sig
  const entries = Object.entries(snap).sort((a, b) => a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0))
  sig = entries.map(([k, v]) => `${k}:${v}`).join(';')
  __snapshotSig.set(snap, sig)
  return sig
}
function getSnapshot(el, preStyle = null, options = {}) {
  const rec = snapshotCache.get(el)
  // The snapshot content depends on embedFonts (extra font props) and excludeStyleProps
  // (skipped props), but __epoch only bumps on DOM/font mutation — not option changes.
  // Capturing the same element twice with different options must not reuse the snapshot
  // (#348). excludeStyleProps is compared by reference: a fresh value misses safely.
  const ef = !!(options && options.embedFonts)
  const ex = (options && options.excludeStyleProps) || null
  if (rec && rec.epoch === __epoch && rec.embedFonts === ef && rec.excludeStyleProps === ex) return rec.snapshot
  const style = preStyle || getComputedStyle(el)
  const snap = snapshotComputedStyleFull(style, options)
  stripHeightForWrappers(el, style, snap)
  snapshotCache.set(el, { epoch: __epoch, snapshot: snap, embedFonts: ef, excludeStyleProps: ex })
  return snap
}

function _resolveCtx(sessionOrCtx, opts) {
  if (sessionOrCtx && sessionOrCtx.session && sessionOrCtx.persist) return sessionOrCtx
  if (sessionOrCtx && (sessionOrCtx.styleMap || sessionOrCtx.styleCache || sessionOrCtx.nodeMap)) {
    return {
      session: sessionOrCtx,
      persist: {
        snapshotKeyCache,
        defaultStyle: cache.defaultStyle,
        baseStyle: cache.baseStyle,
        image: cache.image,
        resource: cache.resource,
        background: cache.background,
        font: cache.font,
      },
      options: opts || {},
    }
  }

  return {
    session: cache.session,
    persist: {
      snapshotKeyCache,
      defaultStyle: cache.defaultStyle,
      baseStyle: cache.baseStyle,
      image: cache.image,
      resource: cache.resource,
      background: cache.background,
      font: cache.font,
    },
    options: (sessionOrCtx || opts || {}),
  }
}

/**
 * Replaces the clone's inline style with computed (cascade-resolved) values for each
 * property that was authored inline on the source. This ensures !important rules in
 * stylesheets correctly override inline styles in the clone (fixes #328).
 * @param {Element} source
 * @param {Element} clone
 * @param {CSSStyleDeclaration} computed
 */
function normalizeInlineStyleToComputed(source, clone, computed) {
  if (!source.style || source.style.length === 0) return
  for (let i = 0; i < source.style.length; i++) {
    const prop = source.style[i]
    const val = computed.getPropertyValue(prop)
    if (val) clone.style.setProperty(prop, val)
  }
}

export async function inlineAllStyles(source, clone, sessionOrCtx, opts) {
  if (source.tagName === 'STYLE') return

  const ctx = _resolveCtx(sessionOrCtx, opts)
  const resetMode = (ctx.options && ctx.options.cache) || 'auto'

  if (resetMode !== 'disabled') setupInvalidationOnce(document.documentElement)

  if (resetMode === 'disabled' && !ctx.session.__bumpedForDisabled) {
    bumpEpoch()
    snapshotKeyCache.clear()
    ctx.session.__bumpedForDisabled = true
  }

  const { session, persist } = ctx

  if (!session.styleCache.has(source)) {
    // ROB-1: getComputedStyle() on detached nodes can return an empty or unstable
    // CSSStyleDeclaration in some environments. Wrap defensively so a stale/detached
    // element never throws and callers always receive a usable style object.
    let computed = null
    try { computed = getComputedStyle(source) } catch { /* detached / cross-origin */ }
    session.styleCache.set(source, computed || getComputedStyle(document.documentElement))
  }
  const pre = session.styleCache.get(source)

  // Replace authored inline style with computed values so !important in stylesheets
  // correctly overrides inline styles in the clone (fixes #328)
  if (source.getAttribute?.('style')) {
    normalizeInlineStyleToComputed(source, clone, pre)
  }

  // A static snapshot must not animate. The generated style class already filters animation
  // props (shouldIgnoreProp), but `animation` can still reach the SVG through the normalized
  // inline style above or through `<style>` tags cloned inside the captured subtree; when the
  // SVG is rasterized the animation replays from its 0% keyframe. An entry animation whose
  // start frame hides the element (e.g. `from { opacity: 0 }`, or an off-screen `transform`)
  // therefore blanks it out even though the live element already finished animating. Pin
  // `animation` off with inline `!important` on the elements that actually have one; the
  // current opacity/transform captured in the snapshot below then renders as the frozen,
  // already-settled frame.
  const animName = pre.getPropertyValue('animation-name')
  if (clone && clone.style && animName && animName !== 'none') {
    clone.style.setProperty('animation', 'none', 'important')
  }

  const snap = getSnapshot(source, pre, ctx.options)

  const flexItem = isFlexOrGridItem(source)

  // #406: foreignObject may resolve min-width:auto differently than normal DOM
  // for flex/grid items. Explicitly set min-width:0 on flex/grid items that have
  // the default auto value, so the generated CSS class includes it and we don't
  // need a blanket foreignObject *{min-width:0} rule (which breaks inline-flex+gap).
  if (flexItem) {
    const mw = pre.getPropertyValue('min-width')
    if (!mw || mw === 'auto' || mw === '0px') {
      snap['min-width'] = '0px'
    }
  }

  const tag = source.tagName?.toLowerCase() || 'div'
  // getStyleKey only softens width for inline-sized / table / inline boxes, and only there does
  // its output depend on content/flex-item-ness. For every other node (the vast majority — divs,
  // headings, paragraphs…) skip that bookkeeping entirely so the hot path stays untouched.
  let sig = styleSignature(snap)
  let sizedByContent = true
  if (softensWidth(tag, (snap.display || '').toLowerCase())) {
    sizedByContent = hasRenderedContent(source)
    // #484: softening only reproduces the box when its `width` is auto. On a blockified box in
    // normal flow (`span{display:block;width:16px}`) the min-width floor cannot cap the stretch,
    // and a flex/grid item gets no floor at all (#406) — both lost the authored width. Treat an
    // author-specified width as "not sized by content" so it is kept verbatim.
    if (sizedByContent && softenNeedsAutoWidth(tag, snap, flexItem) &&
        hasSpecifiedWidth(source, pre, flexItem)) {
      sizedByContent = false
    }
    // Fold tag/content/flex into the cache key so soften-eligible elements with identical styles
    // but different shape don't collide on the shared snapshotKeyCache.
    sig = `${sig}|${tag}${sizedByContent ? '|c' : ''}${flexItem ? '|f' : ''}`
    // This is the exact condition getStyleKey uses to actually drop the width (the #429/#433/
    // #434 family): tally it so capture.js can suggest `reconcile: true` when it's never used —
    // cheap, since softensWidth/sizedByContent are already computed for this node regardless.
    // Nowrap/pre boxes stay frozen (#474), so they carry no re-wrap risk.
    const wsMode = snap['text-wrap-mode'] || snap['white-space'] || ''
    if (sizedByContent && wsMode !== 'nowrap' && wsMode !== 'pre') {
      session.reconcileRisk = (session.reconcileRisk || 0) + 1
    }
  }
  let key = persist.snapshotKeyCache.get(sig)
  if (key === undefined) {
    key = getStyleKey(snap, tag, sizedByContent, flexItem)
    persist.snapshotKeyCache.set(sig, key)
  }
  session.styleMap.set(clone, key)
}
/**
 * Caja “visual”: bg/border/padding u overflow ≠ visible.
 * @param {CSSStyleDeclaration} cs
 */
function hasBox(cs) {
  if (cs.backgroundImage && cs.backgroundImage !== 'none') return true
  if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') return true
  if ((parseFloat(cs.borderTopWidth) || 0) > 0) return true
  if ((parseFloat(cs.borderBottomWidth) || 0) > 0) return true
  if ((parseFloat(cs.paddingTop) || 0) > 0) return true
  if ((parseFloat(cs.paddingBottom) || 0) > 0) return true
  const ob = cs.overflowBlock || cs.overflowY || 'visible'
  return ob !== 'visible'
}

/**
 * Item de flex/grid (mirando display del padre, 1 getComputedStyle).
 * @param {Element} el
 */
function isFlexOrGridItem(el) {
  const p = el.parentElement
  if (!p) return false
  // getStyle memoizes in cache.computedStyle; raw getComputedStyle forced a fresh resolution
  // per node on every capture (even on snapshot-cache hits).
  const pd = getStyle(p).display || ''
  return pd.includes('flex') || pd.includes('grid')
}

/**
 * ¿Hay contenido en flujo? Versión rápida:
 *  - Nodo de texto directo no vacío → true (no dispara layout).
 *  - <br> inmediato → true.
 *  - Algún hijo elemento en flujo → true.
 *
 * Both questions are about THIS element's own flow, so neither `textContent` nor a
 * scrollHeight probe can answer them: `textContent` also sees text inside absolutely
 * positioned descendants, and scrollHeight is floored at clientHeight, so a wrapper whose
 * children are all out of flow still reports its own used height. Trusting either one made
 * stripHeightForWrappers drop the height of such a wrapper, which then collapsed to 0 inside
 * the foreignObject — every following section shifted up over it.
 * @param {Element} el
 */
function hasFlowFast(el) {
  // Only direct text nodes belong to this element's flow.
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return true
  }
  const f = el.firstElementChild, l = el.lastElementChild
  if ((f && f.tagName === 'BR') || (l && l.tagName === 'BR')) return true

  // An element child contributes flow content only when it is itself in flow. getStyle
  // memoizes per node, and this runs only after the cheap text/<br> paths miss.
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    const s = getStyle(c)
    if (s.display === 'none') continue
    const pos = s.position
    if (pos !== 'absolute' && pos !== 'fixed') return true
  }
  return false
}

/**
 * Height this block would take with `height: auto`, measured from the live layout — or NaN
 * when nothing in flow could be measured.
 *
 * Only called once every other guard in stripHeightForWrappers has passed, so the element is
 * a plain block box with no vertical padding/border and `overflow: visible`: its content-box
 * top coincides with its border-box top, and the top/bottom margins of its first/last in-flow
 * children collapse straight through it. The auto height is therefore the distance from the
 * element's own top edge down to the lowest bottom edge among its in-flow contents.
 *
 * Out-of-flow (absolute/fixed) and floated children are skipped: neither contributes to the
 * auto height of a visible-overflow block. Direct text nodes are measured with a Range, which
 * reports real line boxes without touching the DOM.
 *
 * @param {Element} el
 * @returns {number}
 */
function autoContentHeight(el) {
  const top = el.getBoundingClientRect().top
  let bottom = -Infinity
  let range = null
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) {
      if (!/\S/.test(n.nodeValue || '')) continue
      range = range || document.createRange()
      range.selectNode(n)
      const r = range.getBoundingClientRect()
      if (r.width || r.height) bottom = Math.max(bottom, r.bottom)
      continue
    }
    if (n.nodeType !== 1) continue
    const s = getStyle(n)
    if (s.display === 'none') continue
    const pos = s.position
    if (pos === 'absolute' || pos === 'fixed') continue
    if (s.float && s.float !== 'none') continue
    bottom = Math.max(bottom, n.getBoundingClientRect().bottom)
  }
  return bottom === -Infinity ? NaN : bottom - top
}

/**
 * Best-effort: quita height/block-size en wrappers transparentes de flujo para permitir
 * margin-collapsing, etc. sin romper KaTeX, Orbit, ni layouts con height explícito.
 *
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs
 * @param {Record<string, any>} snap
 */
function stripHeightForWrappers(el, cs, snap) {
  // 1) Respeta height inline del autor
  if (el instanceof HTMLElement && el.style && el.style.height) return

  // 2) Solo div/section/article/main/aside/header/footer/nav (no ol/ul/li: layout de listas)
  const tag = el.tagName && el.tagName.toLowerCase()
  const ALLOWED_TAGS = ['div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav']
  if (!tag || !ALLOWED_TAGS.includes(tag)) return

  // 2c) aspect-ratio define dimensiones derivadas; respetar
  if (cs.aspectRatio && cs.aspectRatio !== 'none' && cs.aspectRatio !== 'auto') return

  // 3) Orbit: si el elemento es flex/grid, no tocar su height
  const disp = cs.display || ''
  if (disp.includes('flex') || disp.includes('grid')) return

  // 4) Guardas existentes
  //
  // (La guarda de elementos reemplazados vivía aquí y se eliminó: es inalcanzable.
  // La allow-list de (2) solo deja pasar div/section/article/main/aside/header/
  // footer/nav, y ninguno de esos puede ser un img/canvas/video/iframe/svg/object/
  // embed — la comprobación era falsa por construcción, no por casualidad.)
  const pos = cs.position
  if (pos === 'absolute' || pos === 'fixed' || pos === 'sticky') return
  if (cs.transform !== 'none') return
  if (hasBox(cs)) return
  if (isFlexOrGridItem(el)) return

  // 5) No tocar wrappers que se usan para ocultar / accesibilidad (KaTeX, screen-reader hacks, etc.)
  const overflowX = cs.overflowX || cs.overflow || 'visible'
  const overflowY = cs.overflowY || cs.overflow || 'visible'
  if (overflowX !== 'visible' || overflowY !== 'visible') return

  const clip = cs.clip
  if (clip && clip !== 'auto' && clip !== 'rect(auto, auto, auto, auto)') return

  if (cs.visibility === 'hidden' || cs.opacity === '0') return

  // 6) Solo wrappers "en flujo" realmente neutros
  if (!hasFlowFast(el)) return

  // 6b) Último filtro: solo quitar el height si el height usado es el que el elemento
  // tendría con `height: auto`. Si difiere, el autor lo fijó — venga de donde venga
  // (hoja de estilos, <style>, CSSOM, atributo inline) — y hay que respetarlo.
  //
  // Esta comprobación usaba `el.scrollHeight`, que NO puede responder la pregunta:
  // scrollHeight devuelve la altura del padding-box cuando el contenido es más corto que
  // la caja, así que un `height: 400px` alrededor de una línea de texto da
  // scrollHeight === 400 === used height, diferencia 0, y el height se borraba. Solo
  // detectaba heights fijos MENORES que el contenido (el caso raro), nunca el habitual:
  // el hijo colapsaba a su altura de contenido y el resto del canvas quedaba en blanco.
  //
  // Va al final a propósito: llegados aquí sabemos que no hay padding/borde vertical ni
  // overflow (hasBox), lo que hace que la medida de autoContentHeight sea válida, y el
  // coste de medir solo lo pagan los pocos nodos que superan todas las guardas.
  const usedH = parseFloat(cs.height)
  const autoH = autoContentHeight(el)
  const TOL = 2
  if (Number.isFinite(usedH) && Number.isFinite(autoH) && Math.abs(usedH - autoH) > TOL) return

  // 7) Ahora sí: quitamos height y block-size del snapshot
  delete snap.height
  delete snap['block-size']
}
