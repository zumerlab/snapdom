/**
 * Differential recapture (burst v2): when only SUBTREES of a burst-tracked element mutated,
 * rebuild just those subtrees against the retained clone from the last full capture, splice
 * them in, regenerate the class CSS and re-serialize. The expensive per-node work (computed
 * style reads, snapshotting, pseudo inlining, asset passes) becomes O(dirty subtree); the
 * remaining whole-tree steps (class re-application, XML serialization) are string/DOM walks
 * measured at ~1-2ms even on large captures.
 *
 * Correctness contract: this is a FAST PATH with a hard fallback — `tryDiffCapture` returns
 * null on ANY doubt (unsupported option, heavy content in the subtree, structure drift,
 * selector semantics that can leak across subtrees) and the caller runs the full pipeline.
 * The output for the supported cases must be visually identical to a full capture of the
 * same DOM state (guarded by regression tests comparing both pixel-wise).
 * @module diff
 */

import { deepClone } from './clone.js'
import { composeAndSerialize } from '../engines/svg.js'
import { applyStyleClass, wrapScrolledClone } from './prepare.js'
import { inlinePseudoElements } from '../modules/pseudo.js'
import { inlineImages } from '../modules/images.js'
import { inlineBackgroundImages } from '../modules/background.js'
import { compressCloneAssets } from '../modules/compress.js'
import { ligatureIconToImage } from '../modules/iconFonts.js'
import { universeFor, inlineAllStyles } from '../modules/styles.js'
import { generateCSSClasses } from '../utils/index.js'
import { resolveBlobUrlsInTree } from '../utils/clone.helpers.js'
import { sanitizeCloneForXHTML } from '../utils/capture.helpers.js'
import { hasImpureRenderPlugins } from './plugins.js'

/** Content whose capture involves whole-tree or root-coupled machinery (svg defs hoisting,
 *  nested rasterization, shadow scoping…) — a dirty subtree touching any of these goes full. */
const HEAVY_SUBTREE = 'svg,iframe,canvas,video,audio,object,embed,slot,template,picture,style'

/** Selector/counter semantics that let a mutation inside one subtree change rendering
 *  OUTSIDE it (sibling combinators, :has(), CSS counters) — the subtree-diff premise breaks.
 *  Memoized per property-universe identity (a new Set per style epoch). */
