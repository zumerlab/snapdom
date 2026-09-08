import { isDocument } from '../utils/helpers.js'

/**
 * Lightweight CSS counter resolver for SnapDOM.
 * - Supports counter(name[, style]) and counters(name, sep[, style])
 * - counter-reset push vs replace (push if parent has that counter, replace otherwise)
 * - Carries state across siblings in document order
 * - Simple OL/UL indexing (start, li[value]); reversed not handled intentionally
 *
 * @module counter
 */

/**
 * Whether a `content` value calls counter() or counters(). The cheap gate before any walk.
 * @param {string} input
 * @returns {boolean}
 */
export function hasCounters(input) {
  return /\bcounter\s*\(|\bcounters\s*\(/.test(input || '')
}

/**
 * a, b, ..., z, aa, ab, ...
 * @param {number} n
 * @param {boolean} upper
 * @returns {string}
 */
function alpha(n, upper = false) {
  let s = '', x = Math.max(1, n)
  while (x > 0) { x--; s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26) }
  return upper ? s.toUpperCase() : s
}

/**
 * Roman numerals (1..3999)
 * @param {number} n
 * @param {boolean} upper
 * @returns {string}
 */
function roman(n, upper = true) {
  const map = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]
  let num = Math.max(1, Math.min(3999, n)), out = ''
  for (const [v, sym] of map) while (num >= v) { out += sym; num -= v }
  return upper ? out : out.toLowerCase()
}

/**
 * Format a counter value in a CSS counter-style keyword. Negative values keep their sign
 * (`-05` under decimal-leading-zero); alpha and roman clamp to 1, unknown styles print digits.
 * @param {number} value
 * @param {string} style
 * @returns {string}
 */
function formatCounter(value, style) {
  switch ((style || 'decimal').toLowerCase()) {
    case 'decimal': return String(value)
    case 'decimal-leading-zero': {
      const abs = Math.abs(value)
      return (value < 0 ? '-' : '') + (abs < 10 ? '0' : '') + String(abs)
    }
    // `lower-latin`/`upper-latin` are exact aliases of the -alpha forms (CSS Counter Styles
    // §6.1). Falling through to the decimal default rendered digits where the page shows
    // letters — an `a. b. c.` list captured as `1. 2. 3.`.
    case 'lower-alpha': case 'lower-latin': return alpha(value, false)
    case 'upper-alpha': case 'upper-latin': return alpha(value, true)
    case 'lower-roman': return roman(value, false)
    case 'upper-roman': return roman(value, true)
    default: return String(value)
  }
}

/**
 * Tokenizes a counter-reset / -set / -increment declaration into [name, value] pairs.
 * The grammar is `[<counter-name> <integer>?]+` — WHITESPACE-separated. Splitting on commas
 * (which are not part of it) collapsed `counter-reset: chapter 0 section 0` into a single
 * part and silently dropped every counter after the first. Counter names are custom-idents
 * and cannot start with a digit, so a numeric token is unambiguously the preceding name's
 * value. Commas are tolerated as separators rather than parsed, costing nothing.
 * @param {string} decl
 * @param {number} dflt - value when a name carries no integer (0 for reset/set, 1 for increment)
 * @returns {Array<[string, number]>}
 */
export function counterPairs(decl, dflt) {
  const toks = (decl || '').trim().split(/[\s,]+/).filter(Boolean)
  const out = []
  for (let i = 0; i < toks.length; i++) {
    const name = toks[i]
    if (name === 'none') continue
    const next = toks[i + 1]
    const hasVal = next !== undefined && Number.isFinite(Number(next))
    out.push([name, hasVal ? Number(next) : dflt])
    if (hasVal) i++
  }
  return out
}

/**
 * Build a counter context by walking the DOM once.
 * It stores, for each Element, a Map<counterName, number[]> (stack).
 *
 * Rules:
 * - counter-reset on element:
 *    * if parent had that counter -> push (nest)
 *    * else -> replace (start a fresh stack with [value])
 * - counter-increment on element: add to top, creating top=0 if needed
 * - list-item: sets 'list-item' value for LI in OL/UL (supports start, li[value])
 *
 * Built once per capture, lazily (pseudo.js lazyCounterContext), so a page with no counter
 * in any pseudo never pays the walk. Pinned by __tests__/module.counter.test.js.
 * @param {Document|Element} root
 * @returns {{ get(node: Element, name: string): number, getStack(node: Element, name: string): number[] }}
 */
