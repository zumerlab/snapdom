/**
 * Which font FILES stand behind the capture's text, and the bytes of each.
 *
 * The path from a CSS `font-family` stack to an embeddable binary has four
 * hops, and every one can fail in its own way:
 *
 *   stack → family     the first non-generic name with a readable @font-face
 *   family → rule      CSS matching: style first, nearest weight, then the
 *                      unicode-range subset that covers what this style paints
 *   rule → bytes       a data: URI inlined by snapdom, or the src URL fetched
 *                      force-cache (the page already downloaded it to paint)
 *   bytes → sfnt       WOFF unpacks and WOFF2 is rebuilt; collections and
 *                      license-restricted faces refuse, each with its reason
 *
 * Whatever survives becomes ONE parsed face per underlying file, shared by
 * every style that matched it. Whatever does not is a named diagnostic, never
 * a silent substitution: a system font has no bytes a page can hand over, and
 * saying so is the difference between "not embeddable" and "forgot".
 *
 * Coverage is settled LATER, per run: a face travels bound to a style even
 * when its cmap lacks some character that style paints, because the emitter
 * checks every run against the real cmap and falls back run-by-run. Refusing
 * the whole binding for one missing glyph (what the SVG channel does for its
 * textLength contract) would throw away a page of embeddable Latin over one
 * stray dingbat.
 *
 * A face that embeds is not always the face the page PAINTED. A variable font
 * is one file holding a range of designs, and a PDF draws only the one it was
 * saved in; a bold or an italic the page never loaded is the regular file,
 * fattened or slanted by the engine. `substitution` says so per style, and the
 * export keeps such text in the page image instead of painting the wrong glyphs.
 *
 * The sibling vector product solves the same problem the same way — same rule
 * reading, same matching order — so the two channels embed the same file for
 * the same page or disagree loudly, never quietly.
 */

import { sfntFromBytes, parseFont } from '../writer/font.js'

/** Families that name a CATEGORY, not a file. Nothing behind them to embed. */
const GENERIC = new Set([
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'math',
  'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'fangsong',
  '-apple-system', 'blinkmacsystemfont',
])

const unquote = (s) => String(s || '').trim().replace(/^["']|["']$/g, '').trim()

/** Split at top-level `sep`, parens and quotes respected. */
function splitTop(s, sep) {
  const out = []
  let depth = 0
  let quote = null
  let at = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === sep && depth === 0) {
      out.push(s.slice(at, i))
      at = i + 1
    }
  }
  out.push(s.slice(at))
  return out
}

/** `font-weight` descriptor → [lo, hi]. A single value pins both ends. */
function weightRange(value) {
  const words = String(value || '').trim().toLowerCase()
    .replace(/\bnormal\b/g, '400').replace(/\bbold\b/g, '700').split(/\s+/)
  const lo = parseFloat(words[0])
  const hi = parseFloat(words[1])
  if (!Number.isFinite(lo)) return [400, 400]
  return [lo, Number.isFinite(hi) ? hi : lo]
}

/** `unicode-range` → [[lo,hi],…], or null for "everything". */
function parseUnicodeRange(value) {
  const src = String(value || '').trim()
  if (!src) return null
  const out = []
  for (const part of src.split(',')) {
    const m = /^\s*U\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(part)
    if (!m) continue
    if (m[1].includes('?')) {
      out.push([parseInt(m[1].replace(/\?/g, '0'), 16), parseInt(m[1].replace(/\?/g, 'f'), 16)])
    } else {
      const lo = parseInt(m[1], 16)
      out.push([lo, m[2] ? parseInt(m[2], 16) : lo])
    }
  }
  return out.length ? out : null
}

function dataUriBytes(uri) {
  const comma = uri.indexOf(',')
  if (comma < 0) return null
  const head = uri.slice(0, comma)
  const payload = uri.slice(comma + 1)
  try {
    if (/;base64/i.test(head)) {
      const bin = atob(payload)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    }
    return new TextEncoder().encode(decodeURIComponent(payload))
  } catch {
    return null
  }
}

/** Formats an engine would load; anything else in `format()` never painted. */
const LOADABLE = new Set([
  'woff2', 'woff', 'truetype', 'opentype',
  'woff2-variations', 'woff-variations', 'truetype-variations', 'opentype-variations',
])

