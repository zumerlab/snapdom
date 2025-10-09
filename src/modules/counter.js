import { cache } from '../core/cache'

/**
 * Lightweight CSS counter resolver for SnapDOM.
 * - Supports counter(name[, style]) and counters(name, sep[, style])
 * - counter-reset push vs replace (push if parent has that counter, replace otherwise)
 * - Carries state across siblings in document order
 * - Simple OL/UL indexing (start, li[value]); reversed not handled intentionally
 *
 * @module counters
 */

/** Detects if a content string uses counter()/counters(). */
export function hasCounters(input) {
  return /\bcounter\s*\(|\bcounters\s*\(/.test(input || '')
}

/** Replace every CSS string token "..." with its raw content (keeps single quotes). */
export function unquoteDoubleStrings(s) {
  return (s || '').replace(/"([^"]*)"/g, '$1')
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
 * Format a numeric counter value according to CSS counter-style keyword.
 * NOTE: Keeps your original clamp to 0 in decimal variants.
 * @param {number} value
 * @param {string} style
 * @returns {string}
 */
function formatCounter(value, style) {
  switch ((style || 'decimal').toLowerCase()) {
    case 'decimal': return String(Math.max(0, value))
    case 'decimal-leading-zero': return (value < 10 ? '0' : '') + String(Math.max(0, value))
    case 'lower-alpha': return alpha(value, false)
    case 'upper-alpha': return alpha(value, true)
    case 'lower-roman': return roman(value, false)
    case 'upper-roman': return roman(value, true)
    default: return String(Math.max(0, value))
  }
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
 * @param {Document|Element} root
 * @returns {{ get(node: Element, name: string): number, getStack(node: Element, name: string): number[] }}
 */
export function buildCounterContext(root) {
  const getEpoch = () => (cache?.session?.__counterEpoch ?? 0)
   let run = getEpoch()
  const nodeCounters = new WeakMap()
  const rootEl = (root instanceof Document) ? root.documentElement : root

  const isLi = (el) => el && el.tagName === 'LI'
  const countPrevLi = (li) => {
    let c = 0, p = li?.parentElement
    if (!p) return 0
    for (const sib of p.children) { if (sib === li) break; if (sib.tagName === 'LI') c++ }
    return c
  }
  const cloneMap = (m) => {
    const out = new Map()
    for (const [k, arr] of m) out.set(k, arr.slice())
    return out
  }

  // Apply resets/increments/list-item given base map and the *parent* map (to decide push vs replace)
  const applyTo = (baseMap, parentMap, el) => {
    const map = cloneMap(baseMap)

    // counter-reset
    let reset
    try { reset = el.style?.counterReset || getComputedStyle(el).counterReset } catch {}
    if (reset && reset !== 'none') {
      for (const part of reset.split(',')) {
        const toks = part.trim().split(/\s+/)
        const name = toks[0]
        const val = Number.isFinite(Number(toks[1])) ? Number(toks[1]) : 0
        if (!name) continue

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

    // counter-increment
    let inc
    try { inc = el.style?.counterIncrement || getComputedStyle(el).counterIncrement } catch {}
    if (inc && inc !== 'none') {
      for (const part of inc.split(',')) {
        const toks = part.trim().split(/\s+/)
        const name = toks[0]
        const by = Number.isFinite(Number(toks[1])) ? Number(toks[1]) : 1
        if (!name) continue
        const stack = map.get(name) || []
        if (stack.length === 0) stack.push(0)
        stack[stack.length - 1] += by
        map.set(name, stack)
      }
    }

    // list-item for LI in OL/UL (start, li[value])
    try {
      const cs = getComputedStyle(el)
      if (cs.display === 'list-item' && isLi(el)) {
        const p = el.parentElement
        let idx = 1
        if (p && p.tagName === 'OL') {
          const startAttr = p.getAttribute('start')
          const start = Number.isFinite(Number(startAttr)) ? Number(startAttr) : 1
          const prev = countPrevLi(el)
          const ownAttr = el.getAttribute('value')
          idx = Number.isFinite(Number(ownAttr)) ? Number(ownAttr) : (start + prev)
        } else {
          idx = 1 + countPrevLi(el)
        }
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
    return curr // for the next sibling of the parent
  }

  const empty = new Map()
  build(rootEl, empty, empty)

    // Si cambió el epoch, reconstruimos el mapa antes de responder
  function ensureFresh() {
    const now = getEpoch()
    if (now !== run) {
      run = now
      const empty = new Map()
      build(rootEl, empty, empty)
    }
  }

  return {
    /**
     * Get top value for counter name at given node.
     * @param {Element} node
     * @param {string} name
     */
    get(node, name) {
      ensureFresh()
      const s = nodeCounters.get(node)?.get(name)
      return s && s.length ? s[s.length - 1] : 0
    },
    /**
     * Get full stack for counter name at given node.
     * @param {Element} node
     * @param {string} name
     */
    getStack(node, name) {
      ensureFresh()
      const s = nodeCounters.get(node)?.get(name)
      return s ? s.slice() : []
    }
  }
}

/**
 * Resolves counter()/counters() calls inside a content string for a specific node,
 * returning a plain string suitable for textContent. Also strips double-quote tokens.
 *
 * @param {string} raw
 * @param {Element} node
 * @param {{get(node: Element, name: string): number, getStack(node: Element, name: string): number[]}} ctx
 */
export function resolveCountersInContent(raw, node, ctx) {
  if (!raw || raw === 'none') return raw
  try {
    const RX = /\b(counter|counters)\s*\(([^)]+)\)/g
    let out = raw.replace(RX, (_, fn, args) => {
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
    return unquoteDoubleStrings(out)
  } catch {
    return '- '
  }
}

/**
 * Create a derived counter context that applies a pseudo's counter-reset /
 * counter-increment *for this node only*, before resolving content.
 * Works with ::before / ::after (and any pseudo with content).
 *
 * @param {Element} node
 * @param {CSSStyleDeclaration|null} pseudoStyle getComputedStyle(node, '::before' | '::after')
 * @param {{get(node: Element, name: string): number, getStack(node: Element, name: string): number[]}} baseCtx
 */
export function deriveCounterCtxForPseudo(node, pseudoStyle, baseCtx) {
  const modStacks = new Map()

  /** Parse "a 1, b -2" -> [{name:'a', num:1}, {name:'b', num:-2}] */
  function parseListDecl(value) {
    const out = []
    if (!value || value === 'none') return out
    for (const part of String(value).split(',')) {
      const toks = part.trim().split(/\s+/)
      const name = toks[0]
      const num = Number.isFinite(Number(toks[1])) ? Number(toks[1]) : undefined
      if (name) out.push({ name, num })
    }
    return out
  }

  const resets = parseListDecl(pseudoStyle?.counterReset)
  const incs   = parseListDecl(pseudoStyle?.counterIncrement)

  function getStackDerived(name) {
    if (modStacks.has(name)) return modStacks.get(name).slice()

    // base stack at this node from the element context
    let stack = baseCtx.getStack(node, name)
    stack = stack.length ? stack.slice() : []

    // counter-reset (push if exists, replace if not)
    const r = resets.find(x => x.name === name)
    if (r) {
      const val = Number.isFinite(r.num) ? r.num : 0
      if (stack.length) {
        stack = stack.slice()
        stack.push(val)
      } else {
        stack = [val]
      }
    }

    // counter-increment (on top; create top=0 if missing)
    const inc = incs.find(x => x.name === name)
    if (inc) {
      const by = Number.isFinite(inc.num) ? inc.num : 1
      if (stack.length === 0) stack = [0]
      stack[stack.length - 1] += by
    }

    modStacks.set(name, stack.slice())
    return stack
  }

  return {
    get(_node, name) {
      const s = getStackDerived(name)
      return s.length ? s[s.length - 1] : 0
    },
    getStack(_node, name) {
      return getStackDerived(name)
    }
  }
}

/**
 * Convenience helper: resolve the final text to render for a pseudo's `content`,
 * correctly applying the pseudo's own counter-reset/increment before evaluation.
 *
 * @param {Element} node
 * @param {'::before'|'::after'} pseudo
 * @param {{get(node: Element, name: string): number, getStack(node: Element, name: string): number[]}} baseCtx
 * @returns {string} resolved content (without surrounding double quotes)
 */
export function resolvePseudoContent(node, pseudo, baseCtx) {
  let ps
  try { ps = getComputedStyle(node, pseudo) } catch {}
  const raw = ps?.content
  if (!raw || raw === 'none' || raw === 'normal') return ''
  const derived = deriveCounterCtxForPseudo(node, ps, baseCtx)
  let out = resolveCountersInContent(raw, node, derived)
  return unquoteDoubleStrings(out)
}
