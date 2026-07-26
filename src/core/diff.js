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
import { composeAndSerialize } from './capture.js'
import { applyStyleClass, wrapScrolledClone } from './prepare.js'
import { inlinePseudoElements } from '../modules/pseudo.js'
import { inlineImages } from '../modules/images.js'
import { inlineBackgroundImages } from '../modules/background.js'
import { compressCloneAssets } from '../modules/compress.js'
import { ligatureIconToImage } from '../modules/iconFonts.js'
import { universeFor } from '../modules/styles.js'
import { generateCSSClasses } from '../utils/index.js'
import { resolveBlobUrlsInTree } from '../utils/clone.helpers.js'
import { sanitizeCloneForXHTML } from '../utils/capture.helpers.js'

/** Content whose capture involves whole-tree or root-coupled machinery (svg defs hoisting,
 *  nested rasterization, shadow scoping…) — a dirty subtree touching any of these goes full. */
const GEOMETRY_PROPS = ['width', 'height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'display', 'position']
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
export const __diffStats = { attempts: 0, served: 0 }

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
  if (context.excludeMode === 'remove' || context.filterMode === 'remove') return null

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

    // Layout-ripple guard: frozen styles OUTSIDE this subtree (softened min-widths,
    // measured boxes of siblings) are only still valid if this subtree's outer geometry
    // didn't change. Compare the source's current box/margins against what the old
    // clone's style key froze pre-mutation; any drift → the mutation reflowed the
    // neighborhood and only the full pipeline sees it.
    const oldKey = R.styleMap.get(oldClone) || ''
    const frozen = {}
    for (const part of oldKey.split(';')) {
      const ci = part.indexOf(':')
      if (ci > 0) frozen[part.slice(0, ci)] = part.slice(ci + 1)
    }
    if (!frozen.width || !frozen.height) return null
    const csSrc = getComputedStyle(src)
    for (const p of GEOMETRY_PROPS) {
      if (frozen[p] !== undefined && csSrc.getPropertyValue(p) !== frozen[p]) return null
    }

    // Rebuild the subtree through the same passes the full pipeline runs for that region,
    // sharing the retained styleMap/styleCache (class dedup accumulates) with a fresh
    // delta nodeMap so subtree-scoped passes see only their own nodes.
    const delta = new Map()
    const sessionCache = { styleMap: R.styleMap, styleCache: R.styleCache, nodeMap: delta, options: context }
    const sub = await deepClone(src, sessionCache, context)
    if (!sub || sub.nodeType !== 1) return null
    if (sub.querySelector?.('style[data-sd]')) return null // shadow content appeared → full

    await inlinePseudoElements(src, sub, sessionCache, context)
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
      fast: context.fast,
      fontsCSS: R.fontsCSS || ''
    }
  )
}
