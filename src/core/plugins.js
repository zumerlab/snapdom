/**
 * Plugin core for SnapDOM (minimalistic, local-first compatible).
 *
 * Public hooks:
 *  - beforeSnap(context)
 *  - beforeClone(context)
 *  - afterClone(context)
 *  - beforeRender(context)
 *  - afterRender(context)
 *  - beforeExport(context, { format, options })
 *  - afterExport(context, { format, options, result })
 *  - afterSnap(context)
 *
 * Hook signature: (context, payload?) => void | any | Promise<void|any>
 *
 * Global plugins are registered via registerPlugins()
 * Local (per-capture) plugins can be attached using attachSessionPlugins().
 */

const __plugins = []

/**
 * Normalize any plugin definition form into an instance.
 * Supports plain objects, [factory, options], { plugin, options }, or functions.
 * @param {any} spec
 * @returns {any|null}
 */
export function normalizePlugin(spec) {
  if (!spec) return null
  if (Array.isArray(spec)) {
    const [factory, options] = spec
    return typeof factory === 'function' ? factory(options) : factory
  }
  if (typeof spec === 'object' && 'plugin' in spec) {
    const { plugin, options } = spec
    return typeof plugin === 'function' ? plugin(options) : plugin
  }
  if (typeof spec === 'function') return spec()
  return spec
}

/**
 * Register global plugins (deduped by name, preserves order).
 * @param  {...any} defs
 */
export function registerPlugins(...defs) {
  const flat = defs.flat()
  for (const d of flat) {
    const inst = normalizePlugin(d)
    if (!inst) continue
    // 🔒 de-dup por name
    if (!__plugins.some(p => p && p.name && inst.name && p.name === inst.name)) {
      __plugins.push(inst)
    }
  }
}

/**
 * INTERNAL: pick the plugin list for a given context.
 * If the context defines a per-capture plugin list, use that (local-first).
 * Otherwise, fall back to the global registry.
 * @param {any} context
 * @returns {readonly any[]}
 */
function getContextPlugins(context) {
  const arr = context && Array.isArray(context.plugins) ? context.plugins : __plugins
  return arr || __plugins
}

/**
 * Llama un hook y propaga un acumulador (compat con tu runHook actual).
 * Usa los plugins locales si existen, o los globales en fallback.
 * @param {string} name
 * @param {any} context
 * @param {any} payload
 */
export async function runHook(name, context, payload) {
  let acc = payload
  const list = getContextPlugins(context)
  for (const p of list) {
    const fn = p && typeof p[name] === 'function' ? p[name] : null
    if (!fn) continue
    const out = await fn(context, acc)
    if (typeof out !== 'undefined') acc = out
  }
  return acc
}

/**
 * NUEVO: recolecta los valores devueltos por TODOS los plugins para un hook.
 * Útil para `defineExports` (cada plugin devuelve un mapa propio).
 * Usa plugins locales si existen, o los globales en fallback.
 * @param {string} name
 * @param {any} context
 * @param {any} payload
 */
export async function runAll(name, context, payload) {
  const outs = []
  const list = getContextPlugins(context)
  for (const p of list) {
    const fn = p && typeof p[name] === 'function' ? p[name] : null
    if (!fn) continue
    const out = await fn(context, payload)
    if (typeof out !== 'undefined') outs.push(out)
  }
  return outs
}

/**
 * Return a shallow copy of currently registered global plugins.
 * @returns {any[]}
 */
export function pluginsList() { return __plugins.slice() }

/** Clear all globally registered plugins (mostly for tests). */
export function clearPlugins() { __plugins.length = 0 }

/* ──────────────────────────────────────────────────────────────────────────────
 * NEW: Local-first per-capture support (without removing global APIs)
 * ────────────────────────────────────────────────────────────────────────────── */

/**
 * Merge local (per-capture) plugin defs with the global registry (local-first).
 * - Local plugins override globals by `name`.
 * - Accepts plain instances, factories ([factory, options]) and {plugin, options}.
 * - Returns a frozen array for immutability & GC safety.
 * @param {any[]|undefined} localDefs
 * @returns {ReadonlyArray<any>}
 */
export function mergePlugins(localDefs) {
  /** @type {any[]} */
  const out = []

  // 1️⃣ Locals first (priority)
  if (Array.isArray(localDefs)) {
    for (const d of localDefs) {
      const inst = normalizePlugin(d)
      if (!inst || !inst.name) continue
      const i = out.findIndex(x => x && x.name === inst.name)
      if (i >= 0) out.splice(i, 1)
      out.push(inst)
    }
  }

  // 2️⃣ Then globals if not already present
  for (const g of __plugins) {
    if (g && g.name && !out.some(x => x.name === g.name)) {
      out.push(g)
    }
  }

  return Object.freeze(out)
}

/**
 * Attach a per-capture plugin list on the given context (local-first).
 * Idempotent: if `context.plugins` already exists, it remains unless `force` is true.
 * @param {any} context
 * @param {any[]|undefined} localDefs
 * @param {boolean} [force=false]
 * @returns {any} the same context (for chaining)
 */
export function attachSessionPlugins(context, localDefs, force = false) {
  if (!context || (context.plugins && !force)) return context
  context.plugins = mergePlugins(localDefs)
  return context
}

/**
 * Shallow copy of current global plugins (handy for tests or introspection).
 * @returns {any[]}
 */
export function getGlobalPlugins() {
  return __plugins.slice()
}
