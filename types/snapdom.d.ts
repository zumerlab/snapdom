declare module "@zumer/snapdom" {
  export interface SnapOptions {
    compress?: boolean;
    embedFonts?: boolean;
    fast?: boolean;
    scale?: number;
    backgroundColor?: string;
    format?: "png" | "jpeg" | "jpg" | "webp" | "svg";
    filename?: string;
    dpr?: number;
    quality?: number;
  }

  export interface SnapResult {
    url: string;
    options: SnapOptions;
    toRaw(): string;
    toImg(): Promise<HTMLImageElement>;
    toCanvas(): Promise<HTMLCanvasElement>;
    toBlob(): Promise<Blob>;
    toPng(options?: SnapOptions): Promise<HTMLImageElement>;
    toJpg(options?: SnapOptions): Promise<HTMLImageElement>;
    toWebp(options?: SnapOptions): Promise<HTMLImageElement>;
    download(options?: SnapOptions): Promise<void>;
  }

  /**
   * Captura un elemento del DOM como imagen SVG + métodos de exportación.
   */
  export function snapdom(
    element: HTMLElement,
    options?: SnapOptions
  ): Promise<SnapResult>;

  export namespace snapdom {
    function capture(element: HTMLElement, options?: SnapOptions): Promise<SnapResult>;
    function toRaw(element: HTMLElement, options?: SnapOptions): Promise<string>;
    function toImg(element: HTMLElement, options?: SnapOptions): Promise<HTMLImageElement>;
    function toCanvas(element: HTMLElement, options?: SnapOptions): Promise<HTMLCanvasElement>;
    function toBlob(element: HTMLElement, options?: SnapOptions): Promise<Blob>;
    function toPng(element: HTMLElement, options?: SnapOptions): Promise<HTMLImageElement>;
    function toJpg(element: HTMLElement, options?: SnapOptions): Promise<HTMLImageElement>;
    function toWebp(element: HTMLElement, options?: SnapOptions): Promise<HTMLImageElement>;
    function download(element: HTMLElement, options?: SnapOptions): Promise<void>;
  }

  /**
   * Precarga imágenes, fondos y fuentes para acelerar capturas posteriores.
   */
  export function preCache(
    root?: Document | HTMLElement,
    options?: {
      embedFonts?: boolean;
    }
  ): Promise<void>;
}
