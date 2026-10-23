/**
 * Icon fonts: which families count as one, and Material ligatures drawn to <img>.
 *
 * Icon glyphs are never embedded. fonts.js skips any family `isIconFont` recognizes, and the
 * pseudo pass draws a single-glyph `content` from one to an image. This module owns the
 * recognition and the Material case: a ligature like "home" has no font inside the svg, so it
 * would render as the word. `ligatureIconToImage` paints it on a canvas in the live document,
 * where the font is loaded, and puts the bitmap in the clone (#275).
 * @module iconFonts
 */

import { markInternalNode } from '../utils/ownership.js'
import { debugWarn } from '../utils/debug.js'

/** Families treated as icon fonts with no configuration. `iconFonts` adds to this list. */
export const defaultIconFonts = [
  // /uicons/i,
  /font\s*awesome/i,
  /material\s*icons/i,
  /ionicons/i,
  /glyphicons/i,
  /feather/i,
  /bootstrap\s*icons/i,
  /remix\s*icons/i,
  /heroicons/i,
  /layui/i,
  /lucide/i
]

/** Static Material Icons faces, one per style, for drawing a filled Symbols icon on canvas.
 *  A host page overrides any of them through `window.__SNAPDOM_ICON_FONTS__`. */
export const ICON_FONT_URLS = Object.assign({
  materialIconsFilled:  'https://fonts.gstatic.com/s/materialicons/v48/flUhRq6tzZclQEJ-Vdg-IuiaDsNcIhQ8tQ.woff2',
  materialIconsOutlined:'https://fonts.gstatic.com/s/materialiconsoutlined/v110/gok-H7zzDkdnRel8-DQ6KAXJ69wP1tGnf4ZGhUcel5euIg.woff2',
  materialIconsRound:   'https://fonts.gstatic.com/s/materialiconsround/v109/LDItaoyNOAY6Uewc665JcIzCKsKc_M9flwmPq_HTTw.woff2',
  materialIconsSharp:   'https://fonts.gstatic.com/s/materialiconssharp/v110/oPWQ_lt5nv4pWNJpghLP75WiFR4kLh3kvmvRImcycg.woff2'
}, (typeof window !== 'undefined' && window.__SNAPDOM_ICON_FONTS__) || {})

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
}

/**
 * Compile the `iconFonts` option into matchers, ONCE per capture, in createContext.
 *
 * This used to be a module-level `sessionIconFonts` array that every capture overwrote at
 * its start. Two concurrent captures with different lists interleaved through the await
 * points and each read the other's matchers, which is the exact bug class v3 removed
 * everywhere else: per-capture state does not live at module scope, it lives on the
 * context and is passed explicitly.
 *
 * @param {string|RegExp|Array<string|RegExp>} [fonts]
 * @param {{debug?: boolean}} [options] - read for `debug`
 * @returns {RegExp[]}
 */
export function compileIconFontMatchers(fonts, options) {
  const list = Array.isArray(fonts) ? fonts : (fonts ? [fonts] : [])
  const out = []
  for (const f of list) {
    if (f instanceof RegExp) out.push(f)
    else if (typeof f === 'string') out.push(new RegExp(escapeRegExp(f), 'i'))
    else debugWarn(options, 'Ignored an iconFonts entry: use a string or a RegExp.', f)
  }
  return out
}

/**
 * Whether a family name or font URL belongs to an icon font.
 *
 * The defaults and the capture's own matchers go first, then a loose word test (icon, glyph,
 * symbols) that also catches self-hosted icon sets nobody listed. Callers skip embedding and
 * subsetting for anything that answers true.
 * @param {*} input - family name or URL to test
 * @param {RegExp[]} [matchers] - this capture's extra matchers (context.__iconMatchers)
 * @returns {boolean}
 */
export function isIconFont(input, matchers) {
  const text = typeof input === 'string' ? input : ''
  for (const rx of defaultIconFonts) {
    if (rx.test(text)) return true
  }
  if (matchers) {
    for (const rx of matchers) {
      if (rx instanceof RegExp && rx.test(text)) return true
    }
  }
  if (/icon/i.test(text) || /glyph/i.test(text) || /symbols/i.test(text) || /feather/i.test(text) || /fontawesome/i.test(text)) return true
  return false
}

