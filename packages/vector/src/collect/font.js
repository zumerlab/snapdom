/**
 * Font collection: the bytes behind the `@font-face` families this document
 * paints with.
 *
 * `collect/text.js` resolves WHICH face painted each run — `family`, `cssFamily`,
 * `webfont`, verified against the stack's own advances — and stays synchronous on
 * purpose, so it reads a binary only when the rule carries one inline
 * (`nameTableFor`). This module is the asynchronous other half, named as the fix
 * in `declareFonts` since v0: for every text style the resolution marked
 * `webfont`, find the `@font-face` rule the browser matched, fetch its bytes,
 * and put them in `doc.assets` with `style.font` pointing at them. From there
 * machinery that has existed all along takes over: `emit/svg-flat.js` writes the
 * `@font-face` with the data URI (`fontFaceRules`), prepends the family so it
 * wins over the stack, and pins every line with `textLength`
 * (`measuredFontTravels`) — and a standalone SVG stops depending on what the
 * viewer happens to have installed.
 *
 * What this module deliberately does NOT do:
 *
 *  - **Subset.** The whole binary travels and `subset` stays false: a subsetter
 *    is a font compiler, and a wrong one corrupts glyphs silently. The cost is
 *    bytes and it is declared per face (`assets.font-embedded` states the size);
 *    `embedFonts: false` refuses the trade entirely.
 *  - **Compose multi-subset families.** When no single rule covers every code
 *    point a style paints (Google Fonts serves latin / latin-ext / cyrillic as
 *    separate rules of the same family), the style keeps the family NAME and the
 *    gap is declared (`assets.font-uncovered`): embedding one subset would make
 *    `measuredFontTravels` pin lines whose characters the embedded file does not
 *    have, measuring one font and painting another.
 *  - **Serve Figma.** Its SVG importer runs no `@font-face` and no `textLength`
 *    (measured, FIGMA_FINDINGS); the h2d channel owns that destination. These
 *    bytes are for the editors and renderers that read SVG as specified.
 *
 * System and locally-installed faces are out of reach by nature — there is no
 * URL a page can hand over — and stay the emitter's `font-not-embedded` story.
 */

import {
  unquoteFamily, parseUnicodeRange, weightRange, dataUriBytes, parseFontNames,
} from './text.js'

/** Formats Chromium/Firefox/WebKit all load; anything else in `format()` is skipped. */
const LOADABLE_FORMATS = new Set([
  'woff2', 'woff', 'truetype', 'opentype', 'woff2-variations', 'woff-variations',
  'truetype-variations', 'opentype-variations',
])

/** Magic bytes -> the mime `emit/svg-flat.js` FONT_FORMATS maps to a `format()`. */
function sniffFontMime (bytes) {
  if (!bytes || bytes.length < 4) return null
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (tag === 'wOF2') return 'font/woff2'
  if (tag === 'wOFF') return 'font/woff'
  if (tag === 'OTTO') return 'font/otf'
  if (tag === 'true' || tag === 'ttcf') return 'font/ttf'
  if (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) return 'font/ttf'
  return null
}

