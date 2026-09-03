import { getDefaultStyleForTag, getStyleKey, softensWidth, softenNeedsAutoWidth, shouldIgnoreProp, getStyle, NO_DEFAULTS_TAGS, _invalidateSplitCaches } from '../utils/index.js'
import { cache } from '../core/cache.js'

const snapshotCache = new WeakMap()
const snapshotKeyCache = new Map()
/** PERF-4: evict snapshotKeyCache when it grows beyond this size.
 *  Each entry stores a long CSS signature string → key string. In SPAs with many
 *  unique element styles, this Map can grow without bound and leak memory. */
const MAX_SNAPSHOT_KEY_CACHE = 2000
let __epoch = 0
// Per-document allow-list state: Document -> {epoch, set:Set|null, fingerprint:string|null}
const __docState = new WeakMap()
function bumpEpoch() {
  __epoch++
  try { _invalidateSplitCaches?.() } catch {}
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

const __wiredDocs = new WeakMap()
function setupInvalidationOnce(root = document.documentElement) {
  const doc = (root && root.ownerDocument) || document
  if (__wiredDocs.has(doc)) return
  __wiredDocs.set(doc, true)
  const onRecords = (records) => { if (hasExternalMutation(records)) bumpEpoch() }
  try {
    const target = doc.documentElement || root
    const domObs = new MutationObserver(onRecords)
    domObs.observe(target, { subtree: true, childList: true, characterData: true, attributes: true })
  } catch { }
  try {
    const head = doc.head
    if (head) {
      const headObs = new MutationObserver(onRecords)
      headObs.observe(head, { subtree: true, childList: true, characterData: true, attributes: true })
    }
  } catch { }
  try {
    const f = doc.fonts || document.fonts
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

// PERF-5: "used property" allow-list (Juan's v3 idea). Reading every one of the ~370
// `style.length` computed properties per node is the single biggest cost in a capture.
// But the vast majority are browser defaults that contribute nothing to a static snapshot.
// We scan the document's author stylesheets ONCE per epoch to learn which CSS properties
// the page can actually set, then only snapshot those (plus a small set of module-required
// props the engine reads explicitly). Any authored property lands in the allow-set, so the
// output is identical for everything the author styled; only true UA defaults are skipped.
// This is ~2x faster than reading all props and is safe: a property not in the allow-set
// can never carry an authored (non-default) value.
const SHORTHAND_EXPANSIONS = new Map([
  ['margin', ['margin-top','margin-right','margin-bottom','margin-left','margin-block-start','margin-block-end','margin-inline-start','margin-inline-end']],
  ['padding', ['padding-top','padding-right','padding-bottom','padding-left','padding-block-start','padding-block-end','padding-inline-start','padding-inline-end']],
  ['border', ['border-top-width','border-top-style','border-top-color','border-right-width','border-right-style','border-right-color','border-bottom-width','border-bottom-style','border-bottom-color','border-left-width','border-left-style','border-left-color','border-width','border-style','border-color','border-block-start-width','border-block-start-style','border-block-start-color','border-block-end-width','border-block-end-style','border-block-end-color','border-inline-start-width','border-inline-start-style','border-inline-start-color','border-inline-end-width','border-inline-end-style','border-inline-end-color']],
  ['border-width', ['border-top-width','border-right-width','border-bottom-width','border-left-width','border-block-start-width','border-block-end-width','border-inline-start-width','border-inline-end-width']],
  ['border-style', ['border-top-style','border-right-style','border-bottom-style','border-left-style','border-block-start-style','border-block-end-style','border-inline-start-style','border-inline-end-style']],
  ['border-color', ['border-top-color','border-right-color','border-bottom-color','border-left-color','border-block-start-color','border-block-end-color','border-inline-start-color','border-inline-end-color']],
  ['border-radius', ['border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius','border-start-start-radius','border-start-end-radius','border-end-start-radius','border-end-end-radius']],
  ['background', ['background-image','background-color','background-position','background-position-x','background-position-y','background-size','background-repeat','background-attachment','background-origin','background-clip','background-blend-mode']],
  ['background-position', ['background-position-x','background-position-y']],
  ['font', ['font-family','font-size','font-weight','font-style','font-variant','line-height','font-stretch','font-size-adjust','font-kerning']],
  ['flex', ['flex-grow','flex-shrink','flex-basis','flex-direction','flex-wrap']],
  ['gap', ['row-gap','column-gap']],
  ['inset', ['top','right','bottom','left','inset-block-start','inset-block-end','inset-inline-start','inset-inline-end']],
  ['overflow', ['overflow-x','overflow-y','overflow-block','overflow-inline']],
  ['text-decoration', ['text-decoration-line','text-decoration-color','text-decoration-style','text-decoration-thickness','text-underline-offset']],
])
function addWithExpansion(prop, set) {
  if (shouldIgnoreProp(prop)) return
  const ex = SHORTHAND_EXPANSIONS.get(prop)
  // A shorthand carries exactly its longhands' information, so only the longhands enter
  // the set: snapshots stay shorthand-free (smaller signatures/keys, fewer
  // getPropertyValue calls per node) while getStyleKey emits identical CSS from longhands.
  // Shorthands without an expansion (grid, mask, border-image, …) are kept as-is.
  if (ex) {
    for (const p of ex) {
      if (!shouldIgnoreProp(p)) set.add(p)
    }
    return
  }
  set.add(prop)
}
const MODULE_REQUIRED_PROPS = [
  'background-image', 'background-color', 'content-visibility',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-image-source', 'background', 'min-width', 'min-height',
  'text-decoration-line', 'text-decoration-color', 'text-decoration-style',
  'text-decoration-thickness', 'text-underline-offset', 'text-decoration-skip-ink',
  '-webkit-text-stroke', '-webkit-text-stroke-width', '-webkit-text-stroke-color', 'paint-order',
  'font-feature-settings', 'font-variation-settings', 'font-kerning', 'font-variant',
  'font-variant-ligatures', 'font-optical-sizing', 'animation-name',
  'width', 'height', 'display', 'position', 'color', 'font-size', 'font-family',
  'margin', 'padding', 'border', 'opacity', 'transform', 'box-shadow', 'background-clip',
  'overflow', 'flex', 'grid', 'gap', 'z-index', 'visibility', 'mix-blend-mode',
  // border-radius longhands (both physical and logical — computed exposes both)
  'border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius',
  'border-start-start-radius','border-start-end-radius','border-end-start-radius','border-end-end-radius',
  '-webkit-text-fill-color',
  // logical sizes and origins that otherwise appear as dropped non-defaults
  'block-size','inline-size','min-block-size','min-inline-size','max-block-size','max-inline-size',
  'perspective-origin','transform-origin','unicode-bidi',
  'caret-color','column-rule-color','row-rule-color','outline-color','text-emphasis-color',
  // background/mask/border-image props needed by inlineBackgroundImages — ensure they are
  // always in the snapshot so that pass can reuse the snapshot instead of re-reading
  'mask','mask-image','-webkit-mask','-webkit-mask-image','mask-source','mask-box-image-source','mask-border-source','-webkit-mask-box-image-source','border-image',
  'mask-position','mask-size','mask-repeat','mask-mode','mask-composite','-webkit-mask-position','-webkit-mask-size','-webkit-mask-repeat','-webkit-mask-composite','mask-origin','mask-clip','-webkit-mask-origin','-webkit-mask-clip','-webkit-mask-position-x','-webkit-mask-position-y',
  'background-position','background-position-x','background-position-y','background-size','background-repeat','background-origin','background-clip','background-attachment','background-blend-mode',
  'border-image-slice','border-image-width','border-image-outset','border-image-repeat'
]
/** Collect every open ShadowRoot under a start element, recursing through nested hosts. */
function collectShadowRootsFrom(startEl) {
  const out = []
  try {
    if (!startEl) return out
    const stack = [startEl]
    const seen = new Set()
    while (stack.length) {
      const el = stack.pop()
      if (!el || seen.has(el)) continue
      seen.add(el)
      let sr = null
      try { sr = el.shadowRoot } catch {}
      if (sr) {
        out.push(sr)
        for (let i = sr.children.length - 1; i >= 0; i--) stack.push(sr.children[i])
      }
      const kids = el.children
      if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
    }
  } catch {}
  return out
}

/** Shadow scopes relevant to a capture root: descendants' scopes plus any scopes above the
 *  root (capturing inside a shadow tree still inherits them). Document author styles are
 *  global, but shadow styles only apply inside their tree, so small captures no longer pay
 *  a whole-document walk. */
function collectCaptureShadowRoots(root) {
  const out = collectShadowRootsFrom(root)
  try {
    const seen = new Set(out)
    let n = root
    while (n) {
      const r = n.getRootNode ? n.getRootNode() : null
      if (r && r instanceof ShadowRoot) {
        if (!seen.has(r)) { seen.add(r); out.push(r) }
        n = r.host
      } else break
    }
  } catch {}
  return out
}

/**
 * Build the allow-set and a fingerprint for a document in ONE scan.
 * Fingerprint is a join of sheet identity + cssText; any CSSOM mutation that
 * changes values or structure changes the fingerprint. Cross-origin denial
 * yields {set:null, fingerprint:null} fallback.
 */
function buildAllowSetAndFingerprint(doc, root) {
  const set = new Set()
  for (const p of MODULE_REQUIRED_PROPS) addWithExpansion(p, set)
  const hashParts = []
  let readable = true
  const collectFromSheets = (sheets) => {
    for (const sheet of sheets) {
      let rules
      try { rules = sheet.cssRules } catch { return false }
      if (!rules) continue
      try { hashParts.push(`sheet:${sheet.href||''}:${sheet.disabled}:${sheet.media?sheet.media.mediaText:''}:${rules.length}`) } catch {}
      if (!collectSheetProps(rules, set, hashParts)) return false
    }
    return true
  }
  try {
    readable = collectFromSheets(doc.styleSheets)
    if (readable) {
      const adopted = doc.adoptedStyleSheets
      if (adopted && adopted.length) readable = collectFromSheets(adopted)
    }
    if (readable) {
      const shadowRoots = (root && root.nodeType === 1)
        ? collectCaptureShadowRoots(root)
        : collectShadowRootsFrom(doc.documentElement)
      for (const sr of shadowRoots) {
        if (!readable) break
        if (sr.adoptedStyleSheets && sr.adoptedStyleSheets.length) {
          readable = collectFromSheets(sr.adoptedStyleSheets)
        }
        if (readable && sr.styleSheets) {
          try { readable = collectFromSheets(sr.styleSheets) } catch { readable = false }
        }
        if (readable) {
          for (const st of sr.querySelectorAll('style')) {
            const sheet = st.sheet
            if (sheet) {
              let rules
              try { rules = sheet.cssRules } catch { readable = false; break }
              if (rules && !collectSheetProps(rules, set, hashParts)) { readable = false; break }
              try { hashParts.push(`style:${st.textContent?st.textContent.length:0}`) } catch {}
            } else {
              try { hashParts.push(`style:text:${st.textContent||''}`) } catch {}
              const m = st.textContent ? st.textContent.match(/([a-z-]+)\s*:/gi) : null
              if (m) for (const raw of m) addWithExpansion(raw.slice(0,-1).trim().toLowerCase(), set)
            }
          }
        }
      }
    }
  } catch { readable = false }
  if (!readable) return { set: null, sorted: null, fingerprint: null, usesVars: true }
  const sorted = [...set].sort()
  const fingerprint = hashParts.join('\n')
  return { set, sorted, fingerprint, usesVars: VAR_RE.test(fingerprint) }
}

// Epoch-keyed flag: does any scanned author CSS use var()? Lets resolveCSSVars skip its
// per-node baseline comparison (1 getComputedStyle + 5 getPropertyValue per node) on
// var-free pages. Unknown epoch → true (today's thorough path). seedUsedProps rebuilds
// every capture, so CSSOM-inserted var() rules are picked up on the next capture.
const VAR_RE = /var\(/i
let __authorVarsEpoch = -1
let __authorVarsSeen = true
function noteAuthorVars(epoch, usesVars, readable) {
  if (__authorVarsEpoch !== epoch) { __authorVarsEpoch = epoch; __authorVarsSeen = false }
  if (!readable || usesVars) __authorVarsSeen = true
}
export function authorUsesCssVars() {
  return __authorVarsEpoch === __epoch ? __authorVarsSeen : true
}

function getUsedPropSetForDoc(doc, epoch) {
  if (typeof window !== 'undefined' && window.__SNAPDOM_FULL_PROPS) return null
  const state = __docState.get(doc)
  if (state && state.epoch === epoch) return state.set
  const { set, sorted, fingerprint, usesVars } = buildAllowSetAndFingerprint(doc, null)
  noteAuthorVars(epoch, usesVars, fingerprint !== null)
  __docState.set(doc, { epoch, set, sorted, fingerprint })
  return set
}

/** Build (once per capture) the used-prop allow-set. Call from prepareClone before the
 *  snapshot walk. Per-node inline props are piggybacked top-down inside getSnapshot, so no
 *  whole-subtree pre-walk is needed here (it was a redundant O(n) pass that also desynced
 *  `sorted` from `set`). */
export function seedUsedProps(root) {
  const doc = (root && root.ownerDocument) || document
  const before = __docState.get(doc)
  const beforeFp = before ? before.fingerprint : undefined
  const beforeEpoch = before ? before.epoch : -1
  const { set, sorted, fingerprint, usesVars } = buildAllowSetAndFingerprint(doc, root)
  // Any fingerprint change that is not already covered by a DOM-mutation epoch bump
  // must invalidate snapshots: CSSOM APIs (insertRule/deleteRule/replaceSync,
  // adoptedStyleSheets assignment, rule.style mutation) do not fire MutationObserver.
  if (beforeFp !== undefined && fingerprint !== beforeFp && beforeEpoch === __epoch) {
    if (!(beforeFp === null && fingerprint === null)) bumpEpoch()
  }
  noteAuthorVars(__epoch, usesVars, fingerprint !== null)
  __docState.set(doc, { epoch: __epoch, set, sorted, fingerprint })
}
export function getUsedPropSetDebug(doc) {
  const targetDoc = doc || document
  const state = __docState.get(targetDoc)
  return state ? state.set : null
}
// Back-compat: tests that call getUsedPropSetDebug without arg get top-doc
export function getCachedSnapshot(el) {
  const rec = snapshotCache.get(el)
  return rec && rec.epoch === __epoch ? rec.snapshot : null
}
export { snapshotComputedStyleFull }
function collectSheetProps(rules, set, hashParts) {
  for (const rule of rules) {
    if (rule.styleSheet) {
      try {
        const importedRules = rule.styleSheet.cssRules
        if (importedRules) {
          try { hashParts && hashParts.push(`import:${rule.styleSheet.href||''}`) } catch {}
          if (!collectSheetProps(importedRules, set, hashParts)) return false
        }
      } catch { return false }
    }
    let nestedRules = null
    try { nestedRules = rule.cssRules } catch { return false }
    if (nestedRules && nestedRules.length) {
      // Container rule (@media/@supports/@keyframes/…): its cssText duplicates every nested
      // rule below, so fingerprint the header only and recurse for contents. Any value,
      // selector, or condition change still flips the fingerprint via the header or a leaf.
      try { hashParts && hashParts.push(`@${rule.constructor?.name || rule.type}:${rule.conditionText || rule.name || ''}:${nestedRules.length}`) } catch {}
      if (!collectSheetProps(nestedRules, set, hashParts)) return false
      continue
    }
    if (rule.style) {
      for (let i = 0; i < rule.style.length; i++) addWithExpansion(rule.style[i], set)
    }
    // rule.cssText already contains the declarations — no separate style.cssText push.
    try { hashParts && hashParts.push(rule.cssText) } catch {}
  }
  return true
}

let __uaProbeEpoch = -1
let __uaProbeKeys = new Set()

function uaProbeKey(el) {
  let key = el.tagName || ''
  const attrs = []
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]
    const name = attr.name.toLowerCase()
    // Author selectors for these are already represented by the stylesheet allow-list.
    // Keep native/presentational attributes, which can change UA styles for form controls,
    // tables, lists, hidden/details state, writing direction, and legacy HTML markup.
    if (name === 'class' || name === 'id' || name === 'style' ||
        name.startsWith('data-') || name.startsWith('aria-')) continue
    attrs.push(`${name}=${attr.value}`)
  }
  if (attrs.length) key += `|${attrs.sort().join('|')}`
  // Some live form states do not reflect back to attributes.
  if ('checked' in el) key += `|checked=${!!el.checked}|indeterminate=${!!el.indeterminate}`
  if ('selected' in el) key += `|selected=${!!el.selected}`
  return key
}

/** Add properties whose live UA/presentational value differs from CSS `initial`.
 *  The caller already owns the computed declaration, so this costs one property-name walk per
 *  tag/native-attribute variant and no extra getComputedStyle or temporary DOM nodes. */
function collectElementUAProps(el, style, set, epoch) {
  if (__uaProbeEpoch !== epoch) {
    __uaProbeEpoch = epoch
    __uaProbeKeys = new Set()
  }
  const key = uaProbeKey(el)
  if (__uaProbeKeys.has(key)) return true
  try {
    const defaults = getDefaultStyleForTag(el.tagName)
    for (let i = 0; i < style.length; i++) {
      const prop = style[i]
      if (set.has(prop) || shouldIgnoreProp(prop)) continue
      const value = style.getPropertyValue(prop)
      if (value && value !== defaults[prop]) addWithExpansion(prop, set)
    }
    __uaProbeKeys.add(key)
    return true
  } catch {
    return false
  }
}

function snapshotComputedStyleFull(style, options = {}) {
  const out = {}
  const excludeStyleProps = options.excludeStyleProps
  let allow = options.__usedProps
  let allowSorted = options.__usedPropsSorted || null
  if (allow === undefined) {
    if (typeof window !== 'undefined' && window.__SNAPDOM_FULL_PROPS) allow = null
    else {
      const st = __docState.get(document)
      allow = st && st.epoch === __epoch ? st.set : null
      allowSorted = st && st.epoch === __epoch ? st.sorted : null
      // getSnapshot already passes the per-document set via __usedProps, so this
      // fallback is only for legacy direct calls without a capture context.
    }
  }
  // Use pre-sorted array when available to build `out` in sorted insertion order
  // so styleSignature can avoid per-node sort.
  const allowIter = allowSorted || (allow ? [...allow].sort() : null)
  // C3 micro: normalize exclude predicate once per snapshot, not per prop
  let excludePred = null
  if (excludeStyleProps) {
    if (excludeStyleProps instanceof RegExp) {
      const re = excludeStyleProps
      excludePred = (p) => re.test(p)
    } else if (typeof excludeStyleProps === 'function') {
      excludePred = excludeStyleProps
    }
  }
  // Same-declaration re-reads: `out` was just built from `style`, so on the allow path
  // without exclusions a value missing from `out` is already known-empty — re-reading it
  // live repeats the C++ call for the identical answer.
  const needLive = !allowIter || !!excludePred
  if (allowIter) {
    for (const prop of allowIter) {
      // A5: custom properties already filtered at insertion, but keep guard for safety
      if (prop[0] === '-' && prop[1] === '-') continue
      if (excludePred && excludePred(prop)) continue
      let val = ''
      try { val = style.getPropertyValue(prop) } catch { continue }
      if (!val) continue
      if ((prop === 'background-image' || prop === 'content') && val.includes('url(') && !val.includes('data:')) {
        val = 'none'
      }
      out[prop] = val
    }
  } else {
    for (let i = 0; i < style.length; i++) {
      const prop = style[i]
      if (shouldIgnoreProp(prop)) continue
      if (excludePred && excludePred(prop)) continue
      let val = style.getPropertyValue(prop)
      if ((prop === 'background-image' || prop === 'content') && val.includes('url(') && !val.includes('data:')) {
        val = 'none'
      }
      out[prop] = val
    }
  }
    // C8: Extra decoration/stroke/font loops are already covered by the allow-set
  // (all those props are in MODULE_REQUIRED_PROPS). On the allow path they are
  // guaranteed present, so skip the 17 extra getPropertyValue calls per node.
  if (!allowIter) {
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
    // content-visibility hidden — already in allow, but handle full-read fallback
    try {
      const cv = out['content-visibility'] || style.getPropertyValue('content-visibility')
      if (cv === 'hidden') out['content-visibility'] = 'hidden'
    } catch { /* ignore */ }
  } else if (out['content-visibility'] === 'hidden') {
    // On allow path, content-visibility is already captured if non-empty; nothing to do
  }

  // Flag whether inlineBackgroundImages has any work on this node (bg/mask/border-image or a
  // background-color that needs its layout longhands for background-clip:text). Read from the
  // live declaration (not `out`) so excludeStyleProps or the url()→none rewrite can't hide it.
  // Stored non-enumerable so key generation/signature iteration never sees it.
  let needsBg = false
  {
    // background-image is read from the live declaration, NOT `out`: the main loop rewrites
    // url(non-data) → 'none' (lines 98-100), which would hide real bg work. Fast-path: a
    // non-'none' value already in `out` is genuine bg work (gradients / data: urls are never
    // rewritten), so we skip the live read in that case.
    const outBgi = out['background-image']
    const bgi = (outBgi && outBgi !== 'none') ? outBgi : (needLive ? style.getPropertyValue('background-image') : '')
    if (bgi && bgi !== 'none') needsBg = true
    if (!needsBg) {
      // background-color is never rewritten, so prefer the value already captured in `out`
      // (falls back to the live declaration only when excludeStyleProps dropped it).
      const bgc = (out['background-color'] !== undefined)
        ? out['background-color']
        : (needLive ? style.getPropertyValue('background-color') : '')
      if (bgc && bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent') needsBg = true
    }
    if (!needsBg) {
      // These longhands are captured in the main loop, so read them from `out` and only fall
      // back to the live declaration when excludeStyleProps excluded them or the engine did not
      // enumerate them. Skips up to 9 getPropertyValue calls for the common no-mask/no-border-image node.
      for (const p of BG_INLINE_FLAG_PROPS) {
        const v = (out[p] !== undefined) ? out[p] : (needLive ? style.getPropertyValue(p) : '')
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
  // Prefer the values already captured in `out` (the main loop read them), falling back to
  // the live declaration only when excludeStyleProps dropped them. Avoids 4-5
  // getPropertyValue() calls per node - the same technique used for the BG-flag block above.
  const bt = parseFloat(out['border-top-width'] ?? style.getPropertyValue('border-top-width')) || 0
  const br = parseFloat(out['border-right-width'] ?? style.getPropertyValue('border-right-width')) || 0
  const bb = parseFloat(out['border-bottom-width'] ?? style.getPropertyValue('border-bottom-width')) || 0
  const bl = parseFloat(out['border-left-width'] ?? style.getPropertyValue('border-left-width')) || 0
  if (bt === 0 && br === 0 && bb === 0 && bl === 0) {
    // If border-image is being used (even with zero border widths), do NOT force
    // the shorthand `border: none` because it can override the intended rendering.
    // (Decorative border-image + 0 widths is valid CSS in some setups.)
    const bis = ((out['border-image-source'] !== undefined
      ? out['border-image-source']
      : style.getPropertyValue('border-image-source')) || '').trim()
    const hasBorderImage = bis && bis !== 'none'
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

// Hoisted: was an 8-element array allocated per node in stripHeightForWrappers.
const STRIP_HEIGHT_TAGS = new Set(['div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav'])

// Hoisted: was allocated inside the zero-border-width block, which fires for most nodes.
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
function styleSignature(snap) {
  let sig = __snapshotSig.get(snap)
  if (sig) return sig
  // Snap is built in sorted key order (see snapshotComputedStyleFull with sorted allow),
  // so Object.keys is already sorted; joining without sort is both faster and canonical.
  // Fallback to sort only for legacy snaps not built sorted.
  const keys = Object.keys(snap)
  let isSorted = true
  for (let i = 1; i < keys.length; i++) if (keys[i] < keys[i-1]) { isSorted = false; break }
  if (isSorted) sig = keys.map(k => `${k}:${snap[k]}`).join(';')
  else {
    const entries = Object.entries(snap).sort((a, b) => a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0))
    sig = entries.map(([k, v]) => `${k}:${v}`).join(';')
  }
  __snapshotSig.set(snap, sig)
  return sig
}
function getSnapshot(el, preStyle = null, options = {}) {
  const doc = (el && el.ownerDocument) || document
  const style = preStyle || getStyle(el)
  // PERF-5: piggyback inline-style collection on the snapshot walk itself (no extra
  // tree walk). Each node's own inline props are added to the per-document allow-set
  // before its snapshot is taken, so parents' inline props are already present
  // for children (top-down walk). This keeps the set minimal and pixel-perfect
  // without an extra O(n) pass.
  let usedSet = getUsedPropSetForDoc(doc, __epoch)
  let usedSorted = null
  const state = __docState.get(doc)
  if (state && state.epoch === __epoch) usedSorted = state.sorted || null
  if (usedSet && el.style) {
    const beforeSize = usedSet.size
    for (let i = 0; i < el.style.length; i++) addWithExpansion(el.style[i], usedSet)
    if (usedSet.size !== beforeSize && state) {
      // Keep sorted array in sync without full resort per node when only few props added
      // Resort is cheap for 137 entries and happens only when a new inline prop appears
      state.sorted = [...usedSet].sort()
      usedSorted = state.sorted
    }
  }
  if (usedSet && !collectElementUAProps(el, style, usedSet, __epoch)) {
    // UA inspection is part of the allow-list's fidelity proof. If it cannot complete,
    // make this document's epoch use the same conservative full-read fallback as denied stylesheets.
    __docState.set(doc, { epoch: __epoch, set: null, sorted: null, fingerprint: __docState.get(doc)?.fingerprint ?? null })
    usedSet = null
    usedSorted = null
  } else if (usedSet && state && usedSorted && usedSet.size !== usedSorted.length) {
    // UA probe added new props — resort
    state.sorted = [...usedSet].sort()
    usedSorted = state.sorted
  }
  const rec = snapshotCache.get(el)
  // The snapshot content depends on embedFonts (extra font props) and excludeStyleProps
  // (skipped props), but __epoch only bumps on DOM/font mutation — not option changes.
  // Capturing the same element twice with different options must not reuse the snapshot
  // (#348). excludeStyleProps is compared by reference: a fresh value misses safely.
  const ef = !!(options && options.embedFonts)
  const ex = (options && options.excludeStyleProps) || null
  if (rec && rec.epoch === __epoch && rec.embedFonts === ef && rec.excludeStyleProps === ex) return rec.snapshot
  // Pass the per-document allow-set explicitly (null = full-read fallback) and its
  // pre-sorted array so snapshotComputedStyleFull can build the snap in sorted order
  // and styleSignature can avoid per-node sort.
  const snapOptions = { ...options, __usedProps: usedSet, __usedPropsSorted: usedSorted }
  const snap = snapshotComputedStyleFull(style, snapOptions)
  stripHeightForWrappers(el, style, snap)
  snapshotCache.set(el, { epoch: __epoch, snapshot: snap, embedFonts: ef, excludeStyleProps: ex })
  return snap
}

const _persistSingleton = {
  snapshotKeyCache,
  defaultStyle: cache.defaultStyle,
  baseStyle: cache.baseStyle,
  image: cache.image,
  resource: cache.resource,
  background: cache.background,
  font: cache.font,
}
function _resolveCtx(sessionOrCtx, opts) {
  if (sessionOrCtx && sessionOrCtx.session && sessionOrCtx.persist) return sessionOrCtx
  if (sessionOrCtx && (sessionOrCtx.styleMap || sessionOrCtx.styleCache || sessionOrCtx.nodeMap)) {
    // C3: memoize on session object to avoid 2 allocs per node
    if (sessionOrCtx.__ctx && sessionOrCtx.__ctx.options === (opts || {})) return sessionOrCtx.__ctx
    const ctx = {
      session: sessionOrCtx,
      persist: _persistSingleton,
      options: opts || {},
    }
    try { sessionOrCtx.__ctx = ctx } catch {}
    return ctx
  }

  return {
    session: cache.session,
    persist: _persistSingleton,
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
  // B2: Skip snapshot entirely for NO_DEFAULTS_TAGS (SVG). These tags never produce a class
  // (getStyleKey returns ''), but currently pay for a full 137-prop snapshot + signature + key.
  // On icon sets/charts with thousands of <path> elements this is hundreds of thousands of
  // wasted getPropertyValue calls. Hoist the check here.
  const tagLower = source.tagName ? source.tagName.toLowerCase() : ''
  if (NO_DEFAULTS_TAGS.has(tagLower)) {
    const ctx2 = _resolveCtx(sessionOrCtx, opts)
    ctx2.session.styleMap.set(clone, '')
    // Provide minimal snapshot for needsBackgroundInline (these tags never have CSS bg)
    const mSnap = {}
    Object.defineProperty(mSnap, '__needsBgInline', { value: false, enumerable: false })
    snapshotCache.set(source, { epoch: __epoch, snapshot: mSnap, embedFonts: false, excludeStyleProps: null })
    return
  }

  const ctx = _resolveCtx(sessionOrCtx, opts)
  const resetMode = (ctx.options && ctx.options.cache) || 'auto'

  const srcDoc = source.ownerDocument || document
  if (resetMode !== 'disabled') setupInvalidationOnce(srcDoc.documentElement || document.documentElement)

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
    try { computed = getStyle(source) } catch { /* detached / cross-origin */ }
    // Fallback to the source's own document root, not the top document, for iframe support
    let fallback = null
    try { fallback = getStyle(srcDoc.documentElement) } catch {}
    const final = computed || fallback || getStyle(document.documentElement)
    session.styleCache.set(source, final)
    // Populate the global cache as well so getStyle(parent) hits without a second gcs
    try {
      let m = cache.computedStyle.get(source)
      if (!m) { m = new Map(); cache.computedStyle.set(source, m) }
      if (!m.has(null)) m.set(null, final)
    } catch {}
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
  let snapForKey = snap
  if (flexItem && (!snap['min-width'] || snap['min-width'] === 'auto' || snap['min-width'] === '0px')) {
    snapForKey = { ...snap, 'min-width': '0px' }
    if (snap.__needsBgInline !== undefined) {
      Object.defineProperty(snapForKey, '__needsBgInline', { value: snap.__needsBgInline, enumerable: false })
    }
  }

  const tag = source.tagName?.toLowerCase() || 'div'
  let sig = styleSignature(snapForKey)
  let sizedByContent = true
  if (softensWidth(tag, (snapForKey.display || '').toLowerCase())) {
    sizedByContent = hasRenderedContent(source)
    if (sizedByContent && softenNeedsAutoWidth(tag, snapForKey, flexItem) &&
        hasSpecifiedWidth(source, pre, flexItem)) {
      sizedByContent = false
    }
    // Fold tag/content/flex into the cache key so soften-eligible elements with identical styles
    // but different shape don't collide on the shared snapshotKeyCache.
    sig = `${sig}|${tag}${sizedByContent ? '|c' : ''}${flexItem ? '|f' : ''}`
    const wsMode = snapForKey['text-wrap-mode'] || snapForKey['white-space'] || ''
    if (sizedByContent && wsMode !== 'nowrap' && wsMode !== 'pre') {
      session.reconcileRisk = (session.reconcileRisk || 0) + 1
    }
  }
  // Memoize the style key by signature. Most nodes share a signature with their siblings, so this
  // turns a full getStyleKey() computation into an O(1) hit. Measured: bypassing this cache makes
  // large captures ~2x SLOWER, so it must not be removed.
  let key = persist.snapshotKeyCache.get(sig)
  if (key === undefined) {
    key = getStyleKey(snapForKey, tag, sizedByContent, flexItem)
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
// Parent display memo: siblings share parents, so this turns N getStyle+includes into one
// per parent. Epoch-keyed entries simply miss after bumpEpoch — no explicit clear needed.
const __flexParentMemo = new WeakMap()
function isFlexOrGridItem(el) {
  const p = el.parentElement
  if (!p) return false
  const m = __flexParentMemo.get(p)
  if (m && m.e === __epoch) return m.v
  // getStyle memoizes in cache.computedStyle; raw getComputedStyle forced a fresh resolution
  // per node on every capture (even on snapshot-cache hits).
  const pd = getStyle(p).display || ''
  const v = pd.includes('flex') || pd.includes('grid')
  try { __flexParentMemo.set(p, { e: __epoch, v }) } catch {}
  return v
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
  if (!tag || !STRIP_HEIGHT_TAGS.has(tag)) return

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
