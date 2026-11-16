/**
 * WebKit draws shadows wrong when an SVG is used as an image: the Y offset is flipped, the
 * result is corrupt at any scale but the natural one, and a stroke colour kills text-shadow.
 * `fixSafariShadows` probes for it once and rewrites the capture's CSS. Runs on WebKit only;
 * re-verify in real Safari before touching it, Playwright's WebKit does not reproduce it.
 * @module exporters/safariShadows
 */

/* c8 ignore start -- the shadow rewrites below run only from fixSafariShadows (WebKit); coverage runs on chromium */
/** Split a declaration list on top-level `;` only, so the `;` inside a data: url() survives. */
function splitDecls(s) {
  let parts = [], buf = '', depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ';' && depth === 0) { parts.push(buf); buf='' } else buf += ch
  }
  if (buf.trim()) parts.push(buf)
  return parts.map(x => x.trim()).filter(Boolean)
}
/**
 * Rewrite a box-shadow value as drop-shadow() filters, for engines that do not paint
 * box-shadow inside svg-as-image. Inset layers are dropped (no filter equivalent), spread is
 * dropped (drop-shadow has none) and the blur radius is halved, since WebKit takes it as sigma.
 * @param {string} value
 * @returns {string} space-separated drop-shadow() functions, empty when no layer applies
 */
function boxShadowToDropShadow(value) {
  // split by layer without breaking the parentheses of color functions
  const layers = []
  let buf = '', depth = 0
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) { layers.push(buf.trim()); buf = '' }
    else buf += ch
  }
  if (buf.trim()) layers.push(buf.trim())

  const fns = []
  for (const layer of layers) {
    // CSS inset box-shadows have no SVG filter equivalent (drop-shadow only supports outer shadows).
    // They are intentionally omitted from the canvas export rather than rendered incorrectly.
    if (/\binset\b/i.test(layer)) continue
    const nums = layer.match(/-?\d+(?:\.\d+)?px/gi) || []
    let [ox='0px', oy='0px', blur='0px'] = nums // a fourth value (spread) has no drop-shadow equivalent
    // WebKit renders drop-shadow at ~2x the radius (radius taken as sigma): halve
    // so the fallback shadow matches the live box-shadow width.
    blur = `${parseFloat(blur) / 2}px`
    // color is roughly whatever is left after removing px values and 'inset'
    let color = layer.replace(/-?\d+(?:\.\d+)?px/gi, '')
                     .replace(/\binset\b/ig, '')
                     .trim().replace(/\s{2,}/g, ' ')
    const hasColor = !!color && color !== ',' // loose on purpose: any leftover token is the colour
    fns.push(`drop-shadow(${ox} ${oy} ${blur}${hasColor ? ` ${color}` : ''})`)
  }
  return fns.join(' ')
}
/** Move a declaration list's box-shadow into its filter and -webkit-filter as drop-shadow(). */
function rewriteDeclList(list) {
  const decls = splitDecls(list)
  let filter = null, wfilter = null, box = null
  const rest = []
  for (const d of decls) {
    const idx = d.indexOf(':')
    if (idx < 0) continue
    const prop = d.slice(0, idx).trim().toLowerCase()
    const val  = d.slice(idx + 1).trim()
    if (prop === 'box-shadow') box = val
    else if (prop === 'filter') filter = val
    else if (prop === '-webkit-filter') wfilter = val
    else rest.push([prop, val])
  }
  if (box) {
    const ds = boxShadowToDropShadow(box)
    if (ds) {
      filter = filter ? `${filter} ${ds}` : ds
      wfilter = wfilter ? `${wfilter} ${ds}` : ds
      // optional: drop the original box-shadow so it cannot come back
      // (not strictly required inside the SVG)
    }
  }
  const out = [...rest]
  if (filter) out.push(['filter', filter])
  if (wfilter) out.push(['-webkit-filter', wfilter])
  return out.map(([k, v]) => `${k}:${v}`).join(';')
}
/** rewriteDeclList over every rule body of a stylesheet. */
function rewriteCssBlock(css) {
  return css.replace(/([^{}]+)\{([^}]*)\}/g, (_m, sel, body) => `${sel}{${rewriteDeclList(body)}}`)
}
/** The drop-shadow rewrite over an svg's <style> blocks and its style="" attributes. */
function rewriteSvgBoxShadowToDropShadow(svgText) {
  // 1) <style>…</style>
  svgText = svgText.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (m, css) =>
    m.replace(css, rewriteCssBlock(css))
  )
  // 2) style="…"
  svgText = svgText.replace(/style=(['"])([\s\S]*?)\1/gi, (m, q, body) =>
    `style=${q}${rewriteDeclList(body)}${q}`
  )
  return svgText
}
// Modern WebKit paints box-shadow natively in svg-as-image (the drop-shadow rewrite is for
// engines that do not, and loses spread) BUT flips the Y offset of box- and text-shadow
// (drop-shadow is fine). Probe both once per session: a black box and its offset shadow.
let _svgShadowProbe = null
function probeSvgShadowSupport() {
  if (_svgShadowProbe) return _svgShadowProbe
  _svgShadowProbe = (async () => {
    try {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="20">' +
        '<foreignObject width="8" height="20"><div xmlns="http://www.w3.org/1999/xhtml" ' +
        'style="width:4px;height:4px;margin-top:8px;background:#000;box-shadow:0 8px 0 0 #000"></div></foreignObject></svg>'
      const img = new Image()
      img.decoding = 'sync'
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = 8
      c.height = 20
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const below = ctx.getImageData(2, 18, 1, 1).data[3] > 128
      const above = ctx.getImageData(2, 2, 1, 1).data[3] > 128
      return { native: below || above, flippedY: above && !below }
    } catch {
      return { native: false, flippedY: false }
    }
  })()
  return _svgShadowProbe
}

/** Negates the 2nd top-level px length (the Y offset) of each shadow layer. */
function negateShadowY(value) {
  const layers = []
  let depth = 0, start = 0
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ',' && depth === 0) { layers.push(value.slice(start, i)); start = i + 1 }
  }
  layers.push(value.slice(start))
  return layers.map((seg) => {
    let d = 0, count = 0, out = '', i = 0
    while (i < seg.length) {
      const ch = seg[i]
      if (ch === '(') d++
      else if (ch === ')') d = Math.max(0, d - 1)
      if (d === 0 && (i === 0 || seg[i - 1] === ' ')) {
        const m = /^-?\d*\.?\d+px/.exec(seg.slice(i))
        if (m) {
          count++
          out += count === 2 ? `${-parseFloat(m[0])}px` : m[0]
          i += m[0].length
          continue
        }
      }
      out += ch
      i++
    }
    return out
  }).join(',')
}

