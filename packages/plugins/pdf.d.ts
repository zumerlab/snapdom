import type { SnapdomPlugin } from '@zumer/snapdom'

/** PDF page sizes supported by the exporter. Custom pairs are PDF points. */
export type PdfPageSize =
  | 'fit'
  | 'a3'
  | 'a4'
  | 'a5'
  | 'a6'
  | 'b4'
  | 'b5'
  | 'letter'
  | 'legal'
  | 'tabloid'
  | 'executive'
  | readonly [width: number, height: number]

export type PdfOrientation = 'portrait' | 'landscape'
export type PdfImageCodec = 'auto' | 'jpeg' | 'flate'
export type PdfBase14Family = 'sans' | 'serif' | 'mono'
/**
 * Furniture type. `'document'`, the default, is the body's own embedded face,
 * falling back to base-14 sans per string; the other three mean base-14.
 */
export type PdfFontFamily = 'document' | PdfBase14Family
export type PdfTextValue = string | number | null | undefined
export type PdfPageText = PdfTextValue | ((page: number, pages: number) => PdfTextValue)

export interface PdfTextBand {
  left?: PdfPageText
  center?: PdfPageText
  right?: PdfPageText
  /** Font size in PDF points. Default 9. */
  size?: number
  font?: PdfFontFamily
  /** Three- or six-digit hexadecimal colour. */
  color?: string
  /** Alias accepted by the runtime. */
  colour?: string
  /** Draw the separator rule. Default true. */
  rule?: boolean
  /** Space between the text and rule, in PDF points. Default 10. */
  gap?: number
}

export type PdfBand = string | ((page: number, pages: number) => PdfTextValue) | PdfTextBand | Element | null

export interface PdfPageNumbers {
  format?: (page: number, pages: number) => PdfTextValue
  align?: 'left' | 'center' | 'right'
  size?: number
  font?: PdfFontFamily
  color?: string
  colour?: string
}

export interface PdfTableOfContents {
  title?: string
  /** Outline depths to include. Default 3. */
  levels?: number
  size?: number
  font?: PdfFontFamily
  indent?: number
  dots?: boolean
  /** Formats the body page number printed by the index. */
  label?: (page: number, bodyPages: number) => PdfTextValue
  color?: string
  colour?: string
  leaderColor?: string
  leaderColour?: string
}

export interface PdfTextWatermark {
  text: string
  opacity?: number
  angle?: number
  /** Zero or omitted auto-fits the text to the page. */
  size?: number
  font?: PdfFontFamily
  color?: string
  colour?: string
}

export interface PdfElementWatermark {
  element: Element
  opacity?: number
  angle?: number
  /** Fraction of the page's limiting dimension. Default 0.6. */
  fit?: number
}

export type PdfWatermark = string | Element | PdfTextWatermark | PdfElementWatermark | null

/** Document properties written to /Info and mirrored into the XMP packet. */
/**
 * Permission flags. Every one defaults to true, and every one is ADVISORY: a
 * viewer may honour it and any other tool may ignore it. Only `userPassword`
 * protects anything. Extraction for accessibility is deliberately not offered:
 * PDF 2.0 deprecates that bit and PDF/UA requires an encrypted file to keep
 * permitting it.
 */
export interface PdfPermissions {
  print?: boolean
  modify?: boolean
  copy?: boolean
  annotate?: boolean
  fillForms?: boolean
  assemble?: boolean
  printHighRes?: boolean
}

export interface PdfEncryption {
  /** Required, non-empty: without it the reader cannot open the file at all. */
  userPassword: string
  /** Lifts the permission flags. Defaults to the user password. */
  ownerPassword?: string
  permissions?: PdfPermissions
}

export interface PdfDocumentMeta {
  title?: string
  author?: string
  subject?: string
  keywords?: string | readonly string[]
  /** The producing APPLICATION (xmp:CreatorTool); Producer is always snapdom-pdf. */
  creator?: string
  /**
   * Written only when given: an invented "now" would break byte determinism.
   * Pass new Date() yourself when you want it.
   */
  created?: Date | string
  modified?: Date | string
}

export type PdfProgressPhase = 'measure' | 'page' | 'matter' | 'assemble'

export interface PdfProgress {
  phase: PdfProgressPhase
  /** Pages done in this phase, or null when the phase has no count. */
  done: number | null
  /** Body page total, or null before pagination knows it. */
  total: number | null
}

/** One warning, carrying its stable machine-readable code. */
export interface PdfWarning {
  code: string
  message: string
}

/** One face whose font program travels in the document. */
export interface PdfEmbeddedFont {
  /** The /BaseFont name; a subset carries the `AAAAAA+` tag PDF 9.6.4 asks for. */
  name: string
  /** The CSS-facing request this face answered, e.g. `"Inter" 700`. */
  label: string
  /** Size of the embedded program before stream compression. */
  kB: number
  /** true when only the used glyphs travel; false when the whole file does. */
  subset: boolean
}

