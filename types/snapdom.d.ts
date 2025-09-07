/**
 * snapDOM – ultra-fast DOM-to-image capture
 * TypeScript definitions
 *
 * Notes:
 * - Style compression is always enabled internally (no user option).
 * - Icon fonts are always embedded; `embedFonts` controls non-icon fonts only.
 */

export type RasterMime = "png" | "jpg" | "jpeg" | "webp";
export type BlobType = "svg" | RasterMime;

export type IconFontMatcher = string | RegExp;

export interface LocalFontDescriptor {
  /** CSS font-family name (e.g. "Inter") */
  family: string;
  /** URL to the font source (woff2/woff/ttf). Data URLs are allowed. */
  src: string;
  /** CSS font-weight value (e.g. 400, "bold"). */
  weight?: string | number;
  /** CSS font-style value (e.g. "normal", "italic"). */
  style?: string;
  /** CSS font-stretch as percentage (e.g. 100 for normal). */
  stretchPct?: number;
}

export interface CaptureOptions {
  /**
   * Skip small idle delays for faster overall capture on some browsers.
   * Default: true
   */
  fast?: boolean;

  /**
   * Inline non-icon fonts that are detected as used within the captured subtree.
   * Icon fonts are always embedded.
   * Default: false
   */
  embedFonts?: boolean;

  /**
   * Additional local fonts to be considered during embedding.
   */
  localFonts?: LocalFontDescriptor[];

  /**
   * Extra icon font family matchers (by name or regex). Helpful for custom icon sets.
   */
  iconFonts?: IconFontMatcher | IconFontMatcher[];

  /**
   * Output scale multiplier. If set, takes precedence over width/height.
   * Default: 1
   */
  scale?: number;

  /**
   * Device pixel ratio to use for raster exports.
   * Default: `window.devicePixelRatio` at capture time.
   */
  dpr?: number;

  /** Target width for the exported image. Ignored if `scale` is provided. */
  width?: number;

  /** Target height for the exported image. Ignored if `scale` is provided. */
  height?: number;

  /** Fallback color for JPG/WebP exports (no alpha). Default: "#fff". */
  backgroundColor?: string;

  /** Quality for JPG/WebP (0..1). Default: 1. */
  quality?: number;

  /**
   * Proxy base URL used as a fallback for CORS-restricted images/fonts.
   * Example: "https://corsproxy.io/?url="
   */
  useProxy?: string;

  /** Preferred Blob type for `toBlob`. Default: "svg". */
  type?: BlobType;

  /**
   * CSS selectors for elements to exclude entirely from capture.
   * They are removed from the cloned subtree before processing.
   */
  exclude?: string[];

  /**
   * Advanced filter; return false to exclude a node.
   * Applied to the cloned subtree during traversal.
   */
  filter?: (el: Element) => boolean;

  /**
   * Reset mode for internal caches at the beginning of capture.
   * - "soft" (default): clear ephemeral/session caches (computed styles, per-capture maps).
   * - "hard": clear all caches including images/resources/fonts/base styles.
   * - "none": do not reset anything (fastest, may reuse stale resources).
   */
  reset?: "soft" | "hard" | "none";

  /**
   * Fallback image source when an <img> fails to load.
   * - String: use as-is.
   * - Callback: receives measured width/height and original src, returns a URL string.
   */
  defaultImageUrl?:
        | string
        | ((args: {
        width?: number;
        height?: number;
        src?: string;
        element: HTMLImageElement;
    }) => string | Promise<string>);
}

export interface BlobOptions {
  /** Blob type to export. Default: "svg". */
  type?: BlobType;
  /** JPG/WebP quality (0..1). */
  quality?: number;
  /** Background override for lossy formats. */
  backgroundColor?: string;
}

export interface DownloadOptions {
  /** File format. Default: "png". */
  format?: "svg" | RasterMime;
  /** Base filename without extension. Default: "capture". */
  filename?: string;
  /** Background override for lossy formats. */
  backgroundColor?: string;
  /** Quality for JPG/WebP (0..1). */
  quality?: number;
}

export interface CaptureResult {
  /** SVG data URL representing the captured element. */
  url: string;
  /** Returns the raw SVG markup as string. */
  toRaw(): string;
  /** Creates an HTMLImageElement from the SVG. */
  toImg(): Promise<HTMLImageElement>;
  /** Renders into a Canvas element (sized appropriately). */
  toCanvas(): Promise<HTMLCanvasElement>;
  /** Exports to a Blob (SVG/PNG/JPG/WebP). */
  toBlob(options?: BlobOptions): Promise<Blob>;
  /** Convenience PNG export (returns an <img>). */
  toPng(options?: { backgroundColor?: string; quality?: number }): Promise<HTMLImageElement>;
  /** Convenience JPG export (returns an <img>). */
  toJpg(options?: { backgroundColor?: string; quality?: number }): Promise<HTMLImageElement>;
  /** Convenience WebP export (returns an <img>). */
  toWebp(options?: { backgroundColor?: string; quality?: number }): Promise<HTMLImageElement>;
  /** Triggers a file download. */
  download(options?: DownloadOptions): Promise<void>;
}

/**
 * Capture an element and return reusable export helpers.
 */
export declare function snapdom(el: Element, options?: CaptureOptions): Promise<CaptureResult>;

export declare namespace snapdom {
  function toImg(el: Element, options?: CaptureOptions): Promise<HTMLImageElement>;
  function toCanvas(el: Element, options?: CaptureOptions): Promise<HTMLCanvasElement>;
  function toBlob(el: Element, options?: CaptureOptions & BlobOptions): Promise<Blob>;
  function toPng(el: Element, options?: CaptureOptions): Promise<HTMLImageElement>;
  function toJpg(el: Element, options?: CaptureOptions): Promise<HTMLImageElement>;
  function toWebp(el: Element, options?: CaptureOptions): Promise<HTMLImageElement>;
  function download(el: Element, options?: CaptureOptions & DownloadOptions): Promise<void>;
}

/**
 * Preload resources (images/fonts) to avoid first-capture stalls.
 */
export interface PreCacheOptions {
  /** Root element to scan. Default: document.body. */
  root?: Element | Document;
  /** Inline non-icon fonts during preload. Default: true. */
  embedFonts?: boolean;
  /** Additional local fonts. */
  localFonts?: LocalFontDescriptor[];
  /** Proxy for CORS fallbacks. */
  useProxy?: string;
}

export declare function preCache(options?: PreCacheOptions): Promise<void>;

export {};
