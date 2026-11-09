/**
 * Document identity: the /Info dictionary, the XMP metadata stream, and the
 * viewer preference that makes a title actually show.
 *
 * Two facts shape this file.
 *
 * **Dates are opt-in.** The byte-determinism promise — same capture, same
 * options, same bytes — is asserted by the release gate, and `new Date()` here
 * would break it silently. So `created`/`modified` are written when the caller
 * passes them and never invented. A caller who wants "now" writes `new Date()`
 * themselves, visibly, at the call site.
 *
 * **The /ID is content, not chance.** The trailer /ID comes from a hash of the
 * file's own bytes (see the writer), so "is this the same document?" is
 * answerable by any tool without this plugin's help.
 *
 * Producer names the software and never the document, which is why it is not an
 * option: a knob that exists only to misattribute the generator is not a feature.
 */
import { pdfTextString } from '../writer/index.js'

const PRODUCER = 'snapdom-pdf'

const META_KEYS = ['title', 'author', 'subject', 'keywords', 'creator', 'created', 'modified']

/**
 * Validate and normalise the `meta` export option.
 *
 * @param {object|null} meta  `{ title, author, subject, keywords, creator,
 *   created, modified }` — all optional. `keywords` may be a string or an array
 *   of strings. Dates may be `Date` instances or ISO-8601 strings.
 * @param {(msg: string) => void} report
 * @returns {object|null} the normalised spec, or null when nothing usable was given
 */
export function metaSpec(meta, report) {
  if (meta == null) return null
  if (typeof meta !== 'object' || Array.isArray(meta)) {
    throw new TypeError('[snapdom-pdf] meta must be an object of document properties')
  }
  const out = {}
  for (const key of Object.keys(meta)) {
    if (!META_KEYS.includes(key)) {
      report(`meta.${key} is not a document property — ` +
        `the properties are ${META_KEYS.join(', ')}. Ignored.`)
    }
  }
  for (const key of ['title', 'author', 'subject', 'creator']) {
    if (meta[key] == null) continue
    const value = String(meta[key]).trim()
    if (value) out[key] = value
  }
  if (meta.keywords != null) {
    const list = Array.isArray(meta.keywords) ? meta.keywords : [meta.keywords]
    const joined = list.map(k => String(k).trim()).filter(Boolean).join(', ')
    if (joined) out.keywords = joined
  }
  for (const key of ['created', 'modified']) {
    if (meta[key] == null) continue
    const date = meta[key] instanceof Date ? meta[key] : new Date(String(meta[key]))
    if (Number.isNaN(date.getTime())) {
      report(`meta.${key} is not a date this plugin can read — pass a Date or an ISO-8601 string. Ignored.`)
      continue
    }
    out[key] = date
  }
  return Object.keys(out).length ? out : null
}

/** A `Date` as the spec's `D:YYYYMMDDHHmmSS` form, in UTC so the bytes do not
 * depend on the timezone of whoever exported. */
function pdfDate(date) {
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `D:${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
}

/**
 * The /Info dictionary body. Written even when the caller gave no `meta`,
 * because /Producer is how a triaged support case tells this exporter's files
 * from another tool's.
 */
export function infoDict(spec) {
  const parts = [`/Producer ${pdfTextString(PRODUCER)}`]
  const names = {
    title: 'Title', author: 'Author', subject: 'Subject',
    keywords: 'Keywords', creator: 'Creator',
  }
  for (const [key, name] of Object.entries(names)) {
    if (spec?.[key]) parts.push(`/${name} ${pdfTextString(spec[key])}`)
  }
  if (spec?.created) parts.push(`/CreationDate (${pdfDate(spec.created)})`)
  if (spec?.modified) parts.push(`/ModDate (${pdfDate(spec.modified)})`)
  return `<< ${parts.join(' ')} >>`
}

const xml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The XMP packet mirroring /Info — what Bridge, Spotlight importers, DAM
 * systems and every post-2001 Adobe tool actually read. Deliberately carries NO
 * `pdfuaid:part`: this plugin's tagging is real but its fonts are not embedded,
 * and a conformance identifier is a claim, not a decoration.
 *
 * Uncompressed by spec: an XMP packet must be scannable by tools that do not
 * parse PDF, which is the whole reason it exists twice.
 */
export function xmpPacket(spec, lang, { pdfua = false } = {}) {
  const dcLang = lang || 'x-default'
  const items = []
  // Written ONLY when the export verified its own eligibility: every text
  // operation on an embedded face, structure tagged, language set, title
  // displayed. An identifier a validator can refute is worse than none.
  if (pdfua) items.push('  <pdfuaid:part>1</pdfuaid:part>')
  if (spec?.title) {
    items.push(`  <dc:title><rdf:Alt><rdf:li xml:lang="${xml(dcLang)}">${xml(spec.title)}</rdf:li></rdf:Alt></dc:title>`)
  }
  if (spec?.author) {
    items.push(`  <dc:creator><rdf:Seq><rdf:li>${xml(spec.author)}</rdf:li></rdf:Seq></dc:creator>`)
  }
  if (spec?.subject) {
    items.push(`  <dc:description><rdf:Alt><rdf:li xml:lang="${xml(dcLang)}">${xml(spec.subject)}</rdf:li></rdf:Alt></dc:description>`)
  }
  if (spec?.keywords) {
    items.push(`  <pdf:Keywords>${xml(spec.keywords)}</pdf:Keywords>`)
  }
  if (spec?.creator) items.push(`  <xmp:CreatorTool>${xml(spec.creator)}</xmp:CreatorTool>`)
  if (spec?.created) items.push(`  <xmp:CreateDate>${spec.created.toISOString()}</xmp:CreateDate>`)
  if (spec?.modified) items.push(`  <xmp:ModifyDate>${spec.modified.toISOString()}</xmp:ModifyDate>`)
  items.push(`  <pdf:Producer>${xml(PRODUCER)}</pdf:Producer>`)

  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"${pdfua ? `
    xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"` : ''}>
${items.join('\n')}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}