/** Bytes -> base64, chunked: `String.fromCharCode(...400k)` overflows the stack. */
function base64Of (bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/**
 * Same fetch discipline as `index.js` `fetchBytes` (force-cache: the page already
 * downloaded this face to paint with, so the HTTP cache should answer without a
 * second trip), written here because `index.js` imports this module.
 */
async function fetchFontBytes (url, timeout) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller && timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null
  try {
    const res = await fetch(url, {
      signal: controller ? controller.signal : undefined,
      cache: 'force-cache',
    })
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ——— reading the rules ———

/**
 * One declaration block split at top-level semicolons, parens respected: a data
 * URI is `;base64,` in the middle of `src`, and a split that does not track
 * parentheses hands half a URL to the URL parser.
 */
function declarationsOf (block) {
  const out = []
  let depth = 0
  let at = 0
  for (let i = 0; i < block.length; i++) {
    const c = block[i]
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === ';' && depth === 0) {
      out.push(block.slice(at, i))
      at = i + 1
    }
  }
  out.push(block.slice(at))
  const props = {}
  for (const decl of out) {
    const colon = decl.indexOf(':')
    if (colon < 0) continue
    props[decl.slice(0, colon).trim().toLowerCase()] = decl.slice(colon + 1).trim()
  }
  return props
}

/** The shape both rule sources produce, so everything downstream reads one thing. */
function faceRecord (props, base) {
  const family = unquoteFamily(props['font-family'])
  const src = props.src || ''
  if (!family || !src) return null
  return {
    family,
    src,
    weight: props['font-weight'] || '',
    style: props['font-style'] || '',
    unicodeRange: props['unicode-range'] || '',
    base,
  }
}

/**
 * Every `@font-face` of the document the CSSOM will show us, plus the `href` of
 * each sheet it will not: a cross-origin stylesheet (Google Fonts) throws on
 * `cssRules`, and those sheets are exactly where webfont rules live, so the
 * hrefs come back for `refetchFaces` to read over HTTP instead.
 */
function readFaceRules () {
  const rules = []
  const blocked = []
  const sheets = typeof document !== 'undefined' && document.styleSheets ? document.styleSheets : []
  const base = typeof document !== 'undefined' ? document.baseURI : undefined
  const walk = (list, sheetBase) => {
    for (const rule of list) {
      if (rule.type === 5 || (rule.style && typeof rule.cssText === 'string' && /^@font-face/.test(rule.cssText))) {
        let rec = null
        try {
          rec = faceRecord({
            'font-family': rule.style.getPropertyValue('font-family'),
            src: rule.style.getPropertyValue('src'),
            'font-weight': rule.style.getPropertyValue('font-weight'),
            'font-style': rule.style.getPropertyValue('font-style'),
            'unicode-range': rule.style.getPropertyValue('unicode-range'),
          }, sheetBase)
        } catch { /* a dead rule reads as absent */ }
        if (rec) rules.push(rec)
        continue
      }
      if (rule.cssRules) {
        try { walk(rule.cssRules, sheetBase) } catch { /* nested cross-origin */ }
      }
    }
  }
  for (const sheet of sheets) {
    const sheetBase = sheet.href || base
    try {
      walk(sheet.cssRules, sheetBase)
    } catch {
      if (sheet.href) blocked.push(sheet.href)
    }
  }
  return { rules, blocked }
}

/**
 * The `@font-face` rules of one stylesheet the CSSOM refused, read over HTTP.
 * Fonts are CORS-gated by spec, so a host that serves loadable webfonts serves
 * readable CSS more often than not; a host that refuses both is declared, not
 * guessed around.
 */
async function refetchFaces (href, timeout) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller && timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null
  try {
    const res = await fetch(href, { signal: controller ? controller.signal : undefined, cache: 'force-cache' })
    if (!res.ok) return null
    const css = (await res.text()).replace(/\/\*[\s\S]*?\*\//g, '')
    const out = []
    const re = /@font-face\s*\{([^}]*)\}/gi
    let m
    while ((m = re.exec(css))) {
      const rec = faceRecord(declarationsOf(m[1]), href)
      if (rec) out.push(rec)
    }
    return out
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ——— matching ———

/**
 * `src:` as candidates in SOURCE order — the browser takes the first entry it
 * can load, and mirroring that order is what makes "the bytes we embed" and
 * "the bytes that painted the page" the same file. `local()` entries are
 * skipped (a local face has no bytes a page can hand over), and so is any
 * `format()` no engine loads.
 */
function srcCandidates (src, base) {
  const items = []
  let depth = 0
  let at = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === ',' && depth === 0) {
      items.push(src.slice(at, i))
      at = i + 1
    }
  }
  items.push(src.slice(at))

  const out = []
  for (const item of items) {
    if (/^\s*local\s*\(/i.test(item)) continue
    const u = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/i.exec(item)
    if (!u) continue
    const raw = u[1] || u[2] || u[3] || ''
    if (!raw) continue
    const f = /format\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/i.exec(item)
    const format = (f ? (f[1] || f[2] || f[3] || '') : '').toLowerCase()
    if (format && !LOADABLE_FORMATS.has(format)) continue
    let url = raw
    if (!/^data:/i.test(raw)) {
      try { url = new URL(raw, base).href } catch { continue }
    }
    out.push({ url, format })
  }
  return out
}

/**
 * CSS font matching over rule records: style first, then nearest weight —
 * the ordering `collect/text.js` uses for the same decision (`nameTableFor`,
 * `pickFace`), applied to the same inputs.
 */
function matchScore (rule, weight, italic) {
  const [lo, hi] = weightRange(rule.weight)
  const distance = weight < lo ? lo - weight : weight > hi ? weight - hi : 0
  const ruleItalic = /^(italic|oblique)/.test(rule.style || 'normal')
  return (ruleItalic === italic ? 1000 : 0) - distance
}

/** Does this rule's `unicode-range` cover EVERY code point the style paints? */
function coversAll (rule, points) {
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

// ——— the collector ———

/**
 * Every code point each text style actually paints, read off the runs — the
 * coverage question (`coversAll`) is about painted characters, never about the
 * family's whole repertoire. The hyphen a line took at a hyphenation break is
 * painted from the same style and is not in `characters`, so `line.hyphen`
 * joins the set of every style on its node.
 */
function pointsByStyle (doc, markupTextUses = []) {
  const out = new Map()
  const add = (sid, text) => {
    let set = out.get(sid)
    if (!set) {
      set = new Set()
      out.set(sid, set)
    }
    for (const ch of text) set.add(ch.codePointAt(0))
  }
  for (const id of Object.keys(doc.nodes)) {
    const node = doc.nodes[id]
    if (node.type !== 'text' || !node.text) continue
    const chars = typeof node.text.characters === 'string' ? node.text.characters : ''
    const runs = Array.isArray(node.text.runs) ? node.text.runs : []
    const hyphens = (Array.isArray(node.text.lines) ? node.text.lines : [])
      .map((line) => (line && typeof line.hyphen === 'string' ? line.hyphen : ''))
      .join('')
    for (const run of runs) {
      if (typeof run.style !== 'string') continue
      const from = Number.isInteger(run.start) ? run.start : 0
      const to = Number.isInteger(run.end) ? run.end : chars.length
      add(run.style, chars.slice(from, to) + hyphens)
    }
  }
  for (const use of markupTextUses) add(use.style, use.characters)
  return out
}

/**
 * Fetch and embed the faces, mutating `doc.assets` and `styles.text[*].font`.
 *
 * Runs inside the mount, after the collectors and before `declareFonts` — which
 * then declares only what is STILL not embedded. One face fetched once serves
 * every style that matched it (dedup on resolved URL), and every outcome that
 * is not bytes-in-the-document is a diagnostic, because a capture that quietly
 * skipped a font is exactly the silence this engine exists to break.
 *
 * @param {object} st  the assemble state: `{doc, ctx}` and the report plumbing
 * @param {(st: object, nodeId: string|null, code: string, grade: string,
 *   message: string, severity?: string) => void} report  `index.js`'s own
 */
export async function collectFonts (st, report) {
  const { doc, ctx } = st
  const styles = doc.styles.text
  const styleIds = Object.keys(styles)
  if (!styleIds.length) return
  if (typeof fetch !== 'function' || typeof document === 'undefined') return

  // The requests: one per (family, weight, italic) the webfont styles paint.
  const points = pointsByStyle(doc, st.markupTextUses)
  const groups = new Map()
  for (const sid of styleIds) {
    const style = styles[sid]
    if (style.webfont !== true || style.font) continue
    const family = unquoteFamily(style.cssFamily || style.family)
    if (!family) continue
    const weight = Number.isFinite(Number(style.weight)) ? Number(style.weight) : 400
    const italic = style.italic === true
    const key = `${family.toLowerCase()} ${weight} ${italic}`
    let group = groups.get(key)
    if (!group) {
      group = { family, weight, italic, styleIds: [], points: new Set() }
      groups.set(key, group)
    }
    group.styleIds.push(sid)
    for (const cp of points.get(sid) || []) group.points.add(cp)
  }
  if (!groups.size) return

  const { rules, blocked } = readFaceRules()
  const byFamily = new Map()
  const index = (list) => {
    for (const rule of list) {
      const key = rule.family.toLowerCase()
      if (!byFamily.has(key)) byFamily.set(key, [])
      byFamily.get(key).push(rule)
    }
  }
  index(rules)

  // Refetch a blocked sheet only when a family this capture needs is missing:
  // the common blocked sheet is an analytics stylesheet nobody paints with.
  const missing = [...groups.values()].some((g) => !byFamily.has(g.family.toLowerCase()))
  if (missing && blocked.length) {
    const fetched = await Promise.all(blocked.map((href) => refetchFaces(href, ctx.fetchTimeout)))
    fetched.forEach((list, i) => {
      if (list) index(list)
      else {
        report(st, null, 'assets.font-css-unreadable', 'A',
          `stylesheet ${blocked[i]} is cross-origin, exposes no cssRules, and could not be re-read over ` +
          'HTTP; any @font-face it declares cannot be embedded and its families travel by name.', 'warn')
      }
    })
  }

  const assetByUrl = new Map()

  for (const group of groups.values()) {
    const { family, weight, italic, styleIds: members } = group
    const label = `"${family}" ${weight}${italic ? ' italic' : ''}`
    const candidates = byFamily.get(family.toLowerCase()) || []
    if (!candidates.length) {
      report(st, null, 'assets.font-rule-missing', 'A',
        `${label} is in document.fonts but no readable stylesheet declares its @font-face, so its bytes ` +
        'could not be located and the family travels by name (a rule constructed with `new FontFace()` ' +
        'never appears in a stylesheet at all).', 'warn')
      continue
    }

    // The faces the browser would order first for this request; among equals
    // (unicode-range subsets of one weight) the one that covers everything the
    // style paints. Ties broken by source order, which is also the CSS rule.
    const scored = candidates
      .map((rule, i) => ({ rule, i, score: matchScore(rule, weight, italic) }))
      .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    const best = scored.filter((s) => s.score === scored[0].score)
    const cps = [...group.points]
    const winner = best.find((s) => coversAll(s.rule, cps))
    if (!winner) {
      report(st, null, 'assets.font-uncovered', 'A',
        `${label} is served in ${best.length} unicode-range subsets and none alone covers all ` +
        `${cps.length} distinct code points this capture paints with it. Embedding one subset would let ` +
        'textLength pin lines to a file that lacks some of their characters — measuring one font and ' +
        'painting another — so the family travels by name instead.', 'warn')
      continue
    }
    const rule = winner.rule

    // The bytes, from the first loadable src — the browser's own pick.
    let bytes = null
    let fromUrl = null
    let inline = false
    const sources = srcCandidates(rule.src, rule.base)
    for (const cand of sources) {
      if (/^data:/i.test(cand.url)) {
        bytes = dataUriBytes(cand.url)
        fromUrl = 'an inline data: URI'
        inline = true
      } else if (assetByUrl.has(cand.url)) {
        bytes = null
        fromUrl = cand.url
        inline = false
        break
      } else {
        bytes = await fetchFontBytes(cand.url, ctx.fetchTimeout)
        fromUrl = cand.url
        inline = false
      }
      if (bytes) break
    }

    let assetId = !inline && fromUrl ? assetByUrl.get(fromUrl) : undefined
    if (!assetId) {
      if (!bytes || !bytes.length) {
        report(st, null, 'assets.font-fetch-failed', 'A',
          `${label}: none of the ${sources.length} src candidate(s) of its @font-face could be read ` +
          `(${sources.length ? sources.map((s) => s.url.slice(0, 96)).join(', ') : 'src lists only local() or unloadable formats'}), ` +
          'so the family travels by name and the viewer substitutes on a machine without it.', 'warn')
        continue
      }
      const mime = sniffFontMime(bytes) || 'font/ttf'
      const [lo, hi] = weightRange(rule.weight)
      assetId = ctx.nextId('f')
      const asset = {
        kind: 'font',
        data: `data:${mime};base64,${base64Of(bytes)}`,
        mime,
        cssFamily: rule.family,
        italic: /^(italic|oblique)/.test(rule.style || 'normal'),
        subset: false,
      }
      // A fixed-weight rule pins the descriptor; a variable face covers a range
      // and gets it verbatim, or every style but 400 would synthesise.
      if (lo === hi) asset.weight = lo
      else asset.weightRange = `${lo} ${hi}`
      if (!inline && fromUrl) asset.src = fromUrl
      // The name the binary claims, for `emit/figma-json.js` `fontOf`: the page
      // says "Inter var", the file says Inter / SemiBold, and only the second
      // exists in a font picker. WOFF2 name tables are brotli-compressed and
      // stay unread — the consumer falls back to the stack, as before.
      const names = parseFontNames(bytes)
      if (names && !names.error && (names.family || names.sub)) {
        asset.nameTable = {}
        if (names.family) asset.nameTable['16'] = names.family
        if (names.sub) asset.nameTable['17'] = names.sub
      }
      doc.assets[assetId] = asset
      if (!inline && fromUrl) assetByUrl.set(fromUrl, assetId)
      report(st, null, 'assets.font-embedded', 'E',
        `${label} travels in the document: ${Math.round(bytes.length / 1024)} kB of ${mime} fetched from ` +
        `${fromUrl}, serving ${members.length} text style(s). Every line in those styles now carries ` +
        'textLength pinned to the advances this exact binary measures, and a standalone emit renders them ' +
        'without depending on the viewer\'s installed fonts. The cost is the bytes: the file travels ' +
        'WHOLE (no subsetter here — a wrong one corrupts glyphs silently), and embedFonts:false refuses ' +
        'the trade for captures where size outranks portability.', 'info')
    }

    for (const sid of members) styles[sid].font = assetId
  }
}

export default collectFonts
