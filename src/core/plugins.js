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
// core/plugins.js

const __plugins = []

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
 * Llama un hook y propaga un acumulador (compat con tu runHook actual).
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

/**
 * NUEVO: recolecta los valores devueltos por TODOS los plugins para un hook.
 * Útil para `defineExports` (cada plugin devuelve un mapa propio).
 */
export async function runAll(name, context, payload) {
  const outs = []
  for (const p of __plugins) {
    const fn = p && typeof p[name] === 'function' ? p[name] : null
    if (!fn) continue
    const out = await fn(context, payload)
    if (typeof out !== 'undefined') outs.push(out)
  }
  return outs
}

export function pluginsList() { return __plugins.slice() }
export function clearPlugins() { __plugins.length = 0 }
