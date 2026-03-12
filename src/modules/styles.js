import { getStyleKey, shouldIgnoreProp } from '../utils/index.js'
import { cache } from '../core/cache.js'

const snapshotCache = new WeakMap()
const snapshotKeyCache = new Map()
let __epoch = 0
function bumpEpoch() { __epoch++ }

export function notifyStyleEpoch() { bumpEpoch() }

let __wired = false
function setupInvalidationOnce(root = document.documentElement) {
  if (__wired) return
  __wired = true
  try {
    const domObs = new MutationObserver(() => bumpEpoch())
    domObs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true })
  } catch { }
  try {
    const headObs = new MutationObserver(() => bumpEpoch())
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

function snapshotComputedStyleFull(style, options = {}) {
  const out = {}
  const vis = style.getPropertyValue('visibility')
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
  if (vis === 'hidden') out.opacity = '0'
  return out
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
  if (rec && rec.epoch === __epoch) return rec.snapshot
  const style = preStyle || getComputedStyle(el)
  const snap = snapshotComputedStyleFull(style, options)
  stripHeightForWrappers(el, style, snap)
  snapshotCache.set(el, { epoch: __epoch, snapshot: snap })
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
    session.styleCache.set(source, getComputedStyle(source))
  }
  const pre = session.styleCache.get(source)

  // Replace authored inline style with computed values so !important in stylesheets
  // correctly overrides inline styles in the clone (fixes #328)
  if (source.getAttribute?.('style')) {
    normalizeInlineStyleToComputed(source, clone, pre)
  }

  const snap = getSnapshot(source, pre, ctx.options)

  const sig = styleSignature(snap)
  let key = persist.snapshotKeyCache.get(sig)
  if (!key) {
    const tag = source.tagName?.toLowerCase() || 'div'
    key = getStyleKey(snap, tag)
    persist.snapshotKeyCache.set(sig, key)
  }
  session.styleMap.set(clone, key)
}
/**
 * @param {Element} el
 * @returns {boolean}
 */
function isReplaced(el) {
  return el instanceof HTMLImageElement ||
         el instanceof HTMLCanvasElement ||
         el instanceof HTMLVideoElement ||
         el instanceof HTMLIFrameElement ||
         el instanceof SVGElement ||
         el instanceof HTMLObjectElement ||
         el instanceof HTMLEmbedElement
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
  const pd = getComputedStyle(p).display || ''
  return pd.includes('flex') || pd.includes('grid')
}

/**
 * ¿Hay contenido en flujo? Versión rápida:
 *  - Texto no vacío → true (no dispara layout).
 *  - <br> inmediato → true.
 *  - Geometry probe: scrollHeight > padding (abspos NO suma) → true.
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs  // ya lo tenemos en mano
 */
function hasFlowFast(el, cs) {
  if (el.textContent && /\S/.test(el.textContent)) return true
  const f = el.firstElementChild, l = el.lastElementChild
  if ((f && f.tagName === 'BR') || (l && l.tagName === 'BR')) return true

  // Probe geométrico (1 lectura de layout): evita recorrer hijos
  // Nota: scrollHeight no incluye hijos absolute; si sólo hay absolute → ≈ padding
  const sh = el.scrollHeight
  if (sh === 0) return false
  const pt = parseFloat(cs.paddingTop) || 0
  const pb = parseFloat(cs.paddingBottom) || 0
  return sh > pt + pb
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

  // 2b) Solo quitar si height parece "auto" (≈scrollHeight); si difiere, el autor lo fijó
  const usedH = parseFloat(cs.height)
  const TOL = 2
  if (Number.isFinite(usedH) && el.scrollHeight > 0 && Math.abs(usedH - el.scrollHeight) > TOL) return

  // 2c) aspect-ratio define dimensiones derivadas; respetar
  if (cs.aspectRatio && cs.aspectRatio !== 'none' && cs.aspectRatio !== 'auto') return

  // 3) Orbit: si el elemento es flex/grid, no tocar su height
  const disp = cs.display || ''
  if (disp.includes('flex') || disp.includes('grid')) return

  // 4) Guardas existentes
  if (isReplaced(el)) return

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
  if (!hasFlowFast(el, cs)) return

  // 7) Ahora sí: quitamos height y block-size del snapshot
  delete snap.height
  delete snap['block-size']
}