const relationalCache = new WeakMap()
function stylesLeakAcrossSubtrees(doc, universe) {
  if (relationalCache.has(universe)) return relationalCache.get(universe)
  let leaky = false
  const state = { budget: 20000 }
  const scanRules = (rules) => {
    for (let i = 0; i < rules.length && !leaky; i++) {
      if (--state.budget < 0) { leaky = true; return }
      const r = rules[i]
      const sel = r.selectorText
      if (sel && /[+~]|:has\(/.test(sel)) { leaky = true; return }
      const st = r.style
      if (st && (st.counterReset || st.counterIncrement || st.counterSet ||
        (st.content && st.content.includes('counter')))) { leaky = true; return }
      if (r.cssRules && r.cssRules.length) scanRules(r.cssRules)
    }
  }
  try {
    for (const sheet of doc.styleSheets) {
      let rules = null
      try { rules = sheet.cssRules } catch { leaky = true }
      if (leaky) break
      if (rules) scanRules(rules)
    }
    if (!leaky) {
      const adopted = /** @type {any} */ (doc).adoptedStyleSheets
      if (Array.isArray(adopted)) {
        for (const sheet of adopted) {
          if (leaky) break
          try { scanRules(sheet.cssRules) } catch { leaky = true }
        }
      }
    }
  } catch { leaky = true }
  relationalCache.set(universe, leaky)
  return leaky
}

/** A frozen length is not the raw computed one: getStyleKey rounds widths UP to the next
 *  1/16px so a shrink-to-fit box can't re-wrap. Comparing it against a raw getComputedStyle
 *  value therefore reports drift on every fractional box — 279 of 282 nodes on a plain
 *  3-column flex grid — and the reconcile then re-runs inlineAllStyles over the whole tree
 *  on every differential frame. Real layout drift is orders of magnitude bigger than the
 *  rounding, so compare with the rounding step as tolerance. */
const FROZEN_LENGTH_EPS = 1 / 16
function sameFrozenLength(live, frozen) {
  if (live === frozen) return true
  if (!live.endsWith('px') || !frozen.endsWith('px')) return false
  const a = parseFloat(live), b = parseFloat(frozen)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= FROZEN_LENGTH_EPS
}

/** Parsed box geometry from a style key, memoized per key string (keys are deduped). */
const keyGeomCache = new Map()
const GEOM_PROPS = ['width', 'height', 'min-width', 'min-height']
function geomOfKey(key) {
  let g = keyGeomCache.get(key)
  if (g === undefined) {
    g = null
    for (const p of GEOM_PROPS) {
      const m = key.match(new RegExp('(?:^|;)' + p + ':([^;]+)'))
      if (m && m[1].endsWith('px')) (g ||= {})[p] = m[1]
    }
    if (keyGeomCache.size > 5000) keyGeomCache.clear()
    keyGeomCache.set(key, g)
  }
  return g
}

function stripGeneratedClasses(node) {
  if (!node.classList || !node.classList.length) return
  for (const cls of Array.from(node.classList)) {
    if (/^c\d+$/.test(cls)) node.classList.remove(cls)
  }
}

function pruneSubtreeFromMaps(oldRoot, R) {
  const stack = [oldRoot]
  while (stack.length) {
    const n = stack.pop()
    if (n.nodeType === 1) {
      const src = R.nodeMap.get(n)
      if (src !== undefined) {
        R.nodeMap.delete(n)
        if (R.srcToClone.get(src) === n) R.srcToClone.delete(src)
      }
      R.styleMap.delete(n)
    }
    for (let c = n.firstChild; c; c = c.nextSibling) stack.push(c)
  }
}

/**
 * Attempts a differential recapture. Returns the fresh SVG data URL, or null when the
 * fast path doesn't apply (caller must run the full pipeline).
 * @param {Element} element - burst-tracked capture root
 * @param {object} state - burst state (retained artifacts + dirtyRoots)
 * @param {object} context - normalized capture context
 * @returns {Promise<string|null>}
 */
/** Test/diagnostic counters — how often the fast path was attempted and actually served. */
export const __diffStats = { attempts: 0, served: 0, reconciled: 0 }

export async function tryDiffCapture(element, state, context) {
  __diffStats.attempts++
  try {
    const url = await diffCapture(element, state, context)
    if (url) __diffStats.served++
    return url
  } catch {
    return null // any failure → full pipeline; the fast path must never cost correctness
  }
}

async function diffCapture(element, state, context) {
  const R = state.retained
  if (!R || !R.clone || !R.styleMap || !R.srcToClone) return null
  // Root/whole-tree coupled features: their passes read or reshape the entire clone.
  if (context.reconcile || context.clip || R.clipWindow) return null
  // Fonts were embedded in the retained capture: a dirty subtree can introduce codepoints
  // or faces the embedded set lacks — only the full pipeline recollects usage.
  if (R.fontsCSS) return null
  // Render-affecting plugins: beforeRender would mutate retained state, and the rebuilt
  // subtree would skip whole-tree work. Full pipeline unless declared pure.
  if (hasImpureRenderPlugins(context)) return null
  // `pure` promises deterministic and idempotent; it does NOT promise SUBTREE-LOCAL, and
  // these two hooks are exactly where that gap bites. An afterClone that rewrites the whole
  // clone never re-runs on the spliced region, and resolveNode hooks are collected inside
  // captureDOM (options.__resolveNodeHooks), which this path never reaches, so the deepClone
  // below would silently skip every one of them. Bail regardless of `pure`: the memo hit,
  // which serves an unchanged result, is the path where `pure` still means something.
  for (const p of context.plugins || []) {
    if (p && (typeof p.resolveNode === 'function' || typeof p.afterClone === 'function')) return null
  }
  // Scoped ::marker/::first-line rules are attribute-keyed per element — a rebuilt or
  // removed subtree would strand/miss rules and break the byte-equality guarantee.
  if (R.classPrefixCSS && (R.classPrefixCSS.includes('::marker') || R.classPrefixCSS.includes('::first-line'))) return null
  if (context.excludeMode === 'remove') return null

  const doc = element.ownerDocument || document
  const universe = universeFor(element)
  if (!universe) return null // unreadable (cross-origin) CSS: can't rule out leaky selectors
  if (stylesLeakAcrossSubtrees(doc, universe)) return null

  // Outermost dirty roots only; every root must still be a live descendant of the capture.
  const roots = []
  outer: for (const r of state.dirtyRoots) {
    if (!r.isConnected || r === element || !element.contains(r)) return null
    for (const other of state.dirtyRoots) {
      if (other !== r && other !== element && other.contains(r)) continue outer
    }
    roots.push(r)
  }
  if (!roots.length) return null

  for (const src of roots) {
    // Direct children interact with root margin-collapse neutralization — keep it full.
    if (src.parentElement === element) return null
    if (src.matches?.(HEAVY_SUBTREE) || src.querySelector?.(HEAVY_SUBTREE)) return null
    const oldClone = R.srcToClone.get(src)
    if (!oldClone || !oldClone.parentNode) return null

    // Rebuild the subtree through the same passes the full pipeline runs for that region,
    // sharing the retained styleMap/styleCache (class dedup accumulates) with a fresh
    // delta nodeMap so subtree-scoped passes see only their own nodes.
    const delta = new Map()
    const sessionCache = { styleMap: R.styleMap, styleCache: R.styleCache, nodeMap: delta, options: context }
    const sub = await deepClone(src, sessionCache, context)
    if (!sub || sub.nodeType !== 1) return null
    if (sub.querySelector?.('style[data-sd]')) return null // shadow content appeared → full

    await inlinePseudoElements(src, sub, sessionCache, context)
    // Newly-appearing scoped ::marker/::first-line rules can't be spliced into the
    // retained prefix CSS byte-faithfully → full pipeline.
    if (sessionCache.__pseudoCSS) return null
    await resolveBlobUrlsInTree(sub, sessionCache)
    sanitizeCloneForXHTML(sub)
    try { await ligatureIconToImage(sub, src, delta) } catch { /* parity with full: non-blocking */ }
    await inlineImages(sub, context)
    await inlineBackgroundImages(src, sub, R.styleCache, context, delta)
    if (context.compress) {
      try { await compressCloneAssets(sub, context, delta) } catch { /* parity with full */ }
    }
    for (const [cloneNode, srcNode] of delta.entries()) wrapScrolledClone(cloneNode, srcNode)

    oldClone.replaceWith(sub)
    pruneSubtreeFromMaps(oldClone, R)
    for (const [cloneNode, srcNode] of delta.entries()) {
      R.nodeMap.set(cloneNode, srcNode)
      R.srcToClone.set(srcNode, cloneNode)
    }
  }

  // Geometry reconcile: a subtree mutation can reflow its NEIGHBORHOOD (grid/flex/table
  // tracks, float wrapping), going stale in frozen sibling boxes (softened min-widths,
  // measured sizes). One pass over the retained pairs refreshes the style key of every box
  // whose computed geometry drifted — the same values a full pipeline would snapshot at the
  // current epoch, so byte-fidelity holds without bailing on layout-changing mutations.
  const sessionLike = { styleMap: R.styleMap, styleCache: R.styleCache, nodeMap: R.nodeMap, options: context }
  for (const [cloneN, srcN] of R.nodeMap.entries()) {
    if (!srcN || srcN.nodeType !== 1 || !srcN.isConnected) continue
    const key = R.styleMap.get(cloneN)
    if (!key) continue
    const frozen = geomOfKey(key)
    if (!frozen) continue
    let cs = null
    let drifted = false
    for (const p in frozen) {
      cs ||= getComputedStyle(srcN)
      if (!sameFrozenLength(cs.getPropertyValue(p), frozen[p])) { drifted = true; break }
    }
    if (drifted) { __diffStats.reconciled++; await inlineAllStyles(srcN, cloneN, sessionLike, context) }
  }

  // Class numbering is positional over the sorted key set, so new keys renumber: strip the
  // generated classes everywhere and re-apply against the fresh keyToClass.
  const keyToClass = generateCSSClasses(R.styleMap)
  for (const [node, key] of R.styleMap.entries()) {
    stripGeneratedClasses(node)
    applyStyleClass(node, key, keyToClass)
  }
  const classCSS = (R.classPrefixCSS || '') +
    Array.from(keyToClass.entries()).map(([key, cn]) => `.${cn}{${key}}`).join('')

  return composeAndSerialize(
    {
      element,
      options: context,
      plugins: context.plugins,
      clone: R.clone,
      classCSS,
      styleCache: R.styleCache,
      nodeMap: R.nodeMap
    },
    {
      clipWindow: null,
      outerTransforms: R.outerTransforms,
      outerShadows: R.outerShadows,
      rootTransform2D: R.rootTransform2D,
      fontsCSS: R.fontsCSS || ''
    }
  )
}
