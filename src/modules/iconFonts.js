// iconFonts.js

// ---------------------------------------------------------------------------
// Detection / configuration (kept as-is + extensible)
// ---------------------------------------------------------------------------
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

// Static, non-variable fallbacks (safe to override from the host app)
export const ICON_FONT_URLS = Object.assign({
  materialIconsFilled:  'https://fonts.gstatic.com/s/materialicons/v48/flUhRq6tzZclQEJ-Vdg-IuiaDsNcIhQ8tQ.woff2',
  materialIconsOutlined:'https://fonts.gstatic.com/s/materialiconsoutlined/v110/gok-H7zzDkdnRel8-DQ6KAXJ69wP1tGnf4ZGhUcel5euIg.woff2',
  materialIconsRound:   'https://fonts.gstatic.com/s/materialiconsround/v109/LDItaoyNOAY6Uewc665JcIzCKsKc_M9flwmPq_HTTw.woff2',
  materialIconsSharp:   'https://fonts.gstatic.com/s/materialiconssharp/v110/oPWQ_lt5nv4pWNJpghLP75WiFR4kLh3kvmvRImcycg.woff2'
}, (typeof window !== 'undefined' && window.__SNAPDOM_ICON_FONTS__) || {})

let userIconFonts = []

export function extendIconFonts(fonts) {
  const list = Array.isArray(fonts) ? fonts : [fonts]
  for (const f of list) {
    if (f instanceof RegExp) userIconFonts.push(f)
    else if (typeof f === 'string') userIconFonts.push(new RegExp(f, 'i'))
    else console.warn('[snapdom] Ignored invalid iconFont value:', f)
  }
}

export function isIconFont(input) {
  const text = typeof input === 'string' ? input : ''
  const candidates = [...defaultIconFonts, ...userIconFonts]
  for (const rx of candidates) {
    if (rx instanceof RegExp && rx.test(text)) return true
  }
  if (/icon/i.test(text) || /glyph/i.test(text) || /symbols/i.test(text) || /feather/i.test(text) || /fontawesome/i.test(text)) return true
  return false
}

// ---------------------------------------------------------------------------
// Material Symbols (ligatures) helpers
// ---------------------------------------------------------------------------
export function isMaterialFamily(family = '') {
  const s = String(family).toLowerCase()
  return /\bmaterial\s*icons\b/.test(s) || /\bmaterial\s*symbols\b/.test(s)
}

const loadedCanvasFamilies = new Map()

function parseAxes(variation = '') {
  const out = Object.create(null)
  const v = String(variation || '')
  const rx = /['"]?\s*([A-Za-z]{3,4})\s*['"]?\s*([+-]?\d+(?:\.\d+)?)\s*/g
  let m; while ((m = rx.exec(v))) out[m[1].toUpperCase()] = Number(m[2])
  return out
}

/**
 * Strategy:
 * - If family is Material *Icons* (legacy, non-variable) → keep it (already stable).
 * - If family is Material *Symbols* (variable):
 *     * Detect style: outlined / rounded / sharp
 *     * Detect FILL axis (0/1)
 *     * For FILL=1 → pick a static filled family when we have a good match:
 *         - outlined → materialIconsFilled
 *         - rounded  → materialIconsRound
 *         - sharp    → materialIconsSharp
 *     * For FILL=0 → stay on the original Symbols family (no override).
 *
 * This avoids forcing "Icons" when Symbols are present, and only swaps when we
 * can guarantee the desired "filled" appearance on canvas.
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
      document.fonts.add(ff)
      await ff.load()
      loadedCanvasFamilies.set(pick.alias, true)
    } catch {
      // If loading fails, stay on Symbols
      return { familyForMeasure: fam, familyForCanvas: fam }
    }
  }

  const quoted = `"${pick.alias}"`
  return { familyForMeasure: quoted, familyForCanvas: quoted }
}

export async function ensureMaterialFontsReady(family = 'Material Icons', px = 24) {
  try {
    await Promise.all([
      document.fonts.load(`400 ${px}px "${String(family).replace(/["']/g, '')}"`),
      document.fonts.ready
    ])
  } catch { /* noop */ }
}

function resolvePaintColor(cs) {
  let fill = cs.getPropertyValue('-webkit-text-fill-color')?.trim() || ''
  const isTransparent = /^transparent$/i.test(fill) || /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(fill)
  if (fill && !isTransparent && fill.toLowerCase() !== 'currentcolor') return fill
  const c = cs.color?.trim()
  return c && c !== 'inherit' ? c : '#000'
}

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
 * Replace Material ligature nodes in the CLONE by <img>.
 * Reads styles from SOURCE for accurate size/color/variation/class.
 */
export async function ligatureIconToImage(cloneRoot, sourceRoot) {
  if (!(cloneRoot instanceof Element)) return 0

  const selector = '.material-icons, [class*="material-symbols"]'

  const cloneNodes = Array.from(
    cloneRoot.querySelectorAll(selector)
  ).filter(n => n && n.textContent && n.textContent.trim())

  if (cloneNodes.length === 0) return 0

  const sourceNodes = (sourceRoot instanceof Element)
    ? Array.from(sourceRoot.querySelectorAll(selector)).filter(n => n && n.textContent && n.textContent.trim())
    : []

  let replaced = 0

  for (let i = 0; i < cloneNodes.length; i++) {
    const el = cloneNodes[i]
    const src = sourceNodes[i] || null

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
