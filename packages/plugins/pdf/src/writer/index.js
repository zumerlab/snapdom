/**
 * Minimal PDF 1.7 writer: page tree, image XObjects, fonts (base-14 plus one
 * Type0 for everything else), link and widget annotations. 1.7 because it is
 * ISO 32000-1 — the last numbered version every reader in use parses — and
 * because the structure types the table model needs (`THead`, `TBody`, `TFoot`)
 * arrived in 1.5; nothing here emits a 1.5+ FILE STRUCTURE feature (no object
 * streams, no xref streams), so a 1.4-era parser still reads these bytes.
 *
 * **This is the byte level, and it stays there.** Nothing in this directory may
 * know what it is drawing: no text layers, no page model, no layout. If a helper
 * needs to know who called it, it belongs in the caller. That line is what keeps
 * the writer testable on its own and the exporter free to change above it.
 *
 * It began life as `@zumer/pdf-writer`, a package shared with the sibling vector
 * product inside a monorepo. This repository owns its copy outright: the two
 * are free to diverge, and neither can break the other. `setWarnPrefix` survives
 * from that arrangement and is still worth having — it is what puts the product's
 * own name in front of a warning.
 *
 * createPdfDoc itself never compresses: it builds dictionaries and counts
 * /Length over whatever bytes it is handed, which is what keeps it synchronous
 * and lets a debug build stay readable with `strings`. Compression is opt-in and
 * visible. deflate() is exported for the caller to run over its content streams,
 * and encodeImage deflates the /SMask plane, which is opaque binary either way.
 */

/**
 * Whose name goes in front of a warning from this file. Neutral by default; each
 * plugin sets its own on load, so a message always names the product the reader
 * actually bought.
 */
import { buildEncryption, AES256_EXTENSION } from './encrypt.js'

let prefix = '[pdf-writer]'

/** @param {string} name e.g. `[snapdom-pdf]` */
export function setWarnPrefix (name) {
  if (typeof name === 'string' && name) prefix = name
}

const warn = (msg) => console.warn(`${prefix} ${msg}`)

/**
 * 128 bits of file identity from the file's own bytes: four FNV-1a 32-bit lanes
 * over the same stream, differently seeded. Not cryptographic and not trying to
 * be — a trailer /ID exists so tools can tell "same document" from "different
 * document", and a content hash answers exactly that while keeping the bytes
 * deterministic. Plain 32-bit arithmetic so a 16 MB file hashes in milliseconds.
 */
function contentHash(chunks) {
  // Lane 0 is the standard FNV-1a offset basis; the rest are its successive
  // FNV-mixes, so no two lanes ever start equal.
  const seeds = [0x811c9dc5, 0xaf63bd4c, 0x84222325, 0xcbf29ce4]
  const h = seeds.slice()
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i]
      for (let lane = 0; lane < 4; lane++) {
        // FNV-1a: xor the byte, multiply by the 32-bit FNV prime 16777619.
        const x = h[lane] ^ byte
        h[lane] = (x + (x << 1) + (x << 4) + (x << 7) + (x << 8) + (x << 24)) >>> 0
      }
    }
  }
  return h.map(n => n.toString(16).padStart(8, '0')).join('').toUpperCase()
}

/** PDF syntax is ASCII and PDF strings are byte strings — never UTF-8 encode. */
function latin1(str) {
  const out = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff
  return out
}

/**
 * WinAnsi holds the typographic punctuation real copy is full of at 0x80–0x9F,
 * outside Latin-1. Without this, curly quotes and dashes silently drop out of
 * the text layer — which is most of the punctuation on a designed page.
 */
const WINANSI = new Map(Object.entries({
  8364: 0x80, 8218: 0x82, 402: 0x83, 8222: 0x84, 8230: 0x85, 8224: 0x86, 8225: 0x87,
  710: 0x88, 8240: 0x89, 352: 0x8a, 8249: 0x8b, 338: 0x8c, 381: 0x8e, 8216: 0x91,
  8217: 0x92, 8220: 0x93, 8221: 0x94, 8226: 0x95, 8211: 0x96, 8212: 0x97, 732: 0x98,
  8482: 0x99, 353: 0x9a, 8250: 0x9b, 339: 0x9c, 382: 0x9e, 376: 0x9f,
}).map(([k, v]) => [Number(k), v]))

/**
 * Escape a JS string into a PDF literal string.
 * Returns null when the text carries a codepoint the base-14 WinAnsi fonts
 * cannot address — the caller drops that run rather than writing mojibake.
 */
export function pdfString(text) {
  let out = '('
  for (const ch of text) {
    let code = ch.codePointAt(0)
    if (code > 255) {
      const mapped = WINANSI.get(code)
      if (mapped === undefined) return null
      code = mapped
    }
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch
    else if (code < 32) out += ' '
    else out += String.fromCharCode(code)
  }
  return out + ')'
}

/**
 * Escape a JS string into a PDF **text string** — the kind that goes in a
 * `/Title`, not in a content stream.
 *
 * Unlike `pdfString` this never returns null and never drops a codepoint: what
 * WinAnsi cannot address goes out as UTF-16BE hex with a BOM, which every PDF
 * consumer since 1.2 reads. It is a different job from `pdfString`, which writes
 * the bytes a base-14 font will SHOW and therefore has to fail when no glyph
 * exists. Nothing paints a text string, so there is no glyph to be missing.
 *
 * ASCII stays a literal string, so an outline of Latin headings reads in the
 * clear with `strings` and costs no more bytes than it did before.
 */
export function pdfTextString(text) {
  const str = String(text)
  // eslint-disable-next-line no-control-regex
  if (!/[^\x20-\x7e]/.test(str)) {
    return '(' + str.replace(/[\\()]/g, (c) => '\\' + c) + ')'
  }
  let hex = 'FEFF'
  for (let i = 0; i < str.length; i++) hex += hex4(str.charCodeAt(i))
  return `<${hex}>`
}

/**
 * Every PDF string inside one object body, as `[start, end)` offsets.
 *
 * Encryption has to find them all, and "all" is the operative word: a string
 * left in the clear is not a smaller feature, it is a document whose title or
 * link comes back as mojibake, because the reader decrypts what was never
 * encrypted. Marking them at each call site was the other design and it was
 * rejected for exactly that reason — `/URI` and `/DA` do not go through the same
 * helper as `/Title`, and the next one added would not either.
 *
 * So this reads the grammar instead of trusting a convention. Object bodies at
 * this level are dictionaries, names, numbers, arrays and the two string forms;
 * a scanner that knows `<<` from `<` cannot be fooled by output this writer
 * produced, and it finds strings nobody remembered to enumerate.
 */
