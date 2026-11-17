/**
 * Web fonts: which @font-face rules a capture needs, emitted with their payloads inlined.
 * `collectFontUsage` records every family, weight, style, stretch and codepoint the subtree
 * uses; `embedCustomFonts` keeps the stylesheet faces that match them. Icon fonts are skipped:
 * their glyphs are drawn to images (iconFonts.js).
 *
 * Contracts: a remote url() never reaches the emitted CSS (it is inert inside a
 * foreignObject). A used family never ends the scan with zero faces (#478). Descriptors the
 * source did not declare are never invented (#479). The result is memoized per document,
 * codepoint set and option bag, never across them.
 * @module fonts
 */

import { extractURL } from '../utils/helpers'
import { getStyle } from '../utils/css.js'
import { cache } from '../core/cache'
import { isIconFont, isIconFontStylesheet } from '../modules/iconFonts.js'
import { snapFetch } from './snapFetch.js'
import { pseudoGatesFor } from './authorStyles.js'
import { getStyleEnvEpoch, flushStyleInvalidations } from '../core/changes.js'
import { nextFrame, fontsSettled } from '../utils/browser.js'
import { markInternalNode } from '../utils/ownership.js'
import { debugWarn } from '../utils/debug.js'

// ---- Font helpers (module-scope; shared by collectors & embedCustomFonts) ----

/** Generic CSS family names to ignore when picking primary family */
const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'emoji', 'math', 'fangsong', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded'
])

/** Path tokens of libraries that ship their own @font-face, so their cross-origin CSS is
 *  fetched even when the URL names no font (KaTeX from a CDN, #344). */
const FONT_LIBRARIES = ['katex', 'mathjax', 'mathml']
/** @font-face descriptors that size the glyphs, copied when the rule is rebuilt from CSSOM. */
const METRIC_DESCRIPTORS = ['size-adjust', 'ascent-override', 'descent-override', 'line-gap-override']

/**
 * #357: every non-generic family in a font-family list, for fallback chain embedding:
 * `"Roboto", "Noto Sans SC", sans-serif` gives ["Roboto", "Noto Sans SC"].
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
 * Normalize weight to 100..900 ("normal" is 400, "bold" is 700).
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

/** A @font-face weight descriptor as a range: `'400 700'` gives `{ min: 400, max: 700 }`,
 *  `'bold'` gives `{ min: 700, max: 700 }`. */
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

