/**
 * TrueType subsetting: keep only the glyphs a document actually used, renumbered
 * into a dense space, and rebuild a valid sfnt around them.
 *
 * This is the font compiler the embedding path deliberately went without at
 * first. It earns its risk with one number: an unsubsetted face is the whole
 * file (Inter is ~320 kB); a Latin document touches ~80 glyphs, and those plus
 * their metrics and a fresh cmap are tens of kB. The saving is the glyf table,
 * which is most of a font and most of which no page ever draws.
 *
 * The dense renumber is the whole trick, and it is shared with `createEmbeddedFont`:
 * that writer already assigns each glyph a compact id in first-use order as it
 * encodes the content stream (0 is `.notdef`), and writes THAT id as the CID. So
 * the content stream, `/W` and `/ToUnicode` all speak the subset's numbering
 * already; this file only has to place original glyph `g` at its new index and
 * rewrite the composite-component references that point across the renumber.
 *
 * What is rebuilt, and what is dropped:
 *  - `glyf` + `loca`: the retained outlines, composite component ids remapped,
 *    long `loca` throughout so offsets never need the ×2 short encoding.
 *  - `hmtx` + `hhea`: advances/lsbs for the dense set; `numberOfHMetrics` = count.
 *  - `maxp`: `numGlyphs` = count; the other ceilings are copied (they bound).
 *  - `cmap`: a fresh format 4 (+ format 12 when an astral code point is kept),
 *    mapping the retained CODE POINTS to their new ids. The PDF encodes through
 *    Identity-H and ignores this, but OTS and any standalone use want it valid.
 *  - `head`, `name`, `OS/2`, `post`: copied; `post` is rewritten to v3 (no glyph
 *    names — they are dead weight the PDF never reads).
 *  - Hinting (`fpgm`/`prep`/`cvt`/`gasp`) and layout (`GSUB`/`GPOS`/`GDEF`) are
 *    DROPPED. No shaping happens on this path, so the glyphs render unhinted and
 *    unshaped — correct for an invisible layer and honest for short furniture.
 *
 * CFF (`OTTO`) fonts are not subset here — their charstrings are a different
 * compiler — so the caller embeds those whole.
 */

const U16 = (b, at) => (b[at] << 8) | b[at + 1]
const U32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
const TAG = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])

// glyf composite flags this file reads.
const ARG_1_AND_2_ARE_WORDS = 0x0001
const WE_HAVE_A_SCALE = 0x0008
const MORE_COMPONENTS = 0x0020
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040
const WE_HAVE_A_TWO_BY_TWO = 0x0080

/** The sfnt table directory as tag → {offset, length}. */
function directory(b) {
  const numTables = U16(b, 4)
  const tables = new Map()
  for (let i = 0; i < numTables; i++) {
    const at = 12 + i * 16
    tables.set(TAG(b, at), { offset: U32(b, at + 8), length: U32(b, at + 12) })
  }
  return tables
}

/** glyph `gid`'s bytes in the source, or an empty view when it has no outline. */
function glyphSlice(b, loca, gid) {
  const start = loca[gid]
  const end = loca[gid + 1]
  return end > start ? b.subarray(start, end) : b.subarray(0, 0)
}

/** loca as absolute byte offsets into glyf, in either stored format. */
function readLoca(b, locaT, glyfOffset, numGlyphs, longLoca) {
  const out = new Array(numGlyphs + 1)
  for (let i = 0; i <= numGlyphs; i++) {
    out[i] = glyfOffset + (longLoca ? U32(b, locaT.offset + i * 4) : U16(b, locaT.offset + i * 2) * 2)
  }
  return out
}

/**
 * Every glyph id a composite glyph reaches, transitively. A component may itself
 * be composite, so the walk is a queue, not one pass; a self-reference or a cycle
 * is bounded by the `seen` set.
 */
function componentIds(b, loca, gid, into) {
  const g = glyphSlice(b, loca, gid)
  if (g.length < 10 || (U16(g, 0) & 0x8000) === 0) return // not composite (numberOfContours >= 0)
  let at = 10
  for (;;) {
    const flags = U16(g, at)
    const componentGid = U16(g, at + 2)
    into.add(componentGid)
    at += 4
    at += (flags & ARG_1_AND_2_ARE_WORDS) ? 4 : 2
    if (flags & WE_HAVE_A_SCALE) at += 2
    else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) at += 4
    else if (flags & WE_HAVE_A_TWO_BY_TWO) at += 8
    if (!(flags & MORE_COMPONENTS)) break
  }
}