function scanStrings(text) {
  const found = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '<') {
      if (text[i + 1] === '<') { i++; continue }   // dictionary, not a string
      const end = text.indexOf('>', i + 1)
      if (end < 0) break
      found.push([i, end + 1])
      i = end
    } else if (c === '(') {
      // Literal strings nest, and a backslash escapes the next byte whatever it is.
      let depth = 1
      let j = i + 1
      for (; j < text.length && depth; j++) {
        if (text[j] === '\\') j++
        else if (text[j] === '(') depth++
        else if (text[j] === ')') depth--
      }
      found.push([i, j])
      i = j - 1
    }
  }
  return found
}

/** A literal or hex PDF string, back to the bytes it stands for. */
function stringBytes(token) {
  if (token[0] === '<') {
    const hex = token.slice(1, -1).replace(/[^0-9a-fA-F]/g, '')
    const even = hex.length % 2 ? hex + '0' : hex
    const out = new Uint8Array(even.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = parseInt(even.substr(i * 2, 2), 16)
    return out
  }
  const body = token.slice(1, -1)
  const out = []
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') { out.push(body.charCodeAt(i) & 0xff); continue }
    const n = body[++i]
    const simple = { n: 10, r: 13, t: 9, b: 8, f: 12 }[n]
    if (simple !== undefined) out.push(simple)
    else if (n >= '0' && n <= '7') {
      let oct = n
      while (oct.length < 3 && body[i + 1] >= '0' && body[i + 1] <= '7') oct += body[++i]
      out.push(parseInt(oct, 8) & 0xff)
    } else if (n === '\n') { /* line continuation: nothing */ }
    else out.push(n.charCodeAt(0) & 0xff)
  }
  return new Uint8Array(out)
}

export function createPdfDoc() {
  // 1-indexed: object 0 is the free-list head and never written.
  const objects = [null]
  /** The /Encrypt object once `encrypt()` has run: the trailer has to point at it. */
  let encryptId = null

  function add(parts) {
    objects.push(Array.isArray(parts) ? parts : [parts])
    return objects.length - 1
  }

  /** Reserve an id before its body exists (page ↔ pages tree is circular). */
  function reserve() {
    objects.push(undefined)
    return objects.length - 1
  }

  function fill(id, parts) {
    objects[id] = Array.isArray(parts) ? parts : [parts]
  }

  /**
   * @param {string} dict - dictionary WITHOUT /Length, which is computed here.
   *   /Length counts the bytes actually written, so a pre-deflated payload needs
   *   no special handling — pass the compressed bytes and put /Filter in `dict`.
   */
  function streamParts(dict, data) {
    const bytes = typeof data === 'string' ? latin1(data) : data
    return [`<< ${dict} /Length ${bytes.length} >>\nstream\n`, bytes, '\nendstream']
  }

  function addStream(dict, data) {
    return add(streamParts(dict, data))
  }

  /** A stream whose id had to exist before its bytes did (fonts reference theirs). */
  function fillStream(id, dict, data) {
    fill(id, streamParts(dict, data))
  }

  /**
   * Encrypt the whole document in place, then hand back the catalog entry it
   * needs. Call it once, AFTER every object is filled and BEFORE `build()`:
   * an object written afterwards would travel in the clear inside a file that
   * says everything is encrypted, and no reader would recover it.
   *
   * Revision 6 uses the file key for every object, so nothing here depends on
   * object numbers — the classic way to corrupt an encrypted PDF is to derive a
   * per-object key from the wrong one, and that mistake is not available.
   *
   * @param {number} rootId  the /Catalog, which this also stamps with the
   *   extension level that makes AES-256 legible to an ISO 32000-1 reader. It is
   *   done here rather than by the caller because the stamp has to land AFTER
   *   the walk — the catalog carries strings of its own (`/Lang`), and one filled
   *   in afterwards would sit in the clear inside a file that says it is not.
   * @param {object} spec  `{userPassword, ownerPassword, permissions}`
   * @returns {Promise<{p: number}>} the permission value actually written.
   */
  async function encrypt(rootId, spec) {
    if (encryptId !== null) throw new Error(`${prefix} the document is already encrypted`)
    if (typeof crypto?.subtle?.encrypt !== 'function') {
      throw new Error(`${prefix} encryption needs WebCrypto, which needs a secure ` +
        'context — serve the page over https or localhost')
    }
    const handler = await buildEncryption({ ...spec, warn })

    // Its own strings are the way IN to the file and are never encrypted, so the
    // dictionary is added after the walk rather than exempted during it.
    for (let id = 1; id < objects.length; id++) {
      const parts = objects[id]
      if (!parts) continue
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        if (typeof part !== 'string') {
          // A non-string part is a stream payload, and `streamParts` always put
          // the dictionary carrying its /Length immediately before it.
          parts[i] = await handler.encrypt(part)
          parts[i - 1] = String(parts[i - 1]).replace(
            /\/Length \d+ >>\nstream\n$/, `/Length ${parts[i].length} >>\nstream\n`)
          continue
        }
        const found = scanStrings(part)
        if (!found.length) continue
        let out = ''
        let at = 0
        for (const [from, to] of found) {
          const bytes = await handler.encrypt(stringBytes(part.slice(from, to)))
          out += part.slice(at, from) + '<' +
            [...bytes].map(b => b.toString(16).padStart(2, '0')).join('') + '>'
          at = to
        }
        parts[i] = out + part.slice(at)
      }
    }
    const catalog = objects[rootId]
    if (!catalog) throw new Error(`${prefix} the catalog must be filled before encrypting`)
    const last = catalog.length - 1
    catalog[last] = String(catalog[last]).replace(/>>\s*$/, `${AES256_EXTENSION} >>`)
    encryptId = add(`<< ${handler.dict} >>`)
    return { p: handler.p }
  }

  /**
   * @param {number} rootId  the /Catalog object id
   * @param {object} [trailer]
   * @param {number|null} [trailer.infoId]  a /Info dictionary's object id
   * @param {boolean} [trailer.fileId]  write a trailer /ID derived from the
   *   file's own bytes. Deterministic on purpose: the same unencrypted document
   *   produces the same ID, which is the byte-determinism contract extended to
   *   the one field the spec suggests randomising. An encrypted file carries
   *   random IVs, so its ID differs per export as well. Both halves are equal
   *   because this writer never updates a file incrementally, so there is no
   *   "original" to differ from.
   */
  function build(rootId, { infoId = null, fileId = false } = {}) {
    const chunks = []
    let offset = 0
    const push = (d) => {
      const u8 = typeof d === 'string' ? latin1(d) : d
      chunks.push(u8)
      offset += u8.length
    }

    // The binary comment marks the file as non-ASCII so transfers stay in binary mode.
    push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')

    const offsets = []
    for (let id = 1; id < objects.length; id++) {
      offsets[id] = offset
      push(`${id} 0 obj\n`)
      for (const part of objects[id]) push(part)
      push('\nendobj\n')
    }

    const xref = offset
    push(`xref\n0 ${objects.length}\n0000000000 65535 f \n`)
    for (let id = 1; id < objects.length; id++) {
      push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
    }
    // Hashed over everything above the trailer — header, objects and xref — so
    // any content change moves the ID and identical exports share one.
    const id = fileId ? contentHash(chunks) : null
    push(`trailer\n<< /Size ${objects.length} /Root ${rootId} 0 R` +
      (infoId ? ` /Info ${infoId} 0 R` : '') +
      (encryptId ? ` /Encrypt ${encryptId} 0 R` : '') +
      (id ? ` /ID [<${id}> <${id}>]` : '') +
      ` >>\nstartxref\n${xref}\n%%EOF\n`)

    const out = new Uint8Array(offset)
    let at = 0
    for (const c of chunks) { out.set(c, at); at += c.length }
    return out
  }

  return { add, reserve, fill, addStream, fillStream, encrypt, build }
}

