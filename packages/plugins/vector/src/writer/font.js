/**
 * Embedded fonts: the WHOLE font program travels, and the text points into it.
 *
 * This module deliberately stops short of a subsetter. Subsetting rewrites
 * glyf/loca/hmtx and renumbers every glyph — a font compiler, and a wrong one
 * corrupts text silently. Embedding the file as it came from the wire needs
 * none of that: the byte stream goes into /FontFile2 (or /FontFile3 for CFF)
 * untouched, glyph ids keep the numbering the font was born with, and
 * `CIDToGIDMap /Identity` is exact BY CONSTRUCTION — the CID written in the
 * content stream IS the glyph id the font's own cmap names for that character.
 * The cost is bytes (a face travels whole, typically 100–350 kB before Flate),
 * and it is the caller's job to say so out loud.
 *
 * What is read out of the binary, and why nothing else:
 *
 *  - `cmap` (formats 4 and 12): character → glyph id, the encoding itself.
 *  - `hmtx`/`hhea`: advances, for /W — a viewer places invisible text and
 *    selection boxes off these, so they must be the REAL ones.
 *  - `head`, `OS/2`, `post`, `maxp`: units-per-em, the descriptor's metrics,
 *    and the embedding-permission bits.
 *  - `name` (id 6): the PostScript name, so /BaseFont tells the truth.
 *
 * No shaping happens here. A CID per codepoint means no ligatures, no kerning,
 * no contextual forms — correct for an invisible layer whose widths are pinned
 * by Tz, and honest for short furniture strings. Scripts whose legibility
 * REQUIRES shaping (Arabic joining) must not be painted through this path; the
 * caller keeps them on the raster.
 *
 * `OS/2.fsType` is licensing, not advice. Restricted-license (bit 1) and
 * bitmap-only (bit 9) faces are refused here, once, rather than quietly
 * embedded into every customer's court exhibit.
 */

import { deflate, canDeflate } from './index.js'
import { subsetTrueType } from './subset.js'

const U16 = (b, at) => (b[at] << 8) | b[at + 1]
const I16 = (b, at) => { const v = U16(b, at); return v & 0x8000 ? v - 0x10000 : v }
const U32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
const TAG = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])

/** zlib inflate (WOFF table compression) via the engine's own DecompressionStream. */
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Whatever arrived → a plain sfnt, or a refusal that names its reason.
 *
 * WOFF1 is a zip of the same tables and is rebuilt losslessly. WOFF2 is a
 * different font (glyf transformed, brotli-compressed) and reconstructing it IS
 * subsetter-grade surgery, so it is declined. A TrueType collection shares
 * tables between faces behind absolute offsets; embedding the whole file would
 * make every viewer guess which face was meant, so it is declined too.
 *
 * @returns {Promise<{sfnt: Uint8Array}|{error: string}>}
 */
