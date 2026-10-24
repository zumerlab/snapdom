/**
 * Type declarations for `@zumer/snapdom-plugins/ascii-export`.
 *
 * The plugin instance type comes from the core package: one definition of what a plugin IS,
 * so a plugin that stops matching the host's contract fails to typecheck instead of failing
 * at capture time.
 */
import type { SnapdomPlugin } from '@zumer/snapdom';
import type { Stream, StreamOptions, StreamFrame } from './stream.js';

export interface AsciiExportOptions {
  /** Character width of the output. */
  width?: number;
  /** Characters from lightest to darkest. */
  charset?: string;
  /** Invert the luminance mapping. */
  invert?: boolean;
  /** Plain text (default) or colored HTML with preserved character spacing. */
  format?: 'text' | 'html';
  /** Non-negative luminance contrast boost. */
  contrast?: number;
}

/** Adds `result.toAscii()`. */
export declare function asciiExport(options?: AsciiExportOptions): SnapdomPlugin;

/** ASCII art from any drawable (a canvas, an image, a video frame, a `stream()` frame). No capture involved. */
export declare function asciiFromCanvas(source: CanvasImageSource & { width: number; height: number }, options?: AsciiExportOptions & { charset?: string | string[] }): string;

declare module '@zumer/snapdom' {
  interface CaptureResult {
    toAscii(options?: AsciiExportOptions): Promise<string>;
  }
}

/** `stream()` plus `asciiFromCanvas()` on every frame; `onText` receives the text (or HTML when `format: 'html'`). */
export declare function asciiStream(
  element: Element,
  options?: AsciiExportOptions & { charset?: string | string[] } & StreamOptions & { onText?: (text: string, frame: StreamFrame) => void }
): Stream;