// ——— document structure ———————————————————————————————————————
//
// Outlines and the destination name tree are the two places where a PDF says
// something about the SHAPE of the document rather than about its ink, which is
// why they live here and not in a plugin: neither one knows or cares whether the
// page under it is a raster with a text layer over it or a page of drawn paths.
// Both take destinations as finished PDF array strings, because only the caller
// knows where its pages ended up.

/**
 * One level of the outline, written bottom-up so every sibling knows its
 * neighbours. Reserving the whole level's ids first is what makes /Prev and /Next
 * writable in one pass.
 *
 * @returns {{first:number, last:number, open:number}} `open` is the number of
 *   entries a viewer will SHOW with this level expanded — the level's own count
 *   plus every open descendant, which is what a parent's /Count has to carry.
 */
function outlineLevel(doc, nodes, parentId) {
  const ids = nodes.map(() => doc.reserve())
  let open = nodes.length
  nodes.forEach((node, i) => {
    let kids = ''
    if (node.children && node.children.length) {
      const sub = outlineLevel(doc, node.children, ids[i])
      kids = ` /First ${sub.first} 0 R /Last ${sub.last} 0 R /Count ${sub.open}`
      open += sub.open
    }
    doc.fill(ids[i],
      `<< /Title ${pdfTextString(node.title)} /Parent ${parentId} 0 R` +
      (i > 0 ? ` /Prev ${ids[i - 1]} 0 R` : '') +
      (i < ids.length - 1 ? ` /Next ${ids[i + 1]} 0 R` : '') +
      kids + (node.dest ? ` /Dest ${node.dest}` : '') + ' >>')
  })
  return { first: ids[0], last: ids[ids.length - 1], open }
}

/**
 * Write the outline tree — what a viewer's sidebar calls bookmarks.
 *
 * Every level ships EXPANDED (a positive /Count): an outline exists to show the
 * reader the shape of the document, and one that opens collapsed to a single row
 * shows them nothing.
 *
 * @param {ReturnType<createPdfDoc>} doc
 * @param {Array<{title:string, dest:(string|null), children:Array}>} nodes
 * @returns {number|null} the /Outlines object id, or null for an empty tree
 */
export function writeOutlines(doc, nodes) {
  if (!nodes || !nodes.length) return null
  const rootId = doc.reserve()
  const { first, last, open } = outlineLevel(doc, nodes, rootId)
  doc.fill(rootId, `<< /Type /Outlines /First ${first} 0 R /Last ${last} 0 R /Count ${open} >>`)
  return rootId
}

/**
 * Write a `/Dests` name tree — the named destinations that make `file.pdf#name`
 * work from outside the document, and that a cross-reference can point at.
 *
 * One node, no /Limits: the spec only requires balancing for trees big enough to
 * need it, and a document's headings do not reach that. Names MUST come out
 * sorted or a conforming reader binary-searches its way to the wrong entry —
 * sorted here by UTF-16 code unit, which is byte order for every name an `id`
 * attribute realistically holds.
 *
 * @param {ReturnType<createPdfDoc>} doc
 * @param {Array<[string, string]>} entries  `[name, destination array string]`
 * @returns {number|null} the name-tree object id, or null when there is nothing
 */
export function writeNameTree(doc, entries) {
  const list = [...entries].filter(([name]) => name).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  if (!list.length) return null
  return doc.add(`<< /Names [${list.map(([name, dest]) => `${pdfTextString(name)} ${dest}`).join(' ')}] >>`)
}

