/**
 * Exporters registry (by format).
 * An exporter declares supported formats and an export() method:
 *
 * interface Exporter {
 *   format: string | string[];                 // e.g., 'png' or ['png','image/png']
 *   export(context: object, args: { format: string, options: object, url: string }): Promise<any> | any;
 * }
 */

const __exporters = new Map();

/**
 * Normalize an exporter def: Factory, [Factory, options], { exporter, options }, instance.
 * @param {any} spec
 * @returns {any|null}
 */
export function normalizeExporter(spec) {
  if (!spec) return null;
  if (Array.isArray(spec)) {
    const [factory, options] = spec;
    return typeof factory === 'function' ? factory(options) : factory;
  }
  if (typeof spec === 'object' && 'exporter' in spec) {
    const { exporter, options } = spec;
    return typeof exporter === 'function' ? exporter(options) : exporter;
  }
  if (typeof spec === 'function') return spec();
  return spec;
}

/**
 * Register one or many exporters.
 * Last one wins on format collision.
 * @param  {...any} defs
 */
export function registerExporters(...defs) {
  const flat = defs.flat();
  for (const d of flat) {
    const inst = normalizeExporter(d);
    if (!inst) continue;
    const formats = Array.isArray(inst.format) ? inst.format : [inst.format];
    for (const fmtRaw of formats) {
      const fmt = String(fmtRaw || '').toLowerCase().trim();
      if (!fmt) continue;
      __exporters.set(fmt, inst);
    }
  }
}

/**
 * Resolve the exporter for a format (case-insensitive).
 * @param {string} format
 * @returns {any|null}
 */
export function getExporter(format) {
  if (!format) return null;
  const key = String(format).toLowerCase().trim();
  return __exporters.get(key) || null;
}

/** Utilities for tests */
export function _exportersMap() { return new Map(__exporters); }
export function _clearExporters() { __exporters.clear(); }
