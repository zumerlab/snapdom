/**
 * Utilities for inlining ::before and ::after pseudo-elements.
 * @module pseudo
 */

import {
  getStyle,
  snapshotComputedStyle,
  extractURL,
  safeEncodeURI,
  inlineSingleBackgroundEntry,
  splitBackgroundImage,
  getStyleKey
} from '../utils/index.js'
import { iconToImage } from '../modules/fonts.js'
import { isIconFont } from '../modules/iconFonts.js'
import {
  buildCounterContext,
  resolveCountersInContent,
  hasCounters
} from '../modules/counter.js'
import { snapFetch } from './snapFetch.js'
import { cache } from '../core/cache.js'

/** Weak memo for per-document preflight results keyed by a cheap style fingerprint */
const __preflightMemo = new WeakMap()

/** Max number of CSS rules to scan across all sheets (keeps it fast) */
const CSS_RULE_SCAN_BUDGET = 300

/**
 * Returns whether to process pseudos, but also memoizes the last fingerprint
 * seen in the provided sessionCache to avoid stale results between tests/runs.
 * @param {Document} doc
 * @param {Map|Object} sessionCache
 * @returns {boolean}
 */
function preflightWithFp(doc, sessionCache) {
  const fp = styleFingerprint(doc)
  if (!sessionCache) return shouldProcessPseudos(doc)
  // Recompute when the fingerprint changes
  if (sessionCache.__pseudoPreflightFp !== fp) {
    sessionCache.__pseudoPreflight = shouldProcessPseudos(doc)
    sessionCache.__pseudoPreflightFp = fp
  }
  return !!sessionCache.__pseudoPreflight
}
/**
 * Safely returns cssRules for a stylesheet, or null when cross-origin/blocked.
 * @param {CSSStyleSheet} sheet
 * @returns {CSSRuleList | null}
 */
function safeRules(sheet) {
  try {
    return sheet && sheet.cssRules ? sheet.cssRules : null
  } catch {
    return null
  }
}

/**
 * Builds a cheap fingerprint of the document's stylesheet landscape.
 * Includes:
 *  - count and basic hash of <style> and <link rel="stylesheet">
 *  - adoptedStyleSheets length
 *  - total rules count (safe, no cssText) to reflect CSSOM insertRule changes
 * @param {Document} doc
 * @returns {string}
 */
function styleFingerprint(doc) {
  const nodes = doc.querySelectorAll('style,link[rel~="stylesheet"]')
  let fp = `n:${nodes.length}|`
  let totalRules = 0

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (n.tagName === 'STYLE') {
      const len = n.textContent ? n.textContent.length : 0
      fp += `S${len}|`
      // If same-origin, cssRules is readable; include count to reflect insertRule
      const sheet = /** @type {HTMLStyleElement} */(n).sheet
      const rules = sheet ? safeRules(sheet) : null
      if (rules) totalRules += rules.length
    } else {
      const href = n.getAttribute('href') || ''
      const media = n.getAttribute('media') || 'all'
      fp += `L${href}|m:${media}|`
      const sheet = /** @type {HTMLLinkElement} */(n).sheet
      const rules = sheet ? safeRules(sheet) : null
      if (rules) totalRules += rules.length
    }
  }

  const ass = /** @type {any} */ (doc).adoptedStyleSheets
  fp += `ass:${Array.isArray(ass) ? ass.length : 0}|tr:${totalRules}`

  return fp
}

/**
 * Scans a stylesheet's rules for any needle strings within a limited budget.
 * @param {CSSStyleSheet} sheet
 * @param {string[]} needles
 * @param {{budget:number}} state
 * @returns {boolean}
 */
function sheetHasNeedles(sheet, needles, state) {
  const rules = safeRules(sheet)
  if (!rules) return false

  for (let i = 0; i < rules.length; i++) {
    if (state.budget <= 0) return false
    const rule = rules[i]
    // Only read cssText when needed and decrement budget
    const css = rule && rule.cssText ? rule.cssText : ''
    state.budget--
    for (const k of needles) {
      if (css.includes(k)) return true
    }
    // Nested group rules: @media, @supports, etc.
    // @ts-ignore - CSSGroupingRule may not exist in all envs
    if (rule && rule.cssRules && rule.cssRules.length) {
      for (let j = 0; j < rule.cssRules.length && state.budget > 0; j++) {
        const inner = rule.cssRules[j]
        const innerCss = inner && inner.cssText ? inner.cssText : ''
        state.budget--
        for (const k of needles) {
          if (innerCss.includes(k)) return true
        }
      }
    }
    if (state.budget <= 0) return false
  }
  return false
}

