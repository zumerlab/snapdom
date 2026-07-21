/**
 * snapDOM – ultra-fast DOM-to-image capture
 * TypeScript definitions (v2.16)
 *
 * Notes:
 * - Style compression is internal (no public option).
 * - Icon fonts are always embedded; `embedFonts` controls non-icon fonts only.
 * - This file preserves backward compatibility with earlier defs.
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
  /** font-stretch as a percentage (e.g. 100). Default 100. */
  stretchPct?: number;
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

  /** Background fallback color. Default: `"#ffffff"` for JPEG/WebP, `null` (transparent) otherwise. */
  backgroundColor?: string;
  /** Quality for JPEG/WebP (0..1). Default 0.92. */
  quality?: number;
  /** Output format for capture/export helpers. Default "png". */
  format?: BlobType;

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

  /**
   * Layout reconciliation: mount the styled clone in-document once, compare every node's
   * box against the live DOM and pin only diverging sizes. Measurement over heuristics.
   * Opt-in (adds one in-document layout of the clone). Default false.
   */
  reconcile?: boolean;

  /** outerTransforms the root: remove translate/rotate, keep scale/skew. Default true. */
  outerTransforms?: boolean;
  /**
   * Expand root bbox for shadows/blur/outline instead of stripping them from the
   * cloned root. Default false (root shadows/outline are stripped, blur bleed is
   * still included).
   */
  outerShadows?: boolean;

  /**
   * Capture only a region instead of the full element: `'viewport'` (what the user
   * currently sees) or a page-coordinate rect. Offscreen subtrees are pruned before
   * styling/inlining, so this is faster than a full capture. Default null (no clip).
   */
  clip?: "viewport" | { x: number; y: number; width: number; height: number } | null;

  /**
   * Downsample inlined raster images to their visible resolution (display box × scale × dpr),
   * preserving the source codec (lossless PNG stays lossless). On by default; pass `false`
   * to embed images verbatim.
   */
  compress?: boolean;

  /** Inline non-icon fonts actually used within the subtree. */
  embedFonts?: boolean;
  /** Provide fonts explicitly to avoid remote discovery. */
  localFonts?: LocalFont[];
  /** Additional matchers for icon font families (strings or regex). */
  iconFonts?: IconFontMatcher | IconFontMatcher[];
  /** Skip specific non-icon fonts (by family/domain/subset). */
  excludeFonts?: ExcludeFonts;
  /** Extra domains allowed for cross-origin font stylesheet fetches (e.g. self-hosted CDNs). */
  fontStylesheetDomains?: string[];

  /**
   * Skip style properties when snapshotting computed styles (e.g. `/^--/` to exclude
   * CSS variables on pages with thousands of custom props).
   */
  excludeStyleProps?: RegExp | ((prop: string) => boolean);

  /** Safari warmup iterations for WebKit #219770 (1..3). Default 3. */
  safariWarmupAttempts?: number;

  /** Verbose diagnostics via console.warn. Default false. */
  debug?: boolean;

  /** Default filename (without extension) for download(). Default "snapDOM". */
  filename?: string;

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

  /**
   * Resolve lazy `<picture>` placeholders / `data-src` patterns before clone (default true).
   * Set false to skip; register the `picture-resolver` plugin explicitly if you need overrides while core is off.
   */
  resolvePicturePlaceholders?: boolean;
  /** Fine-tune the built-in picture/lazy resolver (timeout, concurrency, etc.). */
  pictureResolver?: {
    timeout?: number;
    concurrency?: number;
    resolveLazySrc?: boolean;
    silent?: boolean;
  };

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

  /**
   * Per-node hook, called for every element while the clone is built (after exclude/filter,
   * before built-in iframe/canvas/video/audio handling). First plugin returning a value wins:
   * - Node → used as the finished clone for that node (mapped to source, box styles applied)
   * - null → skip the node entirely
   * - undefined → continue with the normal pipeline
   * Runs on every node: keep checks cheap.
   */
  resolveNode?(node: Element, context: CaptureContext): Node | null | undefined | Promise<Node | null | undefined>;

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
  /** Output format for the downloaded file. Default "png". */
  format?: BlobType;
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

  /** Returns the raw SVG data URL (same as `url`). */
  toRaw(): string;

  /** Run any registered export by name (core or plugin), e.g. `to("png")`. */
  to(type: string, options?: any): Promise<any>;

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
/** Session for repeated captures of the same element (see snapdom.session). */
export interface CaptureSession {
  /** True when the subtree (or document styles) changed since the last capture. */
  readonly dirty: boolean;
  /**
   * Capture the element. While nothing changed and no overrides are passed, the memoized
   * result is returned instantly; otherwise a fresh capture runs with warm caches.
   */
  capture(overrides?: Partial<SnapdomOptions>): Promise<CaptureResult>;
  /** Disconnect observers and drop the memoized result. */
  dispose(): void;
}

export declare namespace snapdom {
  function plugins(...defs: PluginUse[]): typeof snapdom;

  /**
   * Create a capture session for repeated captures of the same element (frame loops,
   * polling previews). Mutations are tracked by a scoped MutationObserver.
   */
  function session(
    element: Element,
    options?: SnapdomOptions
  ): CaptureSession;

  /** Shortcut helpers that run a one-off capture+export. */

  /** Returns the raw SVG data URL of a one-off capture. */
  function toRaw(
    element: Element,
    options?: SnapdomOptions
  ): Promise<string>;

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
