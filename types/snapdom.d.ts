/**
 * snapDOM – ultra-fast DOM-to-image capture
 * TypeScript definitions (v3)
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

/**
 * How far a capture runs: the live page, the frozen clone, or the rendered image.
 * Plugins declare it as `needs`; the result reports it as `needs`.
 */
export type CaptureStage = "dom" | "clone" | "render";
/**
 * v3: caching is structural — 'disabled' (or `cache: false`) is the one debug/testing
 * escape hatch. The legacy strings 'full' | 'auto' | 'soft' are still ACCEPTED at runtime
 * but deprecated: they all map to the same structural behavior.
 */
export type CachePolicy = "disabled" | "full" | "auto" | "soft";

/** Geometry of the serialized capture, expressed in SVG viewBox CSS pixels. */
export interface CaptureMeta {
  /** Logical capture-box size (the clip-window size when clip is active). */
  readonly w0: number;
  readonly h0: number;
  /** Serialized SVG viewBox size, including bleed/padding. */
  readonly vbW: number;
  readonly vbH: number;
  /** Requested output basis before scale/dpr rasterization. */
  readonly targetW: number;
  readonly targetH: number;
  /** Exact logical capture-box origin inside the viewBox. */
  readonly contentX: number;
  readonly contentY: number;
  /** Resolved clip window, or null for a full-element capture. */
  readonly clip: Readonly<{ x: number; y: number; width: number; height: number }> | null;
}

/** A window in serialized SVG viewBox coordinates (see `CaptureMeta`). */
export interface CanvasCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CanvasExportOptions = Partial<SnapdomOptions> & { crop?: CanvasCrop };

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
  /** Output scale multiplier. Applies only when neither width nor height is set —
   *  width/height are the absolute output size and win (one rule across all exporters). */
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

  /** @deprecated Legacy alias for `format` (accepted when it carries an image-format string). */
  type?: BlobType;

  /**
   * Nodes to leave out of the capture: a CSS selector, a predicate returning true to
   * EXCLUDE the element, or any mix of both in an array.
   */
  exclude?: string | ((el: Element) => boolean) | Array<string | ((el: Element) => boolean)>;
  /** How excluded nodes leave ("hide" keeps layout via an invisible spacer; "remove" drops them). Default "hide". */
  excludeMode?: "hide" | "remove";

  /**
   * @deprecated Legacy KEEP-polarity predicate (return true to keep). Use `exclude` with
   * exclude-polarity instead; both compose when passed together.
   */
  filter?: (el: Element) => boolean;
  /** @deprecated Legacy alias for `excludeMode`. */
  filterMode?: "hide" | "remove";

  /**
   * Layout reconciliation: mount the styled clone in-document once, compare every node's
   * box against the live DOM and pin only diverging sizes. Measurement over heuristics.
   * Opt-in (adds one in-document layout of the clone). Default false.
   */
  reconcile?: boolean;

  /**
   * Forces one fresh, non-memoized capture — for changes the automatic tracking
   * (mutations, video frames, image/font loads, scroll, resize, head CSS, animations)
   * can't see: canvas pixel draws and programmatic CSSOM edits
   * (stylesheet.insertRule/deleteRule, cssRule.style.* on a rule rather than an element).
   * Works with the engine's automatic memoization — no other option required. Default false.
   */
  invalidate?: boolean;

  /** true (default): keep the root's translate/rotate. false: strip them (scale/skew kept)
   *  and recompute the bbox from the remaining 2D matrix. */
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
   * Inline non-icon fonts actually used within the subtree. Default 'auto': embeds only
   * when the element uses families the document declares as webfonts (system-font pages
   * skip the phase entirely). true forces the embed pass; false disables it (webfont text
   * will rasterize with fallback metrics).
   */
  embedFonts?: boolean | 'auto';
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

  /**
   * EXPERIMENTAL: 'canvas' renders raster exports through the WICG canvas-place-element
   * API (ctx.drawElement — Chrome behind chrome://flags/#canvas-draw-element) when
   * available, using the browser's own painter (native form controls, no svg-as-image
   * quirks). Falls back silently to the svg pipeline whenever unsupported or not
   * applicable. Engine results expose the raster exports plus lazy toRaw()/toSvg();
   * `.url` is not synchronously available.
   */
  engine?: 'svg' | 'canvas';

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

  /**
   * Cache behavior. 'disabled' (or false) opts out of every cache — a debug/testing escape
   * hatch. Anything else (including the legacy 'soft'/'auto'/'full' strings, still accepted)
   * is the structural default: per-capture sessions plus content-keyed persistent caches;
   * repeat-capture speed comes from automatic burst memoization and differential recapture.
   */
  cache?: CachePolicy;

  /** Show placeholders when resources are missing. Default true. */
  placeholders?: boolean;

  /** Arbitrary plugin configuration at call-site (see PluginUse). */
  plugins?: PluginUse[];
}

/* =========================
 * Capture context (hook state)
 * ========================= */

