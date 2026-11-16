/**
 * Plugin registry and hook runner.
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
 * Hook signature: (context, payload?) => void | any | Promise<void|any>. Per-capture plugins
 * (`snapdom(el, { plugins })`) win over registerPlugins() globals by name. Spec: PLUGIN_SPEC.md.
 * @module plugins
 */

// Re-exported through the `@zumer/snapdom/plugins` subpath, so a plugin validates `needs` with
// the same words core resolves it by (stages.js).
import { DEFAULT_STAGE } from './stages.js'
export { STAGES, DEFAULT_STAGE, assertNeeds } from './stages.js'

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
 * Register global plugins (deduped by name, order kept). A global plugin may NOT lower the
 * stage: a global `needs: 'clone'` would stop every capture in the application before pixels,
 * including call sites that never heard of it.
 * @param  {...any} defs
 * @throws {Error} when a global plugin declares `needs` other than 'render'
 */
export function registerPlugins(...defs) {
  const flat = defs.flat()
  for (const d of flat) {
    const inst = normalizePlugin(d)
    if (!inst) continue
    if (inst.needs !== undefined && inst.needs !== DEFAULT_STAGE) {
      throw new Error(`[SnapDOM] '${inst.name || '(unnamed)'}' declares needs: ${JSON.stringify(inst.needs)}, so it can't be a global plugin (it would stop every capture before '${DEFAULT_STAGE}'). Pass it per capture: snapdom(el, { plugins: [...] }).`)
    }
    // Dedup by name
    if (!__plugins.some(p => p && p.name && inst.name && p.name === inst.name)) {
      __plugins.push(inst)
    }
  }
}

/**
 * INTERNAL: the context's per-capture plugin list (local-first), else the global registry.
 * @param {any} context
 * @returns {readonly any[]}
 */
function getContextPlugins(context) {
  return context && Array.isArray(context.plugins) ? context.plugins : __plugins
}

/**
 * Calls a hook and threads an accumulator through it.
 * Uses the per-capture plugins when present, falling back to the globals.
 * @param {string} name
 * @param {any} context
 * @param {any} payload
 * @returns {Promise<any>} the payload, or the last value a hook returned in its place
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
 * Collects the values returned by EVERY plugin for one hook.
 * Used by `defineExports`, where each plugin returns a map of its own.
 * Uses the per-capture plugins when present, falling back to the globals. Every plugin sees
 * the same payload; nothing is chained.
 * @param {string} name
 * @param {any} context
 * @param {any} payload
 * @returns {Promise<any[]>} the non-undefined returns, in plugin order
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

/** Clear all globally registered plugins (mostly for tests). */
export function clearPlugins() { __plugins.length = 0 }

/* Local-first per-capture plugins, next to the global APIs. */

/** Counter behind the `anonymous-N` names handed to unnamed local plugins. */
let __anonSeq = 0

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

  // Locals first (priority)
  if (Array.isArray(localDefs)) {
    for (const d of localDefs) {
      const inst = normalizePlugin(d)
      if (!inst) continue
      // `name` exists for dedup and local-over-global override; a plugin without one is still
      // a plugin. A per-instance name keeps it running and never collides (dropping it here
      // silently skipped its hooks).
      if (!inst.name) inst.name = `anonymous-${++__anonSeq}`
      const i = out.findIndex(x => x && x.name === inst.name)
      if (i >= 0) out.splice(i, 1)
      out.push(inst)
    }
  }

  // Then globals not already present
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

/** Hooks that touch the clone or the render, which the memo and diff paths would skip or re-run
 *  against retained state. buildResult serves export-only plugins (defineExports, beforeExport,
 *  afterExport) on every path. */
const RENDER_HOOKS = ['resolveNode', 'beforeSnap', 'beforeClone', 'afterClone', 'beforeRender', 'afterRender']

/**
 * True when the capture has a render-affecting plugin that has NOT declared itself pure.
 * Auto-burst and the diff path bail on these, as the engine seam's hasPlugins rule does: a
 * memo would skip their hooks and a spliced subtree would drop their changes. A plugin whose
 * hooks are deterministic and idempotent sets `pure: true` to get the fast paths back.
 * @param {{plugins?: any[]}} context
 * @returns {boolean}
 */
export function hasImpureRenderPlugins(context) {
  const defs = Array.isArray(context && context.plugins) ? context.plugins : []
  for (const d of defs) {
    const inst = normalizePlugin(d)
    if (!inst || inst.pure === true) continue
    for (const h of RENDER_HOOKS) {
      if (typeof inst[h] === 'function') return true
    }
  }
  return false
}