/** A copy of glyph `gid`'s bytes with every component id remapped through `map`. */
function remapComposite(bytes, map) {
  if (bytes.length < 10 || (U16(bytes, 0) & 0x8000) === 0) return bytes
  const out = bytes.slice()
  let at = 10
  for (;;) {
    const flags = U16(out, at)
    const newGid = map.get(U16(out, at + 2))
    out[at + 2] = (newGid >> 8) & 0xff
    out[at + 3] = newGid & 0xff
    at += 4
    at += (flags & ARG_1_AND_2_ARE_WORDS) ? 4 : 2
    if (flags & WE_HAVE_A_SCALE) at += 2
    else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) at += 4
    else if (flags & WE_HAVE_A_TWO_BY_TWO) at += 8
    if (!(flags & MORE_COMPONENTS)) break
  }
  return out
}

/** sfnt table checksum: sum of big-endian uint32 over the 4-byte-padded data. */
function checksum(bytes) {
  let sum = 0
  const n = (bytes.length + 3) & ~3
  for (let i = 0; i < n; i += 4) {
    const v = ((bytes[i] || 0) << 24) | ((bytes[i + 1] || 0) << 16) |
      ((bytes[i + 2] || 0) << 8) | (bytes[i + 3] || 0)
    sum = (sum + (v >>> 0)) >>> 0
  }
  return sum >>> 0
}

/** A format-4 (BMP) cmap subtable body for `pairs` of [codepoint, gid], sorted. */
function cmapFormat4(pairs) {
  const segments = []
  let i = 0
  while (i < pairs.length) {
    const [startCp, startGid] = pairs[i]
    let j = i
    while (j + 1 < pairs.length &&
      pairs[j + 1][0] === pairs[j][0] + 1 && pairs[j + 1][1] === pairs[j][1] + 1) j++
    segments.push({ start: startCp, end: pairs[j][0], delta: (startGid - startCp) & 0xffff })
    i = j + 1
  }
  segments.push({ start: 0xffff, end: 0xffff, delta: 1 }) // required terminator → gid 0
  const segCount = segments.length
  const segX2 = segCount * 2
  let entropy = 0
  while ((1 << (entropy + 1)) <= segCount) entropy++
  const searchRange = 2 * (1 << entropy)
  const words = []
  words.push(4, segX2 + 16 /* length filled below */, 0, segX2, searchRange, entropy, segX2 - searchRange)
  for (const s of segments) words.push(s.end)
  words.push(0) // reservedPad
  for (const s of segments) words.push(s.start)
  for (const s of segments) words.push(s.delta)
  for (const s of segments) words.push(0) // idRangeOffset — all pure-delta
  const body = new Uint8Array(words.length * 2)
  for (let k = 0; k < words.length; k++) {
    body[k * 2] = (words[k] >> 8) & 0xff
    body[k * 2 + 1] = words[k] & 0xff
  }
  body[2] = (body.length >> 8) & 0xff // real length now that it is known
  body[3] = body.length & 0xff
  return body
}

/** A format-12 (full Unicode) cmap subtable body for `pairs`, sorted. */
function cmapFormat12(pairs) {
  const groups = []
  let i = 0
  while (i < pairs.length) {
    const [startCp, startGid] = pairs[i]
    let j = i
    while (j + 1 < pairs.length &&
      pairs[j + 1][0] === pairs[j][0] + 1 && pairs[j + 1][1] === pairs[j][1] + 1) j++
    groups.push([startCp, pairs[j][0], startGid])
    i = j + 1
  }
  const body = new Uint8Array(16 + groups.length * 12)
  const w32 = (at, v) => { body[at] = (v >>> 24) & 0xff; body[at + 1] = (v >>> 16) & 0xff; body[at + 2] = (v >>> 8) & 0xff; body[at + 3] = v & 0xff }
  body[0] = 0; body[1] = 12 // format 12.0
  w32(4, body.length)
  w32(8, 0) // language
  w32(12, groups.length)
  groups.forEach(([s, e, g], k) => {
    w32(16 + k * 12, s); w32(16 + k * 12 + 4, e); w32(16 + k * 12 + 8, g)
  })
  return body
}