/**
 * The single object every hook receives: the normalized capture options at the TOP level
 * (`ctx.scale`, `ctx.backgroundColor`, …) plus the per-stage fields as they are produced.
 * It is the very bag the pipeline reads, so changing an option in `beforeSnap` takes effect
 * — except for the options that pick the capture PATH (`plugins`, `needs`, `engine`,
 * `burst`, `invalidate`, `cache`), which are resolved before the first hook runs.
 */
export interface CaptureContext extends SnapdomOptions {
  /** Input element being captured. */
  element: Element;

  /** Self-reference to this same context, for plugins written against `ctx.options`. */
  readonly options: CaptureContext;

  /** How far this capture runs (the deepest `needs` of its plugins). A plugin that
   *  defines exports can read it to know whether there will be an image at all. */
  needs: CaptureStage;

  /** Cloned root (detached), from `afterClone` through the render hooks. Released (null)
   *  once `afterRender` has run, so a live result never retains the whole tree. */
  clone?: HTMLElement | SVGElement | null;

  /** Internal style/class caches (opaque to user). */
  classCSS?: string;
  styleCache?: unknown;
  nodeMap?: unknown;
  fontsCSS?: string;
  baseCSS?: string;

  /** Serialized artifacts, available in `afterRender`. `svgString` is released as soon as
   *  that hook returns (read it lazily from `export.svgString` in an export hook). */
  svgString?: string | null;
  dataURL?: string;

  /** Authoritative render geometry, frozen and pinned once the render stage runs.
   *  Absent on a capture that stopped at 'dom' or 'clone' (no viewBox exists). */
  readonly meta?: Readonly<CaptureMeta>;

  /** Render artifacts handed to `defineExports` so exporters never reverse-parse the data
   *  URL for CSS the pipeline already holds. `svgString` stays out on purpose (it would
   *  double retained memory) — read it lazily from `export.svgString`. */
  artifacts?: {
    classCSS: string;
    fontsCSS: string;
    baseCSS: string;
    scrollbarCSS: string;
  } | null;

  /** Current export info during beforeExport/afterExport. */
  export?: {
    /** Export key (e.g., "png", "jpeg", "svg", or any custom key). Absent inside `defineExports`. */
    type?: string;
    /** Capture defaults merged with the options passed to the exporter. */
    options?: any;
    /** Exact own options supplied to this export call, frozen when `toXxx()` was called;
     *  omitted keys stay omitted, so a plugin can tell an explicit value from a default. */
    requestedOptions?: Readonly<Record<string, unknown>>;
    /** Canonical SVG data URL of this capture. */
    url: string;
    /** Lazily decodes the capture's SVG source from `url` (kept a thunk so a live result
     *  doesn't retain a second copy of the whole document). */
    svgString?: () => string;
  };

  /** Core export facade for `defineExports`: the built-in exporters without their hooks,
   *  so a plugin format can build on `png`/`canvas`/… without re-entering the pipeline. */
  exports?: Record<string, (opts?: any) => Promise<any>>;
}

/* =========================
 * Exporter signatures
 * ========================= */

export type Exporter = (ctx: CaptureContext, opts?: any) => Promise<any>;

/** Map returned by `defineExports`: each key is exposed on the result as a `to<Key>()`
 *  helper (`pdf` → `result.toPdf()`) and by name through `result.to('pdf')`. */
export type ExportMap = Record<string, Exporter>;

/** Second argument of the export hooks. Both hooks observe: every plugin gets this same
 *  payload and return values are ignored, while `options` is the SAME object the exporter
 *  receives, so mutating it is how a plugin steers the export. */
export interface ExportHookPayload {
  /** Export name: "png", "blob", "download", or any plugin-declared key. */
  format: string;
  /** Capture defaults merged with the options passed to this export call. */
  options: any;
}

/* =========================
 * Plugin system
 * ========================= */

export interface SnapdomPlugin {
  /** Unique name for de-dupe/overrides. */
  name: string;

  /**
   * How far the capture has to run for this plugin: 'dom' (live page only, no clone),
   * 'clone' (frozen tree, no pixels) or 'render' (the whole pipeline). Default 'render'.
   * The capture runs to the deepest stage any attached plugin declares, so one plugin can
   * only lower it when every other agrees. Below 'render' there is no image: `url`,
   * `toPng()` and every other export throw, and `result.needs` reports what ran.
   */
  needs?: CaptureStage;

  /**
   * Declares the render hooks deterministic and idempotent, opting the plugin back into the
   * engine's fast paths. A plugin with a render hook otherwise suspends auto-burst and the
   * differential recapture: serving a memo would skip its hooks, and splicing a rebuilt
   * subtree would drop its transformations. Set this only if re-running your hooks on the
   * same input always produces the same output. Default false.
   */
  pure?: boolean;

  /** Hook order follows registration order. All hooks may be async. */
  beforeSnap?(context: CaptureContext): void | Promise<void>;
  beforeClone?(context: CaptureContext): void | Promise<void>;
  afterClone?(context: CaptureContext): void | Promise<void>;
  beforeRender?(context: CaptureContext): void | Promise<void>;
  afterRender?(context: CaptureContext): void | Promise<void>;

