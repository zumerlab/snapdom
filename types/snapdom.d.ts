/**
 * snapDOM – ultra-fast DOM-to-image capture
 * TypeScript definitions (v1.9.14)
 *
 * Notes:
 * - Style compression is internal (no public option).
 * - Icon fonts are always embedded; `embedFonts` controls non-icon fonts only.
 * - This file preserves backward compatibility with earlier 1.9.x defs.
 */

/* =========================
 * Basic MIME / type aliases
 * ========================= */

export type RasterMime = "png" | "jpg" | "jpeg" | "webp";
export type BlobType = "svg" | RasterMime;

export type IconFontMatcher = string | RegExp;
export type CachePolicy = "disabled" | "full" | "auto" | "soft";

/* =========================
 * Font & proxy declarations
 * ========================= */

export interface LocalFont {
  family: string;
  src: string;            // URL or data: URL
  weight?: string | number;
  style?: string;
}

export interface ExcludeFonts {
  /** Case-insensitive family names to skip (non-icon only). */
  families?: string[];
  /** Host substrings to skip (e.g., "fonts.gstatic.com"). */
  domains?: string[];
  /** Unicode-range subset tags to skip (e.g., "cyrillic-ext"). */
  subsets?: string[];
}

/* =========================
 * Capture options
 * ========================= */

export interface SnapdomOptions {
  /** Fast path: skip small idle delays where safe. */
  fast?: boolean;
  /** Output scale multiplier. Takes precedence over width/height. */
  scale?: number;
  /** Device pixel ratio to use for rasterization (defaults to `devicePixelRatio`). */
  dpr?: number;
  /** Target width of the export (keeps aspect if only one dimension is provided). */
  width?: number;
  /** Target height of the export (keeps aspect if only one dimension is provided). */
  height?: number;

  /** Background fallback color (used esp. for JPEG). Default "#fff". */
  backgroundColor?: string;
  /** Quality for JPEG/WebP (0..1). Default 1. */
  quality?: number;

  /** Cross-origin proxy prefix (used as a fallback when CORS blocks). */
  useProxy?: string;

  /** Default Blob type for toBlob() when unspecified. */
  type?: BlobType;

  /** CSS selector list to filter nodes. */
  exclude?: string[];
  /** How to apply `exclude` ("hide" keeps layout via visibility:hidden; "remove" drops nodes). Default "hide". */
  excludeMode?: "hide" | "remove";

  /**
   * Custom predicate: return true to keep node, false to exclude.
   * Runs in document order; pairs with `filterMode`.
   */
  filter?: (el: Element) => boolean;
  /** How to apply `filter` ("hide" or "remove"). Default "hide". */
  filterMode?: "hide" | "remove";

  /** Straighten the root: remove translate/rotate, keep scale/skew. */
  straighten?: boolean;
  /**
   * Do not expand root bbox for shadows/blur/outline; also strip shadows/outline
   * from the cloned root to get a tight capture box.
   */
  noShadows?: boolean;

  /** Inline non-icon fonts actually used within the subtree. */
  embedFonts?: boolean;
  /** Provide fonts explicitly to avoid remote discovery. */
  localFonts?: LocalFont[];
  /** Additional matchers for icon font families (strings or regex). */
  iconFonts?: IconFontMatcher | IconFontMatcher[];
  /** Skip specific non-icon fonts (by family/domain/subset). */
  excludeFonts?: ExcludeFonts;

  /**
   * Fallback image when <img> fails to load.
   * Can be a fixed URL or a callback that receives measured dimensions.
   */
  fallbackURL?:
    | string
    | ((dims: { width?: number; height?: number }) => string);

  /** Cache policy for resources and style maps. Default "soft". */
  cache?: CachePolicy;

  /** Show placeholders when resources are missing. Default true. */
  placeholders?: boolean;

  /** Arbitrary plugin configuration at call-site (see PluginUse). */
  plugins?: PluginUse[];
}

