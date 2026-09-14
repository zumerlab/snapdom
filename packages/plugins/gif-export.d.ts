/**
 * Type declarations for `@zumer/snapdom-plugins/gif-export`.
 *
 * The plugin instance type comes from the core package: one definition of what a plugin IS,
 * so a plugin that stops matching the host's contract fails to typecheck instead of failing
 * at capture time.
 */
import type { SnapdomPlugin } from '@zumer/snapdom';

export interface GifExportOptions {
  fps?: number;
  /** Total duration in ms. Ignored when `frames` is set. */
  duration?: number;
  /** Explicit frame count; overrides `duration`. */
  frames?: number;
  /** Palette size per frame, 2-256. */
  maxColors?: number;
  /** Color composited under transparent pixels. */
  background?: string;
  /** Capture scale; inherits the original capture when omitted. */
  scale?: number;
  /** Loop count: 0 = forever, -1 = play once. */
  repeat?: number;
  filename?: string;
}

/** Adds `result.toGif()`: records a sequence of captures into an animated GIF. */
export declare function gifExport(options?: GifExportOptions): SnapdomPlugin;
export default gifExport;
