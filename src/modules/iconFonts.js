var defaultIconFonts = [
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

var userIconFonts = []

export function extendIconFonts(fonts) {
  const list = Array.isArray(fonts) ? fonts : [fonts]
  for (const f of list) {
    if (f instanceof RegExp) {
      userIconFonts.push(f)
    } else if (typeof f === 'string') {
      userIconFonts.push(new RegExp(f, 'i'))
    } else {
      console.warn('[snapdom] Ignored invalid iconFont value:', f)
    }
  }
}

export function isIconFont(input) {
  /* v8 ignore next */
  const text = typeof input === 'string' ? input : ''
  const candidates = [...defaultIconFonts, ...userIconFonts]
  for (const rx of candidates) {
    if (rx instanceof RegExp && rx.test(text)) return true
  }
  /* v8 ignore next */
  if (/icon/i.test(text) || /glyph/i.test(text) || /symbols/i.test(text) || /feather/i.test(text) || /fontawesome/i.test(text)) return true
  return false
}

/**
 * Rasterization helpers for Google Material Icons / Material Symbols that use ligatures.
 * Converts elements that render icons via text ligatures into inline <img> (data URL).
 * This runs on the CLONE tree (never mutates the original).
 *
 * @module materialIcons
 */

/** True si la familia es Material Icons / Material Symbols */
export function isMaterialFamily(family = '') {
  const s = String(family).toLowerCase()
  return /\bmaterial\s*icons\b/.test(s) || /\bmaterial\s*symbols\b/.test(s)
}

/** Espera a que la fuente esté lista (ligaduras) */
export async function ensureMaterialFontsReady(family = 'Material Icons', px = 24) {
  try {
    await Promise.all([
      document.fonts.load(`400 ${px}px "${family.replace(/["']/g, '')}"`),
      document.fonts.ready
    ])
  } catch {
    /* noop */
  }
}

/** Resuelve color: usa -webkit-text-fill-color si aplica, si no el color computado. */
function resolvePaintColor(cs) {
  // -webkit-text-fill-color tiene prioridad si no es transparente/currentcolor
  let fill = cs.getPropertyValue('-webkit-text-fill-color')?.trim() || ''
  const isTransparent = /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(fill)
  if (fill && !isTransparent && fill.toLowerCase() !== 'currentcolor') {
    return fill
  }
  // caso normal
  const c = cs.color?.trim()
  return c && c !== 'inherit' ? c : '#000'
}

/**
 * Dibuja la ligadura (ej. "face") en canvas → dataURL PNG.
 */
export async function materialIconToImage(ligatureText, {
  family = 'Material Icons',
  weight = 'normal',
  fontSize = 32,
  color = '#000',
  variation = ''
} = {}) {
  const fam = String(family || '').replace(/^['"]+|['"]+$/g, '')
  const dpr = window.devicePixelRatio || 1

  await ensureMaterialFontsReady(fam, fontSize)

  // medir caja exacta con el browser (ligaduras ON)
  const span = document.createElement('span')
  span.textContent = ligatureText
  span.style.position = 'absolute'
  span.style.visibility = 'hidden'
  span.style.left = '-99999px'
  span.style.whiteSpace = 'nowrap'
  span.style.fontFamily = `"${fam}"`
  span.style.fontWeight = String(weight || 'normal')
  span.style.fontSize = `${fontSize}px`
  span.style.lineHeight = '1'
  span.style.margin = '0'
  span.style.padding = '0'
  span.style.fontFeatureSettings = '\'liga\' 1'
  span.style.fontVariantLigatures = 'normal'
  if (variation) span.style.fontVariationSettings = variation
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
  ctx.font = `${weight ? `${weight} ` : ''}${fontSize}px "${fam}"`
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
 * Reemplaza nodos de Material (ligaduras) por <img> en el CLONE.
 * IMPORTANTE: leé estilos del SOURCE para obtener el color correcto.
 *
 * @param {Element} cloneRoot - subárbol clonado
 * @param {Element} sourceRoot - subárbol original (para estilos reales)
 * @returns {Promise<number>}
 */
export async function ligatureIconToImage(cloneRoot, sourceRoot) {
  if (!(cloneRoot instanceof Element)) return 0

  const selector = '.material-icons, [class*="material-symbols"]'

  // 1) colecciones paralelas (mismo orden) para mapear por índice
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
      // Leer estilos del SOURCE si existe; si no, del CLONE
      const csSrc = src ? getComputedStyle(src) : getComputedStyle(el)
      const family = csSrc.fontFamily || 'Material Icons'
      if (!isMaterialFamily(family)) continue

      const text = (src || el).textContent.trim()
      if (!text) continue

      const size = parseInt(csSrc.fontSize, 10) || 24
      const weight = (csSrc.fontWeight && csSrc.fontWeight !== 'normal') ? csSrc.fontWeight : 'normal'
      const color = resolvePaintColor(csSrc)
      const variation = csSrc.fontVariationSettings && csSrc.fontVariationSettings !== 'normal'
        ? csSrc.fontVariationSettings
        : ''

      const { dataUrl, width, height } = await materialIconToImage(text, {
        family,
        weight,
        fontSize: size,
        color,
        variation
      })

      el.textContent = ''
      const img = el.ownerDocument.createElement('img')
      img.src = dataUrl
      img.alt = text
      img.style.height = `${size}px`
      img.style.width = `${Math.max(1, Math.round((width / height) * size))}px`
      img.style.objectFit = 'contain'
      // mantener baseline; si el clone ya tiene verticalAlign, úsalo
      img.style.verticalAlign = getComputedStyle(el).verticalAlign || 'baseline'
      el.appendChild(img)

      replaced++
    } catch {
      // seguimos con el resto
    }
  }

  return replaced
}