/* =========================
 * Capture context (hook state)
 * ========================= */

export interface CaptureContext extends SnapdomOptions {
  /** Input element being captured. */
  element: Element;

  /** Cloned root (detached), available after `beforeClone`/`afterClone`. */
  clone?: HTMLElement | SVGElement | null;

  /** Internal style/class caches (opaque to user). */
  classCSS?: string;
  styleCache?: unknown;
  fontsCSS?: string;
  baseCSS?: string;

  /** Serialized artifacts, available after render. */
  svgString?: string;
  dataURL?: string;

  /** Current export info during beforeExport/afterExport. */
  export?: {
    /** Export key (e.g., "png", "jpeg", "svg", or any custom key). */
    type: string;
    /** Options passed to the exporter. */
    options?: any;
    /** Canonical SVG data URL of this capture. */
    url: string;
  };
}

/* =========================
 * Exporter signatures
 * ========================= */

export type Exporter = (ctx: CaptureContext, opts?: any) => Promise<any>;

/** Map returned by `defineExports`: keys are exposed on the result (e.g., `pdf` → `result.toPdf()` as well as `result['pdf']()`). */
export type ExportMap = Record<string, Exporter>;

/* =========================
 * Plugin system
 * ========================= */

export interface SnapdomPlugin {
  /** Unique name for de-dupe/overrides. */
  name: string;

  /** Hook order follows registration order. All hooks may be async. */
  beforeSnap?(context: CaptureContext): void | Promise<void>;
  beforeClone?(context: CaptureContext): void | Promise<void>;
  afterClone?(context: CaptureContext): void | Promise<void>;
  beforeRender?(context: CaptureContext): void | Promise<void>;
  afterRender?(context: CaptureContext): void | Promise<void>;

  /** Runs before EACH export. */
  beforeExport?(context: CaptureContext): void | Promise<void>;
  /**
   * Runs after EACH export; returning a value will be chained to the next plugin
   * (transform pipeline). If undefined is returned, the prior result is preserved.
   */
  afterExport?(context: CaptureContext, result: any): any | Promise<any>;

  /**
   * Provide custom exporters (e.g., { pdf: async (ctx, opts) => Blob }).
   * Keys are exposed on the capture result as helpers (toPdf()) and as index access (result['pdf']()).
   */
  defineExports?(context: CaptureContext): ExportMap | Promise<ExportMap>;

  /** Runs ONCE after the FIRST successful export of this capture (good for cleanup). */
  afterSnap?(context: CaptureContext): void | Promise<void>;
}

export type PluginFactory = (options?: any) => SnapdomPlugin;
/** You can pass a plugin instance, a factory, or a tuple with options. */
export type PluginUse =
  | SnapdomPlugin
  | PluginFactory
  | [PluginFactory, any]
  | { plugin: PluginFactory; options?: any };

/* =========================
 * Capture result API
 * ========================= */

export interface DownloadOptions {
  filename?: string;
  /** Override default blob type for this download. */
  type?: BlobType;
  /** Quality hint for raster formats. */
  quality?: number;
  /** Target width/height for this export. */
  width?: number;
  height?: number;
}

export interface BlobOptions {
  type?: BlobType;
  quality?: number;
  width?: number;
  height?: number;
}

export interface CaptureResult {
  /** Canonical data URL of the SVG snapshot (when available). */
  url: string;

  /**
   * @deprecated Use `toSvg()` for an <img> that renders the SVG snapshot.
   * Historical alias kept for compatibility.
   */
  toImg(): Promise<HTMLImageElement>;

  /** Returns an HTMLImageElement that renders the SVG snapshot. */
  toSvg(options?: Partial<SnapdomOptions>): Promise<HTMLImageElement>;

  /** Returns a Canvas with the rasterized snapshot. */
  toCanvas(options?: Partial<SnapdomOptions>): Promise<HTMLCanvasElement>;