/** `src:` in source order — the browser takes the first loadable entry. */
function srcCandidates(src, base) {
  const out = []
  for (const item of splitTop(String(src || ''), ',')) {
    if (/^\s*local\s*\(/i.test(item)) continue
    const u = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/i.exec(item)
    if (!u) continue
    const raw = u[1] || u[2] || u[3] || ''
    if (!raw) continue
    const f = /format\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/i.exec(item)
    const format = (f ? (f[1] || f[2] || f[3] || '') : '').toLowerCase()
    if (format && !LOADABLE.has(format)) continue
    let url = raw
    if (!/^data:/i.test(raw)) {
      try { url = new URL(raw, base).href } catch { continue }
    }
    out.push(url)
  }
  return out
}

/**
 * Every `@font-face` the measurement document can show. Runs while the isolated
 * frame is ALIVE — snapdom serialized the capture's stylesheets into it, fonts
 * usually inlined as data: URIs — because this CSSOM is gone the moment the
 * frame is torn down, and the export that wants the bytes runs later.
 */
export function collectFaceRules(frameDoc) {
  const rules = []
  const base = frameDoc.baseURI
  const walk = (list, sheetBase) => {
    for (const rule of list) {
      if (rule.type === 5) {
        const family = unquote(rule.style.getPropertyValue('font-family'))
        const src = rule.style.getPropertyValue('src')
        if (family && src) {
          rules.push({
            family,
            src,
            weight: rule.style.getPropertyValue('font-weight') || '',
            style: rule.style.getPropertyValue('font-style') || '',
            unicodeRange: rule.style.getPropertyValue('unicode-range') || '',
            base: sheetBase,
          })
        }
        continue
      }
      if (rule.cssRules) {
        try { walk(rule.cssRules, sheetBase) } catch { /* nested cross-origin */ }
      }
    }
  }
  for (const sheet of frameDoc.styleSheets) {
    try { walk(sheet.cssRules, sheet.href || base) } catch { /* cross-origin: nothing to read */ }
  }
  return rules
}

/** Style first, then nearest weight — the browser's own ordering, compressed. */
function matchScore(rule, weight, italic) {
  const [lo, hi] = weightRange(rule.weight)
  const distance = weight < lo ? lo - weight : weight > hi ? weight - hi : 0
  const ruleItalic = /^(italic|oblique)/.test((rule.style || 'normal').trim())
  return (ruleItalic === italic ? 1000 : 0) - distance
}

function coversAll(rule, points) {
  const ranges = parseUnicodeRange(rule.unicodeRange)
  if (!ranges) return true
  for (const cp of points) {
    let hit = false
    for (const [lo, hi] of ranges) {
      if (cp >= lo && cp <= hi) { hit = true; break }
    }
    if (!hit) return false
  }
  return true
}

/**
 * The variation axes of an sfnt (`fvar`): [{tag, min, def, max}], empty for a
 * static font and for a table too short to be read.
 */
export function variationAxes(sfnt) {
  const u16 = (at) => (sfnt[at] << 8) | sfnt[at + 1]
  const u32 = (at) => ((sfnt[at] << 24) | (sfnt[at + 1] << 16) | (sfnt[at + 2] << 8) | sfnt[at + 3]) >>> 0
  const fixed = (at) => (u32(at) | 0) / 65536
  const out = []
  const numTables = u16(4)
  for (let i = 0; i < numTables; i++) {
    const entry = 12 + i * 16
    if (entry + 16 > sfnt.length) return out
    if (u32(entry) !== 0x66766172) continue // 'fvar'
    const table = u32(entry + 8)
    if (table + 16 > sfnt.length) return out
    const axes = table + u16(table + 4)
    const count = u16(table + 8)
    const size = u16(table + 10)
    for (let a = 0; a < count; a++) {
      const axis = axes + a * size
      if (size < 16 || axis + 16 > sfnt.length) return out
      out.push({
        tag: String.fromCharCode(sfnt[axis], sfnt[axis + 1], sfnt[axis + 2], sfnt[axis + 3]),
        min: fixed(axis + 4), def: fixed(axis + 8), max: fixed(axis + 12),
      })
    }
    return out
  }
  return out
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** At and above this weight an engine fattens a face that is lighter than it. */
const BOLD = 600

/**
 * Why the glyphs in the file are NOT the glyphs the page painted for this
 * style, or null when they are.
 *
 * Three things stand between a file and the paint. A variable font is drawn at
 * the instance the style asks for, and the file read as a plain font is only
 * its default instance. A weight the family does not carry is faked by
 * emboldening the nearest face, and an italic it does not carry by slanting the
 * upright one — unless `font-synthesis` forbids it. Everything here is read
 * from the rule that won and the file behind it, never guessed from a name.
 *
 * @param {{weight: string, style: string}} rule  the @font-face that matched
 * @param {{weight: number, italic: boolean, stretch?: number, tuned?: boolean,
 *   fakeBold?: boolean, fakeItalic?: boolean}} fk
 * @param {Array<{tag: string, min: number, def: number, max: number}>} axes
 * @returns {string|null}
 */
export function substitution(rule, fk, axes) {
  const [lo, hi] = weightRange(rule.weight)
  const ruleItalic = /^(italic|oblique)/.test((rule.style || 'normal').trim())
  const axis = (tag) => axes.find(a => a.tag === tag && a.max > a.min) || null

  if (axes.some(a => a.max > a.min) && fk.tuned) {
    return 'the page sets font-variation-settings on a variable font, and a PDF draws only the design the file was saved in'
  }
  const wght = axis('wght')
  if (wght) {
    const drawn = clamp(clamp(fk.weight, lo, hi), wght.min, wght.max)
    if (drawn !== wght.def) {
      return `it is a variable font the page draws at weight ${drawn}, and a PDF draws only the weight the file was saved in (${wght.def})`
    }
  }
  if (fk.weight >= BOLD && hi < BOLD && fk.fakeBold !== false) {
    return 'the page has no bold file for it, so the browser fattens the regular one; the file holds only the regular glyphs'
  }
  if (fk.italic && (axis('slnt') || axis('ital'))) {
    return 'it is a variable font the page slants along an axis, and a PDF draws only the upright design the file was saved in'
  }
  if (fk.italic && !ruleItalic && fk.fakeItalic !== false) {
    return 'the page has no italic file for it, so the browser slants the upright one; the file holds only the upright glyphs'
  }
  const wdth = axis('wdth')
  if (wdth && clamp(fk.stretch ?? 100, wdth.min, wdth.max) !== wdth.def) {
    return 'it is a variable font the page draws at another width, and a PDF draws only the width the file was saved in'
  }
  if (axis('opsz')) {
    return 'it is a variable font with an optical-size axis that follows the font size, and a PDF draws only the size the file was saved in'
  }
  return null
}

async function fetchBytes(url, timeout) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller && timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null
  try {
    const res = await fetch(url, { signal: controller?.signal, cache: 'force-cache' })
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Resolve every font key the layer measured to a parsed, embeddable face — or
 * to `null` and a sentence.
 *
 * @param {Array<{stack: string, weight: number, italic: boolean}>} fontKeys
 * @param {Array<Set<number>>} pointsOfFk  code points each key's runs paint
 * @param {Array<object>} rules  `collectFaceRules` output, captured at measure
 * @param {Map} cache  capture-lifetime: url/data-uri → {parsed, sfnt}|{error}
 * @param {(msg: string) => void} report
 * @returns {Promise<Array<{parsed, sfnt, label}|null> & {approx: Array<string|null>}>}
 *   parallel to fontKeys; entries are SHARED where two keys resolved to one
 *   file. `approx`, parallel too, is null where the file's glyphs are what the
 *   page painted for that key and otherwise the sentence saying why they are
 *   not (`substitution`): such a face still embeds, and still must not be
 *   painted with.
 */
export async function resolveFaces(fontKeys, pointsOfFk, rules, cache, report) {
  const byFamily = new Map()
  for (const rule of rules) {
    const key = rule.family.toLowerCase()
    if (!byFamily.has(key)) byFamily.set(key, [])
    byFamily.get(key).push(rule)
  }

  const faceByUrl = new Map()
  const out = []
  out.approx = []
  const failed = new Map() // one sentence per distinct failure, however many keys hit it

  for (let i = 0; i < fontKeys.length; i++) {
    const fk = fontKeys[i]
    out.push(null)
    out.approx.push(null)
    const points = pointsOfFk[i] || new Set()
    for (const name of splitTop(fk.stack, ',').map(unquote)) {
      if (!name || GENERIC.has(name.toLowerCase())) continue
      const candidates = byFamily.get(name.toLowerCase())
      if (!candidates) continue
      const scored = candidates
        .map((rule, at) => ({ rule, at, score: matchScore(rule, fk.weight, fk.italic) }))
        .sort((a, b) => (b.score - a.score) || (a.at - b.at))
      const best = scored.filter(s => s.score === scored[0].score)
      const winner = (best.find(s => coversAll(s.rule, points)) || best[0]).rule
      const label = `"${winner.family}" ${fk.weight}${fk.italic ? ' italic' : ''}`

      let face = null
      let why = null
      for (const url of srcCandidates(winner.src, winner.base)) {
        if (faceByUrl.has(url)) {
          face = faceByUrl.get(url)
          why = substitution(winner, fk, face.axes)
          break
        }
        let entry = cache.get(url)
        if (!entry) {
          const bytes = /^data:/i.test(url) ? dataUriBytes(url) : await fetchBytes(url, 8000)
          if (!bytes || !bytes.length) {
            entry = { error: 'its bytes could not be read' }
          } else {
            const container = await sfntFromBytes(bytes)
            if (container.error) {
              entry = { error: container.error }
            } else {
              const parsed = parseFont(container.sfnt)
              entry = parsed.error
                ? { error: parsed.error }
                : { parsed, sfnt: container.sfnt, axes: variationAxes(container.sfnt) }
            }
          }
          cache.set(url, entry)
        }
        if (!entry.error) {
          face = { parsed: entry.parsed, sfnt: entry.sfnt, label, axes: entry.axes || [] }
          faceByUrl.set(url, face)
          why = substitution(winner, fk, face.axes)
          break
        }
        failed.set(`${label}: ${entry.error}`, true)
      }
      if (face) {
        out[i] = face
        out.approx[i] = why && `"${winner.family}" ${fk.weight}${fk.italic ? ' italic' : ''}: ${why}`
      }
      break // first non-generic family with rules decides, matching the browser
    }
  }

  for (const sentence of failed.keys()) {
    report(`font ${sentence} — text in that face stays searchable but is not embedded, and the ` +
      'export cannot claim conformance.')
  }
  return out
}