/** Rewrites box-/text-shadow declarations in the svg, negating their Y offsets. */
function rewriteSvgShadowOffsets(svgText, includeBoxShadow) {
  const rewriteList = (list) => splitDecls(list).map((d) => {
    const idx = d.indexOf(':')
    if (idx < 0) return d
    const prop = d.slice(0, idx).trim().toLowerCase()
    if (prop === 'text-shadow' || (includeBoxShadow && prop === 'box-shadow')) {
      return `${prop}:${negateShadowY(d.slice(idx + 1))}`
    }
    return d
  }).join(';')
  svgText = svgText.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (m, css) =>
    m.replace(css, css.replace(/([^{}]+)\{([^}]*)\}/g, (_m, sel, body) => `${sel}{${rewriteList(body)}}`))
  )
  svgText = svgText.replace(/style=(['"])([\s\S]*?)\1/gi, (m, q, body) => `style=${q}${rewriteList(body)}${q}`)
  return svgText
}
/* c8 ignore stop */

/**
 * Rewrite Safari shadows in decoded svg text. `naturalOnly` says it carries box-/text-shadows,
 * which WebKit rasterizes right only at the svg's natural size (any other scale corrupts their
 * offsets or drops blurred ones), so the caller must draw 1:1 and resample the raster.
 * @param {string} svg - decoded svg text
 * @returns {Promise<{svg: string, naturalOnly: boolean}>}
 */
export async function fixSafariShadows(svg) {
  // Real shadows carry px lengths; `text-shadow:none` defaults must not match.
  const hasShadows = /(?:box-shadow|text-shadow)\s*:[^;"}]*px/i.test(svg)
  if (!hasShadows) return { svg, naturalOnly: false }
  const { native, flippedY } = await probeSvgShadowSupport()
  try {
    let out = svg
    // No native box-shadow: emulate via drop-shadow (correct Y, blur halved from ~2x).
    if (!native) out = rewriteSvgBoxShadowToDropShadow(out)
    // Flipped Y: pre-negate box-shadow (only while still native) and text-shadow.
    if (flippedY) out = rewriteSvgShadowOffsets(out, native)
    return { svg: out, naturalOnly: true }
  } catch {
    return { svg, naturalOnly: true }
  }
}
