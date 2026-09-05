/**
 * SnapDOM — browser capture engine for web interfaces
 * TypeScript definitions (v3)
 *
 * Notes:
 * - Style compression is internal (no public option).
 * - Recognized icon fonts are rendered as images; `embedFonts` controls text fonts.
 * - This file preserves backward compatibility with earlier defs.
 */

/* =========================
 * Basic MIME / type aliases
 * ========================= */

export type RasterMime = "png" | "jpg" | "jpeg" | "webp";
export type BlobType = "svg" | RasterMime;

export type IconFontMatcher = string | RegExp;

/**
 * How far a capture runs: the frozen clone, or the rendered image. Plugins declare it as
 * `needs`; the result reports it as `needs`. A shallower "dom" stage existed and was
 * removed: a capture that takes no clone does no capturing.
 */
export type CaptureStage = "clone" | "render";
/**
 * Persistent resource/style cache policy. 'soft' is the v3 default; 'disabled' (or
 * `cache: false`) clears and bypasses those caches for debugging. The legacy 'full' and
 * 'auto' strings remain accepted but both normalize to 'soft'.
 */
export type CachePolicy = "soft" | "disabled" | "auto" | "full";

/** Geometry of the rendered capture, expressed in viewBox-style CSS pixels. */
export interface CaptureMeta {
  /** Logical capture-box size (the clip-window size when clip is active). */
  readonly w0: number;
  readonly h0: number;
  /** Render viewBox size, including bleed/padding. */
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

/** A window in capture viewBox coordinates (see `CaptureMeta`). */
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
  backgroundColor?: string | null;
  /** Quality for JPEG/WebP (0..1). Default 0.92. */
  quality?: number;
  /** Default for format-selecting exports; named helpers choose their own codec. Default "png". */
  format?: BlobType;

  /** Cross-origin proxy prefix (used as a fallback when CORS blocks). */
  useProxy?: string;

  /** @deprecated Legacy alias kept synchronized with canonical `format`; either key is honored. */
  type?: BlobType;

  /**
   * Nodes to leave out of the capture: a CSS selector, a predicate returning true to
   * EXCLUDE the element, or any mix of both in an array.
   */
  exclude?: string | ((el: Element) => boolean) | Array<string | ((el: Element) => boolean)>;
  /** How excluded nodes leave ("hide" keeps layout via an invisible spacer; "remove" drops them). Default "hide". */
  excludeMode?: "hide" | "remove";

  /**
   * @deprecated REMOVED in v3 and no longer applied. It was a second door to the same
   * decision as `exclude`, with the opposite polarity. Flip the predicate and pass it to
   * `exclude`: `filter: el => keep(el)` becomes `exclude: el => !keep(el)`. Still declared
   * so the compiler points at this note instead of reporting an unknown property, and
   * passing it logs a warning at runtime.
   */
  filter?: (el: Element) => boolean;
  /** @deprecated REMOVED in v3 and no longer applied. Use `excludeMode`. */
  filterMode?: "hide" | "remove";

  /**
   * Layout reconciliation: mount the styled clone in-document once, compare every node's
   * box against the live DOM and pin only diverging sizes. Measurement over heuristics.
   * Opt-in (adds one in-document layout of the clone). Default false.
   */
  reconcile?: boolean;

  /**
   * Forces one fresh capture that is not served from the existing memo, and clears style
   * snapshots after application changes for which the browser exposes no signal, notably
   * programmatic CSSOM edits
   * (stylesheet.insertRule/deleteRule, cssRule.style.* on a rule rather than an element).
   * Frame-driven canvas/video/iframe trees already capture fresh automatically.
   * The fresh stable result may become the new memo for later calls. Works with the engine's
   * automatic memoization — no other option required. Default false.
   */
  invalidate?: boolean;

  /** Root translation is normalized in both modes. true (default) keeps rotation;
   *  false removes rotation, keeps scale/skew and recomputes the bounding box. */
  outerTransforms?: boolean;
  /**
   * Control root shadow/outline bleed. Default false strips root box/text shadows,
   * outline and drop-shadow(); blur remains visible and its bleed is included unless an
   * explicit `clip` fixes the capture edges.
   * true keeps and bounds all root effects.
   *
   * `'subtree'` additionally widens the capture for the outer-shadow ink DESCENDANTS
   * paint past the root's box — a card whose own ring is a box-shadow, captured from a
   * wrapper around it — measured per side and bounded by any ancestor that clips.
   */
  outerShadows?: boolean | 'subtree';

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
   * Renderer: 'svg' by default. The second engine, 'html-in-canvas', is EXPERIMENTAL and
   * requires a build with SNAPDOM_CANVAS_ENGINE=1. It renders through the WICG html-in-canvas
   * API (ctx.drawElementImage — Chrome 148+ origin trial / chrome://flags/#canvas-draw-element)
   * when available, using the browser's own painter (native form controls, no svg-as-image
   * quirks). Falls back silently to the svg pipeline whenever unsupported/not applicable,
   * including captures with beforeRender/afterRender plugin hooks. Successful native-engine
   * results expose raster exports; reading `.url` or calling `toRaw()` synchronously
   * materializes and memoizes a PNG data URL, while `toSvg()`/`toImg()` return an image
   * backed by a PNG encoding of the bitmap. There is no serialized SVG.
   */
  engine?: 'svg' | 'html-in-canvas';

