/**
 * Web fonts: which @font-face rules a capture needs, emitted with their payloads inlined.
 *
 * Two halves. `collectFontUsage` walks the subtree once and records every family, weight,
 * style and stretch it uses, plus every codepoint it shows. `embedCustomFonts` then scans the
 * document's stylesheets (same-origin through CSSOM, cross-origin fetched, nested @import
 * flattened), keeps the faces that match a used variant and meet a used codepoint, and emits
 * them with every url() turned into a data: URL. Icon fonts are skipped throughout: their
 * glyphs are drawn to images instead (iconFonts.js, and `iconToImage` below).
 *
 * Contracts a change must keep. A remote url() never reaches the emitted CSS, it is inert
 * inside a foreignObject. A family the page uses never ends the scan with zero faces (#478).
 * Descriptors the source did not declare are never invented (#479). The result is memoized
 * per document, codepoint set and option bag, never across them.
 * @module fonts
 */

import { extractURL } from '../utils/helpers'
import { getStyle } from '../utils/css.js'
import { cache } from '../core/cache'
import { isIconFont, isIconFontStylesheet } from '../modules/iconFonts.js'
import { snapFetch } from './snapFetch.js'
import { pseudoGatesFor, getStyleEnvEpoch, flushStyleInvalidations } from './styles.js'
import { nextFrame } from '../utils/browser.js'
import { markInternalNode } from '../utils/ownership.js'

/**
 * Draw one icon-font glyph on a canvas at devicePixelRatio and return it as a data URL.
 *
 * The pseudo pass calls this for a single-character `content` in an icon font: icon fonts are
 * never embedded, so inside the svg the glyph would have no font. The size comes from a
 * hidden span measured in the same family the canvas draws with.
 * @param {string} unicodeChar - The unicode character to render
 * @param {string} fontFamily - The font family name
 * @param {string|number} fontWeight - The font weight
 * @param {number} [fontSize=32] - The font size in pixels
 * @param {string} [color="#000"] - The color to use
 * @returns {Promise<{dataUrl:string,width:number,height:number}>} Data URL and intrinsic size
 */
export async function iconToImage(unicodeChar, fontFamily, fontWeight, fontSize = 32, color = '#000') {
  fontFamily = fontFamily.replace(/^['"]+|['"]+$/g, '')
  const dpr = window.devicePixelRatio || 1

  try { await document.fonts.ready } catch {}

  const span = document.createElement('span')
  markInternalNode(span)
  span.textContent = unicodeChar
  span.style.position = 'absolute'
  span.style.visibility = 'hidden'
  span.style.fontFamily = `"${fontFamily}"`
  span.style.fontWeight = fontWeight || 'normal'
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
  ctx.font = fontWeight ? `${fontWeight} ${fontSize}px "${fontFamily}"` : `${fontSize}px "${fontFamily}"`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = color
  ctx.fillText(unicodeChar, 0, 0)

  return {
    dataUrl: canvas.toDataURL(),
    width,
    height
  }
}

// ---- Font helpers (module-scope; shared by collectors & embedCustomFonts) ----

/** Generic CSS family names to ignore when picking primary family */
const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'emoji', 'math', 'fangsong', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded'
])

/** Path tokens of libraries that ship their own @font-face, so their cross-origin CSS is
 *  fetched even when the URL names no font (KaTeX from a CDN, #344). */
const FONT_LIBRARIES = ['katex', 'mathjax', 'mathml']

/**
 * Normalize a CSS font-family list to the first non-generic family.
 * E.g. `"Roboto", Arial, sans-serif` -> `Roboto`
 * @param {string} familyList
 * @returns {string}
 */