export function buildCounterContext(root) {
  const nodeCounters = new WeakMap()
  const rootEl = isDocument(root) ? root.documentElement : root

  const isLi = (el) => el && el.tagName === 'LI'
  // The walk is already in document order. Carry each list's ordinal instead of counting
  // all previous siblings for every LI (quadratic), and continue from explicit li[value].
  const listOrdinals = new WeakMap()
  const cloneMap = (m) => {
    const out = new Map()
    for (const [k, arr] of m) out.set(k, arr.slice())
    return out
  }

  // Apply resets/increments/list-item given base map and the *parent* map (to decide push vs replace)
  const applyTo = (baseMap, parentMap, el) => {
    const map = cloneMap(baseMap)
    let cs
    try { cs = getComputedStyle(el) } catch { cs = el.style }

    // counter-reset
    let reset
    try { reset = cs?.counterReset } catch {}
    if (reset && reset !== 'none') {
      for (const [name, val] of counterPairs(reset, 0)) {
        const parentStack = parentMap.get(name)
        if (parentStack && parentStack.length) {
          const s = parentStack.slice() // nest on parent's stack
          s.push(val)
          map.set(name, s)
        } else {
          map.set(name, [val])         // replace any carried state
        }
      }
    }

    // counter-set (sets top value without creating a new scope)
    let set
    try { set = cs?.counterSet } catch {}
    if (set && set !== 'none') {
      for (const [name, val] of counterPairs(set, 0)) {
        const stack = map.get(name) || []
        if (stack.length === 0) stack.push(0)
        stack[stack.length - 1] = val
        map.set(name, stack)
      }
    }

    // counter-increment
    let inc
    try { inc = cs?.counterIncrement } catch {}
    if (inc && inc !== 'none') {
      for (const [name, by] of counterPairs(inc, 1)) {
        const stack = map.get(name) || []
        if (stack.length === 0) stack.push(0)
        stack[stack.length - 1] += by
        map.set(name, stack)
      }
    }

    // list-item for LI in OL/UL (start, li[value])
    try {
      if (cs?.display === 'list-item' && isLi(el)) {
        const p = el.parentElement
        const previous = p && listOrdinals.get(p)
        const start = p?.tagName === 'OL' ? parseInt(p.getAttribute('start'), 10) : NaN
        let idx = previous === undefined ? (Number.isFinite(start) ? start : 1) : previous + 1
        const own = p?.tagName === 'OL' ? parseInt(el.getAttribute('value'), 10) : NaN
        if (Number.isFinite(own)) idx = own
        if (p) listOrdinals.set(p, idx)
        const s = map.get('list-item') || []
        if (s.length === 0) s.push(0)
        s[s.length - 1] = idx
        map.set('list-item', s)
      }
    } catch {}

    return map
  }

  // Recursive build with (parentMap, carryMap) and carry state across siblings
  const build = (el, parentMap, carryMap) => {
    const curr = applyTo(carryMap, parentMap, el)
    nodeCounters.set(el, curr)

    let nextCarry = curr
    for (const child of el.children) {
      const childCarry = build(child, curr, nextCarry)
      nextCarry = childCarry
    }

    // Sibling carry: strip depth added by counter-reset on this element.
    // counter-reset creates a scope local to this subtree; it must not leak
    // to the next sibling. Truncate each counter back to the depth it had in
    // the incoming carryMap, preserving increments but discarding new scopes.
    const siblingCarry = new Map()
    for (const [name, inStack] of carryMap) {
      const depth = inStack.length
      const finalStack = nextCarry.get(name)
      siblingCarry.set(name, finalStack && finalStack.length
        ? finalStack.slice(0, depth)
        : inStack.slice())
    }
    // Counters created by increment (no prior existence, no reset) are
    // implicitly root-level and should propagate to siblings at depth 1.
    for (const [name, finalStack] of nextCarry) {
      if (!siblingCarry.has(name) && finalStack.length && !parentMap.has(name)) {
        siblingCarry.set(name, finalStack.slice(0, 1))
      }
    }
    return siblingCarry
  }

  const empty = new Map()
  build(rootEl, empty, empty)

  // The context is per-capture (lazily built on sessionCache) and never outlives its
  // capture, so no cross-capture invalidation is needed here.
  return {
    /**
     * Get top value for counter name at given node.
     * @param {Element} node
     * @param {string} name
     */
    get(node, name) {
      const s = nodeCounters.get(node)?.get(name)
      return s && s.length ? s[s.length - 1] : 0
    },
    /**
     * Get full stack for counter name at given node.
     * @param {Element} node
     * @param {string} name
     */
    getStack(node, name) {
      const s = nodeCounters.get(node)?.get(name)
      return s ? s.slice() : []
    }
  }
}

/**
 * Resolves counter()/counters() calls inside a content string for a specific node,
 * returning the content with counter() expanded but quoted-string tokens preserved.
 * The caller (pseudo.js) is responsible for joining tokens and stripping quotes —
 * keeping quotes here lets its tokenizer work so source whitespace between adjacent
 * tokens (e.g. `counter(x) ")"`) doesn't leak into the rendered text.
 *
 * @param {string} raw
 * @param {Element} node
 * @param {{get(node: Element, name: string): number, getStack(node: Element, name: string): number[]}} ctx
 * @returns {string} `raw` with the calls expanded; `'- '` when the context throws
 */
export function resolveCountersInContent(raw, node, ctx) {
  if (!raw || raw === 'none') return raw
  try {
    const RX = /\b(counter|counters)\s*\(([^)]+)\)/g
    return raw.replace(RX, (_, fn, args) => {
      const parts = String(args).split(',').map(s => s.trim())
      if (fn === 'counter') {
        const name = parts[0]?.replace(/^["']|["']$/g, '')
        const style = (parts[1] || 'decimal').toLowerCase()
        const v = ctx.get(node, name)
        return formatCounter(v, style)
      } else { // counters(name, sep, style?)
        const name = parts[0]?.replace(/^["']|["']$/g, '')
        const sep  = (parts[1]?.replace(/^["']|["']$/g, '')) ?? ''
        const style = (parts[2] || 'decimal').toLowerCase()
        const stack = ctx.getStack(node, name)
        if (!stack.length) return '' // empty, no trailing sep
        const pieces = stack.map(v => formatCounter(v, style))
        return pieces.join(sep)
      }
    })
  } catch {
    return '- '
  }
}
