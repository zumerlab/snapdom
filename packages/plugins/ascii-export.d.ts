/**
 * Type declarations for `@zumer/snapdom-plugins/ascii-export`.
 *
 * The plugin instance type comes from the core package: one definition of what a plugin IS,
 * so a plugin that stops matching the host's contract fails to typecheck instead of failing
 * at capture time.
 */
import type { SnapdomPlugin } from '@zumer/snapdom';

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

declare module '@zumer/snapdom' {
  interface CaptureResult {
    toAscii(options?: AsciiExportOptions): Promise<string>;
  }
}