export async function sfntFromBytes(bytes) {
  if (!bytes || bytes.length < 12) return { error: 'not a font: shorter than an sfnt header' }
  const tag = TAG(bytes, 0)
  if (tag === 'wOF2') return { error: 'WOFF2 stores transformed tables behind Brotli; rebuilding the original font is a decompiler this exporter refuses to half-do' }
  if (tag === 'ttcf') return { error: 'a TrueType collection shares tables between several faces; embedding it whole would leave the face choice to the viewer' }
  if (tag === 'wOFF') {
    if (typeof DecompressionStream !== 'function') {
      return { error: 'WOFF needs DecompressionStream to unpack and this runtime has none' }
    }
    const flavor = U32(bytes, 4)
    const numTables = U16(bytes, 12)
    if (!numTables || numTables > 512) return { error: 'WOFF header declares an implausible table count' }
    const entries = []
    for (let i = 0; i < numTables; i++) {
      const at = 44 + i * 20
      if (at + 20 > bytes.length) return { error: 'WOFF table directory runs past the file' }
      entries.push({
        tag: U32(bytes, at), offset: U32(bytes, at + 4),
        compLength: U32(bytes, at + 8), origLength: U32(bytes, at + 12),
        checksum: U32(bytes, at + 16),
      })
    }
    const tables = []
    for (const e of entries) {
      if (e.offset + e.compLength > bytes.length) return { error: 'WOFF table data runs past the file' }
      const raw = bytes.subarray(e.offset, e.offset + e.compLength)
      let data
      if (e.compLength < e.origLength) {
        try { data = await inflate(raw) } catch { return { error: 'a WOFF table failed to inflate' } }
        if (data.length !== e.origLength) return { error: 'a WOFF table inflated to the wrong size' }
      } else {
        data = raw
      }
      tables.push({ tag: e.tag, checksum: e.checksum, data })
    }
    // sfnt directory: offsets 4-byte aligned, search fields per the spec's formula.
    let entropy = 0
    while ((1 << (entropy + 1)) <= numTables) entropy++
    const searchRange = (1 << entropy) * 16
    let offset = 12 + numTables * 16
    const head = new Uint8Array(offset)
    const w16 = (b, at, v) => { b[at] = (v >> 8) & 0xff; b[at + 1] = v & 0xff }
    const w32 = (b, at, v) => { b[at] = (v >>> 24) & 0xff; b[at + 1] = (v >>> 16) & 0xff; b[at + 2] = (v >>> 8) & 0xff; b[at + 3] = v & 0xff }
    w32(head, 0, flavor)
    w16(head, 4, numTables)
    w16(head, 6, searchRange)
    w16(head, 8, entropy)
    w16(head, 10, numTables * 16 - searchRange)
    const chunks = [head]
    tables.forEach((t, i) => {
      const pad = (4 - (t.data.length % 4)) % 4
      const at = 12 + i * 16
      w32(head, at, t.tag)
      w32(head, at + 4, t.checksum)
      w32(head, at + 8, offset)
      w32(head, at + 12, t.data.length)
      chunks.push(t.data)
      if (pad) chunks.push(new Uint8Array(pad))
      offset += t.data.length + pad
    })
    const sfnt = new Uint8Array(offset)
    let at = 0
    for (const c of chunks) { sfnt.set(c, at); at += c.length }
    return { sfnt }
  }
  const version = U32(bytes, 0)
  if (version === 0x00010000 || tag === 'true' || tag === 'OTTO') return { sfnt: bytes }
  return { error: 'unrecognised font container (not sfnt, WOFF or OTTO)' }
}

/** The best cmap subtable: format 12 sees astral planes, format 4 the BMP. */
function readCmap(b, at, length) {
  const numTables = U16(b, at + 2)
  let best = null
  for (let i = 0; i < numTables; i++) {
    const rec = at + 4 + i * 8
    const platform = U16(b, rec)
    const encoding = U16(b, rec + 2)
    const offset = at + U32(b, rec + 4)
    if (offset + 4 > b.length) continue
    const format = U16(b, offset)
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
    if (!unicode) continue
    const score = format === 12 ? 2 : format === 4 ? 1 : 0
    if (!score) continue
    if (!best || score > best.score) best = { format, offset, score }
  }
  if (!best) return null
  const map = new Map()
  const CAP = 200000 // a defensive ceiling, far above any real repertoire
  if (best.format === 12) {
    // The declared group count is a raw uint32 from bytes an attacker can
    // serve (@font-face fetches). Trusting it spins for minutes on a header
    // that declares billions of groups and maps nothing — the CAP guards
    // map.size, not iterations — so the loop is bounded by the bytes that
    // actually exist: 16 header bytes, 12 per group, inside table and file.
    const declared = U32(b, best.offset + 12)
    const room = Math.min(at + length, b.length) - best.offset - 16
    const nGroups = Math.min(declared, Math.max(0, Math.floor(room / 12)))
    for (let g = 0; g < nGroups && map.size < CAP; g++) {
      const at12 = best.offset + 16 + g * 12
      const start = U32(b, at12)
      const end = U32(b, at12 + 4)
      const gid = U32(b, at12 + 8)
      for (let cp = start; cp <= end && map.size < CAP; cp++) {
        const mapped = gid + (cp - start)
        // Identity-H writes CIDs two bytes wide; a glyph id past 0xFFFF is
        // unreachable there and would corrupt the hex string if written.
        if (mapped !== 0 && mapped <= 0xffff) map.set(cp, mapped)
      }
    }
  } else {
    const segX2 = U16(b, best.offset + 6)
    const ends = best.offset + 14
    const starts = ends + segX2 + 2
    const deltas = starts + segX2
    const rangeOffsets = deltas + segX2
    for (let s = 0; s < segX2; s += 2) {
      const end = U16(b, ends + s)
      const start = U16(b, starts + s)
      const delta = U16(b, deltas + s)
      const ro = U16(b, rangeOffsets + s)
      if (start === 0xffff) continue
      for (let cp = start; cp <= end && map.size < CAP; cp++) {
        let gid
        if (ro === 0) {
          gid = (cp + delta) & 0xffff
        } else {
          const gat = rangeOffsets + s + ro + (cp - start) * 2
          if (gat + 2 > b.length) continue
          gid = U16(b, gat)
          if (gid !== 0) gid = (gid + delta) & 0xffff
        }
        if (gid !== 0) map.set(cp, gid)
      }
    }
  }
  return map.size ? map : null
}