/**
 * Fast preflight to decide whether pseudo/counter inlining is needed at all.
 * Triggers true if detects any:
 *  - ::before / ::after / ::first-letter (and single-colon variants)
 *  - counter( / counters( / counter-increment / counter-reset
 *
 * Strategy (fast → slower):
 *  1) Scan inline <style> textContent
 *  2) Scan adoptedStyleSheets (cssRules) if available
 *  3) Scan a small budget of cssRules in <style>/<link> same-origin
 *  4) Cheap DOM hint for inline styles with counter(
 *
 * Memoized by document + style fingerprint.
 *
 * @param {Document} doc
 * @returns {boolean}
 */
export function shouldProcessPseudos(doc = document) {
  const fp = styleFingerprint(doc)
  const memo = __preflightMemo.get(doc)
  if (memo && memo.fingerprint === fp) return memo.result

  const NEEDLES = [
    // double-colon
    '::before', '::after', '::first-letter',
    // single-colon robustness
    ':before', ':after', ':first-letter',
    // counters
    'counter(', 'counters(', 'counter-increment', 'counter-reset'
  ]

  // 1) Inline <style> text scan (O(total style text))
  const styleEls = doc.querySelectorAll('style')
  for (let i = 0; i < styleEls.length; i++) {
    const t = styleEls[i].textContent || ''
    for (const k of NEEDLES) if (t.includes(k)) {
      __preflightMemo.set(doc, { fingerprint: fp, result: true })
      return true
    }
  }

  // 2) adoptedStyleSheets cssRules scan (safe and fast)
  const ass = /** @type {any} */ (doc).adoptedStyleSheets
  if (Array.isArray(ass) && ass.length) {
    const state = { budget: CSS_RULE_SCAN_BUDGET }
    try {
      for (const sheet of ass) {
        if (sheetHasNeedles(sheet, NEEDLES, state)) {
          __preflightMemo.set(doc, { fingerprint: fp, result: true })
          return true
        }
      }
    } catch { /* ignore */ }
  }

  // 3) cssRules scan in <style> / <link rel="stylesheet"> (same-origin only), bounded by budget
  {
    const nodes = doc.querySelectorAll('style,link[rel~="stylesheet"]')
    const state = { budget: CSS_RULE_SCAN_BUDGET }
    for (let i = 0; i < nodes.length && state.budget > 0; i++) {
      const n = nodes[i]
      /** @type {CSSStyleSheet | null} */
      let sheet = null
      if (n.tagName === 'STYLE') {
        sheet = /** @type {HTMLStyleElement} */(n).sheet || null
      } else {
        sheet = /** @type {HTMLLinkElement} */(n).sheet || null
      }
      if (sheet && sheetHasNeedles(sheet, NEEDLES, state)) {
        __preflightMemo.set(doc, { fingerprint: fp, result: true })
        return true
      }
    }
  }

  // 4) Ultra-cheap inline style hint
  if (doc.querySelector('[style*="counter("], [style*="counters("]')) {
    __preflightMemo.set(doc, { fingerprint: fp, result: true })
    return true
  }

  __preflightMemo.set(doc, { fingerprint: fp, result: false })
  return false
}

/** Acumulador de contadores por padre para propagar increments en pseudos entre hermanos */
var __siblingCounters = new WeakMap() // parentElement -> Map<counterName, number>
var __pseudoEpoch = -1

/** Remove only enclosing double-quoted tokens from CSS content (keeps single quotes). */
function unquoteDoubleStrings(s) {
  return (s || '').replace(/"([^"]*)"/g, '$1')
}

/**
 * Concatena tokens de content (p.ej. `"1" "."`) sin introducir espacios.
 * Si no hay comillas, devuelve el unquote estándar.
 * @param {string} raw
 */
function collapseCssContent(raw) {
  if (!raw) return ''
  const tokens = []
  const rx = /"([^"]*)"/g
  let m
  while ((m = rx.exec(raw))) tokens.push(m[1])
  // Si hay tokens con comillas, concatenar sin espacios (comportamiento del browser)
  if (tokens.length) return tokens.join('')
  return unquoteDoubleStrings(raw)
}

/**
 * Crea un contexto base envuelto que aplica overrides de hermanos (si existen).
 * @param {Element} node
 * @param {{get:Function, getStack:Function}} base
 */
