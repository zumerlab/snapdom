import type { SnapdomPlugin } from '@zumer/snapdom';

/** A CSS selector, or a predicate that returns true for an element to leave out. */
export type Exclusion = string | ((element: Element) => boolean);

export interface VectorOptions {
  /** Elements to leave out of the vector output. On a call it wins over the vector() default. */
  exclude?: Exclusion | Exclusion[];
}

/** Create the plugin. A capture it runs on gains toVector() and toFigma(). */
export declare function vector(options?: VectorOptions): SnapdomPlugin;
export default vector;

declare module '@zumer/snapdom' {
  interface CaptureResult {
    /**
     * The capture as a standalone SVG string: real shapes, editable text, no
     * foreignObject. Requires vector() on this capture and a connected source element.
     */
    toVector(options?: VectorOptions): Promise<string>;
    /**
     * Copy the capture to the clipboard in Figma's paste format, then paste it into
     * a Figma file. Needs the async clipboard API: https or localhost, from a user action.
     */
    toFigma(options?: VectorOptions): Promise<void>;
  }
}