/**
 * Whether a stylesheet URL is an icon-font-only stylesheet that can be skipped wholesale.
 *
 * `isIconFont` is a loose name heuristic (`/icon/`, `/symbols/`, ...) meant for one family at a
 * time. Run over a whole URL it also reads the query string, and Google Fonts bundles every
 * requested family there: a single icon-ish name (`Noto+Sans+Symbols`, `Material+Symbols+Outlined`)
 * used to discard the text families sharing the request, so nothing got embedded (#493).
 * When the URL carries `family` params, judge those names one by one and skip only if every
 * one is an icon font; the per-face family check downstream still drops the icon ones.
 * URLs without `family` params keep the path heuristic.
 * @param {string} href
 * @param {RegExp[]} [matchers] - this capture's extra matchers (context.__iconMatchers)
 * @returns {boolean}
 */
export function isIconFontStylesheet(href, matchers) {
  if (typeof href !== 'string' || !href) return false
  let url
  try {
    url = new URL(href, typeof location !== 'undefined' ? location.href : undefined)
  } catch {
    return isIconFont(href, matchers)
  }
  // css?family=A|B (legacy API) and css2?family=A&family=B; ":wght@..." axes are not a name
  const names = url.searchParams.getAll('family')
    .flatMap((v) => v.split('|'))
    .map((v) => v.split(':')[0].trim())
    .filter(Boolean)
  if (names.length) return names.every((name) => isIconFont(name, matchers))
  return isIconFont(href, matchers)
}

/**
 * Whether a family is Material Icons or Material Symbols, the two ligature-based sets.
 * @param {string} [family='']
 * @returns {boolean}
 */
export function isMaterialFamily(family = '') {
  const s = String(family).toLowerCase()
  return /\bmaterial\s*icons\b/.test(s) || /\bmaterial\s*symbols\b/.test(s)
}

/** alias -> true once loaded, false once a load failed. A failure is never retried. */
const loadedCanvasFamilies = new Map()

