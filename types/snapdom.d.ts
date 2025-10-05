/**
 * snapDOM – ultra-fast DOM-to-image capture
 * TypeScript definitions (v1.9.10-dev.2)
 *
 * Notes:
 * - Style compression is internal (no public option).
 * - Icon fonts are always embedded; `embedFonts` controls non-icon fonts only.
 */

export type RasterMime = "png" | "jpg" | "jpeg" | "webp";
export type BlobType = "svg" | RasterMime;

export type IconFontMatcher = string | RegExp;
export type CachePolicy = "disabled" | "full" | "auto" | "soft";

export type ExcludeMode = 'hide' | 'remove';
export type FilterMode = 'hide' | 'remove';

export interface LocalFontDescriptor {
  /** CSS font-family name (e.g. "Inter"). */
  family: string;
  /** URL to the font source (woff2/woff/ttf). Data URLs allowed. */
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
   * Enable additional internal logs.
   * Default: false
   */
  debug?: boolean;

  /**
   * Skip small idle delays for faster overall capture.
   * Default: true
   */
  fast?: boolean;

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

  /**
   * Fallback color for lossy raster formats (JPG/WebP have no alpha).
   * Default: "#ffffff" for JPG/JPEG/WebP, `null` otherwise.
   */
  backgroundColor?: string | null;

  /**
   * Quality for JPG/WebP (0..1).
   * Default: 0.92
   */
  quality?: number;

  /**
   * Proxy base URL used as a fallback for CORS-restricted images/fonts.
   * Example: "https://corsproxy.io/?url="
   */
  useProxy?: string;

  /** Preferred Blob type for `toBlob`. Default: "svg". */
  type?: BlobType;

  /**
   * Preferred export format used by convenience methods / download.
   * Default: "png"
   */
  format?: BlobType;

  /** CSS selectors removed from the cloned subtree before processing. */
  exclude?: string[];

  /**
   * Mode applied to excluded nodes of the cloned tree.
   * Default: "hide"
   */
  excludeMode?: ExcludeMode;

  /**
   * Advanced node filter; return false to exclude a node during traversal.
   * Applied to the cloned subtree.
   */
  filter?: (el: Element) => boolean;

  /**
   * Mode applied to filtered nodes of the cloned tree.
   * Default: "hide"
   */
  filterMode?: FilterMode;

  /**
   * Whether to synthesize placeholders for broken images, etc.
   * Default: true
   */
  placeholders?: boolean;

  /**
   * Inline non-icon fonts used within the captured subtree.
   * Icon fonts are always embedded.
   * Default: false
   */
  embedFonts?: boolean;

  /**
   * Additional local fonts to be considered during embedding.
   */
  localFonts?: LocalFontDescriptor[];

  /**
   * Extra icon font family matchers (by name or regex).
   */
  iconFonts?: IconFontMatcher | IconFontMatcher[];

  /**
   * Font family matchers to explicitly exclude from embedding.
   */
  excludeFonts?: IconFontMatcher[];

  /**
   * Fallback image source when an <img> fails to load.
   * - String: use as-is.
   * - Callback: receives measured width/height and original src, returns a URL string.
   */
  fallbackURL?:
    | string
    | ((
        args: {
          width?: number;
          height?: number;
          src?: string;
          element: HTMLImageElement;
        }
      ) => string | Promise<string>);

  /**
   * Cache policy applied at capture start.
   * Default: "soft"
   */
  cache?: CachePolicy;

  /**
   * Base filename used by `download`.
   * Default: "snapDOM"
   */
  filename?: string;

  /**
   * Normalize only translate*rotate* on the cloned root (keeps scale/skew intact).
   * Children are not modified.
   * Default: false
   */
  straighten?: boolean;

  /**
   * Do not expand the root viewBox for shadows/blur/outline/drop-shadow.
   * Children are not modified. The root may also have those visuals cleared to avoid clipping.
   * Default: false
   */
  noShadows?: boolean;
}


export interface BlobOptions {
  /** Blob type to export. Default: "svg". */
  type?: BlobType;
  /** JPG/WebP quality (0..1). */
  quality?: number;
  /** Background override for lossy formats. */
  backgroundColor?: string | null;
}

export interface DownloadOptions {
  /** File format. Default: "png". */
  format?: "svg" | RasterMime;
  /** Base filename without extension. Default: "snapDOM". */
  filename?: string;
  /** Background override for lossy formats. */
  backgroundColor?: string | null;
  /** JPG/WebP quality (0..1). Default: 0.92. */
  quality?: number;
}

export interface CaptureResult {
  /** SVG data URL representing the captured element. */
  url: string;
  /** Returns the same SVG data URL string. */
  toRaw(): string;
  /** Creates an HTMLImageElement from the SVG (accepts options). */
  toImg(options?: CaptureOptions): Promise<HTMLImageElement>;
  /** Creates an HTMLImageElement from the SVG (accepts options). */
  toSvg(options?: CaptureOptions): Promise<HTMLImageElement>;
  /** Renders into a Canvas element (accepts options). */
  toCanvas(options?: CaptureOptions): Promise<HTMLCanvasElement>;
  /** Exports to a Blob (SVG/PNG/JPG/WebP). */
  toBlob(options?: CaptureOptions & BlobOptions): Promise<Blob>;
  /** Convenience PNG export (returns an <img>). */
  toPng(options?: CaptureOptions): Promise<HTMLImageElement>;
  /** Convenience JPG export (returns an <img>). */
  toJpg(options?: CaptureOptions): Promise<HTMLImageElement>;
  /** Convenience WebP export (returns an <img>). */
  toWebp(options?: CaptureOptions): Promise<HTMLImageElement>;
  /** Triggers a file download. */
  download(options?: CaptureOptions & DownloadOptions): Promise<void>;
}

/**
 * Capture an element and return reusable export helpers.
 */
export declare function snapdom(el: Element, options?: CaptureOptions): Promise<CaptureResult>;

export declare namespace snapdom {
  function toImg(el: Element, options?: CaptureOptions): Promise<HTMLImageElement>;
  function toSvg(el: Element, options?: CaptureOptions): Promise<HTMLImageElement>;
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
  /** Inline non-icon fonts during preload. Default: true. */
  embedFonts?: boolean;
  /** Additional local fonts. */
  localFonts?: LocalFontDescriptor[];
  /** Proxy for CORS fallbacks. */
  useProxy?: string;
  /** Font family matchers to explicitly exclude from embedding. */
  excludeFonts?: IconFontMatcher[];
  /**
   * Cache policy used during precache.
   * Note: for `preCache` the option name in runtime is `cacheOpt`.
   */
  cacheOpt?: CachePolicy;
}

/**
 * Preload resources rooted at `root` (defaults to `document`).
 */
export declare function preCache(
  root?: Element | Document,
  options?: PreCacheOptions
): Promise<void>;

export {};
