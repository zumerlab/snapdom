/** JPEG XL exports. The host owns the plugin contract; jpegxl remains an optional peer. */
import type { SnapdomPlugin, CanvasCrop } from '@zumer/snapdom';

/** Every pixel exact, efforts 1-5. */
export type ExactCaptureModule = 'jpegxl/capture';
/** Photographic capture, efforts 1-3. */
export type UploadCaptureModule = 'jpegxl/upload';
/** Exact text and lossy photos, efforts 1-9. The default. */
export type CompleteCaptureModule = 'jpegxl/capture-complete';
export type JxlCaptureModule = ExactCaptureModule | UploadCaptureModule | CompleteCaptureModule;
export type JxlEffort = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Reported once for the file the export returns. */
export interface JxlEncodedRecord {
  /** True when every pixel of the file is exact. */
  exact: boolean;
  /** Unboxed text was not searched for. */
  textMarks?: 'skipped';
}

/** A directly imported capture module, or an encoder with its prepare and capture methods. */
export interface JxlEncoder {
  prepare(operation?: 'capture'): Promise<void>;
  capture(input: HTMLCanvasElement, options?: Record<string, unknown>): Promise<{
    meetsTarget: boolean;
    bytes?: Uint8Array | null;
    kept?: string | null;
    textMarks?: 'skipped';
    reason?: { code?: string; message?: string } | null;
  }>;
}

/** Alternate modules need the codec you import. Configure helpers on that module. */
export type JxlOptions = {
  module?: CompleteCaptureModule;
  codec?: JxlEncoder;
  /** Default 3; each export can override it. */
  effort?: JxlEffort;
  /** Disable WebGPU, or require a device for work that uses it. */
  webgpu?: false | 'required';
} | {
  module: ExactCaptureModule;
  codec: JxlEncoder;
  effort?: 1 | 2 | 3 | 4 | 5;
  webgpu?: never;
} | {
  module: UploadCaptureModule;
  codec: JxlEncoder;
  effort?: 1 | 2 | 3;
  webgpu?: never;
};

/** Export options and encoding callbacks. Callback promises settle before the export does. */
export interface JxlExportOptions {
  /** Default 0.92. Photos take this quality; 1 is exact. */
  quality?: number;
  scale?: number;
  width?: number;
  height?: number;
  dpr?: number;
  crop?: CanvasCrop;
  /** Transparent unless a color is set. */
  backgroundColor?: string | null;
  filename?: string;
  format?: string;
  effort?: JxlEffort;
  signal?: AbortSignal;
  /** Encoding progress from 0 to 1, after SnapDOM draws. */
  onProgress?: ((fraction: number) => void) | ((fraction: number) => PromiseLike<void>);
  onEncoded?: ((record: JxlEncodedRecord) => void) | ((record: JxlEncodedRecord) => PromiseLike<void>);
}

/** Add toJxl(), toBlob({ format: 'jxl' }) and download({ format: 'jxl' }). */
export declare function jxl(options?: JxlOptions): JxlPlugin;
export type JxlPlugin = SnapdomPlugin;
export default jxl;

declare module '@zumer/snapdom' {
  interface CaptureResult {
    toJxl(options?: JxlExportOptions): Promise<HTMLImageElement>;
    toBlob(options: JxlExportOptions & { format: 'jxl' }): Promise<Blob>;
    download(options: JxlExportOptions & { format: 'jxl' }): Promise<void>;
  }
}