/** The whole cmap table: a (3,1) format 4, plus a (3,10) format 12 when needed. */
function buildCmap(codeToGid) {
  const bmp = [...codeToGid].filter(([cp]) => cp <= 0xffff).sort((a, b) => a[0] - b[0])
  const all = [...codeToGid].sort((a, b) => a[0] - b[0])
  const astral = all.length > bmp.length
  const subs = [{ platform: 3, encoding: 1, body: cmapFormat4(bmp) }]
  if (astral) subs.push({ platform: 3, encoding: 10, body: cmapFormat12(all) })

  const header = 4 + subs.length * 8
  let offset = header
  const out = []
  const head = new Uint8Array(header)
  head[0] = 0; head[1] = 0 // version
  head[2] = (subs.length >> 8) & 0xff; head[3] = subs.length & 0xff
  subs.forEach((s, i) => {
    const at = 4 + i * 8
    head[at] = (s.platform >> 8) & 0xff; head[at + 1] = s.platform & 0xff
    head[at + 2] = (s.encoding >> 8) & 0xff; head[at + 3] = s.encoding & 0xff
    head[at + 4] = (offset >>> 24) & 0xff; head[at + 5] = (offset >>> 16) & 0xff
    head[at + 6] = (offset >>> 8) & 0xff; head[at + 7] = offset & 0xff
    offset += s.body.length
  })
  out.push(head, ...subs.map(s => s.body))
  return concat(out)
}