  /** Verbose diagnostics via console.warn. Default false. */
  debug?: boolean;

  /**
   * Filename for download(). The extension is appended from the export format when the name
   * does not already carry one, so `'card'` saves as `card.png`. Default `"snapDOM"`.
   */
  filename?: string;

  /**
   * Fallback image when <img> fails to load.
   * Can be a fixed URL or a callback that receives measured dimensions.
   */
  fallbackURL?:
    | string
    | ((dims: { width?: number; height?: number }) => string);

  /**
   * Persistent resource/style cache behavior. 'disabled' (or false) clears and bypasses
   * those persistent caches whenever the capture pipeline runs — a debug/testing escape
   * hatch. 'soft' is the default; legacy 'auto'/'full' values remain accepted and normalize
   * to it. Automatic repeat-capture memoization and differential recapture are separate.
   */
  cache?: CachePolicy | false;

  /** Show placeholders when resources are missing. Default true. */
  placeholders?: boolean;

  /**
   * Render the user's live text selection into the capture. A selection is paint without DOM
   * — the browser draws the highlight and restyles the selected glyphs at paint time — so a
   * structural clone loses it. Selected runs are wrapped in the styles the browser painted
   * them with: the authored `::selection` background, color, text-shadow and text-decoration
   * where a rule matches, the UA highlight colour where none does, and nothing at all over
   * `user-select: none`. A focused field's selection is painted as background layers behind
   * its value. Default false.
   */
  captureSelection?: boolean;

  /** Arbitrary plugin configuration at call-site (see PluginUse). */
  plugins?: PluginUse[];

  /** Reuse an existing canvas as the render target instead of allocating one
   *  (`toCanvas` and everything built on it). */
  canvas?: HTMLCanvasElement;
}

/* =========================
 * Capture context (hook state)
 * ========================= */

/**
 * The single object every hook receives: the normalized capture options at the TOP level
 * (`ctx.scale`, `ctx.backgroundColor`, …) plus the per-stage fields as they are produced.
 * It is the very bag the pipeline reads, so changing an option in `beforeSnap` takes effect
 * — except for the options resolved before the first hook (`plugins`, `needs`,
 * `invalidate`, `cache`). `format` is canonical; deprecated `type` stays synchronized with
 * it, and changing either supported name in `beforeSnap` is honored.
 */
export interface CaptureContext extends SnapdomOptions {
  /** Input element being captured. */
  element: Element;

  /** Canonical normalized capture format. */
  format: BlobType;

  /** @deprecated Synchronized legacy alias for `format`. */
  type: BlobType;

  /** Self-reference to this same context, for plugins written against `ctx.options`. */
  readonly options: CaptureContext;

  /** Compiled exclusion policy for this capture. Returns true for data-capture="exclude",
   *  selector matches, and exclusion predicates. Available at every hook stage. */
  readonly shouldExclude: (el: Element) => boolean;

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
   *  Absent on a capture that stopped at 'clone' (no viewBox exists). */
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
    /** Capture data URL: SVG for the default engine; lazily materialized PNG for a
     *  successful `html-in-canvas` capture. */
    url: string;
    /** Lazily decodes the default engine's SVG source from `url` (kept a thunk so a live
     *  result doesn't retain a second copy). Throws for a raster `html-in-canvas` capture. */
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

/** Second argument of the export hooks. Their return values are observational: every plugin
 *  gets this same payload and hook returns are ignored, while `options` is the SAME object
 *  the exporter receives, so mutating it is how a plugin steers the export. For a
 *  format-selecting export, `options.format` is canonical and deprecated `options.type`
 *  stays synchronized with it; changing either supported name is honored. */
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
   * How far the capture has to run for this plugin: 'clone' (frozen tree, no pixels)
   * or 'render' (the whole pipeline). Default 'render'.
   * The capture runs to the deepest stage any attached plugin declares, so one plugin can
   * only lower it when every other agrees. Below 'render' there is no image: `url`,
   * `meta` and core image exports throw. Custom plugin exports still work, and
   * `result.needs` reports what ran.
   */
  needs?: CaptureStage;

  /**
   * Declares capture-affecting hooks deterministic and idempotent, opting the plugin back
   * into unchanged-repeat memoization. Pure beforeRender/afterRender hooks may also use
   * differential recapture; clone-construction hooks still force a conservative full
   * recapture after a change because the splice path cannot skip them. Set this only if
   * re-running your hooks on the same input always produces the same output. Default false.
   * Captures stopped at `needs: 'clone'` are never memoized.
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
   * Per-node hook, called for every element while the clone is built (after the compiled
   * exclusion policy, before built-in iframe/canvas/video/audio handling). First plugin
   * returning a value wins:
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
  /** @deprecated Legacy alias kept synchronized with canonical `format`; either key is honored. */
  type?: BlobType;
  /** Quality hint for raster formats. */
  quality?: number;
  /** Target width/height for this export. */
  width?: number;
  height?: number;
}