function withSiblingOverrides(node, base) {
  const parent = node.parentElement
  const map = parent ? __siblingCounters.get(parent) : null
  if (!map) return base
  return {
    get(n, name) {
      const v = base.get(n, name)
      const ov = map.get(name)
      // usar el mayor (o el override si existe) para mantener secuencia
      return typeof ov === 'number' ? Math.max(v, ov) : v
    },
    getStack(n, name) {
      const s = base.getStack(n, name)
      if (!s.length) return s
      const ov = map.get(name)
      if (typeof ov === 'number') {
        const out = s.slice()
        out[out.length - 1] = Math.max(out[out.length - 1], ov)
        return out
      }
      return s
    }
  }
}

/**
 * Aplica counter-reset / counter-increment del pseudo *solo para este nodo*,
 * partiendo de un contexto base (ya envuelto con overrides de hermanos).
 * @param {Element} node
 * @param {CSSStyleDeclaration|null} pseudoStyle
 * @param {{get:Function, getStack:Function}} baseCtx
 */
function deriveCounterCtxForPseudo(node, pseudoStyle, baseCtx) {
  const modStacks = new Map()

  function parseListDecl(value) {
    const out = []
    if (!value || value === 'none') return out
    for (const part of String(value).split(',')) {
      const toks = part.trim().split(/\s+/)
      const name = toks[0]
      const num = Number.isFinite(Number(toks[1])) ? Number(toks[1]) : undefined
      if (name) out.push({ name, num })
    }
    return out
  }

  const resets = parseListDecl(pseudoStyle?.counterReset)
  const incs = parseListDecl(pseudoStyle?.counterIncrement)

  function getStackDerived(name) {
    if (modStacks.has(name)) return modStacks.get(name).slice()
    let stack = baseCtx.getStack(node, name)
    stack = stack.length ? stack.slice() : []

    // reset: push si hay stack, replace si no
    const r = resets.find(x => x.name === name)
    if (r) {
      const val = Number.isFinite(r.num) ? r.num : 0
      stack = stack.length ? [...stack, val] : [val]
    }

    // increment: sobre el top, crear top=0 si no existe
    const inc = incs.find(x => x.name === name)
    if (inc) {
      const by = Number.isFinite(inc.num) ? inc.num : 1
      if (stack.length === 0) stack = [0]
      stack[stack.length - 1] += by
    }

    modStacks.set(name, stack.slice())
    return stack
  }

  return {
    get(_node, name) {
      const s = getStackDerived(name)
      return s.length ? s[s.length - 1] : 0
    },
    getStack(_node, name) {
      return getStackDerived(name)
    },
    /** expone increments del pseudo para que el caller pueda propagar a hermanos */
    __incs: incs
  }
}

/**
 * Resuelve el `content` del pseudo aplicando:
 * 1) overrides de hermanos (para continuidad entre siblings),
 * 2) reset/increment del pseudo,
 * 3) colapso de tokens `"..."` sin espacios intermedios.
 *
 * @param {Element} node
 * @param {'::before'|'::after'} pseudo
 * @param {{get:Function, getStack:Function}} baseCtx
 * @returns {{ text: string, incs: Array<{name:string,num:number|undefined}> }}
 */
function resolvePseudoContentAndIncs(node, pseudo, baseCtx) {
  let ps
  try { ps = getComputedStyle(node, pseudo) } catch { }
  const raw = ps?.content
  if (!raw || raw === 'none' || raw === 'normal') return { text: '', incs: [] }

  // 1) aplicar overrides de hermanos
  const baseWithSiblings = withSiblingOverrides(node, baseCtx)

  // 2) derivar (aplica reset/increment del pseudo)
  const derived = deriveCounterCtxForPseudo(node, ps, baseWithSiblings)

  // 3) resolver counter()/counters()
  let resolved = hasCounters(raw)
    ? resolveCountersInContent(raw, node, derived)
    : raw

  // 4) colapsar tokens (quita espacios entre "1" "." -> "1.")
  const text = collapseCssContent(resolved)
  return { text, incs: derived.__incs || [] }
}

/**
 * Creates elements to represent ::before, ::after, and ::first-letter pseudo-elements, inlining their styles and content.
 *
 * @param {Element} source - Original element
 * @param {Element} clone - Cloned element
 * @param {Map} sessionCache - styleMap cache etc.
 * @param {Object} options - capture options
 * @returns {Promise<void>}
 */
