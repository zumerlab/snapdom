/**
 * Type declarations for `@zumer/snapdom-plugins/jxl`.
 *
 * The plugin instance type comes from the core package: one definition of what a plugin IS,
 * so a plugin that stops matching the host's contract fails to typecheck instead of failing
 * at capture time. Nothing here imports rapier-jxl, an optional peer dependency.
 */
import type { SnapdomPlugin } from '@zumer/snapdom';

/** Every pixel exact, efforts 1-5. */
export type ExactCaptureModule = 'rapier-jxl/capture';
/** Photographic capture, efforts 1-3. */
export type UploadCaptureModule = 'rapier-jxl/upload';
/** Exact text and lossy photos in one file, efforts 1-9. The default. */
export type CompleteCaptureModule = 'rapier-jxl/capture-complete';
export type JxlCaptureModule = ExactCaptureModule | UploadCaptureModule | CompleteCaptureModule;

/** Higher effort takes longer to encode, usually for a smaller file. */
export type JxlEffort = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Reported once for the file the export returns. */
export interface JxlEncodedRecord {
  /** True when every pixel of the file is exact. */
  exact: boolean;
  bands?: number;
}

/** Your own encoder: a rapier-jxl codec (`createCodec`) or a directly imported capture module. */
export interface JxlEncoder {
  prepare(kind: 'capture'): Promise<void>;
  capture(input: HTMLCanvasElement, options: Record<string, unknown>): Promise<{
    fits: boolean;
    bytes?: Uint8Array;
    reason?: { code?: string; message?: string };
  }>;
}

/** Helper workers for a codec the plugin creates; `count: 0` may omit `memoryBytes`. */
/** `memoryBytes` bounds the helpers' memory; it is required for a `count` above 0. */
export type JxlHelpers = boolean | { count: 0; memoryBytes?: number } | { count: number; memoryBytes: number };

/** A decoder for `toJxl()` where the browser cannot show JPEG XL: `createCodec()` from `rapier-jxl/codec/decode`. */
export interface JxlDecoder {
  decode(input: Blob, options: Record<string, unknown>): Promise<{ data: Uint8Array; width: number; height: number }>;
}

export interface JxlOptions {
  /** Default `'rapier-jxl/capture-complete'`, which the plugin creates; the others need your `codec`. */
  module?: JxlCaptureModule;
  /** Your own encoder; the plugin then creates none and ignores `helpers`. */
  codec?: JxlEncoder;
  /** Without one, `toJxl()` rejects with `JXL_NOT_SHOWN` where the browser cannot show JPEG XL. */
  decoder?: JxlDecoder;
  /** Default effort for each export (3 when omitted); an export's `effort` wins. */
  effort?: JxlEffort;
  /** `false` disables WebGPU; `'required'` requires a device for work that uses it. */
  webgpu?: false | 'required';
  helpers?: JxlHelpers;
}

/** `toWebp()`'s options with the same defaults, plus effort and the encoding callbacks. */
export interface JxlExportOptions {
  /** Default 0.92. Below 1, photos take this quality; 1 is exact. */
  quality?: number;
  scale?: number;
  width?: number;
  height?: number;
  dpr?: number;
  /** Default `'#ffffff'`. */
  backgroundColor?: string | null;
  filename?: string;
  format?: string;
  effort?: JxlEffort;
  signal?: AbortSignal;
  /** Encoding progress from 0 to 1, after SnapDOM draws. */
  onProgress?: (fraction: number) => void;
  onEncoded?: (record: JxlEncodedRecord) => void;
}

/**
 * Adds `result.toJxl()` (an `<img>`), `toBlob({ format: 'jxl' })` (the file) and
 * `download({ format: 'jxl' })`. Install rapier-jxl next to the plugins.
 */
export declare function jxl(options?: JxlOptions): JxlPlugin;

export interface JxlPlugin extends SnapdomPlugin {
  /** Ends the encoder the plugin created (never your own `codec` or `decoder`); a later export creates it again. */
  close(): Promise<void>;
}
export default jxl;

declare module '@zumer/snapdom' {
  interface CaptureResult {
    toJxl(options?: JxlExportOptions): Promise<HTMLImageElement>;
    toBlob(options: JxlExportOptions & { format: 'jxl' }): Promise<Blob>;
    download(options: JxlExportOptions & { format: 'jxl' }): Promise<void>;
  }
}