/** name table, id 6: the PostScript name, decoded from either UTF-16BE or MacRoman-ish. */
function readPsName(b, at) {
  const count = U16(b, at + 2)
  const strings = at + U16(b, at + 4)
  for (let i = 0; i < count; i++) {
    const rec = at + 6 + i * 12
    if (U16(b, rec + 6) !== 6) continue
    const platform = U16(b, rec)
    const len = U16(b, rec + 8)
    const off = strings + U16(b, rec + 10)
    if (off + len > b.length) continue
    let out = ''
    if (platform === 3 || platform === 0) {
      for (let j = 0; j + 1 < len; j += 2) out += String.fromCharCode(U16(b, off + j))
    } else {
      for (let j = 0; j < len; j++) out += String.fromCharCode(b[off + j])
    }
    // A PDF name object survives only printable ASCII minus the delimiters.
    out = out.replace(/[^!-~]|[()<>[\]{}/%#]/g, '')
    if (out) return out.slice(0, 63)
  }
  return null
}

/**
 * The facts the writer needs, read off one sfnt. Returns `{error}` when the
 * binary refuses them — malformed, or licensed against embedding.
 */
export function parseFont(sfnt) {
  const b = sfnt
  const numTables = U16(b, 4)
  if (!numTables || 12 + numTables * 16 > b.length) return { error: 'sfnt table directory is malformed' }
  const tables = new Map()
  for (let i = 0; i < numTables; i++) {
    const at = 12 + i * 16
    const offset = U32(b, at + 8)
    const length = U32(b, at + 12)
    if (offset + length > b.length) return { error: `table ${TAG(b, at)} runs past the file` }
    tables.set(TAG(b, at), { offset, length })
  }
  const need = (tag) => tables.get(tag) || null
  const head = need('head')
  const hhea = need('hhea')
  const hmtx = need('hmtx')
  const maxp = need('maxp')
  const cmapT = need('cmap')
  if (!head || !hhea || !hmtx || !maxp || !cmapT) {
    return { error: 'missing one of head/hhea/hmtx/maxp/cmap' }
  }
  const cff = TAG(b, 0) === 'OTTO'
  if (!cff && !tables.has('glyf')) return { error: 'TrueType flavor without a glyf table' }

  const os2 = need('OS/2')
  if (os2) {
    const fsType = U16(b, os2.offset + 8)
    if (fsType & 0x0002) return { error: 'OS/2 fsType forbids embedding (restricted license)' }
    if (fsType & 0x0200) return { error: 'OS/2 fsType allows bitmap embedding only' }
  }

  const upm = U16(b, head.offset + 18) || 1000
  const numGlyphs = U16(b, maxp.offset + 4)
  const numH = U16(b, hhea.offset + 34)
  if (!numGlyphs || !numH || numH > numGlyphs) return { error: 'hhea/maxp glyph counts disagree' }
  if (hmtx.length < numH * 4) return { error: 'hmtx is shorter than hhea promises' }
  const advances = new Uint16Array(numH)
  for (let i = 0; i < numH; i++) advances[i] = U16(b, hmtx.offset + i * 4)

  const cmap = readCmap(b, cmapT.offset, cmapT.length)
  if (!cmap) return { error: 'no readable Unicode cmap (formats 4/12)' }

  const scale = 1000 / upm
  const os2v = os2 ? U16(b, os2.offset) : 0
  const typoAsc = os2 ? I16(b, os2.offset + 68) : 0
  const typoDesc = os2 ? I16(b, os2.offset + 70) : 0
  const post = need('post')
  return {
    cff,
    numGlyphs,
    upm,
    cmap,
    psName: tables.has('name') ? readPsName(b, need('name').offset) : null,
    weightClass: os2 ? U16(b, os2.offset + 4) : 400,
    fixedPitch: post ? U32(b, post.offset + 12) !== 0 : false,
    italicAngle: post ? I16(b, post.offset + 4) : 0, // integer degrees of the Fixed suffice
    ascent: Math.round((typoAsc || I16(b, hhea.offset + 4)) * scale),
    descent: Math.round((typoDesc || I16(b, hhea.offset + 6)) * scale),
    capHeight: os2 && os2v >= 2 && os2.length >= 90
      ? Math.round(I16(b, os2.offset + 88) * scale)
      : Math.round((typoAsc || I16(b, hhea.offset + 4)) * scale * 0.9),
    bbox: [
      Math.round(I16(b, head.offset + 36) * scale), Math.round(I16(b, head.offset + 38) * scale),
      Math.round(I16(b, head.offset + 40) * scale), Math.round(I16(b, head.offset + 42) * scale),
    ],
    /** Advance of one glyph in 1/1000 em — the /W unit. */
    advanceOf(gid) {
      return Math.round((gid < numH ? advances[gid] : advances[numH - 1]) * scale)
    },
  }
}

/**
 * One embedded face in one document. Same lazy contract as `createUnicodeFont`:
 * nothing is added to the document until the first `encode`, so a face that was
 * fetched but never used costs no objects and no bytes.
 *
 * `encode` answers null when ANY character of the text has no glyph — the
 * caller falls back to its unembedded path for the whole run, so a selection
 * box never spans two fonts' disagreeing metrics.
 *
 * `finalize` is async (the font stream deflates) and must be awaited after the
 * last encode and before `doc.build`.
 */
export function createEmbeddedFont(doc, parsed, sfnt, tag, { subset = true } = {}) {
  // TrueType glyphs are RENUMBERED into a dense space as they are encoded, so the
  // subset can carry only what the document used and the CID is already the
  // subset's own glyph id. CFF is embedded whole and keeps its native ids, so its
  // CID stays the original glyph id.
  const renumber = !parsed.cff
  const cidByOrig = new Map([[0, 0]]) // .notdef is always CID 0
  const origByCid = new Map([[0, 0]])
  const cpByCid = new Map()           // CID → first codepoint that reached it (ToUnicode)
  const codeToOrig = new Map()        // codepoint → original gid (cmap rebuild)
  let nextCid = 1
  let id = null
  let cidId, descId, fileId, toUniId
  // "AAAAAA+" tags a subset font per PDF 9.6.4; six A's is a fixed, honest tag
  // for a deterministic exporter, and keeps two subsets of one face distinct in
  // a merged document by their different glyph sets rather than a random prefix.
  const rawName = parsed.psName || `Embedded${tag}`
  const baseName = renumber && subset ? `AAAAAA+${rawName}` : rawName

  function ensure() {
    if (id !== null) return
    cidId = doc.reserve()
    descId = doc.reserve()
    fileId = doc.reserve()
    toUniId = doc.reserve()
    id = doc.add(
      `<< /Type /Font /Subtype /Type0 /BaseFont /${baseName} /Encoding /Identity-H ` +
      `/DescendantFonts [${cidId} 0 R] /ToUnicode ${toUniId} 0 R >>`
    )
  }

  const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0')

  /** Every codepoint maps to a glyph, or the whole text is not this font's to carry. */
  function covers(text) {
    for (const ch of text) {
      if (!parsed.cmap.has(ch.codePointAt(0))) return false
    }
    return true
  }

  function encode(text) {
    if (!text) return null
    for (const ch of text) {
      if (!parsed.cmap.has(ch.codePointAt(0))) return null
    }
    ensure()
    let out = '<'
    for (const ch of text) {
      const cp = ch.codePointAt(0)
      const orig = parsed.cmap.get(cp)
      let cid
      if (renumber) {
        cid = cidByOrig.get(orig)
        if (cid === undefined) {
          cid = nextCid++
          cidByOrig.set(orig, cid)
          origByCid.set(cid, orig)
        }
      } else {
        cid = orig
        origByCid.set(cid, orig)
      }
      if (!cpByCid.has(cid)) cpByCid.set(cid, cp)
      codeToOrig.set(cp, orig)
      out += hex4(cid)
    }
    return out + '>'
  }

  /** The REAL advance of the text at `size` — Tz denominators and furniture layout. */
  function width(text, size) {
    let units = 0
    for (const ch of text) {
      const gid = parsed.cmap.get(ch.codePointAt(0))
      if (gid === undefined) return null
      units += parsed.advanceOf(gid)
    }
    return units * size / 1000
  }

  async function finalize() {
    if (id === null) return

    // /W is keyed by CID, and every advance is the original glyph's — renumbering
    // moved the id, never the metric.
    const cids = [...cpByCid.keys()].sort((a, b) => a - b)
    const wParts = []
    for (let i = 0; i < cids.length;) {
      let j = i
      while (j + 1 < cids.length && cids[j + 1] === cids[j] + 1) j++
      wParts.push(`${cids[i]} [${cids.slice(i, j + 1).map(c => parsed.advanceOf(origByCid.get(c))).join(' ')}]`)
      i = j + 1
    }

    // The font program, and how CID reaches glyph. Three outcomes:
    //  - CFF: embedded whole, CID = glyph id natively (no CIDToGIDMap).
    //  - TrueType subset: the renumber IS the mapping, so /Identity is exact and
    //    only the used outlines travel.
    //  - TrueType whole (subset off, or a subset that refused): the file travels
    //    whole and an explicit CIDToGIDMap stream carries CID → original glyph.
    let program = sfnt
    let cidToGid = parsed.cff ? '' : ' /CIDToGIDMap /Identity'
    let subsetted = false
    if (renumber) {
      let done = false
      if (subset) {
        const r = subsetTrueType(sfnt, cidByOrig, codeToOrig)
        if (!r.error) { program = r.sfnt; subsetted = true; done = true }
      }
      if (!done) {
        // Whole file, dense CIDs: map each CID back to its original glyph id.
        const maxCid = cids.length ? cids[cids.length - 1] : 0
        const map = new Uint8Array((maxCid + 1) * 2)
        for (const [cid, orig] of origByCid) {
          map[cid * 2] = (orig >> 8) & 0xff
          map[cid * 2 + 1] = orig & 0xff
        }
        const mapId = doc.reserve()
        const mapBody = canDeflate ? await deflate(map) : map
        doc.fillStream(mapId, canDeflate ? '/Filter /FlateDecode' : '', mapBody)
        cidToGid = ` /CIDToGIDMap ${mapId} 0 R`
      }
    }

    const flags = 4 | (parsed.fixedPitch ? 1 : 0) | (parsed.italicAngle ? 64 : 0)
    const stemV = Math.round(10 + (parsed.weightClass || 400) * 0.14)
    doc.fill(descId,
      `<< /Type /FontDescriptor /FontName /${baseName} /Flags ${flags} ` +
      `/FontBBox [${parsed.bbox.join(' ')}] /ItalicAngle ${parsed.italicAngle} ` +
      `/Ascent ${parsed.ascent} /Descent ${parsed.descent} /CapHeight ${parsed.capHeight} ` +
      `/StemV ${stemV} /${parsed.cff ? 'FontFile3' : 'FontFile2'} ${fileId} 0 R >>`
    )
    doc.fill(cidId,
      `<< /Type /Font /Subtype /${parsed.cff ? 'CIDFontType0' : 'CIDFontType2'} /BaseFont /${baseName} ` +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
      `/FontDescriptor ${descId} 0 R /DW 1000` +
      (wParts.length ? ` /W [${wParts.join(' ')}]` : '') +
      cidToGid +
      ' >>'
    )

    // The program itself. /Length1 is the UNCOMPRESSED size and only FontFile2
    // carries it; FontFile3 declares its flavor with /Subtype instead.
    const body = canDeflate ? await deflate(program) : program
    doc.fillStream(fileId,
      (parsed.cff ? '/Subtype /OpenType ' : `/Length1 ${program.length} `) +
      (canDeflate ? '/Filter /FlateDecode' : ''),
      body)
    kB = Math.round(program.length / 1024)
    embeddedBytes = program.length
    isSubset = subsetted

    const utf16be = (cp) => {
      if (cp <= 0xffff) return hex4(cp)
      const v = cp - 0x10000
      return hex4(0xd800 | (v >> 10)) + hex4(0xdc00 | (v & 0x3ff))
    }
    const lines = [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange',
      '<0000> <FFFF>',
      'endcodespacerange',
    ]
    const entries = cids.map(cid => `<${hex4(cid)}> <${utf16be(cpByCid.get(cid))}>`)
    for (let i = 0; i < entries.length; i += 100) {
      const chunk = entries.slice(i, i + 100)
      lines.push(`${chunk.length} beginbfchar`, ...chunk, 'endbfchar')
    }
    lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end')
    doc.fillStream(toUniId, '', lines.join('\n'))
  }

  // Filled by finalize so the caller can report the embedded (post-subset) size.
  let kB = Math.round(sfnt.length / 1024)
  let embeddedBytes = sfnt.length
  let isSubset = false

  return {
    name: `E${tag}`,
    get id() { return id },
    get active() { return id !== null },
    get kB() { return kB },
    get embeddedBytes() { return embeddedBytes },
    get subset() { return isSubset },
    baseName,
    covers,
    encode,
    width,
    finalize,
  }
}
