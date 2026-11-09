/**
 * Structured diagnostics: the same honesty the console already gets, made
 * machine-readable.
 *
 * Every fidelity loss this exporter can name is already a sentence somewhere in
 * the pipeline — clipped runs, unresolved links, a thead too tall to repeat.
 * What a CI gate needs is not a different sentence but a STABLE NAME for it, so
 * "fail the build when the PDF lost annotations" is a filter and not a regex an
 * integrator maintains against our prose.
 *
 * The names are assigned here, in one table, by classifying the finished
 * message. Classifying beats threading a code through thirty call sites for one
 * reason: the sentence and the code can never disagree about which warning this
 * is, because the sentence IS the key. The cost is that rewording a message
 * means touching its pattern here — which is exactly the reminder a stable
 * contract needs.
 *
 * `code` values are the public contract and follow `area-what`:
 *
 *   page-fallback      an unknown paper name fell back to A4
 *   layout-split       a block or field had to be split across a page break
 *   layout-break       a declared page break could not be honoured
 *   layout-repeat      a table header could not repeat
 *   text-clipped       runs/links dropped by clip or overflow — fail-safe
 *   text-invisible     runs/links dropped as invisible or degenerate
 *   text-effects       runs/links omitted under unmappable visual effects
 *   text-off-page      runs land outside the page box
 *   text-overflow      the Type0 font ran out of codepoints
 *   link-unsafe        malformed URL or unsafe protocol
 *   link-unresolved    fragment with no destination in the capture
 *   link-cropped       annotation cropped to its visible area
 *   dest-collision     a matter page reused a body destination name
 *   geometry-approx    transforms/zoom/SVG placed approximately
 *   shadow-closed      unreachable closed shadow roots
 *   content-skipped    content-visibility may have skipped content
 *   raster-limit       the capture exceeds browser bitmap ceilings
 *   image-off          image:false omitted an element band or watermark
 *   fit-furniture      furniture/matter options that need pagination on 'fit'
 *   toc-empty          a contents page was asked for with no headings
 *   toc-raster         index lines drawn from the heading's own pixels
 *   furniture-script   base-14 furniture cannot represent its script
 *   quality-noop       lowered quality reached nothing (Flate won)
 *   flate-off          Flate unavailable in this runtime
 *   no-lang            tagged output without a document language
 *   field-skipped      a control did not become a fillable field
 *   field-password     password fields written empty, flagged, never valued
 *   field-appearance   a field's appearance is approximate or viewer-drawn
 *   field-name         duplicate field names were uniquified
 *   font-embedded      the faces whose whole file travels in the document
 *   font-fallback      a face that could not be embedded, and its reason
 *   font-coverage      runs whose embedded face lacks some glyph — fallback
 *   vector-painted     runs drawn as real vector glyphs from the embedded fonts
 *   vector-missed      vector text asked for but a run could not be painted
 *   ua-claimed         the export verified and wrote its PDF/UA-1 identifier
 *   ua-withheld        fonts are clean but a named blocker stops the claim
 *   option-misplaced   a capture-time option was passed at export
 *   option-unknown     an option or property this plugin does not have
 *   capture-empty      the capture has no layout box
 *   other              a warning this table does not name yet
 *
 * An unmatched message is a bug in this table, not in the caller; it still
 * reaches the report as `other` rather than being dropped.
 */

const RULES = [
  [/the document is encrypted with AES-256/, 'encrypted'],
  [/is not a permission — ignored/, 'encrypt-option'],
  [/is not a usable size|unknown page size/, 'page-fallback'],
  [/block\(s\) had to be split|field annotation\(s\) straddle/, 'layout-split'],
  [/page break\(s\) could not be honoured/, 'layout-break'],
  [/header is more than half a page tall/, 'layout-repeat'],
  [/crossing the snapdom clip edge|dropped because an overflow clip/, 'text-clipped'],
  [/dropped because their paint is invisible/, 'text-invisible'],
  [/omitted because a visual effect/, 'text-effects'],
  [/land outside the page box/, 'text-off-page'],
  [/more than 65,534 distinct codepoints/, 'text-overflow'],
  [/URL is malformed or uses an unsafe protocol/, 'link-unsafe'],
  [/point outside the final captured tree|got no annotation/, 'link-unresolved'],
  [/link annotation\(s\) cropped/, 'link-cropped'],
  [/destination name collision/, 'dest-collision'],
  [/non-identity transform|off-centre origin|without a screen CTM|upright glyphs|zoom on an ancestor|axis-aligned/, 'geometry-approx'],
  [/closed shadow root/, 'shadow-closed'],
  [/content-visibility/, 'content-skipped'],
  [/raster pixels wide|image limit/, 'raster-limit'],
  [/omitted because image:false/, 'image-off'],
  [/need a paginated page size|does nothing on page:'fit'/, 'fit-furniture'],
  [/no headings to put in one/, 'toc-empty'],
  [/heading's own pixels/, 'toc-raster'],
  [/furniture could not be drawn|cannot represent its script/, 'furniture-script'],
  [/quality .* changed nothing/, 'quality-noop'],
  [/Flate|CompressionStream/, 'flate-off'],
  [/no `lang`/, 'no-lang'],
  [/did not become a fillable field|field\(s\) skipped/, 'field-skipped'],
  [/password field\(s\) written empty/, 'field-password'],
  [/appearance|NeedAppearances/, 'field-appearance'],
  [/duplicate field name/, 'field-name'],
  [/^fonts embedded:/, 'font-embedded'],
  [/none reached the capture/, 'font-fallback'],
  [/stays searchable but is not embedded/, 'font-fallback'],
  [/characters their embedded face lacks/, 'font-coverage'],
  [/painted as real vector glyphs/, 'vector-painted'],
  [/could not be painted as vector/, 'vector-missed'],
  [/^document claims PDF\/UA-1/, 'ua-claimed'],
  [/^PDF\/UA-1 claim withheld/, 'ua-withheld'],
  [/decided when the capture measures/, 'option-misplaced'],
  [/is not a PDF option|is not a document property/, 'option-unknown'],
  [/capture element has no layout box/, 'capture-empty'],
]

/** One warning sentence → its stable code. */
export function classify(message) {
  for (const [pattern, code] of RULES) {
    if (pattern.test(message)) return code
  }
  return 'other'
}

/**
 * The object `onReport` receives — everything a caller can gate on, and nothing
 * that varies between identical exports. Timing is deliberately absent: two
 * identical exports must produce two identical reports, or the report cannot sit
 * in a snapshot test.
 *
 * @param {object} args
 * @param {string[]} args.messages  every warning, in emission order
 * @param {number} args.pages  page count, front and back matter included
 * @param {number} args.bytes  the finished blob's size
 * @param {number} args.fields  fillable fields written
 * @param {number} args.annotations  link annotations written
 */
export function buildReport({
  messages, pages, bytes, fields = 0, annotations = 0, fontsEmbedded = [], pdfua = false,
  vectorText = 0,
}) {
  const warnings = messages.map(message => ({ code: classify(message), message }))
  const counts = {}
  for (const w of warnings) counts[w.code] = (counts[w.code] || 0) + 1
  return { warnings, counts, pages, bytes, fields, annotations, fontsEmbedded, pdfua, vectorText }
}

/** Validate the option before any expensive work runs. */
export function reportSpec(onReport) {
  if (onReport == null) return null
  if (typeof onReport !== 'function') {
    throw new TypeError('[snapdom-pdf] onReport must be a function')
  }
  return onReport
}