/** A @font-face stretch descriptor as a range: `'75% 125%'` gives `{ min: 75, max: 125 }`. */
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
 * A family name as the token CDN paths use: "Nunito Variable" gives "nunito", "Nunito Sans
 * Variable" gives "nunito-sans". Whole-name tokens keep Nunito and Nunito Sans apart (#370).
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
 * Whether a <link> stylesheet is worth fetching for @font-face rules. Same-origin always (read
 * through CSSOM, no fetch); cross-origin only for known font hosts, `fontStylesheetDomains`
 * (#309), URLs naming fonts or a required family, and FONT_LIBRARIES.
 * @param {string} href
 * @param {Iterable<string>} requiredFamilies - plain names, e.g. "unbounded"
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
    // A Google Fonts request names its families, and it holds no face of any other. Fetched
    // anyway, the Mansalva sheet of a page that drew Roboto cost its first capture one network
    // round trip (snapdom.dev/showcase, real Chrome: 114 ms, about 100 of them the fetch).
    // Pinned by __tests__/module.fonts.unusedGoogleFamily.test.js.
    // The same reading of `family` as isIconFontStylesheet (iconFonts.js).
    const asked = host === 'fonts.googleapis.com' ? u.searchParams.getAll('family').flatMap(v => v.split('|')) : []
    if (asked.length) {
      const needed = new Set(requiredFamilies)
      return asked.some(v => needed.has(v.split(':')[0].trim().toLowerCase()))
    }
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
 * Separates family, weight, style and stretch in a required-font key. It was `__`, which a
 * family name can hold (Next.js dev's `__nextjs-Geist`, next/font's `__Inter_abc123`): the
 * split took the wrong parts and the font was never embedded (#542). A family name cannot
 * hold a control character. Pinned by __tests__/snapdom.issue542.test.js.
 */
export const FONT_KEY_SEP = '\x1f'

/**
 * The family name of a required-font key.
 * @param {string} key
 * @returns {string}
 */
export function fontKeyFamily(key) {
  return String(key).split(FONT_KEY_SEP)[0]
}

/**
 * Split the document's webfont families into declared and drawn. A face is fetched only when
 * laid-out text needs it, so an all-"unloaded" family never drew and an "error" face passed its
 * text on. Layout flips a needed face to "loading" synchronously on all three engines, so read
 * this after prepareClone (which also lays out content-visibility subtrees). jant#174: no Noto
 * Serif SC face drew (Safari 27.0.1 left one in error), yet 5 of them (35 KB) were embedded.
 * Pinned by __tests__/module.fonts.drawnFamilies.test.js.
 * @param {Document} doc
 * @returns {{declared: Set<string>, drawn: Set<string>}} lowercase family names
 */
export function documentFontFamilies(doc) {
  const declared = new Set(), drawn = new Set()
  try {
    for (const f of doc.fonts) {
      const family = String(f.family).replace(/["']/g, '').toLowerCase()
      declared.add(family)
      if (f.status === 'loading' || f.status === 'loaded') drawn.add(family)
    }
  } catch { /* no Font Loading API */ }
  return { declared, drawn }
}

// Import inliner and relative URL rewriter, per stylesheet level, with a cycle guard

/** `u` resolved against `base` (the page when absent), or `u` itself when it does not parse. */
function normalizeUrl(u, base) {
  try { return new URL(u, base || location.href).href } catch { return u }
}

/** Rewrites all relative url(...) using the given baseHref. */
function rewriteRelativeUrls(cssText, baseHref) {
  if (!cssText) return cssText
  return cssText.replace(
    /url\(\s*(['"]?)([^)'"]+)\1\s*\)/g,
    (m, q, u) => {
      const src = (u || '').trim()
      if (!src || /^data:|^blob:|^https?:|^file:|^about:/i.test(src)) return m
      return `url("${normalizeUrl(src, baseHref)}")`
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
async function inlineImportsAndRewrite(cssText, ownerHref, useProxy, debug) {
  if (!cssText) return cssText

  const visited = new Set()

  async function resolveOnce(text, baseHref, depth = 0) {
    if (depth > MAX_IMPORT_DEPTH) {
      debugWarn({ debug }, `Too many nested @import rules in ${baseHref}; stopped at ${MAX_IMPORT_DEPTH} levels.`)
      return text
    }

    let out = ''
    let last = 0
    let m
    // Own regex per call: IMPORT_ANY_RE is module-level and /g, and this recurses into each
    // imported sheet, so a shared lastIndex skipped every import after the first nested one.
    const importRe = new RegExp(IMPORT_ANY_RE.source, 'g')
    while ((m = importRe.exec(text))) {
      out += text.slice(last, m.index)
      last = importRe.lastIndex

      const rawUrl = (m[2] || m[4] || '').trim()
      const absUrl = normalizeUrl(rawUrl, baseHref)

      if (visited.has(absUrl)) {
        debugWarn({ debug }, `Skipped an @import that loops back: ${absUrl}`)
        continue
      }
      visited.add(absUrl)

      let imported = ''
      try {
        const r = await snapFetch(absUrl, { as: 'text', useProxy })
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
 * `U+0000-00FF, U+4??` gives `[[0, 255], [0x400, 0x4FF]]`. A `?` wildcard spans its min and max.
 * @param {string} ur
 * @returns {Array<[number, number]>}
 */
function parseUnicodeRange(ur) {
  const ranges = []
  for (const p of (ur || '').split(',')) {
    const m = p.trim().match(/^U\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f?]+))?$/)
    if (!m) continue
    const lo = parseInt(m[1].replace(/\?/g, '0'), 16)
    const hi = parseInt((m[2] || m[1]).replace(/\?/g, 'F'), 16)
    ranges.push([Math.min(lo, hi), Math.max(lo, hi)])
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
    if (!/^https?:/i.test(u)) u = normalizeUrl(u, baseHref)
    urls.push(u)
  }
  return urls
}

/**
 * A font file as a data: URL, from cache.resource or fetched. Null when it cannot be loaded.
 * `cache.resource` is FIFO-capped, so having seen the URL before proves nothing: a miss
 * refetches, because a live url() left in place is inert inside a foreignObject.
 * @param {string} src
 * @param {string} useProxy
 * @param {boolean} debug
 * @returns {Promise<string|null>}
 */
async function fontDataURL(src, useProxy, debug) {
  if (cache.resource?.has(src)) return cache.resource.get(src)
  try {
    const r = await snapFetch(src, { as: 'dataURL', useProxy })
    if (r.ok && typeof r.data === 'string') {
      cache.resource?.set(src, r.data)
      return r.data
    }
  } catch {
    debugWarn({ debug }, 'Couldn\'t load font file:', src)
  }
  return null
}

/**
 * Replace every url() in a @font-face block with its payload as a data: URL; a failed fetch
 * leaves the url() and warns. Do not also test the URL with isIconFont (callers drop icon
 * families by name): its loose `/icon/` matched `fonts.gstatic.com/s/delagothicone/` and
 * "Dela Gothic One" rendered in the fallback font (#508).
 * Pinned by __tests__/module.fonts.evictedResource.test.js.
 * @param {string} cssBlock
 * @param {string} baseHref
 * @param {string} [useProxy='']
 * @returns {Promise<string>}
 */
async function inlineUrlsInCssBlock(cssBlock, baseHref, useProxy = '', debug = false) {
  let out = cssBlock
  for (const m of cssBlock.matchAll(URL_RE)) {
    const raw = extractURL(m[0])
    if (!raw) continue
    const abs = raw.startsWith('http') || raw.startsWith('data:') ? raw : normalizeUrl(raw, baseHref)

    const b64 = await fontDataURL(abs, useProxy, debug)
    if (b64 != null) out = out.replace(m[0], `url(${b64})`)
  }
  return out
}

/** The script a unicode-range covers, for the `excludeFonts.subsets` knob: vietnamese,
 *  cyrillic, greek, latin-ext or latin, most specific first. Null when none applies. */
function subsetFromRanges(ranges) {
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
  const seen = new Set()
  const out = []

  for (const block of cssText.match(FACE_RE) || []) {
    const familyRaw = getFontFaceDeclaration(block, 'font-family')
    const family = pickAllFamilies(familyRaw)[0]
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

  let i = 0
  return cssText.replace(FACE_RE, () => out[i++] || '')
}

// Doc identity for the cache key below: same-origin documents (parent and iframe) can share
// stylesheet hrefs, so each Document instance gets its own id.
const _docIds = new WeakMap()
let _nextDocId = 0
function docCacheId(doc) {
  let id = _docIds.get(doc)
  if (id === undefined) _docIds.set(doc, id = _nextDocId++)
  return id
}

/**
 * The cache.resource key for an embed result. Every input that changes the emitted CSS is in
 * it; one left out served one capture's CSS to another. Pinned by
 * __tests__/module.fonts.iframe.test.js and the digest collision case in
 * __tests__/regression.reviewP1.test.js.
 */
function buildFontsCacheKey(required, exclude, localFonts, useProxy, fontStylesheetDomains, doc, usedCodepoints, iconMatchers, envEpoch) {
  const req = Array.from(required || []).sort().join('|')
  // Faces are subsetted by the used codepoints, so different text needs a different key (a
  // Cyrillic panel got an English one's latin faces). The sum ignores Set order. Keep the
  // xor-shift rounds: `sum(imul(c, K)) === imul(sum(c), K)` gave "ad" and "bc" one key.
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
  // iconFonts decides which families are skipped. Without it, `iconFonts: 'Brand'` and a plain
  // capture of the same subtree shared one entry, and whichever ran first won.
  const ic = (iconMatchers || []).map(rx => String(rx)).sort().join('|')
  return `fonts-embed-css::req=${req}::ex=${ex}::lf=${lf}::px=${px}::fd=${fd}::doc=${dc}::cp=${cp}::n=${n}::ic=${ic}::env=${envEpoch}`
}

/**
 * Build the @font-face CSS a capture needs, every payload inlined as a data: URL. A face is
 * kept when it matches a used variant (faceMatchesRequired) and meets a used codepoint, and a
 * used family never ends with zero faces (#478). Only declared descriptors are emitted (#479),
 * the family always quoted. `_snapdomSrc` is how a host exposes a script-built FontFace's
 * source. Memoized under a key that covers every input, document included (#441).
 * Pinned by __tests__/module.fonts.*.test.js.
 *
 * @typedef {{family:string, weightSpec:string, styleSpec:string, stretchSpec:string, unicodeRange:string, srcRaw:string, srcUrls:string[], href:string}} FontFaceMeta
 *
 * @param {Object} options
 * @param {Set<string>} options.required - family, weight, style, stretchPct keys from collectFontUsage
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
  debug = false,
} = {}) {
  // ---------- Normalize inputs ----------
  if (!(required instanceof Set)) required = new Set()
  if (!(usedCodepoints instanceof Set)) usedCodepoints = new Set()

  // Index of family to [{w,s,st}]. CSS font-family names are case-insensitive, so the
  // index is keyed lowercase and every lookup lowercases too, or a page using `Roboto`
  // against `@font-face { font-family: roboto }` fails to embed.
  const requiredIndex = new Map()
  for (const key of required) {
    const [fam, w, s, st] = String(key).split(FONT_KEY_SEP)
    if (!fam) continue
    const famKey = fam.toLowerCase()
    const arr = requiredIndex.get(famKey) || []
    arr.push({ w: parseInt(w, 10), s, st: parseInt(st, 10) })
    requiredIndex.set(famKey, arr)
  }

  /**
 * Which of the family's requested variants a @font-face serves. `exact`: weight in range, same
 * style kind and stretch. `near`: a single weight within 300, kept only where exact faces leave
 * a used codepoint uncovered. A normal face also takes an italic request the family cannot
 * serve (both lists empty), so the engine synthesizes the slant instead of a system font.
 * @param {string} fam
 * @param {string} styleSpec   font-style from the @font-face, e.g. "normal" or "italic"
 * @param {string} weightSpec  font-weight from the @font-face, e.g. "400" or "400 700"
 * @param {string} stretchSpec font-stretch from the @font-face, e.g. "100%"
 * @returns {{exact: object[], near: object[]}|null} requests from `requiredIndex`, or null
 */
function faceMatchesRequired(fam, styleSpec, weightSpec, stretchSpec) {
  const famKey = String(fam).toLowerCase()
  if (!requiredIndex.has(famKey)) return null

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

  // 1) Exact match
  const exact = need.filter((r) => {
    const wOk = faceIsRange ? (r.w >= ws.min && r.w <= ws.max) : (r.w === faceSingleW)
    return wOk && styleOK(normStyle(r.s)) && r.st >= ts.min && r.st <= ts.max
  })
  if (exact.length) return { exact, near: [] }

  // 2) Near weight, same style and stretch
  if (!faceIsRange) {
    const near = need.filter((r) => Math.abs(faceSingleW - r.w) <= 300 && styleOK(normStyle(r.s)) && r.st >= ts.min && r.st <= ts.max)
    if (near.length) return { exact, near }
  }

  // 3) A normal face for an italic or oblique request. No italic check needed: tier 2 already
  //    took every normal request this close.
  if (!faceIsRange && ss.kind === 'normal' &&
      need.some((r) => Math.abs(faceSingleW - r.w) <= 300 && r.st >= ts.min && r.st <= ts.max)) {
    return { exact, near: [] }
  }

  return null
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
  const importUrls = []

  for (const styleTag of doc.querySelectorAll('style')) {
    const cssText = styleTag.textContent || ''
    for (const m of cssText.matchAll(IMPORT_ANY_RE)) {
      const u = (m[2] || m[4] || '').trim()
      if (!u || isIconFontStylesheet(u, iconMatchers)) continue
      const hasLink = !!doc.querySelector(`link[rel="stylesheet"][href="${u}"]`)
      if (!hasLink) importUrls.push(u)
    }
  }
  // An @import font URL with no <link> gets a temporary one, removed below. Keep the 3s
  // deadline (snapFetch's budget): a hanging <link> fires neither load nor error and cannot be
  // aborted, so snapdom() never settled and the <link> stayed in <head>. A missing font costs
  // one fallback glyph run; waiting costs the whole capture.
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

  // #478: a required family never ends the scan with zero faces. `coveredFamilies` holds the
  // families a strict match satisfied; `provisionalFaces` the faces it rejected, un-inlined,
  // so the fallback below costs nothing unless it is needed.
  const coveredFamilies = new Set()
  const provisionalFaces = []
  // Tier-2 faces wait for the scan to end, when `exactCover` knows which used codepoints the
  // exact faces of each request hold. Coverage is read from an explicit unicode-range only:
  // a subsetter derives it from the file, while a face with no range claims every codepoint
  // whether or not the file has the glyph.
  const nearFaces = []
  const exactCover = new Map()
  const inRanges = (cp, ranges) => ranges.some(([a, b]) => cp >= a && cp <= b)
  const coverExact = (exact, ranges) => {
    if (!ranges.length) return
    for (const r of exact) {
      const cover = exactCover.get(r) || new Set()
      for (const cp of usedCodepoints) if (inRanges(cp, ranges)) cover.add(cp)
      exactCover.set(r, cover)
    }
  }

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
        if (!isLikelyFontStylesheet(link.href, requiredIndex.keys(), allowedDomains)) continue
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
        const res = await snapFetch(link.href, { as: 'text', useProxy, debug })
        if (res?.ok && typeof res.data === 'string') cssText = res.data
      }

      // Flatten nested @import and rewrite relative urls per-level using link.href as base
      cssText = await inlineImportsAndRewrite(cssText, link.href, useProxy, debug)

      let facesOut = ''
      for (const face of cssText.match(FACE_RE) || []) {
        const famRaw = getFontFaceDeclaration(face, 'font-family')
        const family = pickAllFamilies(famRaw)[0]
        if (!family || isIconFont(family, iconMatchers)) continue

        const weightSpec = getFontFaceDeclaration(face, 'font-weight', '400')
        const styleSpec = getFontFaceDeclaration(face, 'font-style', 'normal')
        const stretchSpec = getFontFaceDeclaration(face, 'font-stretch', '100%')
        const urange = getFontFaceDeclaration(face, 'unicode-range')
        const srcRaw = getFontFaceDeclaration(face, 'src')
        const srcUrls = extractSrcUrls(srcRaw, link.href)

        const match = faceMatchesRequired(family, styleSpec, weightSpec, stretchSpec)
        if (!match && !requiredIndex.has(family.toLowerCase())) continue
        const ranges = parseUnicodeRange(urange)
        if (!unicodeIntersects(usedCodepoints, ranges)) continue

        const meta = { family, weightSpec, styleSpec, stretchSpec, unicodeRange: urange, srcRaw, srcUrls, href: link.href }
        if (exclude && simpleExcluder(meta, ranges)) continue

        // Far from the request, but this family is used: hold it in case nothing closer
        // shows up (#478). Held raw, so a family that IS covered costs no extra fetch.
        const held = { family: family.toLowerCase(), block: face, srcRaw, baseHref: link.href }
        if (!match) { provisionalFaces.push(held); continue }
        if (match.near.length) { nearFaces.push({ ...held, near: match.near, ranges }); continue }
        coverExact(match.exact, ranges)
        coveredFamilies.add(family.toLowerCase())

        const newFace = /url\(/i.test(srcRaw)
          ? await inlineUrlsInCssBlock(face, link.href, useProxy, debug)
          : face
        facesOut += newFace
      }

      if (facesOut.trim()) finalCSS += facesOut
    } catch {
      debugWarn({ debug }, 'Couldn\'t read stylesheet:', link.href)
    }
  }

  // ---------- 2) CSSOM (inline/imported) ----------
  const visitedSheets = new Set()
  /**
   * Collect the wanted @font-face rules from one CSSStyleSheet through CSSOM, descending into
   * its @import rules with each subsheet's own href as base. Cycles and depth past
   * MAX_IMPORT_DEPTH are skipped. A sheet whose cssRules throw (cross-origin) is left to the
   * <link> pass, which fetches it as text.
   * @param {CSSStyleSheet|CSSGroupingRule} sheet
   * @param {string} baseHref
   * @param {number} [depth=0] - @import nesting
   */
  async function collectFacesFromSheet(sheet, baseHref, depth = 0) {
    const view = doc?.defaultView || window
    // Conditions are evaluated in the live document, before the face is emitted without
    // its grouping wrapper into the SVG. Inactive faces must not win its font matching.
    if (sheet.disabled || (sheet.media?.mediaText && !view.matchMedia(sheet.media.mediaText).matches)) return
    let rules
    try {
      rules = sheet.cssRules || []
    } catch {
      // CSSOM blocked (CORS): the <link> pass fetches and inlines it
      return
    }

    for (const rule of rules) {
      if (rule.type === CSSRule.IMPORT_RULE && rule.styleSheet) {
        const childHref = rule.href ? normalizeUrl(rule.href, baseHref) : baseHref

        if (depth >= MAX_IMPORT_DEPTH) {
          debugWarn({ debug }, `Too many nested @import rules in ${childHref}; stopped at ${MAX_IMPORT_DEPTH} levels.`)
          continue
        }
        if (childHref && visitedSheets.has(childHref)) {
          debugWarn({ debug }, `Skipped an @import that loops back: ${childHref}`)
          continue
        }
        if (childHref) visitedSheets.add(childHref)

        await collectFacesFromSheet(rule.styleSheet, childHref, depth + 1)
        continue
      }

      if (rule.cssRules?.length) {
        if (rule.type === CSSRule.MEDIA_RULE && !view.matchMedia(rule.conditionText).matches) continue
        if (rule.type === CSSRule.SUPPORTS_RULE && !view.CSS.supports(rule.conditionText)) continue
        await collectFacesFromSheet(rule, baseHref, depth)
        continue
      }

      if (rule.type === CSSRule.FONT_FACE_RULE) {
        const famRaw = (rule.style.getPropertyValue('font-family') || '').trim()
        const family = pickAllFamilies(famRaw)[0]
        if (!family || isIconFont(family, iconMatchers)) continue

        // An ABSENT descriptor is not an explicit default on a variable font: with no
        // font-weight the wght axis stays free, while `font-weight:400` pins it (same for
        // wdth/slnt via font-stretch and font-style). Emitting the defaults flattened every axis
        // (#479), so they serve matching only and the rule carries what the source declared.
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
          (urange ? `unicode-range:${urange};` : '') +
          // The metric descriptors: without `size-adjust: 200%` the text came out at half its width.
          METRIC_DESCRIPTORS.map((d) => { const v = rule.style.getPropertyValue(d); return v ? `${d}:${v};` : '' }).join('')

        const match = faceMatchesRequired(family, styleSpec, weightSpec, stretchSpec)
        if (!match && !requiredIndex.has(family.toLowerCase())) continue
        const ranges = parseUnicodeRange(urange)
        if (!unicodeIntersects(usedCodepoints, ranges)) continue

        const meta = {
          family, weightSpec, styleSpec, stretchSpec,
          unicodeRange: urange,
          srcRaw,
          srcUrls: extractSrcUrls(srcRaw, baseHref || location.href),
          href: baseHref || location.href
        }
        if (exclude && simpleExcluder(meta, ranges)) continue

        // Always quote: an unquoted family is CSS identifiers, which cannot start with a digit,
        // so "Press Start 2P", "Baloo 2" and "M PLUS 1p" made an invalid @font-face that the
        // parser dropped whole.
        const familyDecl = `"${String(family).replace(/^\s*["']|["']\s*$/g, '').replace(/(["\\])/g, '\\$1')}"`

        // See the <link> pass: held raw until the family is known to have nothing (#478).
        if (!match) {
          provisionalFaces.push({
            family: family.toLowerCase(),
            block: `@font-face{font-family:${familyDecl};src:${srcRaw};${descriptors}}`,
            srcRaw,
            baseHref: baseHref || location.href,
          })
          continue
        }
        if (match.near.length) {
          nearFaces.push({
            family: family.toLowerCase(),
            block: `@font-face{font-family:${familyDecl};src:${srcRaw};${descriptors}}`,
            srcRaw,
            baseHref: baseHref || location.href,
            near: match.near,
            ranges,
          })
          continue
        }
        coverExact(match.exact, ranges)
        coveredFamilies.add(family.toLowerCase())
        if (/url\(/i.test(srcRaw)) {
          const inlinedSrc = await inlineUrlsInCssBlock(srcRaw, baseHref || location.href, useProxy, debug)
          finalCSS += `@font-face{font-family:${familyDecl};src:${inlinedSrc};${descriptors}}`
        } else {
          finalCSS += `@font-face{font-family:${familyDecl};src:${srcRaw};${descriptors}}`
        }
      }
    }
  }

  // Constructed/adopted sheets do not appear in document.styleSheets, but their faces
  // participate in the same font matching as ordinary sheets.
  const sheets = new Set([...doc.styleSheets, ...(doc.adoptedStyleSheets || [])])
  for (const sheet of sheets) {
    if (sheet.href && linkNodes.some(l => l.href === sheet.href)) continue
    try {
      const rootHref = sheet.href || doc.baseURI || (location.origin + '/')
      if (rootHref) visitedSheets.add(rootHref)
      await collectFacesFromSheet(sheet, rootHref)
    } catch {
      // cross-origin protected CSSOM; ignore (text pass already tried)
    }
  }

  // ---------- 2a) Near-weight faces, where an exact face leaves a gap ----------
  // WebKit draws a codepoint the exact faces miss with the family's other weights (Chromium
  // and Firefox go to the next family), so a near face over one paints and stays. Over covered
  // codepoints it never paints: in the jant#174 scene those 700 faces were 48 KB of 83 KB.
  for (const n of nearFaces) {
    const paints = n.near.some((r) => {
      const cover = exactCover.get(r)
      if (!cover || !usedCodepoints.size) return true
      for (const cp of usedCodepoints) if (!cover.has(cp) && (!n.ranges.length || inRanges(cp, n.ranges))) return true
      return false
    })
    if (!paints) continue
    coveredFamilies.add(n.family)
    finalCSS += /url\(/i.test(n.srcRaw)
      ? await inlineUrlsInCssBlock(n.block, n.baseHref, useProxy, debug)
      : n.block
  }

  // ---------- 2b) Families the strict filter left empty (#478) ----------
  // Every face of this used family was judged too far from the request. CSS still renders it
  // (closest face, weight and stretch synthesized), so dropping it fell back to a system font.
  for (const p of provisionalFaces) {
    if (coveredFamilies.has(p.family)) continue
    finalCSS += /url\(/i.test(p.srcRaw)
      ? await inlineUrlsInCssBlock(p.block, p.baseHref, useProxy, debug)
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

      const b64 = String(f._snapdomSrc).startsWith('data:') ? f._snapdomSrc : await fontDataURL(f._snapdomSrc, useProxy, debug)
      if (b64 == null) continue
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

    const b64 = src.startsWith('data:') ? src : await fontDataURL(src, useProxy, debug)
    if (b64 == null) continue
    finalCSS += `@font-face{font-family:'${family}';src:url(${b64});font-style:${style};font-weight:${weight};font-stretch:${stretch};}`
  }

  // ---------- Cache + return ----------
  if (finalCSS) {
    finalCSS = dedupeFontFaces(finalCSS)
    cache.resource?.set(cacheKey, finalCSS)
  }
  return finalCSS
}

// Collectors for required variants and used codepoints

/**
 * Collect the font variants and codepoints a subtree uses in one walk on the memoized getStyle
 * cache. Every family in a fallback chain counts (#357), and so does pseudo content. The Safari
 * pre-step (snapdom.js) runs it and hands the result on, so a non-clip capture pays once.
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
  // The four strings fully decide the keys, and a page has a handful of distinct tuples.
  const seen = new Set()
  const addFromStyle = (cs) => {
    const ff = cs.fontFamily, fw = cs.fontWeight, fs = cs.fontStyle, fst = cs.fontStretch
    const sig = ff + FONT_KEY_SEP + fw + FONT_KEY_SEP + fs + FONT_KEY_SEP + fst
    if (seen.has(sig)) return
    seen.add(sig)
    // #357: every family in the chain, so a glyph the first one lacks has its fallback embedded.
    const families = pickAllFamilies(ff)
    if (!families.length) return
    const tail = FONT_KEY_SEP + normWeight(fw) + FONT_KEY_SEP + normStyle(fs) + FONT_KEY_SEP + normStretchPct(fst)
    for (const family of families) required.add(family + tail)
  }
  // Same selector gate as inlinePseudoElements: skip the two pseudo style resolutions
  // for nodes no collected ::before/::after selector matches (null gate: probe).
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
        for (const m of c.match(/\\[0-9A-Fa-f]{1,6}/g) || []) usedCodepoints.add(parseInt(m.slice(1), 16))
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
 * Wait for the document's fonts, then lay out a hidden span per used variant holding the used
 * codepoints, so the embedded faces are fetched before the clone reads them. Safari-only in
 * practice (callers gate on isSafari()); under `embedFonts: 'auto'` system families are left
 * out, since waiting on them cost WebKit about 30 ms a capture. Per-variant spans took jant#174
 * from 14 to 11 font downloads; the layout costs WebKit 12 ms for 3000 CJK codepoints.
 * Pinned by __tests__/module.fonts.more.test.js.
 * @param {Set<string>} required - keys from collectFontUsage: family, weight, style, stretchPct
 * @param {Set<number>} usedCodepoints
 * @param {Document} [doc=document] - the element's ownerDocument, for iframe content
 * @returns {Promise<void>}
 */
export async function ensureFontsReady(required, usedCodepoints, doc = document) {
  try { await fontsSettled(doc) } catch {}
  if (!required.size) return

  // A CSS escape can name a codepoint past U+10FFFF, which fromCodePoint throws on.
  const text = Array.from(usedCodepoints, (cp) => cp <= 0x10ffff ? String.fromCodePoint(cp) : '').join('')
  const container = doc.createElement('div')
  markInternalNode(container)
  container.style.cssText = 'position:absolute!important;left:-9999px!important;top:0!important;opacity:0!important;pointer-events:none!important;contain:layout size style;'
  for (const key of required) {
    const [family, weight, style, stretch] = key.split(FONT_KEY_SEP)
    const span = doc.createElement('span')
    span.textContent = text
    span.style.fontFamily = `"${family}"`
    span.style.fontWeight = weight
    span.style.fontStyle = style
    span.style.fontStretch = `${stretch}%`
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
  await nextFrame()
  await nextFrame()
}