/** `'FILL' 1, 'wght' 400` -> `{ FILL: 1, WGHT: 400 }`. Axis tags are upper-cased. */
function parseAxes(variation = '') {
  const out = Object.create(null)
  const v = String(variation || '')
  const rx = /['"]?\s*([A-Za-z]{3,4})\s*['"]?\s*([+-]?\d+(?:\.\d+)?)\s*/g
  let m; while ((m = rx.exec(v))) out[m[1].toUpperCase()] = Number(m[2])
  return out
}

/**
 * Pick the family the canvas will draw a Material ligature with.
 *
 * Material Icons (legacy, not variable) and any non-Material family are kept as they are.
 * Material Symbols is variable, and a canvas font string has no font-variation-settings, so a
 * Symbols icon with FILL=1 would draw hollow. For that case a static filled face is loaded
 * under a snapdom alias, matched to the style class (outlined, rounded, sharp). With FILL=0,
 * or no static face for that style, the original Symbols family stays.
 * @param {string} cssFamily
 * @param {string} className - the element's class list, where Material puts the style
 * @param {Record<string, number>} axes - from parseAxes
 * @returns {Promise<{familyForMeasure: string, familyForCanvas: string}>}
 */
async function ensureLigatureCanvasFont(cssFamily, className, axes) {
  const fam = String(cssFamily || '')
  const lowerFam = fam.toLowerCase()
  const cls = String(className || '').toLowerCase()

  // Already non-variable icons → keep as-is
  if (/\bmaterial\s*icons\b/.test(lowerFam) && !/\bsymbols\b/.test(lowerFam)) {
    return { familyForMeasure: fam, familyForCanvas: fam }
  }

  const isSymbols = /\bmaterial\s*symbols\b/.test(lowerFam)
  if (!isSymbols) {
    // Not Symbols → keep incoming family (Font Awesome / Lucide / etc.)
    return { familyForMeasure: fam, familyForCanvas: fam }
  }

  // Decide style and fill from class/axes
  const FILL = axes && (axes.FILL ?? axes.fill)
  let style = 'outlined' // default
  if (/\brounded\b/.test(cls) || /\bround\b/.test(cls)) style = 'rounded'
  else if (/\bsharp\b/.test(cls)) style = 'sharp'
  else if (/\boutlined\b/.test(cls)) style = 'outlined'

  const filled = FILL === 1

  // Only override to static non-variable when need "filled" on canvas
  let pick = null
  if (filled) {
    if (style === 'outlined' && ICON_FONT_URLS.materialIconsFilled) {
      pick = { url: ICON_FONT_URLS.materialIconsFilled, alias: 'snapdom-mi-filled' }
    } else if (style === 'rounded' && ICON_FONT_URLS.materialIconsRound) {
      pick = { url: ICON_FONT_URLS.materialIconsRound, alias: 'snapdom-mi-round' }
    } else if (style === 'sharp' && ICON_FONT_URLS.materialIconsSharp) {
      pick = { url: ICON_FONT_URLS.materialIconsSharp, alias: 'snapdom-mi-sharp' }
    }
  }

  // If no override (either outlined or missing static), keep Symbols
  if (!pick) {
    return { familyForMeasure: fam, familyForCanvas: fam }
  }

  if (!loadedCanvasFamilies.has(pick.alias)) {
    try {
      const ff = new FontFace(pick.alias, `url(${pick.url})`, { style: 'normal', weight: '400' })
      // Load BEFORE registering, and memoize the failure. Adding first meant a rejected load
      // left a dead FontFace in document.fonts, and `has()` was only set on success — so a
      // font that could not load was re-created and re-added once per icon per capture, and
      // the document's font set grew for the page's lifetime with faces nothing can use.
      await ff.load()
      document.fonts.add(ff)
      loadedCanvasFamilies.set(pick.alias, true)
    } catch {
      // If loading fails, stay on Symbols — and remember, so the next capture does not retry.
      loadedCanvasFamilies.set(pick.alias, false)
      return { familyForMeasure: fam, familyForCanvas: fam }
    }
  }
  if (loadedCanvasFamilies.get(pick.alias) === false) {
    return { familyForMeasure: fam, familyForCanvas: fam }
  }

  const quoted = `"${pick.alias}"`
  return { familyForMeasure: quoted, familyForCanvas: quoted }
}

/**
 * Wait until the family can be used at this size, before measuring or drawing it.
 * A failed load is swallowed: the draw goes ahead with whatever the engine substitutes.
 * @param {string} [family='Material Icons']
 * @param {number} [px=24]
 * @returns {Promise<void>}
 */
export async function ensureMaterialFontsReady(family = 'Material Icons', px = 24) {
  try {
    await Promise.all([
      document.fonts.load(`400 ${px}px "${String(family).replace(/["']/g, '')}"`),
      document.fonts.ready
    ])
  } catch { /* noop */ }
}

/** The colour the glyph is painted with: `-webkit-text-fill-color` when set and opaque, else
 *  `color`, the same precedence text gets. Falls back to black. */
function resolvePaintColor(cs) {
  let fill = cs.getPropertyValue('-webkit-text-fill-color')?.trim() || ''
  const isTransparent = /^transparent$/i.test(fill) || /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(fill)
  if (fill && !isTransparent && fill.toLowerCase() !== 'currentcolor') return fill
  const c = cs.color?.trim()
  return c && c !== 'inherit' ? c : '#000'
}

/**
 * Draw one ligature on a canvas at devicePixelRatio and return it as a data URL.
 *
 * The glyph is measured with a hidden span in the same family the canvas draws with, so the
 * box the <img> gets is the box the glyph needs. Width and height come back in CSS px.
 * @param {string} ligatureText - e.g. "home"
 * @param {object} [opts]
 * @param {string} [opts.family='Material Icons']
 * @param {string} [opts.weight='normal']
 * @param {number} [opts.fontSize=32]
 * @param {string} [opts.color='#000']
 * @param {string} [opts.variation=''] - font-variation-settings, read for the FILL axis
 * @param {string} [opts.className=''] - where Material Symbols puts the style (outlined, rounded, sharp)
 * @returns {Promise<{dataUrl: string, width: number, height: number}>}
 */
export async function materialIconToImage(
  ligatureText,
  {
    family = 'Material Icons',
    weight = 'normal',
    fontSize = 32,
    color = '#000',
    variation = '',
    className = ''
  } = {}
) {
  const fam = String(family || '').replace(/^['"]+|['"]+$/g, '')
  const dpr = window.devicePixelRatio || 1
  const axes = parseAxes(variation)

  const { familyForMeasure, familyForCanvas } =
    await ensureLigatureCanvasFont(fam, className, axes)

  await ensureMaterialFontsReady(familyForCanvas.replace(/^["']+|["']+$/g, ''), fontSize)

  // Measure with same family used on canvas
  const span = document.createElement('span')
  markInternalNode(span)
  span.textContent = ligatureText
  span.style.position = 'absolute'
  span.style.visibility = 'hidden'
  span.style.left = '-99999px'
  span.style.whiteSpace = 'nowrap'
  span.style.fontFamily = familyForMeasure
  span.style.fontWeight = String(weight || 'normal')
  span.style.fontSize = `${fontSize}px`
  span.style.lineHeight = '1'
  span.style.margin = '0'
  span.style.padding = '0'
  span.style.fontFeatureSettings = '\'liga\' 1'
  span.style.fontVariantLigatures = 'normal'
  span.style.color = color

  document.body.appendChild(span)
  const rect = span.getBoundingClientRect()
  const width = Math.max(1, Math.ceil(rect.width))
  const height = Math.max(1, Math.ceil(rect.height))
  document.body.removeChild(span)

  const canvas = document.createElement('canvas')
  canvas.width = width * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.font = `${weight ? `${weight} ` : ''}${fontSize}px ${familyForCanvas}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = color
  try { ctx.fontKerning = 'normal' } catch {}
  ctx.fillText(ligatureText, 0, 0)

  return {
    dataUrl: canvas.toDataURL(),
    width,
    height
  }
}

/**
 * Replace every Material ligature in the clone with an <img> of the drawn glyph.
 *
 * Size, colour, weight and axes are read from the SOURCE node, paired through nodeMap; the
 * clone's own computed style is only a fallback. The root itself is a candidate too, since
 * `querySelectorAll` never matches the node it is called on. Failures skip the node and the
 * text stays. Pinned by __tests__/module.iconFonts.test.js.
 * @param {Element} cloneRoot
 * @param {Element} sourceRoot
 * @param {Map<Node, Node>} [nodeMap] - clone -> source, built by deepClone
 * @returns {Promise<number>} how many nodes were replaced
 */
export async function ligatureIconToImage(cloneRoot, sourceRoot, nodeMap = new Map()) {
  if ((cloneRoot?.nodeType !== 1)) return 0

  const selector = '.material-icons, [class*="material-symbols"]'

  // querySelectorAll never matches the element it's called on — a capture root that IS the
  // icon (e.g. snapdom(iconSpan) for a single toolbar icon) was silently skipped, leaving its
  // ligature text unconverted (see #461 for the same shape in images.js).
  const cloneNodes = Array.from(
    cloneRoot.querySelectorAll(selector)
  ).filter(n => n && n.textContent && n.textContent.trim())
  if (cloneRoot.matches?.(selector) && cloneRoot.textContent && cloneRoot.textContent.trim()) {
    cloneNodes.unshift(cloneRoot)
  }

  if (cloneNodes.length === 0) return 0

  // Map each clone node to its exact source via the clone→source nodeMap built by deepClone.
  // Pairing the two trees positionally breaks when excludeMode:'remove' drops nodes from the
  // clone but not the source: indices shift and we read the wrong source's color/size/variation.
  const sourceNodes = (sourceRoot?.nodeType === 1)
    ? Array.from(sourceRoot.querySelectorAll(selector)).filter(n => n && n.textContent && n.textContent.trim())
    : []
  if (sourceRoot?.nodeType === 1 && sourceRoot.matches?.(selector) && sourceRoot.textContent && sourceRoot.textContent.trim()) {
    sourceNodes.unshift(sourceRoot)
  }

  let replaced = 0

  for (let i = 0; i < cloneNodes.length; i++) {
    const el = cloneNodes[i]
    const src = (nodeMap && nodeMap.get(el)) || sourceNodes[i] || null

    try {
      const cs = src ? getComputedStyle(src) : getComputedStyle(el)
      const family = cs.fontFamily || 'Material Icons'
      if (!isMaterialFamily(family)) continue

      const text = (src || el).textContent.trim()
      if (!text) continue

      const size = parseInt(cs.fontSize, 10) || 24
      const weight = (cs.fontWeight && cs.fontWeight !== 'normal') ? cs.fontWeight : 'normal'
      const color = resolvePaintColor(cs)
      const variation = cs.fontVariationSettings && cs.fontVariationSettings !== 'normal'
        ? cs.fontVariationSettings
        : ''
      const className = (src || el).className || ''

      const { dataUrl, width, height } = await materialIconToImage(text, {
        family,
        weight,
        fontSize: size,
        color,
        variation,
        className
      })

      el.textContent = ''
      const img = el.ownerDocument.createElement('img')
      img.src = dataUrl
      img.alt = text
      img.style.height = `${size}px`
      img.style.width = `${Math.max(1, Math.round((width / height) * size))}px`
      img.style.objectFit = 'contain'
      img.style.verticalAlign = getComputedStyle(el).verticalAlign || 'baseline'
      el.appendChild(img)

      replaced++
    } catch { /* continue */ }
  }

  return replaced
}

const FONT_FAMILY_SIGNATURE = /(?:^|;)font-family:([^;]*)/
/** The stand-ins pinIconStruts inserted, so a second visit of the same clone adds none. */
const strutClones = new WeakSet()

/**
 * Keep an icon font's share of the line in the clone.
 *
 * Icon fonts are never embedded, so inside the svg an icon element lays out in the fallback
 * font, and a line's height and baseline come from the first available font of every inline
 * box on it, glyph or not. An empty 28px Material Icons <i> made its line 4px taller in
 * Chromium and WebKit (Times is taller than Material Icons), and the error added up line
 * after line until the last block fell off the bottom of the capture. Each icon element's
 * line box is measured once per font in the live document, where the font is loaded, and
 * reproduced in the clone: the element's own strut is zeroed with `line-height: 0` and a
 * zero-width inline-block of the measured height, sitting on the measured baseline, stands
 * in for it. The probe uses the element's exact font stack, so a family the name test
 * mistakes for an icon font gets the strut it already had. Candidates come from the style
 * signature, one test per signature. Pinned by __tests__/module.iconStrut.test.js.
 * @param {Iterable<Element>} clones - the clone nodes to visit: every key of the session's
 *   styleMap for a full capture, the rebuilt subtree for a differential one
 * @param {Map<Element, string>} styleMap - clone -> style signature (session.styleMap)
 * @param {Map<Node, Node>} nodeMap - clone -> source
 * @param {RegExp[]} [matchers] - this capture's extra matchers (context.__iconMatchers)
 * @returns {number} how many elements got a strut
 */
export function pinIconStruts(clones, styleMap, nodeMap, matchers) {
  if (!styleMap?.size) return 0
  const iconic = new Map()
  const struts = new Map()
  let pinned = 0
  for (const clone of clones) {
    const key = styleMap.get(clone)
    if (!key || clone.nodeType !== 1 || strutClones.has(clone.firstChild)) continue
    let icon = iconic.get(key)
    if (icon === undefined) {
      const family = FONT_FAMILY_SIGNATURE.exec(key)?.[1]
      iconic.set(key, icon = !!family && isIconFont(family, matchers))
    }
    if (!icon) continue
    const pseudo = clone.dataset?.snapdomPseudo
    const source = pseudo ? nodeMap.get(clone.parentNode) : nodeMap.get(clone)
    if (source?.nodeType !== 1) continue
    const cs = getComputedStyle(source, pseudo || null)
    if (cs.display !== 'inline' && cs.display !== 'inline-block') continue
    const id = `${cs.fontFamily}|${cs.fontSize}|${cs.fontWeight}|${cs.fontStyle}|${cs.fontStretch}|${cs.lineHeight}`
    let strut = struts.get(id)
    if (strut === undefined) struts.set(id, strut = measureStrut(source.ownerDocument, cs))
    if (!strut) continue
    const stand = clone.ownerDocument.createElement('span')
    strutClones.add(stand)
    stand.style.cssText = `display:inline-block;width:0;height:${strut.height}px;vertical-align:${-strut.descent}px`
    clone.style.lineHeight = '0'
    clone.insertBefore(stand, clone.firstChild)
    if (stand.nextSibling === null) keepSpaceCollapsed(clone, source)
    pinned++
  }
  return pinned
}

/**
 * An empty inline is transparent to space collapsing: in "a <i></i> b" the page shows one
 * space. The stand-in is an atomic inline and keeps both ("Parrafo  con" in the capture), so
 * when the text before the element ends in a collapsible space, the clone drops the leading
 * space of the text after it, the one the page collapsed.
 */
function keepSpaceCollapsed(clone, source) {
  const ws = getComputedStyle(source.parentElement || source).whiteSpace
  if (ws !== 'normal' && ws !== 'nowrap' && ws !== 'pre-line') return
  const before = clone.previousSibling
  const after = clone.nextSibling
  if (before?.nodeType !== 3 || after?.nodeType !== 3) return
  if (/[ \t\n]$/.test(before.data)) after.data = after.data.replace(/^[ \t\n]+/, '')
}

/** Height of a line holding only `cs`'s strut, and how far its bottom sits under the baseline. */
function measureStrut(doc, cs) {
  const probe = doc.createElement('div')
  markInternalNode(probe)
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;margin:0;padding:0;border:0;' +
    `font-family:${cs.fontFamily};font-size:${cs.fontSize};font-weight:${cs.fontWeight};font-style:${cs.fontStyle};` +
    `font-stretch:${cs.fontStretch};line-height:${cs.lineHeight}`
  const mark = doc.createElement('span')
  mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
  probe.appendChild(mark)
  ;(doc.body || doc.documentElement).appendChild(probe)
  try {
    const height = probe.getBoundingClientRect().height
    const baseline = mark.getBoundingClientRect().top - probe.getBoundingClientRect().top
    return height > 0 ? { height, descent: height - baseline } : null
  } finally {
    probe.remove()
  }
}