  /** Runs before EACH export. Mutate `payload.options` to change what the exporter does. */
  beforeExport?(context: CaptureContext, payload: ExportHookPayload): void | Promise<void>;
  /**
   * Runs after EACH export. Observational: the return value is ignored and the export's own
   * result is what the caller gets. To produce a different result, declare that format in
   * `defineExports` (it can build on `ctx.exports.png()` and friends).
   */
  afterExport?(context: CaptureContext, payload: ExportHookPayload & { result: any }): void | Promise<void>;

  /**
   * Provide custom exporters (e.g., { pdf: async (ctx, opts) => Blob }).
   * Keys are exposed on the capture result as helpers (`toPdf()`) and by name (`to('pdf')`).
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
  /**
   * Canonical data URL of the SVG snapshot (when available). Note: experimental
   * engine:'canvas' results resolve their SVG lazily — url is '' there and toRaw()
   * returns a Promise; use toRaw()/toSvg() for engine-agnostic access.
   *
   * THROWS when `needs` is not 'render': that capture produced no image, and it is not
   * re-captured on demand (it would be a different instant).
   */
  url: string;

  /**
   * How far this capture ran — the deepest stage its plugins declared. 'render' unless a
   * plugin lowered it, in which case there is no image and every export throws.
   */
  needs: CaptureStage;

  /**
   * Degradation log for this capture — empty in the common case. Entries record the
   * capture's silent fallbacks: {code: 'image-fallback' | 'raster-clamp' | 'canvas-clamp'
   * | 'safari-png-fallback' | 'reconcile-risk' | string, message, detail?}. Export-time
   * entries (clamps, PNG fallback) append after the corresponding export resolves.
   */
  warnings: Array<{ code: string; message: string; detail?: unknown }>;

  /**
   * Authoritative serialized viewBox/content geometry — the same frozen record the
   * exporters read, so it can never diverge from `url`.
   *
   * THROWS when `needs` is not 'render', for the same reason `url` does.
   */
  readonly meta: Readonly<CaptureMeta>;

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

  /** Returns a Canvas with the rasterized snapshot. `crop` windows the capture in
   *  `meta` viewBox coordinates, so a long capture can be rasterized page by page. */
  toCanvas(options?: CanvasExportOptions): Promise<HTMLCanvasElement>;

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
   * Custom exporters exposed by plugins: a plugin returning { pdf: (...) => ... } enables
   * `result.toPdf(...)` and `result.to('pdf', ...)`. Those helper names are not known ahead
   * of time, hence the index signature.
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

  /**
   * Capture an HTML string (SSR markup, templates) without wiring a mount: it mounts
   * offscreen in the live document (page CSS/fonts apply), captures, and cleans up.
   */
  function fromString(html: string, options?: SnapdomOptions): Promise<CaptureResult>;

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
  /** Font embedding — same semantics as capture: 'auto' (default) embeds only
   *  document-declared webfonts actually used under root. */
  embedFonts?: boolean | 'auto';
  /** Provide fonts explicitly to avoid remote discovery. */
  localFonts?: LocalFont[];
  /** Exclude fonts by family/domain/subset. */
  excludeFonts?: { families?: string[]; domains?: string[]; subsets?: string[] };
  /** Extra domains to fetch cross-origin font CSS from. */
  fontStylesheetDomains?: string[];
  /** Cross-origin proxy prefix (as in SnapdomOptions.useProxy). */
  useProxy?: string;
}

/**
 * Preload external resources for a subtree to avoid first-capture stalls.
 * Uses the same discovery heuristics as the main capture path.
 */
export declare function preCache(
  root?: Element | Document,
  options?: PreCacheOptions
): Promise<void>;

/* =========================
 * Plugin registry
 * =========================
 * One runtime owns the registry: the `@zumer/snapdom/plugins` subpath re-exports these same
 * bindings from the root module, so registering through either reaches the same list.
 */

/** Register plugins globally, deduped by name. A global plugin must run to 'render'. */
export declare function registerPlugins(...defs: PluginUse[]): void;
/** Drop every globally registered plugin. */
export declare function clearPlugins(): void;
/** The globally registered plugin instances, in registration order. */
export declare function getGlobalPlugins(): SnapdomPlugin[];
/** Resolve a factory/tuple/instance into a plugin instance. */
export declare function normalizePlugin(spec: PluginUse): SnapdomPlugin | null;
/** Ordered capture stages, cheapest first. */
export declare const STAGES: readonly CaptureStage[];
/** The stage a plugin gets when it declares nothing. */
export declare const DEFAULT_STAGE: CaptureStage;
/**
 * Validate a declared stage, naming `pluginName` in the error. Returns the deepest supported
 * stage when `value` is undefined/null, so a plugin that declares nothing runs the full pipeline.
 */
export declare function assertNeeds(
  pluginName: string,
  value?: unknown,
  supported?: readonly CaptureStage[]
): CaptureStage;

declare module "@zumer/snapdom/plugins" {
  export {
    registerPlugins,
    clearPlugins,
    getGlobalPlugins,
    normalizePlugin,
    STAGES,
    DEFAULT_STAGE,
    assertNeeds,
  };
}

declare module "@zumer/snapdom/preCache" {
  export { preCache };
}

export {};
