/**
 * Recapture live frames for the GIF/video plugins without losing the capture's options or
 * entering its export queue again. A weak lookup associates each result's frozen geometry
 * with that capture's core canvas facade. A memo hit may return the result already running
 * toGif/toMp4; calling its public toCanvas would wait on that occupied queue forever.
 * @module plugins/capture-frames
 */
import { snapdom } from '@zumer/snapdom';

const canvases = new WeakMap();

/**
 * Associate the capture's silent canvas exporter with its result identity.
 * Pinned by __tests__/plugin.recording.memo.test.js.
 * @param {object} [ctx] - defineExports context with meta and core exports
 * @returns {void}
 */
export function rememberCanvas(ctx) {
  if (ctx?.meta && ctx.exports?.canvas) canvases.set(ctx.meta, ctx.exports.canvas);
}

/**
 * Resolve an explicit export override ahead of a plugin default.
 * v3's normalized opts include inherited defaults; requestedOptions distinguishes explicit
 * scale:1 from inherited scale:1. Pinned by __tests__/plugin.recording.contract.test.js.
 * @param {object} ctx - Capture/export context
 * @param {object} opts - Normalized export options, including beforeExport mutations
 * @param {string} key - Option name
 * @param {any} fallback - Plugin or inherited default
 * @returns {any}
 */
export function exportOption(ctx, opts, key, fallback) {
  const requested = ctx.export?.requestedOptions || opts;
  return Object.prototype.hasOwnProperty.call(requested, key) || opts[key] !== ctx[key]
    ? (opts[key] ?? fallback) : fallback;
}

/**
 * Build a live frame reader that preserves capture options and validates finite pacing.
 * Recombine v3's separated exclusion predicates before recapturing. Pinned by
 * __tests__/plugin.recording.contract.test.js and __tests__/plugin.recording.memo.test.js.
 * @param {object} ctx - Export context containing the live source element
 * @param {object} opts - Normalized per-export options
 * @param {{fps:number,duration:number,frames?:number|null,scale?:number,background:string}} defaults
 * @param {string} name - Plugin name for validation errors
 * @returns {{fps:number,count:number,background:string,next:()=>Promise<HTMLCanvasElement>}}
 */
export function frameOptions(ctx, opts, defaults, name) {
  const fps = exportOption(ctx, opts, 'fps', defaults.fps);
  const duration = exportOption(ctx, opts, 'duration', defaults.duration);
  const frames = exportOption(ctx, opts, 'frames', defaults.frames);
  const scale = exportOption(ctx, opts, 'scale', defaults.scale ?? ctx.scale ?? 1);
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError(`[snapdom] ${name}: fps must be positive and finite`);
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError(`[snapdom] ${name}: scale must be positive and finite`);
  if (frames != null && (!Number.isInteger(frames) || frames < 1)) throw new RangeError(`[snapdom] ${name}: frames must be a positive integer`);
  if (frames == null && (!Number.isFinite(duration) || duration <= 0)) throw new RangeError(`[snapdom] ${name}: duration must be positive and finite`);
  const count = frames ?? Math.max(1, Math.round(duration / 1000 * fps));
  if (!Number.isFinite(count)) throw new RangeError(`[snapdom] ${name}: frame count must be finite`);

  // Copy capture inputs, not released stage artifacts or export-session internals. In
  // particular createContext splits exclusion predicates out of exclude: put them back.
  const capture = {};
  for (const key of ['debug', 'width', 'height', 'dpr', 'backgroundColor', 'quality', 'format',
    'exclude', 'excludeMode', 'placeholders', 'captureSelection', 'canvas', 'embedFonts',
    'iconFonts', 'localFonts', 'excludeFonts', 'fontStylesheetDomains', 'fallbackURL', 'cache',
    'useProxy', 'outerTransforms', 'outerShadows', 'reconcile', 'burst', 'engine', 'invalidate',
    'clip', 'compress', 'excludeStyleProps', 'resolvePicturePlaceholders', 'plugins']) {
    if (opts[key] !== undefined) capture[key] = opts[key];
    else if (ctx[key] !== undefined) capture[key] = ctx[key];
  }
  if (capture.exclude === ctx.exclude && ctx.excludePredicates?.length) {
    capture.exclude = [...(ctx.exclude || []), ...ctx.excludePredicates];
  }
  capture.scale = scale;
  return {
    fps, count,
    background: exportOption(ctx, opts, 'background', defaults.background),
    async next() {
      // Always recapture the live element, including the FIRST frame of a deferred export.
      const result = await snapdom(ctx.element, capture);
      const canvas = canvases.get(result.meta);
      return canvas ? canvas({ crop: opts.crop }) : result.toCanvas({ crop: opts.crop });
    },
  };
}
