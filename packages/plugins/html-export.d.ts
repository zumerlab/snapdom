/**
 * Type declarations for `@zumer/snapdom-plugins/html-export`.
 *
 * The plugin instance type comes from the core package: one definition of what a plugin IS,
 * so a plugin that stops matching the host's contract fails to typecheck instead of failing
 * at capture time.
 */
import type { SnapdomPlugin } from '@zumer/snapdom';

export interface HtmlExportOptions {
  /** Wrap in a full `<!DOCTYPE html>` document; false returns `<style>` + fragment. */
  fullDocument?: boolean;
  /** Download filename when `toHtml({ download: true })` is used. */
  filename?: string;
}

export interface ToHtmlOptions extends HtmlExportOptions {
  /** true, or a filename string, to also trigger a download. */
  download?: boolean | string;
}

/**
 * Adds `result.toHtml()`: the capture as a self-contained, re-renderable HTML document —
 * markup plus inlined styles and fonts, not pixels.
 *
 * The returned document carries the captured markup as-is, INCLUDING any event-handler
 * attributes the original nodes had. Treat it as untrusted content when you serve it.
 */
export declare function htmlExport(options?: HtmlExportOptions): SnapdomPlugin;

export default htmlExport;