/**
 * Write the structure tree of a TAGGED PDF: `/StructTreeRoot`, one `/StructElem`
 * per node, and the `/ParentTree` that maps marked content back to it.
 *
 * The tree is the caller's — this file has no idea what an `H2` is or why one
 * paragraph follows another. What it owns is the shape PDF demands, and that
 * shape has one trap worth naming: **the parent tree is not optional and not a
 * convenience.** A reader walks structure downwards through `/K`, but it resolves
 * a click, a selection or a screen-reader cursor upwards from a marked-content id
 * on a page, and the only route back up is this tree. Written wrong, the file
 * looks perfectly tagged in a structure inspector and does nothing for the reader
 * it was made for.
 *
 * Content is referenced with explicit `/MCR` dictionaries rather than bare
 * integers, because a single structure element routinely spans pages here — a
 * paragraph cut by a page break is one paragraph — and a bare integer can only
 * mean "on this element's one `/Pg`".
 *
 * Annotations join the tree through the same two routes marked content does: an
 * `/OBJR` in the owning node's `/K` (downwards), and a `/StructParent` integer on
 * the annotation resolved through the `/ParentTree` (upwards). A mark entry of
 * the shape `{ objr, page }` — `objr` being the ANNOTATION's object id — writes
 * the first; the `annots` argument writes the second. Both are per-export state
 * and live outside the tree, for the same reason `marksOf` does.
 *
 * @param {ReturnType<createPdfDoc>} doc
 * @param {object} tree  the root node: `{ type, alt, lang, attrs, children }`,
 *   where a child is either another node or a mark `{ mcid, page }`, `page` being
 *   a page OBJECT ID. Marks and nodes share one list, in reading order. `attrs`
 *   is an optional `{ scope, colSpan, rowSpan }` written as a table-owner `/A`
 *   dictionary — `TH` scope is the reason it exists.
 * @param {number[]} structParents  per page index, the `/StructParents` key that
 *   page was given. Its position in this array is that page's index.
 * @param {Array<Array<object>>} owners  `owners[pageIndex][mcid]` is the node that
 *   owns that marked-content id on that page.
 * @param {Map<object, Array<{mcid:number, page:number}|{objr:number, page:number}>>}
 *   marksOf  the content each node owns, held OUTSIDE the tree on purpose: the
 *   tree is measured once per capture and a capture may be exported more than
 *   once, so writing marks into it would make the second export carry the first
 *   one's content as well.
 * @param {Array<{key:number, node:object}>} [annots]  `/StructParent` keys handed
 *   to annotations, each resolving to its owning node. Keys MUST continue past
 *   every page's `/StructParents` key: the parent tree is one number tree and a
 *   collision would route a widget's click to a paragraph.
 * @returns {number|null} the `/StructTreeRoot` id, or null when nothing was marked
 */
export function writeStructTree(doc, tree, structParents, owners, marksOf, annots = []) {
  if (!tree) return null
  const marks = (node) => marksOf.get(node) || []
  // A branch nobody marked describes nothing, and a reader that walks into one
  // finds an empty room. Pruned by reading, never by mutating the caller's tree.
  // Some semantic objects (notably an image-only Figure with /Alt) have no marked
  // text content by design. `keep` lets the structure collector retain those
  // meaningful leaves without inventing an MCID or a broken ParentTree entry.
  const alive = (node) => marks(node).length > 0 || node.keep === true || node.children.some(alive)
  const kept = tree.children.filter(alive)
  if (!kept.length) return null

  const rootId = doc.reserve()
  const ids = new Map()

  /** Depth-first, ids reserved before bodies so /P can point back at the parent. */
  const assign = (node) => {
    ids.set(node, doc.reserve())
    for (const child of node.children) if (alive(child)) assign(child)
  }
  for (const child of kept) assign(child)

  /** The table-owner attribute dictionary, when the node carries table facts. */
  const attrsOf = (node) => {
    const a = node.attrs
    if (!a) return ''
    const parts = []
    if (a.scope) parts.push(`/Scope /${a.scope}`)
    if (a.colSpan > 1) parts.push(`/ColSpan ${a.colSpan}`)
    if (a.rowSpan > 1) parts.push(`/RowSpan ${a.rowSpan}`)
    return parts.length ? ` /A << /O /Table ${parts.join(' ')} >>` : ''
  }

  const fill = (node, parentId) => {
    const id = ids.get(node)
    // The node's own words come before its nested structure. `buildStructure`
    // guarantees this is the whole story: a container that also carries loose text
    // gets an implicit paragraph, so no node ever interleaves the two.
    const kids = [
      ...marks(node).map(m => m.objr
        ? `<< /Type /OBJR /Pg ${m.page} 0 R /Obj ${m.objr} 0 R >>`
        : `<< /Type /MCR /Pg ${m.page} 0 R /MCID ${m.mcid} >>`),
      ...node.children.filter(alive).map(child => `${ids.get(child)} 0 R`),
    ]
    doc.fill(id,
      `<< /Type /StructElem /S /${node.type} /P ${parentId} 0 R` +
      (node.alt ? ` /Alt ${pdfTextString(node.alt)}` : '') +
      (node.lang ? ` /Lang ${pdfTextString(node.lang)}` : '') +
      attrsOf(node) +
      ` /K [${kids.join(' ')}] >>`)
    for (const child of node.children) if (alive(child)) fill(child, id)
  }
  for (const child of kept) fill(child, rootId)

  // The number tree, one entry per page that carries marked content. The array at
  // each key is indexed BY MCID, so a gap would misalign every id after it — the
  // caller hands these in already dense. Annotation keys follow the page keys —
  // a number tree's keys must come out ascending, and the caller allocates annot
  // keys past every page key, so appending keeps the order.
  const nums = []
  for (let p = 0; p < owners.length; p++) {
    const list = owners[p]
    if (!list || !list.length) continue
    nums.push(`${structParents[p]} [${list.map(n => `${ids.get(n)} 0 R`).join(' ')}]`)
  }
  let nextKey = structParents.length
  for (const { key, node } of annots) {
    if (!ids.has(node)) continue
    nums.push(`${key} ${ids.get(node)} 0 R`)
    if (key >= nextKey) nextKey = key + 1
  }
  const parentTree = doc.add(`<< /Nums [${nums.join(' ')}] >>`)

  doc.fill(rootId,
    `<< /Type /StructTreeRoot /K [${kept.map(c => `${ids.get(c)} 0 R`).join(' ')}] ` +
    `/ParentTree ${parentTree} 0 R /ParentTreeNextKey ${nextKey} >>`)
  return rootId
}

/**
 * False on runtimes without CompressionStream. The caller must consult it: with
 * no compression deflate() passes the bytes through, and a /Filter /FlateDecode
 * written over uncompressed bytes is an unreadable file, not a bigger one.
 */
export const canDeflate = typeof CompressionStream !== 'undefined'

/**
 * /FlateDecode reads a zlib stream — header and Adler-32 checksum included.
 * CompressionStream('deflate') emits exactly that; 'deflate-raw' emits the bare
 * deflate blocks and would corrupt every stream in the file, so the format name
 * here is load-bearing.
 */