/** Everything gateable about a finished export. Identical exports produce identical reports. */
export interface PdfReport {
  warnings: readonly PdfWarning[]
  /** Warning tallies keyed by code. */
  counts: Readonly<Record<string, number>>
  pages: number
  bytes: number
  /** Fillable fields written. */
  fields: number
  /** Link and widget annotations written. */
  annotations: number
  /** Faces embedded from the capture's own @font-face rules, subset or whole. */
  fontsEmbedded: readonly PdfEmbeddedFont[]
  /**
   * true when this export EARNED and wrote the PDF/UA-1 identifier: every
   * text operation on an embedded face, tagged structure, a language, a
   * displayed title, and no painted image without alternative text. Never
   * configurable; the `ua-withheld` warning names the blockers when false.
   */
  pdfua: boolean
  /** Text runs `vectorText` painted as real glyphs. 0 when it is off. */
  vectorText: number
}

/** Options evaluated when a finished SnapDOM capture is exported. */
export interface PdfExportOptions {
  page?: PdfPageSize
  orientation?: PdfOrientation
  /** Margin on all sides, in PDF points. Ignored by page: 'fit'. */
  margin?: number
  text?: boolean
  links?: boolean
  /**
   * Draw raster/XObject content. false keeps enabled text, links and structure,
   * but omits Element headers, footers and watermarks.
   */
  image?: boolean
  /** Compress PDF content streams. Default true. */
  deflate?: boolean
  /** Quality of the JPEG candidate. Ignored when lossless Flate wins. */
  quality?: number
  codec?: PdfImageCodec
  /** Flatten the capture onto this colour for this PDF export. */
  backgroundColor?: string | null
  header?: PdfBand
  footer?: PdfBand
  pageNumbers?: boolean | PdfPageNumbers
  repeatHeaders?: boolean
  /** Emit a PDF structure tree. Structure alone is not a PDF/UA-1 claim; see `PdfReport.pdfua`. */
  tagged?: boolean
  /** PDF document language, for example "en" or "es-MX". */
  lang?: string | null
  /**
   * Embed the capture's @font-face binaries and point the text at them. `true`
   * (default) subsets each face to the glyphs the document drew; `'full'`
   * embeds whole files; `false` embeds nothing. Needs the capture to carry its
   * fonts: snapdom's own `embedFonts: true` capture option.
   */
  embedFonts?: boolean | 'full'
  /**
   * Paint eligible text as real vector glyphs from the embedded fonts instead
   * of leaving it invisible over the raster, crisp at any zoom. Only faithful
   * where no shaping intervenes (left-to-right runs in an embedded face), so
   * RTL and uncovered runs stay on the raster. Pair with `image: false` for a
   * tiny, fully-vector text PDF; with `image: true` the glyphs overpaint the
   * raster. Default false.
   */
  vectorText?: boolean
  cover?: Element | null
  back?: Element | null
  toc?: boolean | string | PdfTableOfContents | null
  watermark?: PdfWatermark
  debugText?: boolean
  /** A filename, or true for "snapdom.pdf". The Blob is always returned. */
  download?: boolean | string
  /**
   * Emit measured form controls as fillable AcroForm fields. Default true.
   * false keeps their values in the invisible text layer instead.
   */
  fields?: boolean
  /** Document properties: /Info, XMP, and DisplayDocTitle when title is set. */
  meta?: PdfDocumentMeta | null
  /**
   * Encrypt the file with AES-256 (standard security handler, revision 6), so
   * the download itself is protected at rest. `userPassword` is required: a PDF
   * with an empty one is encrypted and still opens without asking.
   */
  encrypt?: PdfEncryption | null
  /** Abort the export between pages. Rejects with the signal's AbortError. */
  signal?: AbortSignal
  /** Progress narration; a throwing callback is dropped, never fatal. */
  onProgress?: (progress: PdfProgress) => void
  /** Receives the structured diagnostics report after the Blob is finished. */
  onReport?: (report: PdfReport) => void

  /** @deprecated Capture resolution belongs to snapdom(...), not toPdf(...). */
  scale?: never
  /** @deprecated Use deflate for PDF streams; SnapDOM owns compress. */
  compress?: never
  /** @deprecated Use download; SnapDOM owns filename. */
  filename?: never
  /** @deprecated Use backgroundColor. */
  background?: never
}

/**
 * Defaults accepted by pdf(). The first five options are capture-time and cannot
 * be changed by a later toPdf() call. Every PdfExportOptions field may also be a
 * factory default and can then be overridden by toPdf().
 */
export interface PdfPluginOptions extends PdfExportOptions {
  formValues?: boolean
  shadow?: boolean
  breakAvoid?: boolean
  /** true for h1-h6/role=heading, a selector string, or false. */
  outline?: boolean | string
  /** Measure form controls for fillable fields. Default true. Capture-time. */
  forms?: boolean
}

/** Create a PDF plugin for @zumer/snapdom >=3.0.0 <4. */
declare function pdf(defaults?: PdfPluginOptions): SnapdomPlugin

export { pdf }
export default pdf

declare module '@zumer/snapdom' {
  interface CaptureResult {
    /** Export this already-created capture as a PDF Blob. */
    toPdf(options?: PdfExportOptions): Promise<Blob>
  }
}
