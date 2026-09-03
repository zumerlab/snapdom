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
 * @returns {RegExp[]}
 */
export function compileIconFontMatchers(fonts) {
  const list = Array.isArray(fonts) ? fonts : (fonts ? [fonts] : [])
  const out = []
  for (const f of list) {
    if (f instanceof RegExp) out.push(f)
    else if (typeof f === 'string') out.push(new RegExp(escapeRegExp(f), 'i'))
    else console.warn('[snapdom] Ignored invalid iconFont value:', f)
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
  span.setAttribute('data-snapdom-internal', '')
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