export async function deflate(data) {
  const bytes = typeof data === 'string' ? latin1(data) : data
  if (!canDeflate) return bytes
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Base-14 font resources. Invisible text still needs plausible metrics for Tz. */
export const BASE14 = {
  'sans': 'Helvetica',
  'sans-bold': 'Helvetica-Bold',
  'sans-italic': 'Helvetica-Oblique',
  'sans-bolditalic': 'Helvetica-BoldOblique',
  'serif': 'Times-Roman',
  'serif-bold': 'Times-Bold',
  'serif-italic': 'Times-Italic',
  'serif-bolditalic': 'Times-BoldItalic',
  'mono': 'Courier',
  'mono-bold': 'Courier-Bold',
  'mono-italic': 'Courier-Oblique',
  'mono-bolditalic': 'Courier-BoldOblique',
}

/**
 * The Unicode font's /DW, in 1/1000 em: every CID advances exactly one em, so a
 * run's natural width is `codepoints × fontSize` and the caller can work out Tz
 * without measuring anything. Do not emit /W — per-CID widths would break that
 * identity and make pdf.js remeasure each glyph. Not exported: the identity is
 * the contract, and any value other than one em would be a different contract.
 */
const UNICODE_ADVANCE = 1000

/**
 * An invented name on purpose. Any name a viewer recognises as standard (Arial,
 * Helvetica, Times…) sends pdf.js down its standard-font branch, which rebuilds
 * ToUnicode with numeric values and truncates every astral codepoint — U+1F600
 * comes back as U+F600. PascalCase also keeps the viewer's "cannot load system
 * font" notice out of verify.mjs's lowercase-'snapdom' console filter.
 */
const UNICODE_NAME = 'SnapdomUnicode'

const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0')

/** ToUnicode destinations are UTF-16BE, so astral codepoints go out as a surrogate pair. */
function utf16be(cp) {
  if (cp <= 0xffff) return hex4(cp)
  const v = cp - 0x10000
  return hex4(0xd800 | (v >> 10)) + hex4(0xdc00 | (v & 0x3ff))
}

/**
 * One document-wide Type0 font for everything WinAnsi cannot address: CJK,
 * Cyrillic, Greek, Arabic, emoji. Nothing is embedded — the layer is invisible,
 * so no glyph is ever painted and extraction runs entirely off /ToUnicode.
 * Bold/serif/mono variants would be meaningless here and would cost one CID
 * table each, hence a single font.
 */
export function createUnicodeFont(doc) {
  const cids = new Map()
  let id = null
  let descId, cidId, toUniId

  // Registered on first use so a Latin-only document carries no dead objects.
  function ensure() {
    if (id !== null) return
    descId = doc.reserve()
    cidId = doc.reserve()
    toUniId = doc.reserve()
    // /ToUnicode belongs on the Type0; the descriptor belongs on the descendant.
    // Swapping them is the classic way to get "Base font is not specified".
    id = doc.add(
      `<< /Type /Font /Subtype /Type0 /BaseFont /${UNICODE_NAME} /Encoding /Identity-H ` +
      `/DescendantFonts [${cidId} 0 R] /ToUnicode ${toUniId} 0 R >>`
    )
  }

  /**
   * Returns a PDF hex string ready for `Tj`, or null when there is nothing to
   * write or the text cannot be represented at all — Identity-H's codespace is
   * two bytes wide. The empty case has to answer null before ensure(): `<>` is a
   * value the caller would happily emit, and it would drag a Type0 font, a
   * CIDFont, a descriptor and an empty CMap into a document that shows nothing.
   */
  function encode(text) {
    if (!text) return null
    ensure()
    let out = '<'
    const added = []
    // Codepoint-wise: a surrogate pair is one CID, which is what makes emoji work.
    for (const ch of text) {
      const cp = ch.codePointAt(0)
      let cid = cids.get(cp)
      if (cid === undefined) {
        if (cids.size >= 0xfffe) {
          // The caller drops the whole run, so nothing this run allocated may
          // survive: otherwise the same text is droppable or not depending on
          // what preceded it, and the CMap carries entries no Tj references.
          for (const done of added) cids.delete(done)
          return null
        }
        cid = cids.size + 1 // never 0 — CID 0 is .notdef and extracts as U+0000
        cids.set(cp, cid)
        added.push(cp)
      }
      out += hex4(cid)
    }
    return out + '>'
  }

  /** Call exactly once, after the last encode() and before doc.build(). */
  function finalize() {
    if (id === null) return

    doc.fill(cidId,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${UNICODE_NAME} ` +
      // Adobe-Identity-0 keeps pdf.js off the UCS2 branch, which would want a
      // CMap file fetched from disk and would fight our own ToUnicode.
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
      `/FontDescriptor ${descId} 0 R /DW ${UNICODE_ADVANCE} /CIDToGIDMap /Identity >>`
    )

    // All nine keys of PDF 1.7 Table 122. pdf.js needs none of them; Acrobat's
    // preflight rejects the font without them, and nothing reads the values
    // because no glyph is ever drawn. /Flags 4 = Symbolic, so viewers do not try
    // to reinterpret our CIDs through a standard encoding.
    doc.fill(descId,
      `<< /Type /FontDescriptor /FontName /${UNICODE_NAME} /Flags 4 ` +
      '/FontBBox [0 -250 1000 1000] /ItalicAngle 0 /Ascent 900 /Descent -250 ' +
      '/CapHeight 700 /StemV 80 >>'
    )

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
    const entries = [...cids].map(([cp, cid]) => `<${hex4(cid)}> <${utf16be(cp)}>`)
    // 100 per section is the spec's hard limit. pdf.js ignores it, Acrobat does not.
    for (let i = 0; i < entries.length; i += 100) {
      const chunk = entries.slice(i, i + 100)
      lines.push(`${chunk.length} beginbfchar`, ...chunk, 'endbfchar')
    }
    lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end')

    // Left uncompressed on purpose. ~14 bytes per codepoint raw, so even an
    // 800-glyph CJK page is 11 KB and deflates to 3 KB — under 1% of a page
    // image, against which finalize() would have to be async and every caller
    // would have to await it.
    doc.fillStream(toUniId, '', lines.join('\n'))
  }

  // 'FU' cannot collide with the caller's base-14 names, which are F0, F1, …
  return { name: 'FU', get id() { return id }, encode, finalize }
}

/**
 * How a pixel sits inside one 32-bit word of `ImageData`.
 *
 * Reading a pixel as a word instead of four bytes is what makes `survey` cheap,
 * and the byte order that word implies is the platform's, not the format's. Every
 * engine this ships to is little-endian; the big-endian constants exist so that a
 * platform which is not cannot read colour out of the wrong end and produce a
 * file whose pixels are silently rotated.
 */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1
const R_SHIFT = LITTLE_ENDIAN ? 0 : 24
const G_SHIFT = 8 + (LITTLE_ENDIAN ? 0 : 8)
const B_SHIFT = LITTLE_ENDIAN ? 16 : 8
const A_SHIFT = LITTLE_ENDIAN ? 24 : 0
/** `level * GREY_STEP | OPAQUE` is the word an opaque r = g = b pixel has to be. */
const GREY_STEP = LITTLE_ENDIAN ? 0x010101 : 0x01010100
const OPAQUE = LITTLE_ENDIAN ? 0xff000000 : 0x000000ff

/** ~4 MB of RGBA per read: enough to amortise the readback, small enough not to spike. */
function bandRows(width) {
  return Math.max(1, Math.floor((1 << 20) / Math.max(1, width)))
}

/**
 * Everything the encoder needs to know about a surface's pixels, learned in ONE
 * banded pass: whether anything is translucent, and the narrowest colour space
 * that reproduces the region exactly — together with the plane already written in
 * it, so the encoding pass has nothing left to read back.
 *
 * This used to be the alpha question alone, asked in its own full readback while
 * `toFlate` did a second one for the colour plane. Both walks visit the same
 * bytes, so they are one walk now — and what it comes back with is what lets the
 * colour plane shrink. MEASURED over this repo's fixtures, 22 of 29 page regions
 * are grey in EVERY pixel and 23 of 29 fit in 256 colours; either one is a THIRD
 * of the bytes of /DeviceRGB, losslessly, because 8-bit grey and a 256-entry
 * palette reproduce those exact pixels.
 *
 * **The walk narrows, it never widens back.** It starts assuming grey, which is
 * the cheapest thing to be — one comparison and one bit in a 32-byte table of the
 * levels seen — and pays for a palette only from the first coloured pixel
 * onwards. That order is the whole performance story: a first cut kept the
 * palette from pixel zero and cost 909 ms across a 46-region export, against
 * 348 ms for the alpha scan it replaced; paying for it only when a region is
 * actually coloured brings it back down, because most regions never are. When
 * colour does arrive, the greys already seen seed the palette in level order —
 * any deterministic order will do, since nothing outside this pass ever sees an
 * index — and the plane written so far is remapped in place.
 *
 * Every pixel is inspected. Sampling could miss the one hole a page really has
 * and flatten it silently, and it could equally miss the one coloured pixel that
 * makes a page not grey — a wrong answer there is not a slower export, it is a
 * different one, so `colorspace.html` fixes exactly that case.
 *
 * Peak memory is one band of RGBA plus the planes: at 3300×4678 that is 15 MB of
 * one-byte colour plane and, only when the capture has holes, 15 MB of alpha —
 * against the 62 MB of RGBA this deliberately never materialises, and the 46 MB
 * of /DeviceRGB the plane replaces. The palette's lookup is two-level for the
 * same reason: a flat 2^24 table is 16 MB, while 256 colours reach at most 256 of
 * its 4096 pages and a real page touches a handful.
 *
 * @param {boolean} [wantPlane=true] false when the caller has pinned a codec that
 *   reads no plane, so a region is not walked for an answer nobody will use.
 * @returns {{alpha: Uint8Array|null, space: 'gray'|'indexed'|'rgb',
 *   plane: Uint8Array|null, palette: number[]|null}} `plane` is one byte per pixel
 *   — a grey level or a palette index — and is null exactly when `space` is
 *   'rgb', which is the one case `toFlate` still has pixels left to read.
 */
function survey(ctx, width, height, wantPlane = true) {
  const count = width * height
  const rows = bandRows(width)
  let alpha = null
  let at = 0

  let space = wantPlane ? 'gray' : 'rgb'
  let plane = wantPlane && count ? new Uint8Array(count) : null
  /** Which of the 256 grey levels this region has drawn, for seeding a palette. */
  const greys = wantPlane ? new Uint8Array(256) : null
  /** 0xRRGGBB in assignment order; index 0 is the first entry. */
  let palette = null
  /** key >>> 12 → page holding (index + 1); 0 means "not seen in this region". */
  let pages = null

  /** Give up on one byte per pixel: the region drew more than a palette holds. */
  const widen = () => { space = 'rgb'; plane = null; palette = null; pages = null }

  /** Remember a colour, or answer that there is no room left for it. */
  const intern = (key) => {
    const page = pages[key >>> 12] || (pages[key >>> 12] = new Uint16Array(1 << 12))
    const slot = key & 0xfff
    if (page[slot]) return page[slot] - 1
    if (palette.length === 256) return -1
    palette.push(key)
    page[slot] = palette.length
    return palette.length - 1
  }

  /**
   * The first coloured pixel of a region that was grey until now. The greys
   * already drawn become the palette's opening entries and the plane, which holds
   * levels, is rewritten to hold their indices.
   */
  const openPalette = () => {
    const levels = []
    for (let v = 0; v < 256; v++) if (greys[v]) levels.push(v)
    // 256 greys already, plus the colour that got us here: nothing to gain.
    if (levels.length >= 256) return widen()
    space = 'indexed'
    palette = []
    pages = []
    const index = new Uint8Array(256)
    for (const v of levels) index[v] = intern((v << 16) | (v << 8) | v)
    for (let p = 0; p < at; p++) plane[p] = index[plane[p]]
  }

  for (let y = 0; y < height; y += rows) {
    const { data } = ctx.getImageData(0, y, width, Math.min(rows, height - y))
    // One word per pixel. `ImageData` has always handed back its own buffer from
    // offset zero, so the copy is a guard against a runtime that stops doing that
    // rather than a path anything has been seen to take.
    const px = data.byteOffset % 4 === 0
      ? new Uint32Array(data.buffer, data.byteOffset, data.byteLength >>> 2)
      : new Uint32Array(data.slice().buffer)
    for (let k = 0; k < px.length; k++, at++) {
      const v = px[k]
      const r = (v >>> R_SHIFT) & 255
      // The whole common case in one comparison: opaque, and grey at this level.
      // It answers the alpha question and the colour question at once, which is
      // why it is worth writing out rather than reading four bytes and asking
      // twice. Once a hole has been found the plane must record every alpha, so
      // the shortcut retires for the rest of the region.
      if (alpha === null && space === 'gray' && v === ((r * GREY_STEP | OPAQUE) >>> 0)) {
        greys[r] = 1
        plane[at] = r
        continue
      }
      const a = (v >>> A_SHIFT) & 255
      if (alpha) alpha[at] = a
      else if (a !== 255) {
        alpha = new Uint8Array(count).fill(255, 0, at)
        alpha[at] = a
      }
      if (space === 'rgb') continue
      const g = (v >>> G_SHIFT) & 255, b = (v >>> B_SHIFT) & 255
      if (space === 'gray') {
        if (r === g && g === b) { greys[r] = 1; plane[at] = r; continue }
        openPalette()
        if (space === 'rgb') continue
      }
      const slot = intern((r << 16) | (g << 8) | b)
      if (slot < 0) { widen(); continue }
      plane[at] = slot
    }
  }
  return { alpha, space, plane, palette }
}

/** What a surface looks like when nothing was surveyed: the widest space, no mask. */
const UNSURVEYED = { alpha: null, space: 'rgb', plane: null, palette: null }

/** The /ColorSpace a survey earned, written the way the image dictionary wants it. */
function flateSpace(seen) {
  if (seen.space === 'gray') return '/DeviceGray'
  if (seen.space !== 'indexed') return '/DeviceRGB'
  let hex = ''
  for (const key of seen.palette) hex += key.toString(16).padStart(6, '0')
  return `[/Indexed /DeviceRGB ${seen.palette.length - 1} <${hex}>]`
}

function blank(width, height) {
  return typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height })
}

/**
 * A background is only an escape hatch if it actually covers what it replaces.
 * A translucent one leaves the JPEG encoder compositing the remainder onto black,
 * and a value the CSS parser rejects leaves fillStyle wherever it was — either
 * way the user asked for a light page and gets black bleed with no explanation.
 * The canvas is the only colour parser in reach, so probe it from two different
 * sentinels: a real colour normalises to the same string from both, an invalid
 * one comes back as whichever sentinel preceded it.
 */
function flatten(canvas, background) {
  const out = blank(canvas.width, canvas.height)
  const ctx = out.getContext('2d')
  ctx.fillStyle = '#000000'
  ctx.fillStyle = background
  const parsed = ctx.fillStyle
  ctx.fillStyle = '#ffffff'
  ctx.fillStyle = background
  if (parsed !== ctx.fillStyle) {
    // The rejected value never took, so fillStyle is still the white sentinel.
    warn(`background ${background} is not a colour — falling back to white.`)
  } else {
    // Not a serialisation test: oklch(), color(), lab() and a gradient all come
    // back as themselves, and any pattern over the string calls them translucent.
    // One painted pixel answers for every syntax, and clearing it again keeps the
    // corner from carrying a second coat of a translucent fill.
    ctx.fillRect(0, 0, 1, 1)
    const opaque = ctx.getImageData(0, 0, 1, 1).data[3] === 255
    ctx.clearRect(0, 0, 1, 1)
    if (!opaque) {
      warn(`background ${background} is not opaque — what it does not cover composites onto black.`)
    }
  }
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(canvas, 0, 0)
  return out
}

/**
 * JPEG has no alpha, so every transparent pixel encodes as black and DCT ringing
 * drags that black back across the edge into pixels the /SMask will keep — a dark
 * halo the mask cannot remove, because there alpha is already 1. Smearing the
 * capture outwards first gives those pixels a neighbouring colour to ring against;
 * everything outside the shape is masked away regardless, so only the ringing
 * changes and the opaque body of the page is untouched by the final redraw.
 *
 * Smearing `out` into itself rather than `canvas` compounds the reach: every draw
 * in a round lands on the surface the earlier ones already extended, so a round of
 * radius r adds 3r and these three reach 3, 9 and 21px — measured, and past an 8×8
 * DCT block plus its 2× subsampled chroma, which is what bounds the ringing; a
 * fourth round at r=8 reaches 45px and measures the same inside the shape. It also
 * keeps every copy on one surface instead of re-uploading the capture 27 times.
 *
 * The centre offset is in the grid on purpose: compositing a translucent region
 * over itself converges on its un-premultiplied colour — the colour /SMask is
 * about to multiply the alpha back into — for anything but near-zero alpha, where
 * 8-bit premultiplied rounding drifts instead (from about α=0.25 down, and the
 * mask scales that error back down by the same α).
 */
function bleedEdges(canvas) {
  const out = blank(canvas.width, canvas.height)
  const ctx = out.getContext('2d')
  ctx.drawImage(canvas, 0, 0)
  for (const r of [1, 2, 4]) {
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) ctx.drawImage(out, dx * r, dy * r)
  }
  ctx.drawImage(canvas, 0, 0)
  return out
}

async function toJpeg(canvas, quality) {
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
    : await new Promise((resolve, reject) => canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/jpeg', quality
    ))
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * The colour plane as a losslessly deflated stream, in the narrowest colour space
 * the survey proved the region actually needs.
 *
 * A narrowed region arrives with its plane already built — `survey` wrote a grey
 * level or a palette index per pixel as it walked — so there is nothing here to
 * read back or repack: the bytes go straight into the compressor. That plane is
 * ONE byte per pixel instead of three, and the third is a third everywhere it
 * counts: a third to hand the compressor, and MEASURED over this repo's fixtures
 * 41% off the deflated bytes of a grey page and 48% off an indexed one. Nothing
 * is approximated to get it — `survey` says grey only when r === g === b in every
 * pixel, and offers a palette only when the region drew 256 colours or fewer — so
 * both planes reconstruct the original exactly, which `colorspace.html` asserts by
 * inflating them back and comparing pixel for pixel.
 *
 * /DeviceRGB is the remaining case and the only one that still reads pixels. It
 * is streamed band by band rather than built as a single w·h·3 buffer: at
 * 3300×4678 that buffer is 46 MB, and this file goes out of its way elsewhere not
 * to allocate a third of that. Peak there is one band.
 *
 * No /DecodeParms — that key describes a PNG predictor, and there is none. A
 * predictor was measured and it LOST on every page tested (prose 971 KB with an
 * up-filter against 711 KB without): page artwork is flat runs, which raw deflate
 * already eats, and the filter turns those runs into noise.
 */
async function toFlate(ctx, width, height, seen) {
  const cs = new CompressionStream('deflate')
  const out = new Response(cs.readable).arrayBuffer()
  const writer = cs.writable.getWriter()
  if (seen.plane) {
    await writer.ready
    writer.write(seen.plane)
  } else {
    const rows = bandRows(width)
    for (let y = 0; y < height; y += rows) {
      const h = Math.min(rows, height - y)
      const { data } = ctx.getImageData(0, y, width, h)
      const rgb = new Uint8Array(width * h * 3)
      for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
        rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2]
      }
      await writer.ready
      writer.write(rgb)
    }
  }
  await writer.close()
  return new Uint8Array(await out)
}

/**
 * Encode a canvas as an image XObject.
 *
 * `dict` is the XObject dictionary body without /Length. When `smask` is set the
 * caller must write it as its own stream object and append ` /SMask <id> 0 R` to
 * `dict` — this file mints no object ids of its own.
 *
 * **Which codec wins is content, not preference.** JPEG is the right answer for a
 * page of artwork and the wrong one for a page of prose, where DCT both inflates
 * the file and rings around every glyph. MEASURED on this repo's own fixtures at
 * scale 2, Flate in the space `survey` earned against JPEG q0.92: prose 473 KB vs
 * 1.69 MB, a 30-page report 8.7 MB vs 21.4, typography 19 KB vs 41, table 137 vs
 * 237, geometry 29 vs 41. The default therefore encodes BOTH and keeps the
 * smaller, which costs one extra encode and can never lose to either fixed
 * choice. `codec: 'jpeg' | 'flate'` pins it.
 *
 * Narrowing widened that gap rather than closing it: Flate now wins every fixture
 * in this repo, by between 1.7x and 3.6x. It has not been made to win everywhere
 * — a photographic region is neither grey nor 256 colours, so it narrows to
 * nothing and DCT can still be the smaller answer, which is exactly why the
 * comparison is still run.
 *
 * Flate is also LOSSLESS, so when it wins, `quality` stopped meaning anything —
 * the glyph edges in the page image are exactly the ones snapdom drew.
 *
 * @param {object} [options]
 * @param {number} [options.quality=0.92]  JPEG quality; ignored if Flate wins
 * @param {string|null} [options.background=null]
 * @param {'auto'|'jpeg'|'flate'} [options.codec='auto']
 */
export async function encodeImage(canvas, options = {}) {
  const { quality = 0.92, background = null, codec = 'auto' } = options
  const { width, height } = canvas
  const base = `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /BitsPerComponent 8`
  const jpegDict = `${base} /ColorSpace /DeviceRGB /Filter /DCTDecode`
  const flateDict = (seen) => `${base} /ColorSpace ${flateSpace(seen)} /Filter /FlateDecode`

  // A runtime with no CompressionStream cannot write the Flate candidate at all,
  // and a caller asking for it there gets told rather than handed a JPEG that
  // silently is not what they asked for.
  let want = codec === 'jpeg' || codec === 'flate' ? codec : 'auto'
  if (want === 'flate' && !canDeflate) {
    warn('codec "flate" needs CompressionStream, which this runtime has not — falling back to JPEG.')
    want = 'jpeg'
  }
  if (want === 'auto' && !canDeflate) want = 'jpeg'

  /**
   * The smaller of the two encodings of one surface, or the one that was asked for.
   *
   * The two candidates are run one after the other, and it is worth saying that
   * this was tried the other way and reverted. `Promise.all` over them is the
   * obvious optimisation — one hands the surface to the browser's DCT encoder,
   * the other reads its pixels and deflates them, and both look like work for
   * other threads. MEASURED on 1748x1497 regions: 75 ms sequential, 73 ms
   * concurrent. They do not overlap, because both begin by reading back the same
   * canvas and that readback serialises them.
   *
   * What `auto` costs and what it buys, MEASURED on a 44-page A4 report at
   * scale 2: the discarded JPEG candidate is 818 ms of a 4.0 s export, about a
   * fifth, and Flate won all 46 regions by 2.5x — 8.7 MB against 21.4. Page
   * artwork is flat runs and sharp edges, which is the worst case for DCT and the
   * best for deflate. Pinning `codec: 'jpeg'` cuts that fifth and multiplies the
   * file; that is the caller's trade to make, and it is why the default does not
   * make it for them.
   */
  const best = async (surface, forJpeg, seen) => {
    const asFlate = async () => ({
      dict: flateDict(seen),
      bytes: await toFlate(surface.getContext('2d'), width, height, seen),
    })
    if (want === 'flate') return asFlate()
    const jpeg = { dict: jpegDict, bytes: await toJpeg(forJpeg || surface, quality) }
    if (want === 'jpeg') return jpeg
    const flate = await asFlate()
    return flate.bytes.length < jpeg.bytes.length ? flate : jpeg
  }

  // Before the alpha pipeline: flattening settles the alpha question by itself,
  // and the smear that dominates this file's cost is skipped whole. The FLATTENED
  // surface is the one surveyed, because it is the one that will be encoded — a
  // background is exactly the kind of thing that turns a grey page colourful.
  // A pinned JPEG reads none of those answers, so it is not asked for them.
  if (background) {
    const flat = flatten(canvas, background)
    const seen = want === 'jpeg' ? UNSURVEYED : survey(flat.getContext('2d'), width, height)
    return { ...(await best(flat, null, seen)), smask: null }
  }

  const seen = survey(canvas.getContext('2d'), width, height, want !== 'jpeg')
  if (!seen.alpha) return { ...(await best(canvas, null, seen)), smask: null }

  // Transparency, so the colour plane needs a companion /SMask whichever codec
  // carries it. Only the JPEG candidate needs the smear: it exists to give DCT
  // ringing a neighbouring colour to ring against, and Flate does not ring.
  const colour = await best(canvas, want === 'flate' ? null : bleedEdges(canvas), seen)
  return {
    ...colour,
    smask: {
      dict: `${base} /ColorSpace /DeviceGray${canDeflate ? ' /Filter /FlateDecode' : ''}`,
      bytes: await deflate(seen.alpha),
    },
  }
}
