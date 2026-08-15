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
  /** Extra CSS selector; anything it matches is redacted. */
  selector?: string;
  /** Redact EVERY input and textarea, ignoring the lists above. */
  all?: boolean;
  /** Custom masker. Defaults to a same-length bullet mask. */
  mask?: (value: string, el: Element) => string;
}

/**
 * Masks form-control values before they reach the serialized capture. Core masks
 * `type="password"` only — that mask is fidelity-neutral because the control already paints
 * bullets. Everything the browser paints in the clear is captured as-is unless you add this.
 */
export declare function redactInputs(options?: RedactInputsOptions): SnapdomPlugin;