function pickPrimaryFamily(familyList) {
  if (!familyList) return ''
  for (let raw of familyList.split(',')) {
    let f = raw.trim().replace(/^['"]+|['"]+$/g, '')
    if (!f) continue
    if (!GENERIC_FAMILIES.has(f.toLowerCase())) return f
  }
  return ''
}

/**
 * #357: Return ALL non-generic families from a font-family list (for fallback chain embedding).
 * E.g. `"Roboto", "Noto Sans SC", sans-serif` -> ["Roboto", "Noto Sans SC"]
 * @param {string} familyList
 * @returns {string[]}
 */
function pickAllFamilies(familyList) {
  if (!familyList) return []
  const out = []
  for (let raw of familyList.split(',')) {
    let f = raw.trim().replace(/^['"]+|['"]+$/g, '')
    if (!f) continue
    if (!GENERIC_FAMILIES.has(f.toLowerCase())) out.push(f)
  }
  return out
}

/**
 * Normalize weight to 100..900 (maps "normal"->400, "bold"->700).
 * @param {string|number} w
 */
function normWeight(w) {
  const t = String(w ?? '400').trim().toLowerCase()
  if (t === 'normal') return 400
  if (t === 'bold') return 700
  const n = parseInt(t, 10)
  return Number.isFinite(n) ? Math.min(900, Math.max(100, n)) : 400
}

/**
 * Normalize style to "normal" | "italic" | "oblique".
 * @param {string} s
 * @returns {"normal"|"italic"|"oblique"}
 */
function normStyle(s) {
  const t = String(s ?? 'normal').trim().toLowerCase()
  if (t.startsWith('italic')) return 'italic'
  if (t.startsWith('oblique')) return 'oblique'
  return 'normal'
}

/**
 * Normalize font-stretch to a percentage number (50..200). Defaults to 100.
 * @param {string} st
 * @returns {number}
 */
function normStretchPct(st) {
  const m = String(st ?? '100%').match(/(\d+(?:\.\d+)?)\s*%/)
  return m ? Math.max(50, Math.min(200, parseFloat(m[1]))) : 100
}

/** A @font-face weight descriptor as a range: `'400 700'` -> `{ min: 400, max: 700 }`,
 *  `'bold'` -> `{ min: 700, max: 700 }`. */
function parseWeightSpec(spec) {
  const s = String(spec || '400').trim()
  const m = s.match(/^(\d{2,3})\s+(\d{2,3})$/)
  if (m) {
    const a = normWeight(m[1]), b = normWeight(m[2])
    return { min: Math.min(a, b), max: Math.max(a, b) }
  }
  const v = normWeight(s)
  return { min: v, max: v }
}

/** A @font-face style descriptor as its kind: normal, italic or oblique (any angle). */
function parseStyleSpec(spec) {
  const t = String(spec || 'normal').trim().toLowerCase()
  if (t === 'italic') return { kind: 'italic' }
  if (t.startsWith('oblique')) return { kind: 'oblique' }
  return { kind: 'normal' }
}

/** A @font-face stretch descriptor as a percentage range: `'75% 125%'` -> `{ min: 75, max: 125 }`. */
function parseStretchSpec(spec) {
  const s = String(spec || '100%').trim()
  const mm = s.match(/(\d+(?:\.\d+)?)\s*%\s+(\d+(?:\.\d+)?)\s*%/)
  if (mm) {
    const a = parseFloat(mm[1]), b = parseFloat(mm[2])
    return { min: Math.min(a, b), max: Math.max(a, b) }
  }
  const m = s.match(/(\d+(?:\.\d+)?)\s*%/)
  const v = m ? parseFloat(m[1]) : 100
  return { min: v, max: v }
}

/**
 * A family name as the token CDN paths use: "Nunito Variable" -> "nunito", "Nunito Sans
 * Variable" -> "nunito-sans". Whole-name tokens keep Nunito and Nunito Sans apart (#370).
 * @param {string} family
 * @returns {string}
 */
function baseFamilyToken(family) {
  if (!family || typeof family !== 'string') return ''
  let base = family
    .replace(/\s+(variable|vf|v[0-9]+)$/i, '')
    .trim()
    .toLowerCase()
  return base.replace(/\s+/g, '-')
}

/**
 * Whether a <link> stylesheet is worth fetching for @font-face rules.
 *
 * Same-origin sheets always are, they are read through CSSOM with no fetch. Cross-origin
 * ones cost a network round trip, so only known font hosts, the domains the user allowed
 * (`fontStylesheetDomains`, #309), URLs that mention fonts or a required family, and the
 * libraries in FONT_LIBRARIES pass.
 * @param {string} href
 * @param {Set<string>} requiredFamilies - plain names, e.g. "Unbounded"
 * @param {string[]} [allowedDomains=[]]
 * @returns {boolean}
 */
function isLikelyFontStylesheet(href, requiredFamilies, allowedDomains = []) {
  if (!href) return false
  try {
    const u = new URL(href, location.href)
    const sameOrigin = (u.origin === location.origin)
    if (sameOrigin) return true // read via CSSOM, no network fetch here

    const host = u.host.toLowerCase()
    const FONT_HOSTS = [
      'fonts.googleapis.com', 'fonts.gstatic.com',
      'use.typekit.net', 'p.typekit.net', 'kit.fontawesome.com', 'use.fontawesome.com',
      'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'esm.sh'
    ]
    if (FONT_HOSTS.some(h => host.endsWith(h))) return true
    if (allowedDomains.some(d => host === d.toLowerCase() || host.endsWith('.' + d.toLowerCase()))) return true

    const path = (u.pathname + u.search).toLowerCase()
    if (/\bfont(s)?\b/.test(path) || /\.woff2?(\b|$)/.test(path)) return true

    // Check for common libraries that include web fonts (e.g., KaTeX for math rendering)
    if (FONT_LIBRARIES.some(lib => path.includes(lib))) return true

    for (const fam of requiredFamilies) {
      const tokenA = fam.toLowerCase().replace(/\s+/g, '+')
      const tokenB = fam.toLowerCase().replace(/\s+/g, '-')
      const baseToken = baseFamilyToken(fam)
      if (path.includes(tokenA) || path.includes(tokenB)) return true
      if (baseToken && path.includes(baseToken)) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * The plain family names inside the required keys ("family__weight__style__stretchPct").
 * @param {Set<string>} required
 * @returns {Set<string>}
 */
function familiesFromRequired(required) {
  const out = new Set()
  for (const k of (required || [])) {
    const fam = String(k).split('__')[0]?.trim()
    if (fam) out.add(fam)
  }
  return out
}

// ----------------------------------------------------------------------------
// Import inliner + relative URL rewriter per stylesheet level (with cycle guard)
// ----------------------------------------------------------------------------

/** Rewrites all relative url(...) using the given baseHref. */
function rewriteRelativeUrls(cssText, baseHref) {
  if (!cssText) return cssText
  return cssText.replace(
    /url\(\s*(['"]?)([^)'"]+)\1\s*\)/g,
    (m, q, u) => {
      const src = (u || '').trim()
      if (!src || /^data:|^blob:|^https?:|^file:|^about:/i.test(src)) return m
      let abs = src
      try { abs = new URL(src, baseHref || location.href).href } catch {}
      return `url("${abs}")`
    }
  )
}

// Supports both @import url("...") and @import "..."
const IMPORT_ANY_RE = /@import\s+(?:url\(\s*(['"]?)([^)"']+)\1\s*\)|(['"])([^"']+)\3)([^;]*);/g

const MAX_IMPORT_DEPTH = 4

/**
 * Flatten every @import into the text, recursively, rewriting relative url()s against each
 * sheet's own href on the way. Goes through snapFetch rather than CSSOM on purpose: a
 * cross-origin import is blocked there but fetchable here (with the proxy). Cycles are
 * skipped and depth stops at MAX_IMPORT_DEPTH; an import that cannot be fetched stays as is.
 * @param {string} cssText
 * @param {string} ownerHref
 * @param {string} useProxy
 * @returns {Promise<string>}
 */
async function inlineImportsAndRewrite(cssText, ownerHref, useProxy) {
  if (!cssText) return cssText

  const visited = new Set()

  function normalizeUrl(u, base) {
    try { return new URL(u, base || location.href).href } catch { return u }
  }

  async function resolveOnce(text, baseHref, depth = 0) {
    if (depth > MAX_IMPORT_DEPTH) {
      console.warn(`[snapDOM] @import depth exceeded (${MAX_IMPORT_DEPTH}) at ${baseHref}`)
      return text
    }

    let out = ''
    let last = 0
    let m
    // Own regex per call. IMPORT_ANY_RE is module-level and /g, so its lastIndex is shared
    // state — and this function RECURSES into each imported sheet. The nested call resumed
    // scanning from the parent's lastIndex and then left its own behind, so imports after
    // the first nested one were skipped and their @font-face rules never embedded.
    const importRe = new RegExp(IMPORT_ANY_RE.source, 'g')
    while ((m = importRe.exec(text))) {
      out += text.slice(last, m.index)
      last = importRe.lastIndex

      const rawUrl = (m[2] || m[4] || '').trim()
      const absUrl = normalizeUrl(rawUrl, baseHref)

      if (visited.has(absUrl)) {
        console.warn(`[snapDOM] Skipping circular @import: ${absUrl}`)
        continue
      }
      visited.add(absUrl)

      let imported = ''
      try {
        const r = await snapFetch(absUrl, { as: 'text', useProxy, silent: true })
        if (r.ok && typeof r.data === 'string') imported = r.data
      } catch { /* noop */ }

      if (imported) {
        imported = rewriteRelativeUrls(imported, absUrl)
        imported = await resolveOnce(imported, absUrl, depth + 1)
        out += `\n/* inlined: ${absUrl} */\n${imported}\n`
      } else {
        // keep original @import if we couldn't fetch (CORS/offline)
        out += m[0]
      }
    }
    out += text.slice(last)
    return out
  }

  let rewritten = rewriteRelativeUrls(cssText, ownerHref || location.href)
  rewritten = await resolveOnce(rewritten, ownerHref || location.href, 0)
  return rewritten
}

// ----------------------------------------------------------------------------

/** Regexes local to embedCustomFonts */
const URL_RE = /url\((["']?)([^"')]+)\1\)/g
const FACE_RE = /@font-face[^{}]*\{[^}]*\}/g

/** One descriptor's value out of a raw @font-face block. The last declaration may have no
 *  semicolon, so the closing brace ends it too (#475). */
function getFontFaceDeclaration(block, property, fallback = '') {
  const match = block.match(new RegExp(`${property}\\s*:\\s*([^;}]+)[;}]`, 'i'))
  return (match?.[1] || fallback).trim()
}

/**
 * `U+0000-00FF, U+4??` -> `[[0, 255], [0x400, 0x4FF]]`. A `?` wildcard spans its min and max.
 * @param {string} ur
 * @returns {Array<[number, number]>}
 */
function parseUnicodeRange(ur) {
  if (!ur) return []
  const ranges = []
  const parts = ur.split(',').map(s => s.trim()).filter(Boolean)
  for (const p of parts) {
    const m = p.match(/^U\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f?]+))?$/)
    if (!m) continue
    const a = m[1], b = m[2]
    const expand = (hex) => {
      if (!hex.includes('?')) return parseInt(hex, 16)
      const min = parseInt(hex.replace(/\?/g, '0'), 16)
      const max = parseInt(hex.replace(/\?/g, 'F'), 16)
      return [min, max]
    }
    if (b) {
      const A = expand(a), B = expand(b)
      const min = Array.isArray(A) ? A[0] : A
      const max = Array.isArray(B) ? B[1] : B
      ranges.push([Math.min(min, max), Math.max(min, max)])
    } else {
      const X = expand(a)
      if (Array.isArray(X)) ranges.push([X[0], X[1]])
      else ranges.push([X, X])
    }
  }
  return ranges
}

/** Whether any used codepoint falls inside the face's unicode-range. No ranges, or no known
 *  codepoints, means keep it: filtering on what is unknown drops glyphs.
 *  @param {Set<number>} used @param {Array<[number,number]>} ranges */
function unicodeIntersects(used, ranges) {
  if (!ranges.length) return true
  if (!used || used.size === 0) return true // don't over-filter if unknown
  for (const cp of used) {
    for (const [a, b] of ranges) if (cp >= a && cp <= b) return true
  }
  return false
}

/** The absolute URLs in a `src:` value, data: ones left out.
 *  @param {string} srcValue @param {string} baseHref @returns {string[]} */
function extractSrcUrls(srcValue, baseHref) {
  const urls = []
  if (!srcValue) return urls
  for (const m of srcValue.matchAll(URL_RE)) {
    let u = (m[2] || '').trim()
    if (!u || u.startsWith('data:')) continue
    if (!/^https?:/i.test(u)) {
      try { u = new URL(u, baseHref || location.href).href } catch {}
    }
    urls.push(u)
  }
  return urls
}

/**
 * Replace every url() in a @font-face block with its payload as a data: URL, from
 * cache.resource or fetched. Icon font URLs are left alone. A fetch that fails leaves the
 * url() in place and warns. Pinned by __tests__/module.fonts.evictedResource.test.js.
 * @param {string} cssBlock
 * @param {string} baseHref
 * @param {string} [useProxy='']
 * @param {RegExp[]} [iconMatchers]
 * @returns {Promise<string>}
 */
async function inlineUrlsInCssBlock(cssBlock, baseHref, useProxy = '', iconMatchers) {
  let out = cssBlock
  for (const m of cssBlock.matchAll(URL_RE)) {
    const raw = extractURL(m[0])
    if (!raw) continue
    let abs = raw
    if (!abs.startsWith('http') && !abs.startsWith('data:')) {
      try { abs = new URL(abs, baseHref || location.href).href } catch {}
    }
    if (isIconFont(abs, iconMatchers)) continue

    // `cache.resource` is the ONLY proof the payload exists, here and at every other font
    // src below. It is FIFO-capped, so a font fetched earlier can be gone; having merely
    // SEEN the URL proves nothing. Miss => refetch, because the alternative is leaving the
    // live url() in place, and a remote URL inside a foreignObject is inert: the font would
    // silently fail to embed.
    if (cache.resource?.has(abs)) {
      out = out.replace(m[0], `url(${cache.resource.get(abs)})`)
      continue
    }

    try {
      const r = await snapFetch(abs, { as: 'dataURL', useProxy, silent: true })
      if (r.ok && typeof r.data === 'string') {
        const b64 = r.data
        cache.resource?.set(abs, b64)
        out = out.replace(m[0], `url(${b64})`)
      }
    } catch {
      console.warn('[snapDOM] Failed to fetch font resource:', abs)
    }
  }
  return out
}

/** The script a unicode-range covers, for the `excludeFonts.subsets` knob: vietnamese,
 *  cyrillic, greek, latin-ext or latin, most specific first. Null when none applies. */
function subsetFromRanges(ranges) {
  if (!ranges.length) return null
  const hit = (a, b) => ranges.some(([x, y]) => !(y < a || x > b))
  const latin = hit(0x0000, 0x00FF) || hit(0x0131, 0x0131)
  const latinExt = hit(0x0100, 0x024F) || hit(0x1E00, 0x1EFF)
  const greek = hit(0x0370, 0x03FF)
  const cyr = hit(0x0400, 0x04FF)
  const viet = hit(0x1EA0, 0x1EF9) || hit(0x0102, 0x0103) || hit(0x01A0, 0x01A1) || hit(0x01AF, 0x01B0)
  if (viet) return 'vietnamese'
  if (cyr) return 'cyrillic'
  if (greek) return 'greek'
  if (latinExt) return 'latin-ext'
  if (latin) return 'latin'
  return null
}

/** Compile `excludeFonts` ({ families, domains, subsets }) into one predicate over a face's
 *  meta and parsed ranges. Plain names and hosts, no regex for the user. */
function buildSimpleExcluder(ex = {}) {
  const famSet = new Set((ex.families || []).map(s => String(s).toLowerCase()))
  const domSet = new Set((ex.domains || []).map(s => String(s).toLowerCase()))
  const subSet = new Set((ex.subsets || []).map(s => String(s).toLowerCase()))
  return (meta, parsedRanges) => {
    if (famSet.size && famSet.has(meta.family.toLowerCase())) return true
    if (domSet.size) {
      for (const u of meta.srcUrls) {
        try { if (domSet.has(new URL(u).host.toLowerCase())) return true } catch {}
      }
    }
    if (subSet.size) {
      const label = subsetFromRanges(parsedRanges)
      if (label && subSet.has(label)) return true
    }
    return false
  }
}

/** Drop repeated @font-face blocks from the emitted CSS. Two blocks are the same face when
 *  family, weight, style, stretch, unicode-range and the sorted src URLs all agree; the
 *  first one stays. */
function dedupeFontFaces(cssText) {
  if (!cssText) return cssText

  const FACE_RE_G = /@font-face[^{}]*\{[^}]*\}/gi

  const seen = new Set()
  const out = []

  for (const block of cssText.match(FACE_RE_G) || []) {
    const familyRaw = getFontFaceDeclaration(block, 'font-family')
    const family = pickPrimaryFamily(familyRaw)
    const weightSpec = getFontFaceDeclaration(block, 'font-weight', '400')
    const styleSpec = getFontFaceDeclaration(block, 'font-style', 'normal')
    const stretchSpec = getFontFaceDeclaration(block, 'font-stretch', '100%')
    const urange = getFontFaceDeclaration(block, 'unicode-range')
    const srcRaw = getFontFaceDeclaration(block, 'src')

    const urls = extractSrcUrls(srcRaw, location.href)
    const srcPart = urls.length
      ? urls.map(u => String(u).toLowerCase()).sort().join('|')
      : srcRaw.toLowerCase()

    const key = [
      String(family || '').toLowerCase(),
      weightSpec, styleSpec, stretchSpec,
      urange.toLowerCase(),
      srcPart
    ].join('|')

    if (!seen.has(key)) {
      seen.add(key)
      out.push(block)
    }
  }

  if (out.length === 0) return cssText

  let i = 0
  return cssText.replace(FACE_RE_G, () => out[i++] || '')
}

// doc identity for the cache key below: same-origin documents (parent + iframe) can share
// stylesheet hrefs, so the href isn't a safe proxy — assign each Document instance its own id.
const _docIds = new WeakMap()
let _nextDocId = 0
function docCacheId(doc) {
  let id = _docIds.get(doc)
  if (id === undefined) {
    id = _nextDocId++
    _docIds.set(doc, id)
  }
  return id
}

/**
 * The cache.resource key for an embed result. It covers every input that changes the
 * emitted CSS: required variants, exclusions, localFonts, proxy, allowed domains, the
 * document itself (same-origin frames share hrefs, so the Document instance is the id),
 * the used codepoints, and the icon matchers. Leaving any of them out served one
 * capture's CSS to another. Pinned by __tests__/module.fonts.iframe.test.js and the digest
 * collision case in __tests__/regression.reviewP1.test.js.
 */
function buildFontsCacheKey(required, exclude, localFonts, useProxy, fontStylesheetDomains, doc, usedCodepoints, iconMatchers, envEpoch) {
  const req = Array.from(required || []).sort().join('|')
  // The emitted CSS is SUBSETTED by unicode-range against the codepoints the captured
  // subtree actually uses, so two captures of the same families but different text are not
  // interchangeable: an English panel warmed the cache and a Cyrillic one was then served
  // its latin-only faces. Order-independent digest — Set iteration order is insertion order.
  //
  // Each codepoint is AVALANCHED before it joins the sum. Multiplying and adding is linear
  // over the ring, so `sum(imul(c, K)) === imul(sum(c), K)`: the digest was a function of the
  // SUM of the codepoints and nothing else, and any two sets summing alike collided —
  // "ad" and "bc" (97+100 = 98+99) produced the same key, on a cache whose whole job is to
  // tell glyph sets apart. The xor-shift/multiply rounds break that linearity; the outer sum
  // stays, because the digest must not depend on iteration order.
  let cp = 0, n = 0
  for (const c of usedCodepoints || []) {
    let h = Math.imul(c, 2654435761)
    h ^= h >>> 15
    h = Math.imul(h, 2246822507)
    h ^= h >>> 13
    cp = (cp + h) | 0
    n++
  }
  const ex = exclude ? JSON.stringify({
    families: (exclude.families || []).map(s => String(s).toLowerCase()).sort(),
    domains: (exclude.domains || []).map(s => String(s).toLowerCase()).sort(),
    subsets: (exclude.subsets || []).map(s => String(s).toLowerCase()).sort(),
  }) : ''
  const lf = (localFonts || [])
    .map(f => `${(f.family || '').toLowerCase()}::${f.weight || 'normal'}::${f.style || 'normal'}::${f.stretchPct ?? 100}::${f.src || ''}`)
    .sort()
    .join('|')
  const px = useProxy || ''
  const fd = (fontStylesheetDomains || []).map(s => String(s).toLowerCase()).sort().join('|')
  const dc = docCacheId(doc || document)
  // iconFonts decides which families are SKIPPED, so it changes the emitted CSS. Leaving it
  // out meant the first capture of a page decided for every later one: `iconFonts: 'Brand'`
  // and a plain capture of the same subtree shared one entry, and whichever ran first won.
  const ic = (iconMatchers || []).map(rx => String(rx)).sort().join('|')
  return `fonts-embed-css::req=${req}::ex=${ex}::lf=${lf}::px=${px}::fd=${fd}::doc=${dc}::cp=${cp}::n=${n}::ic=${ic}::env=${envEpoch}`
}

// ----------------------------------------------------------------------------
// CSSOM recursive collector (descends into CSSImportRule) with cycle guard
// ----------------------------------------------------------------------------

/**
 * Collect the wanted @font-face rules from one CSSStyleSheet through CSSOM, descending into
 * its @import rules with each subsheet's own href as base. Cycles and depth past
 * MAX_IMPORT_DEPTH are skipped. A sheet whose cssRules throw (cross-origin) is left to the
 * <link> pass, which fetches it as text.
 * @param {CSSStyleSheet} sheet
 * @param {string} baseHref
 * @param {(css:string)=>Promise<void>|void} emitFace
 * @param {Object} ctx
 * @param {Map} ctx.requiredIndex
 * @param {Set<number>} ctx.usedCodepoints
 * @param {(fam:string,styleSpec:string,weightSpec:string,stretchSpec:string)=>boolean} ctx.faceMatchesRequired
 * @param {Set<string>} ctx.coveredFamilies - families a strict match already satisfied (#478)
 * @param {Array<object>} ctx.provisionalFaces - rejected faces of a used family, held raw (#478)
 * @param {((meta:any, ranges:any)=>boolean)|null} ctx.simpleExcluder
 * @param {string} ctx.useProxy
 * @param {RegExp[]} ctx.iconMatchers
 * @param {Set<string>} ctx.visitedSheets
 * @param {number} ctx.depth
 */
async function collectFacesFromSheet(sheet, baseHref, emitFace, ctx) {
  const view = ctx.doc?.defaultView || window
  // Conditions are evaluated in the live document, before the face is emitted without
  // its grouping wrapper into the SVG. Inactive faces must not win its font matching.
  if (sheet.disabled || (sheet.media?.mediaText && !view.matchMedia(sheet.media.mediaText).matches)) return
  let rules
  try {
    rules = sheet.cssRules || []
  } catch {
    // CSSOM blocked (CORS) → handled in <link> pass via fetch+inline
    return
  }

  const normalizeUrl = (u, base) => {
    try { return new URL(u, base || location.href).href } catch { return u }
  }

  for (const rule of rules) {
    if (rule.type === CSSRule.IMPORT_RULE && rule.styleSheet) {
      const childHref = rule.href ? normalizeUrl(rule.href, baseHref) : baseHref

      if (ctx.depth >= MAX_IMPORT_DEPTH) {
        console.warn(`[snapDOM] CSSOM import depth exceeded (${MAX_IMPORT_DEPTH}) at ${childHref}`)
        continue
      }
      if (childHref && ctx.visitedSheets.has(childHref)) {
        console.warn(`[snapDOM] Skipping circular CSSOM import: ${childHref}`)
        continue
      }
      if (childHref) ctx.visitedSheets.add(childHref)

      const nextCtx = { ...ctx, depth: (ctx.depth || 0) + 1 }
      await collectFacesFromSheet(rule.styleSheet, childHref, emitFace, nextCtx)
      continue
    }

    if (rule.cssRules?.length) {
      if (rule.type === CSSRule.MEDIA_RULE && !view.matchMedia(rule.conditionText).matches) continue
      if (rule.type === CSSRule.SUPPORTS_RULE && !view.CSS.supports(rule.conditionText)) continue
      await collectFacesFromSheet(rule, baseHref, emitFace, ctx)
      continue
    }

    if (rule.type === CSSRule.FONT_FACE_RULE) {
      const famRaw = (rule.style.getPropertyValue('font-family') || '').trim()
      const family = pickPrimaryFamily(famRaw)
      if (!family || isIconFont(family, ctx.iconMatchers)) continue

      // An ABSENT descriptor is not the same as an explicit default on a variable font: with
      // no font-weight the browser leaves the wght axis free across the font's whole range,
      // while `font-weight:400` pins it to 400 (same for wdth/slnt via font-stretch and
      // font-style). This block re-emits the rule, so substituting the default here flattened
      // every axis in the capture while the live page varied it (#479). Keep the defaults for
      // *matching*, but emit only the descriptors the source actually declared.
      const weightRaw    = (rule.style.getPropertyValue('font-weight')             || '').trim()
      const styleRaw     = (rule.style.getPropertyValue('font-style')              || '').trim()
      const stretchRaw   = (rule.style.getPropertyValue('font-stretch')            || '').trim()
      const variationRaw = (rule.style.getPropertyValue('font-variation-settings') || '').trim()
      const srcRaw       = (rule.style.getPropertyValue('src')                     || '').trim()
      const urange       = (rule.style.getPropertyValue('unicode-range')           || '').trim()

      const weightSpec  = weightRaw || '400'
      const styleSpec   = styleRaw || 'normal'
      const stretchSpec = stretchRaw || '100%'

      const descriptors =
        (styleRaw ? `font-style:${styleRaw};` : '') +
        (weightRaw ? `font-weight:${weightRaw};` : '') +
        (stretchRaw ? `font-stretch:${stretchRaw};` : '') +
        (variationRaw ? `font-variation-settings:${variationRaw};` : '') +
        (urange ? `unicode-range:${urange};` : '')

      const strict = ctx.faceMatchesRequired(family, styleSpec, weightSpec, stretchSpec)
      if (!strict && !ctx.requiredIndex.has(family.toLowerCase())) continue
      const ranges = parseUnicodeRange(urange)
      if (!unicodeIntersects(ctx.usedCodepoints, ranges)) continue

      const meta = {
        family, weightSpec, styleSpec, stretchSpec,
        unicodeRange: urange,
        srcRaw,
        srcUrls: extractSrcUrls(srcRaw, baseHref || location.href),
        href: baseHref || location.href
      }
      if (ctx.simpleExcluder && ctx.simpleExcluder(meta, ranges)) continue

      // See the <link> pass: held raw until the family is known to have nothing (#478).
      if (!strict) {
        ctx.provisionalFaces.push({
          family: family.toLowerCase(),
          block: `@font-face{font-family:${family};src:${srcRaw};${descriptors}}`,
          srcRaw,
          baseHref: baseHref || location.href,
        })
        continue
      }
      ctx.coveredFamilies.add(family.toLowerCase())

      // Always quote. An unquoted family is a sequence of CSS identifiers, and an identifier
      // may not start with a digit — so "Press Start 2P", "Baloo 2" and "M PLUS 1p" emitted
      // an INVALID @font-face that the parser dropped whole, and the font silently failed to
      // embed while everything else looked fine.
      const familyDecl = `"${String(family).replace(/^\s*["']|["']\s*$/g, '').replace(/(["\\])/g, '\\$1')}"`
      if (/url\(/i.test(srcRaw)) {
        const inlinedSrc = await inlineUrlsInCssBlock(srcRaw, baseHref || location.href, ctx.useProxy, ctx.iconMatchers)
        await emitFace(`@font-face{font-family:${familyDecl};src:${inlinedSrc};${descriptors}}`)
      } else {
        await emitFace(`@font-face{font-family:${familyDecl};src:${srcRaw};${descriptors}}`)
      }
    }
  }
}

/**
 * Build the @font-face CSS a capture needs, every payload inlined as a data: URL.
 *
 * Sources, in order: <link> stylesheets (same-origin read through CSSOM, cross-origin fetched
 * when the URL looks like a font sheet, nested @import flattened), the rest of
 * document.styleSheets through CSSOM, the faces the strict filter rejected for a family that
 * ended with nothing (#478), FontFaces the page built in script and tagged with `_snapdomSrc`
 * (a FontFace does not expose its source, so the host puts it there), and `localFonts`.
 *
 * A face is kept when its family is used, it matches a used variant (exact first, then a
 * weight within 300, then a normal face for an italic request the family cannot serve),
 * and its unicode-range meets a used codepoint. Only descriptors the source declared are
 * emitted (#479), and the family is always quoted. The result is memoized in cache.resource
 * under a key that covers every input, document included (#441).
 * Pinned by __tests__/module.fonts.*.test.js.
 *
 * @typedef {{family:string, weightSpec:string, styleSpec:string, stretchSpec:string, unicodeRange:string, srcRaw:string, srcUrls:string[], href:string}} FontFaceMeta
 *
 * @param {Object} options
 * @param {Set<string>} options.required - keys "family__weight__style__stretchPct", from collectFontUsage
 * @param {Set<number>} options.usedCodepoints - codepoints the captured subtree shows
 * @param {{families?:string[], domains?:string[], subsets?:string[]}} [options.exclude] - the `excludeFonts` option
 * @param {Array<{family:string,src:string,weight?:string|number,style?:string,stretchPct?:number}>} [options.localFonts=[]]
 * @param {string}  [options.useProxy=""]
 * @param {string[]} [options.fontStylesheetDomains=[]] - extra domains whose cross-origin CSS is fetched (#309)
 * @param {RegExp[]} [options.iconMatchers=[]] - this capture's `iconFonts`, compiled (context.__iconMatchers)
 * @param {Document} [options.doc=document] - the element's ownerDocument, so an iframe's own fonts are found (#441)
 * @returns {Promise<string>} inlined @font-face CSS, '' when nothing is needed
 */
export async function embedCustomFonts({
  required,
  usedCodepoints,
  exclude = undefined,
  localFonts = [],
  useProxy = '',
  fontStylesheetDomains = [],
  iconMatchers = [],
  doc = document,
} = {}) {
  // ---------- Normalize inputs ----------
  if (!(required instanceof Set)) required = new Set()
  if (!(usedCodepoints instanceof Set)) usedCodepoints = new Set()

  // Build index: family -> [{w,s,st}]. CSS font-family names are case-insensitive, so the
  // index is keyed lowercase and every lookup lowercases too — otherwise a page using
  // `Roboto` against `@font-face { font-family: roboto }` would silently fail to embed.
  const requiredIndex = new Map()
  for (const key of required) {
    const [fam, w, s, st] = String(key).split('__')
    if (!fam) continue
    const famKey = fam.toLowerCase()
    const arr = requiredIndex.get(famKey) || []
    arr.push({ w: parseInt(w, 10), s, st: parseInt(st, 10) })
    requiredIndex.set(famKey, arr)
  }

  /**
 * Whether a @font-face serves at least one variant the page asked for in its family.
 *
 * Three tiers. An exact match on weight (inside the face's range), style kind and stretch.
 * Then a single-weight face within 300 of the request, same style and stretch. Then, when
 * the page asks for italic or oblique and this family only declares a normal face, that
 * normal face, so the engine can synthesize the slant instead of falling back to a system
 * font.
 *
 * @param {string} fam
 * @param {string} styleSpec   font-style from the @font-face, e.g. "normal" or "italic"
 * @param {string} weightSpec  font-weight from the @font-face, e.g. "400" or "400 700"
 * @param {string} stretchSpec font-stretch from the @font-face, e.g. "100%"
 * @returns {boolean}
 */
function faceMatchesRequired(fam, styleSpec, weightSpec, stretchSpec) {
  const famKey = String(fam).toLowerCase()
  if (!requiredIndex.has(famKey)) return false

  const need = requiredIndex.get(famKey)
  const ws = parseWeightSpec(weightSpec)
  const ss = parseStyleSpec(styleSpec)
  const ts = parseStretchSpec(stretchSpec)

  const faceIsRange = ws.min !== ws.max
  const faceSingleW = ws.min

  const styleOK = (reqKind) => (
    (ss.kind === 'normal' && reqKind === 'normal') ||
    (ss.kind !== 'normal' && (reqKind === 'italic' || reqKind === 'oblique'))
  )

  let exactMatched = false

  // 1) Exact match
  for (const r of need) {
    const wOk = faceIsRange ? (r.w >= ws.min && r.w <= ws.max) : (r.w === faceSingleW)
    const sOk = styleOK(normStyle(r.s))
    const tOk = (r.st >= ts.min && r.st <= ts.max)

    if (wOk && sOk && tOk) {
      exactMatched = true
      break
    }
  }

  if (exactMatched) return true

  // 2) Near weight, same style and stretch
  if (!faceIsRange) {
    for (const r of need) {
      const sOk = styleOK(normStyle(r.s))
      const tOk = (r.st >= ts.min && r.st <= ts.max)
      const nearWeight = Math.abs(faceSingleW - r.w) <= 300
      if (nearWeight && sOk && tOk) return true
    }
  }

  // 3) Fallback: the DOM asks for italic/oblique but THIS family only declares a normal
  //    @font-face. Accept the normal face when weight/stretch are reasonable.
  if (!faceIsRange && ss.kind === 'normal') {
    const hasItalicRequest = need.some((r) => normStyle(r.s) !== 'normal')
    if (hasItalicRequest) {
      for (const r of need) {
        const nearWeight = Math.abs(faceSingleW - r.w) <= 300
        const stretchOK = (r.st >= ts.min && r.st <= ts.max)
        if (nearWeight && stretchOK) {
          return true
        }
      }
    }
  }

  // No branch above accepted this face. That is not the end of the story: the rules here
  // reject a face that is FAR from what the page asked for, which is right while some
  // other face of the family is closer — and wrong when there is no other face. CSS never
  // drops a family that has faces; it picks the closest one and synthesises the rest.
  // The caller therefore holds rejected faces of a required family as provisional and
  // emits them only if the family ends the scan with nothing (issue #478).
  return false
}

  const simpleExcluder = buildSimpleExcluder(exclude)

  // Font bytes remain cached by URL, but assembled face CSS depends on current rules and
  // descriptors. Reuse the shared environment epoch, not a per-capture stylesheet census.
  // Wire this document before draining so direct/iframe callers also see same-task edits.
  getStyleEnvEpoch(doc)
  flushStyleInvalidations()
  const cacheKey = buildFontsCacheKey(required, exclude, localFonts, useProxy, fontStylesheetDomains, doc, usedCodepoints, iconMatchers, getStyleEnvEpoch(doc))
  if (cache.resource?.has(cacheKey)) {
    return cache.resource.get(cacheKey)
  }

  // ---- Ensure only likely @import font styles become reachable (<link>), avoid noise ----
  const requiredFamilies = familiesFromRequired(required)

  const importUrls = []
  const IMPORT_ANY_RE_LOCAL = IMPORT_ANY_RE

  for (const styleTag of doc.querySelectorAll('style')) {
    const cssText = styleTag.textContent || ''
    for (const m of cssText.matchAll(IMPORT_ANY_RE_LOCAL)) {
      const u = (m[2] || m[4] || '').trim()
      if (!u || isIconFontStylesheet(u, iconMatchers)) continue
      const hasLink = !!doc.querySelector(`link[rel="stylesheet"][href="${u}"]`)
      if (!hasLink) importUrls.push(u)
    }
  }
  // @import font URLs with no matching <link> are made reachable by injecting a temporary
  // <link>. These are tracked and removed below so the capture never mutates the user's DOM.
  //
  // The deadline is not optional. A <link> cannot be aborted and fires NEITHER load nor
  // error while a request hangs, so a stylesheet that never answers — an offline CDN, a
  // service worker holding the request, a captive portal — left this Promise.all pending
  // forever: snapdom() never settled, and the temporary <link> the comment above promises
  // to remove stayed in the user's <head> because the removal is after the await. Missing
  // that font costs one fallback glyph run; waiting for it costs the whole capture. Same
  // 3s budget snapFetch gives every other remote resource.
  const injectedLinks = []
  if (importUrls.length) {
    await Promise.all(importUrls.map((u) => new Promise((resolve) => {
      if (doc.querySelector(`link[rel="stylesheet"][href="${u}"]`)) return resolve(null)
      const link = doc.createElement('link')
      link.rel = 'stylesheet'
      link.href = u
      markInternalNode(link)
      link.setAttribute('data-snapdom', 'injected-import')
      const timer = setTimeout(() => resolve(null), 3000)
      const settle = (v) => { clearTimeout(timer); resolve(v) }
      link.onload = () => settle(link)
      link.onerror = () => settle(null)
      doc.head.appendChild(link)
      injectedLinks.push(link)
    })))
  }

  let finalCSS = ''

  // #478 — a required family must never end the scan with zero faces. `coveredFamilies`
  // records the families a strict match already satisfied; `provisionalFaces` holds the
  // ones the strict filter rejected, un-inlined, so the fallback below costs nothing
  // unless it is actually needed.
  const coveredFamilies = new Set()
  const provisionalFaces = []

  // ---------- 1) External <link rel="stylesheet"> ----------
  // Snapshot BEFORE detaching the injected links so their @import'd font CSS is still
  // collected below, then remove them from <head> to keep the capture non-destructive.
  const linkNodes = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).filter(l => !!l.href)
  for (const l of injectedLinks) { try { l.remove() } catch { /* ok */ } }

  for (const link of linkNodes) {
    try {
      // Whole-URL skip: only for stylesheets that hold nothing but icon fonts (#493)
      if (isIconFontStylesheet(link.href, iconMatchers)) continue

      let cssText = ''
      let sameOrigin = false
      try { sameOrigin = new URL(link.href, location.href).origin === location.origin } catch {}

      if (!sameOrigin) {
        const allowedDomains = Array.isArray(fontStylesheetDomains) ? fontStylesheetDomains : []
        if (!isLikelyFontStylesheet(link.href, requiredFamilies, allowedDomains)) continue
      }

      if (sameOrigin) {
        const sheet = Array.from(doc.styleSheets).find(s => s.href === link.href)
        if (sheet) {
          try {
            const rules = sheet.cssRules || []
            cssText = Array.from(rules).map(r => r.cssText).join('')
          } catch {
            // fallback to fetch below
          }
        }
      }

      if (!cssText) {
        const res = await snapFetch(link.href, { as: 'text', useProxy })
        if (res?.ok && typeof res.data === 'string') cssText = res.data
      }

      // Flatten nested @import and rewrite relative urls per-level using link.href as base
      cssText = await inlineImportsAndRewrite(cssText, link.href, useProxy)

      let facesOut = ''
      for (const face of cssText.match(FACE_RE) || []) {
        const famRaw = getFontFaceDeclaration(face, 'font-family')
        const family = pickPrimaryFamily(famRaw)
        if (!family || isIconFont(family, iconMatchers)) continue

        const weightSpec = getFontFaceDeclaration(face, 'font-weight', '400')
        const styleSpec = getFontFaceDeclaration(face, 'font-style', 'normal')
        const stretchSpec = getFontFaceDeclaration(face, 'font-stretch', '100%')
        const urange = getFontFaceDeclaration(face, 'unicode-range')
        const srcRaw = getFontFaceDeclaration(face, 'src')
        const srcUrls = extractSrcUrls(srcRaw, link.href)

        const strict = faceMatchesRequired(family, styleSpec, weightSpec, stretchSpec)
        if (!strict && !requiredIndex.has(family.toLowerCase())) continue
        const ranges = parseUnicodeRange(urange)
        if (!unicodeIntersects(usedCodepoints, ranges)) continue

        const meta = { family, weightSpec, styleSpec, stretchSpec, unicodeRange: urange, srcRaw, srcUrls, href: link.href }
        if (exclude && simpleExcluder(meta, ranges)) continue

        // Far from the request, but this family is used: hold it in case nothing closer
        // shows up (#478). Held raw, so a family that IS covered costs no extra fetch.
        if (!strict) { provisionalFaces.push({ family: family.toLowerCase(), block: face, srcRaw, baseHref: link.href }); continue }
        coveredFamilies.add(family.toLowerCase())

        const newFace = /url\(/i.test(srcRaw)
          ? await inlineUrlsInCssBlock(face, link.href, useProxy, iconMatchers)
          : face
        facesOut += newFace
      }

      if (facesOut.trim()) finalCSS += facesOut
    } catch {
      console.warn('[snapDOM] Failed to process stylesheet:', link.href)
    }
  }

  // ---------- 2) CSSOM (inline/imported) ----------
  const ctx = {
    doc,
    requiredIndex,
    usedCodepoints,
    faceMatchesRequired,
    coveredFamilies,
    provisionalFaces,
    simpleExcluder: exclude ? buildSimpleExcluder(exclude) : null,
    useProxy,
    iconMatchers,
    visitedSheets: new Set(),
    depth: 0
  }

  // Constructed/adopted sheets do not appear in document.styleSheets, but their faces
  // participate in the same font matching as ordinary sheets.
  const sheets = new Set([...doc.styleSheets, ...(doc.adoptedStyleSheets || [])])
  for (const sheet of sheets) {
    if (sheet.href && linkNodes.some(l => l.href === sheet.href)) continue
    try {
      const rootHref = sheet.href || doc.baseURI || (location.origin + '/')
      if (rootHref) ctx.visitedSheets.add(rootHref)
      await collectFacesFromSheet(
        sheet,
        rootHref,
        async (faceCss) => { finalCSS += faceCss },
        ctx
      )
    } catch {
      // cross-origin protected CSSOM; ignore (text pass already tried)
    }
  }

  // ---------- 2b) Families the strict filter left empty (#478) ----------
  // The page uses this family and every one of its faces was judged too far from the
  // request. CSS would still render it — the browser picks the closest face and
  // synthesises weight/stretch — so dropping it is what produces the reported fallback
  // to a system font. Emit what the family does have.
  for (const p of provisionalFaces) {
    if (coveredFamilies.has(p.family)) continue
    finalCSS += /url\(/i.test(p.srcRaw)
      ? await inlineUrlsInCssBlock(p.block, p.baseHref, useProxy, iconMatchers)
      : p.block
  }

  // ---------- 3) document.fonts with _snapdomSrc ----------
  // Faces the page built in script. A FontFace does not expose its source, so the host tags
  // it with `_snapdomSrc` (URL or data:); snapdom never sets that field itself.
  try {
    for (const f of doc.fonts || []) {
      if (!f || !f.family || f.status !== 'loaded' || !f._snapdomSrc) continue
      const fam = String(f.family).replace(/^['"]+|['"]+$/g, '')
      if (isIconFont(fam, iconMatchers)) continue
      if (!requiredIndex.has(fam.toLowerCase())) continue

      if (exclude?.families && exclude.families.some(n => String(n).toLowerCase() === fam.toLowerCase())) {
        continue
      }

      let b64 = f._snapdomSrc
      if (!String(b64).startsWith('data:')) {
        if (cache.resource?.has(f._snapdomSrc)) {
          b64 = cache.resource.get(f._snapdomSrc)
        } else {
          try {
            const r = await snapFetch(f._snapdomSrc, { as: 'dataURL', useProxy, silent: true })
            if (r.ok && typeof r.data === 'string') {
              b64 = r.data
              cache.resource?.set(f._snapdomSrc, b64)
            } else {
              continue
            }
          } catch {
            console.warn('[snapDOM] Failed to fetch dynamic font src:', f._snapdomSrc)
            continue
          }
        }
      }
      finalCSS += `@font-face{font-family:'${fam}';src:url(${b64});font-style:${f.style || 'normal'};font-weight:${f.weight || 'normal'};}`
    }
  } catch {}

  // ---------- 4) user-provided localFonts ----------
  for (const font of localFonts) {
    if (!font || typeof font !== 'object') continue
    const family = String(font.family || '').replace(/^['"]+|['"]+$/g, '')
    if (!family || isIconFont(family, iconMatchers)) continue
    if (!requiredIndex.has(family.toLowerCase())) continue
    if (exclude?.families && exclude.families.some(n => String(n).toLowerCase() === family.toLowerCase())) continue

    const weight = font.weight != null ? String(font.weight) : 'normal'
    const style = font.style != null ? String(font.style) : 'normal'
    const stretch = font.stretchPct != null ? `${font.stretchPct}%` : '100%'
    const src = String(font.src || '')

    let b64 = src
    if (!b64.startsWith('data:')) {
      if (cache.resource?.has(src)) {
        b64 = cache.resource.get(src)
      } else {
        try {
          const r = await snapFetch(src, { as: 'dataURL', useProxy, silent: true })
          if (r.ok && typeof r.data === 'string') {
            b64 = r.data
            cache.resource?.set(src, b64)
          } else {
            continue
          }
        } catch {
          console.warn('[snapDOM] Failed to fetch localFonts src:', src)
          continue
        }
      }
    }
    finalCSS += `@font-face{font-family:'${family}';src:url(${b64});font-style:${style};font-weight:${weight};font-stretch:${stretch};}`
  }

  // ---------- Cache + return ----------
  if (finalCSS) {
    finalCSS = dedupeFontFaces(finalCSS)
    cache.resource?.set(cacheKey, finalCSS)
  }
  return finalCSS
}

// ----------------------------------------------------------------------------
// Collectors for required variants and used codepoints
// ----------------------------------------------------------------------------

/**
 * Collect the font variants AND the codepoints a subtree uses, in one walk.
 *
 * The two used to be separate collectors, each re-walking the tree with fresh
 * getComputedStyle calls (element, ::before and ::after per node). This one walks once on
 * the memoized getStyle cache, shared with the clone pass and across captures. Every family
 * in a fallback chain is registered, not only the first (#357), and pseudo content counts
 * toward the codepoints. The Safari pre-step (snapdom.js) runs it and hands the result to
 * the fonts phase, so a non-clip capture pays for it once.
 * @param {Element} root
 * @param {((el: Element) => boolean)|null} [keep] - Clip mode: skip elements outside the window
 * @returns {{required: Set<string>, usedCodepoints: Set<number>}}
 */
export function collectFontUsage(root, keep) {
  const required = /* @__PURE__ */ new Set()
  const usedCodepoints = /* @__PURE__ */ new Set()
  if (!root) return { required, usedCodepoints }

  const pushText = (txt) => {
    if (!txt) return
    for (const ch of txt) usedCodepoints.add(ch.codePointAt(0))
  }
  const addFromStyle = (cs) => {
    // #357: Register ALL families in the fallback chain, not just the primary one.
    // This ensures that if the first font doesn't have a glyph, the fallback font is also embedded.
    const families = pickAllFamilies(cs.fontFamily)
    if (!families.length) return
    for (const family of families) {
      required.add(`${family}__${normWeight(cs.fontWeight)}__${normStyle(cs.fontStyle)}__${normStretchPct(cs.fontStretch)}`)
    }
  }
  // Same selector gate as inlinePseudoElements: skip the two pseudo style resolutions
  // for nodes no collected ::before/::after selector matches (null gate → probe).
  const gates = pseudoGatesFor(root)
  const scope = root.getRootNode()
  const visitElement = (el) => {
    addFromStyle(getStyle(el))
    // Document selectors cannot rule out pseudos in a component's own stylesheet.
    const elementGates = el.getRootNode() === scope ? gates : pseudoGatesFor(el)
    for (const pseudo of ['::before', '::after']) {
      const gate = pseudo === '::before' ? elementGates.before : elementGates.after
      if (gate !== null) {
        if (gate === '') continue
        try { if (!el.matches(gate)) continue } catch { /* probe */ }
      }
      const cs = getStyle(el, pseudo)
      const c = cs && cs.content
      if (!c || c === 'none' || c === 'normal') continue
      addFromStyle(cs)
      if (/^["']/.test(c)) {
        pushText(c.slice(1, -1))
      } else {
        const matches = c.match(/\\[0-9A-Fa-f]{1,6}/g)
        if (matches) {
          for (const m of matches) {
            try { usedCodepoints.add(parseInt(m.slice(1), 16)) } catch {}
          }
        }
      }
    }
  }

  // TreeWalker stops at shadow boundaries, while deepClone includes their painted
  // content. Walk each open root as well so font subsets and auto-embedding see it.
  const trees = [root]
  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i]
    if (tree.nodeType === Node.ELEMENT_NODE) visitElement(tree)
    if (tree.shadowRoot) trees.push(tree.shadowRoot)
    const walker = (root.ownerDocument || document).createTreeWalker(tree, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null)
    while (walker.nextNode()) {
      const n = walker.currentNode
      if (n.nodeType === Node.TEXT_NODE) {
        if (keep && n.parentElement && !keep(n.parentElement)) continue
        pushText(n.nodeValue || '')
      } else {
        if (keep && !keep(/** @type {Element} */ (n))) continue
        visitElement(/** @type {Element} */ (n))
        if (n.shadowRoot) trees.push(n.shadowRoot)
      }
    }
  }
  return { required, usedCodepoints }
}

/**
 * The variant half of collectFontUsage. The pipeline calls the fused walk; this stays for
 * callers that need one half.
 * @param {Element} root
 * @param {((el: Element) => boolean)|null} [keep]
 * @returns {Set<string>} keys "family__weight__style__stretchPct"
 */
export function collectUsedFontVariants(root, keep) {
  return collectFontUsage(root, keep).required
}

/**
 * The codepoint half of collectFontUsage, ::before/::after content included.
 * @param {Element} root
 * @param {((el: Element) => boolean)|null} [keep]
 * @returns {Set<number>}
 */
export function collectUsedCodepoints(root, keep) {
  return collectFontUsage(root, keep).usedCodepoints
}

/**
 * Wait for the document's fonts, then lay out a hidden span per family so each face has
 * been fetched and rasterized before the clone reads it.
 *
 * Safari-only in practice: every caller gates it on isSafari(), and the pre-step in
 * snapdom.js passes only the families the element uses, since waiting on system families
 * cost about 30 ms per capture on WebKit for nothing. Each repetition waits two frames.
 * @param {Set<string>|string[]} families - plain family names, e.g. "Unbounded"
 * @param {number} [warmupRepetitions=2] - how many times to lay the spans out
 * @param {Document} [doc=document] - the element's ownerDocument, for iframe content
 * @returns {Promise<void>}
 */
export async function ensureFontsReady(families, warmupRepetitions = 2, doc = document) {
  try { await doc.fonts.ready } catch {}

  const fams = Array.from(families || []).filter(Boolean)
  if (fams.length === 0) return

  const warmupOnce = () => {
    const container = doc.createElement('div')
    markInternalNode(container)
    container.style.cssText = 'position:absolute!important;left:-9999px!important;top:0!important;opacity:0!important;pointer-events:none!important;contain:layout size style;'

    for (const fam of fams) {
      const span = doc.createElement('span')
      span.textContent = 'AaBbGg1234ÁÉÍÓÚçñ—∞'
      span.style.fontFamily = `"${fam}"`
      span.style.fontWeight = '700'
      span.style.fontStyle = 'italic'
      span.style.fontSize = '32px'
      span.style.lineHeight = '1'
      span.style.whiteSpace = 'nowrap'
      span.style.margin = '0'
      span.style.padding = '0'
      container.appendChild(span)
    }

    doc.body.appendChild(container)
    // Force layout
    container.offsetWidth
    doc.body.removeChild(container)
  }

  for (let i = 0; i < Math.max(1, warmupRepetitions); i++) {
    warmupOnce()
    await nextFrame()
    await nextFrame()
  }
}
