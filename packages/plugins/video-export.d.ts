/**
 * Type declarations for `@zumer/snapdom-plugins/video-export`.
 *
 * The plugin instance type comes from the core package: one definition of what a plugin IS,
 * so a plugin that stops matching the host's contract fails to typecheck instead of failing
 * at capture time.
 */
import type { SnapdomPlugin } from '@zumer/snapdom';

export interface VideoExportOptions {
  fps?: number;
  /** Total duration in ms. Ignored when `frames` is set. */
  duration?: number;
  /** Explicit frame count; overrides `duration`. */
  frames?: number;
  /** Color composited under transparent pixels. */
  background?: string;
  /** Capture scale; inherits the original capture when omitted. */
  scale?: number;
  /** `videoBitsPerSecond` passed to MediaRecorder. */
  bitrate?: number;
  /** Download filename; the default follows the actual .mp4/.webm container. */
  filename?: string;
}

/** Adds `result.toMp4()`: records through MediaRecorder, with WebM fallback when needed. */
export declare function videoExport(options?: VideoExportOptions): SnapdomPlugin;
export default videoExport;