export async function inlinePseudoElements(source, clone, sessionCache, options) {
  if (!(source instanceof Element) || !(clone instanceof Element)) return
  // --- NEW: preflight once per session/doc ---
  const doc = source.ownerDocument || document
  if (!preflightWithFp(doc, sessionCache)) {
    return
  }

  // Reset per-capture: si cambió el epoch, limpiamos overrides de hermanos
  const epoch = (cache?.session?.__counterEpoch ?? 0)
  if (__pseudoEpoch !== epoch) {
    __siblingCounters = new WeakMap()
    if (sessionCache) sessionCache.__counterCtx = null
    __pseudoEpoch = epoch
  }

  if (!sessionCache.__counterCtx) {
    try { sessionCache.__counterCtx = buildCounterContext(source.ownerDocument || document) } catch { }
  }
  const counterCtx = sessionCache.__counterCtx

  for (const pseudo of ['::before', '::after', '::first-letter']) {
    try {
      const style = getStyle(source, pseudo)
      if (!style) continue
      // Skip visually empty pseudo-elements early
      const isEmptyPseudo =
        style.content === 'none' &&
        style.backgroundImage === 'none' &&
        style.backgroundColor === 'transparent' &&
        (style.borderStyle === 'none' || parseFloat(style.borderWidth) === 0) &&
        (!style.transform || style.transform === 'none') &&
        style.display === 'inline'

      if (isEmptyPseudo) continue

      if (pseudo === '::first-letter') {
        const normal = getComputedStyle(source)
        const isMeaningful =
          style.color !== normal.color ||
          style.fontSize !== normal.fontSize ||
          style.fontWeight !== normal.fontWeight
        if (!isMeaningful) continue

        const textNode = Array.from(clone.childNodes).find(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim().length > 0
        )
        if (!textNode) continue

        const text = textNode.textContent
        const match = text.match(/^([^\p{L}\p{N}\s]*[\p{L}\p{N}](?:['’])?)/u)
        const first = match?.[0]
        const rest = text.slice(first?.length || 0)
        if (!first || /[\uD800-\uDFFF]/.test(first)) continue

        const span = document.createElement('span')
        span.textContent = first
        span.dataset.snapdomPseudo = '::first-letter'
        const snapshot = snapshotComputedStyle(style)
        const key = getStyleKey(snapshot, 'span')
        sessionCache.styleMap.set(span, key)

        const restNode = document.createTextNode(rest)
        clone.replaceChild(restNode, textNode)
        clone.insertBefore(span, restNode)
        continue
      }

      // ---------- CONTENT (pseudo-aware counters + collapse tokens) ----------
      const rawContent = style.content ?? ''
const isNoExplicitContent =
  rawContent === '' || rawContent === 'none' || rawContent === 'normal'
const { text: cleanContent, incs } =
  resolvePseudoContentAndIncs(source, pseudo, counterCtx)

      const bg = style.backgroundImage
      const bgColor = style.backgroundColor
      const fontFamily = style.fontFamily
      const fontSize = parseInt(style.fontSize) || 32
      const fontWeight = parseInt(style.fontWeight) || false
      const color = style.color || '#000'
      const borderStyle = style.borderStyle
      const borderWidth = parseFloat(style.borderWidth)
      const transform = style.transform

      const isIconFont2 = isIconFont(fontFamily)

const hasExplicitContent = !isNoExplicitContent && cleanContent !== ''
      const hasBg = bg && bg !== 'none'
      const hasBgColor =
        bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)'
      const hasBorder =
        borderStyle && borderStyle !== 'none' && borderWidth > 0
      const hasTransform = transform && transform !== 'none'

      const shouldRender =
        hasExplicitContent || hasBg || hasBgColor || hasBorder || hasTransform

      if (!shouldRender) {
        // Aun si no renderizamos caja, si el pseudo tenía increments, propagar a hermanos
        if (incs && incs.length && source.parentElement) {
          const map = __siblingCounters.get(source.parentElement) || new Map()
          // Para cada counter incrementado en el pseudo, guardar el valor resuelto final
          for (const { name } of incs) {
            if (!name) continue
            // reconstruir valor final desde derived: volvemos a pedirlo
            // Usamos withSiblingOverrides + derive para ser consistentes
            const baseWithSibs = withSiblingOverrides(source, counterCtx)
            const derived = deriveCounterCtxForPseudo(source, getComputedStyle(source, pseudo), baseWithSibs)
            const finalVal = derived.get(source, name)
            map.set(name, finalVal)
          }
          __siblingCounters.set(source.parentElement, map)
        }
        continue
      }

      const pseudoEl = document.createElement('span')
      pseudoEl.dataset.snapdomPseudo = pseudo
      // pseudoEl.style.display = 'inline'
      // pseudoEl.style.verticalAlign = 'baseline'
      pseudoEl.style.pointerEvents = 'none'
      const snapshot = snapshotComputedStyle(style)
      const key = getStyleKey(snapshot, 'span')
      sessionCache.styleMap.set(pseudoEl, key)

      // ---- Content handling (icon-font glyphs / url() / text) ----
      if (isIconFont2 && cleanContent && cleanContent.length === 1) {
        const { dataUrl, width: w, height: h } =
          await iconToImage(cleanContent, fontFamily, fontWeight, fontSize, color)
        const imgEl = document.createElement('img')
        imgEl.src = dataUrl
        imgEl.style = `height:${fontSize}px;width:${(w / h) * fontSize}px;object-fit:contain;`
        pseudoEl.appendChild(imgEl)
        clone.dataset.snapdomHasIcon = 'true'
      } else if (cleanContent && cleanContent.startsWith('url(')) {
        // content: url(...)
        const rawUrl = extractURL(cleanContent)
        if (rawUrl?.trim()) {
          try {
            const imgEl = document.createElement('img')
            const dataUrl = await snapFetch(safeEncodeURI(rawUrl), { as: 'dataURL', useProxy: options.useProxy })
            imgEl.src = dataUrl.data
            imgEl.style = `width:${fontSize}px;height:auto;object-fit:contain;`
            pseudoEl.appendChild(imgEl)
          } catch (e) {
            console.error(`[snapdom] Error in pseudo ${pseudo} for`, source, e)
          }
        }
      } else if (!isIconFont2 && hasExplicitContent) {
        pseudoEl.textContent = cleanContent // <- ya sin espacios extra
      }

      // ---- Backgrounds / colors ----
      pseudoEl.style.backgroundImage = 'none'
      if ('maskImage' in pseudoEl.style) pseudoEl.style.maskImage = 'none'
      if ('webkitMaskImage' in pseudoEl.style) pseudoEl.style.webkitMaskImage = 'none'

      try {
        pseudoEl.style.backgroundRepeat = style.backgroundRepeat
        pseudoEl.style.backgroundSize = style.backgroundSize
        if (style.backgroundPositionX && style.backgroundPositionY) {
          pseudoEl.style.backgroundPositionX = style.backgroundPositionX
          pseudoEl.style.backgroundPositionY = style.backgroundPositionY
        } else {
          pseudoEl.style.backgroundPosition = style.backgroundPosition
        }
        pseudoEl.style.backgroundOrigin = style.backgroundOrigin
        pseudoEl.style.backgroundClip = style.backgroundClip
        pseudoEl.style.backgroundAttachment = style.backgroundAttachment
        pseudoEl.style.backgroundBlendMode = style.backgroundBlendMode
      } catch { }

      if (hasBg) {
        try {
          const bgSplits = splitBackgroundImage(bg)
          const newBgParts = await Promise.all(bgSplits.map(inlineSingleBackgroundEntry))
          pseudoEl.style.backgroundImage = newBgParts.join(', ')
        } catch (e) {
          console.warn(`[snapdom] Failed to inline background-image for ${pseudo}`, e)
        }
      }
      if (hasBgColor) pseudoEl.style.backgroundColor = bgColor

      const hasContent2 =
        pseudoEl.childNodes.length > 0 || (pseudoEl.textContent?.trim() !== '')
      const hasVisibleBox =
        hasContent2 || hasBg || hasBgColor || hasBorder || hasTransform

      // Antes de insertar, si hubo increments en el pseudo, propagar valor final a los hermanos
      if (incs && incs.length && source.parentElement) {
        const map = __siblingCounters.get(source.parentElement) || new Map()
        const baseWithSibs = withSiblingOverrides(source, counterCtx)
        const derived = deriveCounterCtxForPseudo(source, getComputedStyle(source, pseudo), baseWithSibs)
        for (const { name } of incs) {
          if (!name) continue
          const finalVal = derived.get(source, name)
          map.set(name, finalVal)
        }
        __siblingCounters.set(source.parentElement, map)
      }

      if (!hasVisibleBox) continue

      if (pseudo === '::before') {
        clone.insertBefore(pseudoEl, clone.firstChild)
      } else {
        clone.appendChild(pseudoEl)
      }
    } catch (e) {
      console.warn(`[snapdom] Failed to capture ${pseudo} for`, source, e)
    }
  }
}
