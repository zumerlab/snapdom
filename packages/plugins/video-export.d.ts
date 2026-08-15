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
  scale?: number;
  /** `videoBitsPerSecond` passed to MediaRecorder. */
  bitrate?: number;
  /** Download filename; the extension is set to .mp4/.webm automatically. */
  filename?: string;
}

/** Adds `result.toVideo()`: records a sequence of captures through MediaRecorder. */
export declare function videoExport(options?: VideoExportOptions): SnapdomPlugin;
