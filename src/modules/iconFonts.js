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
import { fontsSettled } from '../utils/browser.js'
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
 * Compile the `iconFonts` option into matchers, ONCE per capture, in createContext. The result
 * lives on the context, not at module scope: a shared module-level list let two concurrent
 * captures read each other's matchers across their awaits.
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
 * Whether a family name or font URL belongs to an icon font: the defaults, the capture's own
 * matchers, then a loose word test (icon, glyph, symbols) for self-hosted sets nobody listed.
 * Callers skip embedding and subsetting for anything that answers true.
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
 * Whether a stylesheet URL holds only icon fonts and can be skipped wholesale.
 * Do not run `isIconFont` over the whole URL: Google Fonts puts every family in the query, and
 * one icon-ish name (`Noto+Sans+Symbols`) discarded the text families beside it (#493). With
 * `family` params, skip only when every name is an icon font (the per-face check downstream
 * drops the icon ones); without them, the path heuristic applies.
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
 * Draw one icon-font glyph on a canvas at devicePixelRatio and return it as a data URL, for a
 * single-character pseudo `content`: icon fonts are never embedded, so the svg has no font for
 * it. The size comes from a hidden span in the same family the canvas draws with.
 * @param {string} unicodeChar - The unicode character to render
 * @param {string} fontFamily - The font family name
 * @param {string|number} fontWeight - The font weight
 * @param {number} [fontSize=32] - The font size in pixels
 * @param {string} [color="#000"] - The color to use
 * @param {string} [fontStyle="normal"] - The font style
 * @returns {Promise<{dataUrl:string,width:number,height:number,advance:number,descent:number}>} Data
 *   URL, the bitmap's whole-pixel size, the glyph's exact advance, and how far the bitmap's
 *   bottom reaches under the glyph's baseline (0 when unknown)
 */
export async function iconToImage(unicodeChar, fontFamily, fontWeight, fontSize = 32, color = '#000', fontStyle = 'normal') {
  fontFamily = fontFamily.replace(/^['"]+|['"]+$/g, '')
  const dpr = window.devicePixelRatio || 1

  try { await fontsSettled() } catch {}

  const span = document.createElement('span')
  markInternalNode(span)
  span.textContent = unicodeChar
  span.style.position = 'absolute'
  span.style.visibility = 'hidden'
  span.style.fontFamily = `"${fontFamily}"`
  span.style.fontWeight = fontWeight || 'normal'
  span.style.fontStyle = fontStyle || 'normal'
  span.style.fontSize = `${fontSize}px`
  span.style.lineHeight = '1'
  span.style.whiteSpace = 'nowrap'
  span.style.padding = '0'
  span.style.margin = '0'
  document.body.appendChild(span)

  const rect = span.getBoundingClientRect()
  const width = Math.ceil(rect.width)
  const height = Math.ceil(rect.height)
  document.body.removeChild(span)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width * dpr)
  canvas.height = Math.max(1, height * dpr)

  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.font = `${fontStyle || 'normal'} ${fontWeight || 'normal'} ${fontSize}px "${fontFamily}"`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = color
  ctx.fillText(unicodeChar, 0, 0)
  // The bitmap is drawn from the em square's top; on the page the glyph sits on the alphabetic
  // baseline, this far below that top. Read as the gap between the two baselines, since
  // Chromium reports no emHeightDescent.
  const fromTop = ctx.measureText(unicodeChar).actualBoundingBoxAscent
  ctx.textBaseline = 'alphabetic'
  const fromBaseline = ctx.measureText(unicodeChar).actualBoundingBoxAscent
  const descent = height - (fromBaseline - fromTop)

  return {
    dataUrl: canvas.toDataURL(),
    width,
    height,
    advance: rect.width,
    descent: Number.isFinite(descent) ? descent : 0
  }
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
 * Pick the family the canvas will draw a Material ligature with. Only Material Symbols with
 * FILL=1 changes: a canvas font string has no font-variation-settings, so it would draw hollow,
 * and a static filled face for its style class (outlined, rounded, sharp) is loaded under a
 * snapdom alias. Everything else, or a style with no static face, keeps its family.
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
      // Load BEFORE registering, and memoize the failure, or a font that cannot load is re-added
      // as a dead FontFace once per icon per capture for the page's lifetime.
      await ff.load()
      document.fonts.add(ff)
      loadedCanvasFamilies.set(pick.alias, true)
    } catch {
      // If loading fails, stay on Symbols, and remember so the next capture does not retry.
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
      fontsSettled()
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
 * Draw one ligature on a canvas at devicePixelRatio and return it as a data URL. A hidden span
 * in the canvas's family measures it, so the <img> gets the box the glyph needs, in CSS px.
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
 * Replace every Material ligature in the clone with an <img> of the drawn glyph. Size, colour,
 * weight and axes come from the SOURCE node through nodeMap, the clone's style only as a
 * fallback. A failure skips the node and the text stays.
 * Pinned by __tests__/module.iconFonts.test.js.
 * @param {Element} cloneRoot
 * @param {Element} sourceRoot
 * @param {Map<Node, Node>} [nodeMap] - clone -> source, built by deepClone
 * @returns {Promise<number>} how many nodes were replaced
 */
export async function ligatureIconToImage(cloneRoot, sourceRoot, nodeMap = new Map()) {
  if ((cloneRoot?.nodeType !== 1)) return 0

  const selector = '.material-icons, [class*="material-symbols"]'

  // querySelectorAll never matches the element it is called on, so a root that IS the icon
  // (snapdom(iconSpan)) is added by hand (#461 is the same shape in images.js).
  const cloneNodes = Array.from(
    cloneRoot.querySelectorAll(selector)
  ).filter(n => n && n.textContent && n.textContent.trim())
  if (cloneRoot.matches?.(selector) && cloneRoot.textContent && cloneRoot.textContent.trim()) {
    cloneNodes.unshift(cloneRoot)
  }

  if (cloneNodes.length === 0) return 0

  // Pair through nodeMap, not by position: excludeMode:'remove' drops clone nodes but not
  // source ones, and the indices shift onto the wrong source.
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
 * Keep an icon font's share of the line in the clone. Icon fonts are never embedded, so in the
 * svg an icon element's strut comes from the fallback font: an empty 28px Material Icons <i>
 * made its line 4px taller in Chromium and WebKit (Times is taller), line after line, until the
 * last block fell off the capture. The line box is measured once per font in the live document; the clone gets
 * `line-height: 0` and a zero-width inline-block of that height on that baseline. The probe
 * uses the exact font stack, so a family the name test mistakes for an icon font keeps the
 * strut it had. One icon test per style signature.
 * Pinned by __tests__/module.iconStrut.test.js.
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
  const families = new Map()
  const struts = new Map()
  let pinned = 0
  for (const clone of clones) {
    const key = styleMap.get(clone)
    if (!key || clone.nodeType !== 1 || strutClones.has(clone.firstChild)) continue
    let icon = iconic.get(key)
    if (icon === undefined) {
      const family = FONT_FAMILY_SIGNATURE.exec(key)?.[1]
      icon = false
      if (family && (icon = families.get(family)) === undefined) families.set(family, icon = isIconFont(family, matchers))
      iconic.set(key, icon)
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
 * An empty inline is transparent to space collapsing ("a <i></i> b" shows one space), but the
 * stand-in is atomic and keeps both. So when the text before ends in a collapsible space, the
 * clone drops the leading space of the text after.
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
