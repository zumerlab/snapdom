/**
 * Type declarations for `@zumer/snapdom-plugins/redact-inputs`.
 *
 * The plugin instance type comes from the core package: one definition of what a plugin IS,
 * so a plugin that stops matching the host's contract fails to typecheck instead of failing
 * at capture time.
 */
import type { SnapdomPlugin } from '@zumer/snapdom';

export interface RedactInputsOptions {
  /** `input` type values to redact. */
  types?: string[];
  /** autocomplete tokens to redact; a trailing '*' matches a prefix. */
  autocomplete?: string[];
  /** Extra CSS selector for input/textarea source elements. */
  selector?: string;
  /** Redact EVERY input and textarea, ignoring the lists above. */
  all?: boolean;
  /** Custom masker, called with the cloned field. Defaults to same-length bullets; glyph widths may differ. */
  mask?: (value: string, el: Element) => string;
  /**
   * CSS selectors for source subtrees to exclude. Uses the capture's excludeMode ('hide' by default).
   * If the capture root belongs to a blocked subtree, 'remove' throws; use 'hide'.
   */
  blocks?: string | string[];
  /**
   * Remove exact named attributes from matching clones and their semantic projections; names are not patterns.
   * Does not erase copies already rendered as text, CSS content or bitmap pixels; use blocks for visible content.
   * A value rule on input/textarea also clears its displayed value and omits its structured state.value.
   */
  attributes?: Array<{ selector: string; names: string[] }>;
}

/**
 * Masks form-control values before they reach the serialized capture. Core masks
 * `type="password"` only — that mask is fidelity-neutral because the control already paints
 * bullets. Everything the browser paints in the clear is captured as-is unless you add this.
 * Optional blocks exclude whole subtrees; attribute rules remove named attributes. The live DOM is unchanged.
 * These rules do not search captured text or images for sensitive content.
 * The default mask without selectors permits unchanged-repeat memoization; custom masks and selectors run every capture.
 * Nonempty blocks/attribute rules add a beforeRender pass, so experimental html-in-canvas captures use SVG.
 */
export declare function redactInputs(options?: RedactInputsOptions): SnapdomPlugin;