function concat(chunks) {
  let n = 0
  for (const c of chunks) n += c.length
  const out = new Uint8Array(n)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

/** A minimal post v3 table — no glyph names, which the PDF never reads. */
function postV3(src) {
  const out = new Uint8Array(32)
  out.set(src.subarray(4, 32), 4) // keep italicAngle…maxMemType1 from the original
  out[0] = 0; out[1] = 3; out[2] = 0; out[3] = 0 // version 3.0
  return out
}

/**
 * Subset a TrueType sfnt to the glyphs named by `directMap`.
 *
 * @param {Uint8Array} sfnt  the source font, already unpacked to plain sfnt
 * @param {Map<number, number>} directMap  original glyph id → new (dense) id,
 *   for exactly the glyphs the content stream references. Must map original 0
 *   to new 0 (`.notdef`) and be dense over 0…directMap.size-1.
 * @param {Map<number, number>} codeToOrig  code point → original glyph id, for
 *   the retained characters — used to rebuild the cmap in the new numbering.
 * @returns {{sfnt: Uint8Array}|{error: string}}
 */
export function subsetTrueType(sfnt, directMap, codeToOrig) {
  const b = sfnt
  const tables = directory(b)
  const headT = tables.get('head')
  const maxpT = tables.get('maxp')
  const hheaT = tables.get('hhea')
  const hmtxT = tables.get('hmtx')
  const glyfT = tables.get('glyf')
  const locaT = tables.get('loca')
  if (!headT || !maxpT || !hheaT || !hmtxT || !glyfT || !locaT) {
    return { error: 'subset needs head/maxp/hhea/hmtx/glyf/loca (TrueType outlines)' }
  }
  const numGlyphs = U16(b, maxpT.offset + 4)
  const longLoca = U16(b, headT.offset + 50) === 1
  const loca = readLoca(b, locaT, glyfT.offset, numGlyphs, longLoca)

  // The retained set, closed over composite components. `newOf` extends
  // directMap: components not directly used get ids after the dense prefix.
  const newOf = new Map(directMap)
  const queue = [...directMap.keys()]
  while (queue.length) {
    const gid = queue.pop()
    if (gid >= numGlyphs) continue
    const comps = new Set()
    componentIds(b, loca, gid, comps)
    for (const c of comps) {
      if (!newOf.has(c)) { newOf.set(c, newOf.size); queue.push(c) }
    }
  }
  const count = newOf.size
  const origOf = new Array(count)
  for (const [orig, nw] of newOf) origOf[nw] = orig

  // glyf + loca in the new order. Each glyph padded to an even length; long loca
  // throughout, so a large offset never overflows the short format.
  const numH = U16(b, hheaT.offset + 34)
  const glyphBytes = []
  const locaOut = new Uint8Array((count + 1) * 4)
  const putLoca = (i, v) => { const at = i * 4; locaOut[at] = (v >>> 24) & 0xff; locaOut[at + 1] = (v >>> 16) & 0xff; locaOut[at + 2] = (v >>> 8) & 0xff; locaOut[at + 3] = v & 0xff }
  let glyfLen = 0
  const hmtxOut = new Uint8Array(count * 4)
  for (let nw = 0; nw < count; nw++) {
    putLoca(nw, glyfLen)
    const orig = origOf[nw]
    let g = glyphSlice(b, loca, orig)
    if (g.length) {
      g = remapComposite(g, newOf)
      glyphBytes.push(g)
      glyfLen += g.length
      if (g.length & 1) { glyphBytes.push(new Uint8Array(1)); glyfLen += 1 }
    }
    // hmtx: advance from the last real metric when orig sat in the monospaced
    // tail, its own lsb otherwise; a subset keeps a full (advance,lsb) per glyph.
    const hm = orig < numH ? orig : numH - 1
    hmtxOut[nw * 4] = b[hmtxT.offset + hm * 4]
    hmtxOut[nw * 4 + 1] = b[hmtxT.offset + hm * 4 + 1]
    if (orig < numH) {
      hmtxOut[nw * 4 + 2] = b[hmtxT.offset + orig * 4 + 2]
      hmtxOut[nw * 4 + 3] = b[hmtxT.offset + orig * 4 + 3]
    } else {
      // A tail glyph's lsb lives in the leftSideBearings[] array that follows the
      // hMetrics — not in a 4-byte hMetric. Reading it as one (above) would take
      // the advance's bytes; dropping it (no else) would zero the bearing and
      // shift the painted glyph sideways within its cell on a monospaced face.
      const at = hmtxT.offset + numH * 4 + (orig - numH) * 2
      hmtxOut[nw * 4 + 2] = b[at]
      hmtxOut[nw * 4 + 3] = b[at + 1]
    }
  }
  putLoca(count, glyfLen)
  const glyfOut = concat(glyphBytes)

  // Fixed-size tables, copied then patched.
  const head = b.slice(headT.offset, headT.offset + headT.length)
  head[50] = 0; head[51] = 1 // indexToLocFormat = long
  head[8] = head[9] = head[10] = head[11] = 0 // checkSumAdjustment zeroed; set at the end
  const maxp = b.slice(maxpT.offset, maxpT.offset + maxpT.length)
  maxp[4] = (count >> 8) & 0xff; maxp[5] = count & 0xff
  const hhea = b.slice(hheaT.offset, hheaT.offset + hheaT.length)
  hhea[34] = (count >> 8) & 0xff; hhea[35] = count & 0xff // numberOfHMetrics

  const codeToNew = new Map()
  for (const [cp, orig] of codeToOrig) {
    if (newOf.has(orig)) codeToNew.set(cp, newOf.get(orig))
  }

  const out = new Map()
  out.set('head', head)
  out.set('hhea', hhea)
  out.set('maxp', maxp)
  out.set('hmtx', hmtxOut)
  out.set('loca', locaOut)
  out.set('glyf', glyfOut)
  out.set('cmap', buildCmap(codeToNew))
  for (const tag of ['name', 'OS/2']) {
    const t = tables.get(tag)
    if (t) out.set(tag, b.slice(t.offset, t.offset + t.length))
  }
  const postT = tables.get('post')
  if (postT) out.set('post', postV3(b.slice(postT.offset, postT.offset + postT.length)))

  return { sfnt: assemble(out) }
}

/** Lay the tables out as a checksummed sfnt with a sorted directory. */
function assemble(tableMap) {
  const tags = [...tableMap.keys()].sort()
  const numTables = tags.length
  let entropy = 0
  while ((1 << (entropy + 1)) <= numTables) entropy++
  const searchRange = (1 << entropy) * 16

  const headerLen = 12 + numTables * 16
  let offset = headerLen
  const records = []
  for (const tag of tags) {
    const data = tableMap.get(tag)
    records.push({ tag, data, offset, length: data.length, checksum: checksum(data) })
    offset += (data.length + 3) & ~3
  }

  const out = new Uint8Array(offset)
  const w16 = (at, v) => { out[at] = (v >> 8) & 0xff; out[at + 1] = v & 0xff }
  const w32 = (at, v) => { out[at] = (v >>> 24) & 0xff; out[at + 1] = (v >>> 16) & 0xff; out[at + 2] = (v >>> 8) & 0xff; out[at + 3] = v & 0xff }
  w32(0, 0x00010000)
  w16(4, numTables)
  w16(6, searchRange)
  w16(8, entropy)
  w16(10, numTables * 16 - searchRange)
  records.forEach((r, i) => {
    const at = 12 + i * 16
    for (let k = 0; k < 4; k++) out[at + k] = r.tag.charCodeAt(k) || 0x20
    w32(at + 4, r.checksum)
    w32(at + 8, r.offset)
    w32(at + 12, r.length)
    out.set(r.data, r.offset)
  })

  // head.checkSumAdjustment closes the loop: 0xB1B0AFBA minus the whole file's
  // checksum with this field zero (it already is).
  const headRec = records.find(r => r.tag === 'head')
  const adjustment = (0xb1b0afba - checksum(out)) >>> 0
  w32(headRec.offset + 8, adjustment)
  return out
}

export default subsetTrueType
