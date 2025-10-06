/**
 * Plugin core for SnapDOM (minimalistic).
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
 */

const __plugins = []

/**
 * Normalize any plugin spec into an instance.
 * Accepts: Factory, [Factory, options], { plugin, options }, plain instance.
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
 * Register many plugins globally.
 * @param  {...any} defs
 */
export function registerPlugins(...defs) {
  const flat = defs.flat()
  for (const d of flat) {
    const inst = normalizePlugin(d)
    if (inst && !__plugins.includes(inst)) __plugins.push(inst)
  }
}

/**
 * Emit a hook to all plugins (in registration order).
 * If a plugin returns non-undefined, it becomes the accumulator.
 * @param {string} name
 * @param {object} context
 * @param {any} [payload]
 * @returns {Promise<any>}
 */
export async function runHook(name, context, payload) {
  let acc = payload
  for (const p of __plugins) {
    const fn = p && typeof p[name] === 'function' ? p[name] : null
    if (!fn) continue
    const out = await fn(context, acc)
    if (typeof out !== 'undefined') acc = out
  }
  return acc
}

/** Utilities to query/clear (handy for tests) */
export function pluginsList() { return __plugins.slice() }
export function clearPlugins() { __plugins.length = 0 }
