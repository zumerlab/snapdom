/**
 * Type declarations for `@zumer/snapdom-plugins/pdf-image`.
 *
 * The plugin instance type comes from the core package: one definition of what a plugin IS,
 * so a plugin that stops matching the host's contract fails to typecheck instead of failing
 * at capture time.
 */
import type { SnapdomPlugin } from '@zumer/snapdom';

export interface PdfImageOptions {
  orientation?: 'portrait' | 'landscape';
  /** JPEG quality, 0-1. */
  quality?: number;
  filename?: string;
}

/** Adds `result.toPdfImage()`: the capture as a JPEG embedded in a downloadable PDF. */
export declare function pdfImage(options?: PdfImageOptions): SnapdomPlugin;