export interface BlobOptions {
  /** Blob codec. Defaults to SVG for the default engine and PNG for a successful native capture. */
  type?: BlobType;
  quality?: number;
  width?: number;
  height?: number;
}

export interface CaptureResult {
  /**
   * Canonical data URL of the capture. On the default engine, the serialized SVG. On a
   * successful experimental engine:'html-in-canvas' capture the artifact is a raster bitmap:
   * pixel exports (toCanvas/toPng/toJpg/toWebp and raster toBlob) consume it directly, and reading `url`
   * (or toRaw()) mints a PNG data URL once, lazily — the encode costs 15-22x the direct
   * draw, so it is paid only when a string is actually asked for.
   *
   * THROWS when `needs` is not 'render': that capture produced no image, and it is not
   * re-captured on demand (it would be a different instant).
   */
  url: string;

  /**
   * How far this capture ran — the deepest stage its plugins declared. 'render' unless a
   * plugin lowered it, in which case core image exports throw. Custom plugin exports
   * can still return their own data.
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
   * Authoritative render viewBox/content geometry — the same frozen record the exporters
   * read, so raster placement cannot diverge from the captured artifact.
   *
   * THROWS when `needs` is not 'render', for the same reason `url` does.
   */
  readonly meta: Readonly<CaptureMeta>;

  /** Returns the capture data URL (SVG by default; PNG for a successful html-in-canvas capture). */
  toRaw(): string;

  /** Run any registered export by name (core or plugin), e.g. `to("png")`. */
  to(type: string, options?: any): Promise<any>;

  /**
   * @deprecated Use `toSvg()` for an <img> representing the capture.
   * Historical alias kept for compatibility.
   */
  toImg(options?: Partial<SnapdomOptions>): Promise<HTMLImageElement>;

  /** Returns an HTMLImageElement representing the capture (SVG-backed by default,
   *  PNG-backed after a successful native html-in-canvas capture, SVG-backed on fallback). */
  toSvg(options?: Partial<SnapdomOptions>): Promise<HTMLImageElement>;

  /** Returns a Canvas with the rasterized snapshot. `crop` windows the capture in
   *  `meta` viewBox coordinates, so a long capture can be rasterized page by page. */
  toCanvas(options?: CanvasExportOptions): Promise<HTMLCanvasElement>;

  /** Returns a Blob of the chosen type (svg/png/jpeg/webp). Defaults to SVG on the default
   *  engine and PNG after a successful html-in-canvas capture. An explicit SVG request on
   *  that raster path rejects because there is no SVG source. */
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

  /** The package version this bundle was built from (`'src'` when imported from source). */
  const version: string;

  /**
   * Capture an HTML string (SSR markup, templates) without wiring a mount: it mounts
   * offscreen in the live document (page CSS/fonts apply), captures, and cleans up.
   *
   * ⚠️ TRUSTED HTML ONLY. The string is assigned to `innerHTML` and attached to the real
   * document, so it is parsed and activated exactly like markup you wrote yourself:
   * `<img onerror>` and friends RUN, in your origin, with your cookies. This is inherent
   * to rendering arbitrary markup — there is no capture without a live layout — so the
   * boundary is the caller's to hold. Never pass user-supplied HTML that has not been
   * sanitized first (DOMPurify or equivalent).
   */
  function fromString(html: string, options?: SnapdomOptions): Promise<CaptureResult>;

  /**
   * The capture that is ready before the click: link prefetch, translated. Arm it once at
   * setup. A memo-eligible capture started in the same event task as a control's press or
   * click event is learned for that control. Later pointer-enter or focus intent repeats it
   * with a shallow copy of the original call's top-level options, so an unchanged click can
   * be served from memory; the first unknown intent event warms the visible viewport once.
   * It reacts to intent events and does no background polling. A programmatic capture needs
   * none of this, because memoization engages on every eligible element's first capture.
   */
  function preCapture(): void;

  /** Shortcut helpers that run a one-off capture+export. */

  /** Returns the capture data URL (SVG by default; PNG after a successful native
   *  html-in-canvas capture, SVG on fallback). */
  function toRaw(
    element: Element,
    options?: SnapdomOptions
  ): Promise<string>;

  /** @deprecated Returns an <img> representing the capture; prefer `toSvg`. */
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
 * Plugin registry
 * =========================
 * One runtime owns the registry: the `@zumer/snapdom/plugins` subpath resolves to the root
 * module itself (package.json maps it there), so registering through either reaches the
 * same list.
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

/* The `/plugins` subpath points at THIS file through the `types` condition
 * in package.json's exports map. They used to be declared here as
 * `declare module "@zumer/snapdom/plugins" { … }`. In a file that is already a module those
 * are AUGMENTATIONS of a specifier TypeScript has to resolve first, and it cannot resolve a
 * package into itself, so every consumer without `skipLibCheck: true` got TS2665. */

export {};