  /** Returns a Blob of the chosen type (svg/png/jpeg/webp). */
  toBlob(options?: BlobOptions & Partial<SnapdomOptions>): Promise<Blob>;

  /** Convenience raster exports returning an HTMLImageElement. */
  toPng(options?: Partial<SnapdomOptions>): Promise<HTMLImageElement>;
  toJpeg(options?: Partial<SnapdomOptions>): Promise<HTMLImageElement>;
  /** Alias for `toJpeg()`. */
  toJpg(options?: Partial<SnapdomOptions>): Promise<HTMLImageElement>;
  toWebp(options?: Partial<SnapdomOptions>): Promise<HTMLImageElement>;

  /** Trigger a client-side download of the snapshot using current/default settings. */
  download(options?: DownloadOptions & Partial<SnapdomOptions>): Promise<void>;

  /**
   * Custom exporters exposed by plugins:
   * - As helpers: a plugin returning { pdf: (...) => ... } also enables result.toPdf(...)
   * - As index access: result["pdf"](...)
   *
   * Since keys are not known ahead of time, we allow index access.
   */
  [key: string]: any;
}

/* =========================
 * Main callable & static helpers
 * ========================= */

/** Overload: main callable returns a reusable exporter object for the element. */
export declare function snapdom(
  element: Element,
  options?: SnapdomOptions
): Promise<CaptureResult>;

/**
 * Global plugin registration (chainable).
 * - De-duplicates by `name`.
 * - Execution order = registration order.
 * - Per-capture plugins run before globals and override by `name`.
 */
export declare namespace snapdom {
  function plugins(...defs: PluginUse[]): typeof snapdom;

  /** Shortcut helpers that run a one-off capture+export. */

  /** @deprecated Returns an SVG <img>; prefer `toSvg`. */
  function toImg(
    element: Element,
    options?: SnapdomOptions
  ): Promise<HTMLImageElement>;

  function toSvg(
    element: Element,
    options?: SnapdomOptions
  ): Promise<HTMLImageElement>;

  function toCanvas(
    element: Element,
    options?: SnapdomOptions
  ): Promise<HTMLCanvasElement>;

  function toBlob(
    element: Element,
    options?: SnapdomOptions & BlobOptions
  ): Promise<Blob>;

  function toPng(
    element: Element,
    options?: SnapdomOptions
  ): Promise<HTMLImageElement>;

  function toJpeg(
    element: Element,
    options?: SnapdomOptions
  ): Promise<HTMLImageElement>;

  /** Alias for `toJpeg`. */
  function toJpg(
    element: Element,
    options?: SnapdomOptions
  ): Promise<HTMLImageElement>;

  function toWebp(
    element: Element,
    options?: SnapdomOptions
  ): Promise<HTMLImageElement>;

  function download(
    element: Element,
    options?: SnapdomOptions & DownloadOptions
  ): Promise<void>;
}

/* =========================
 * preCache helper
 * ========================= */

export interface PreCacheOptions {
  /** Root to scan (defaults to `document`). */
  root?: Element | Document;
  /** Try to embed non-icon fonts used under root (see also localFonts). */
  embedFonts?: boolean;
  /** Provide fonts explicitly to avoid remote discovery. */
  localFonts?: LocalFont[];
  /** Additional matchers for icon fonts (strings or regex). */
  iconFonts?: IconFontMatcher | IconFontMatcher[];
  /** Cross-origin proxy prefix (as in SnapdomOptions.useProxy). */
  useProxy?: string;
  /** Cache policy for this preload operation. */
  cache?: CachePolicy;

  /** Back-compat fields (no-ops if present) */
  /**
   * @deprecated Use `cache` instead.
   */
  cacheOpt?: CachePolicy;
}

/**
 * Preload external resources for a subtree to avoid first-capture stalls.
 * Uses the same discovery heuristics as the main capture path.
 */
export declare function preCache(
  root?: Element | Document,
  options?: PreCacheOptions
): Promise<void>;

export {};
