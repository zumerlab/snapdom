/**
 * contextExport – Official SnapDOM Plugin
 *
 * Adds a toContext() export: a compact, LLM-friendly structured view of the captured
 * UI — structure, roles, visible text and geometry — designed to be READ by a model
 * without pixels. Complements agent-map (which is about ACTING: numbered badges on
 * interactive elements): together a capture yields "what does this UI say" and
 * "what can I click", from the same call.
 *
 * Token economy is the design constraint: the default output is an indented outline
 * (cheaper to tokenize than JSON), wrapper elements that add no information are
 * collapsed, invisible content is skipped, and text is whitespace-normalized.
 *
 * Usage:
 *   import { contextExport } from '@zumer/snapdom-plugins/context-export';
 *   const result = await snapdom(el, { plugins: [contextExport()] });
 *   const outline = await result.toContext();          // string outline (default)
 *   const tree = await result.toContext({ format: 'json' });
 *
 * Output line shape (outline format):
 *   tag[#id][.class] [x,y wxh] "visible text" {state}
 *
 * @param {Object} [options]
 * @param {'outline'|'json'} [options.format='outline']
 * @param {number} [options.maxTextLength=120] - Per-node text cap (ellipsised)
 * @param {number} [options.maxNodes=800] - Hard cap; output notes truncation
 * @param {boolean} [options.geometry=true] - Include bounding boxes
 * @returns {Object} SnapDOM plugin
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'TITLE'])

/** Tags that carry structure/meaning on their own — never collapsed. */
const MEANINGFUL_TAGS = new Set([
  'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'FORM', 'IMG', 'VIDEO', 'AUDIO',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'UL', 'OL', 'LI', 'TABLE', 'TR', 'TD', 'TH',
  'NAV', 'MAIN', 'HEADER', 'FOOTER', 'ARTICLE', 'SECTION', 'ASIDE', 'FIGURE', 'FIGCAPTION',
  'BLOCKQUOTE', 'PRE', 'CODE', 'DETAILS', 'SUMMARY', 'DIALOG', 'CANVAS', 'SVG', 'IFRAME',
])

export function contextExport(options = {}) {
  const {
    format = 'outline',
    maxTextLength = 120,
    maxNodes = 800,
    geometry = true,
  } = options

  return {
    name: 'context-export',
    // Export-only + beforeSnap stash (beforeSnap doesn't touch the clone/render, but it
    // IS render-phase adjacent; it only records the element reference, so declare pure
    // to keep the engine's memo/diff fast paths).
    pure: true,
    beforeSnap(ctx) {
      if (ctx && ctx.options) ctx.options.__contextSource = ctx.element
      return ctx
    },

    defineExports() {
      return {
        context: async (ctx, opts = {}) => {
          const el = ctx.__contextSource || ctx.element
          if (!el) throw new Error('[snapdom] context-export: no source element on context')
          const _format = opts.format ?? format
          const _maxText = opts.maxTextLength ?? maxTextLength
          const _maxNodes = opts.maxNodes ?? maxNodes
          const _geometry = opts.geometry ?? geometry

          const rootRect = el.getBoundingClientRect()
          const state = { count: 0, truncated: false }
          const tree = buildNode(el, rootRect, _maxText, _maxNodes, _geometry, state)
          if (_format === 'json') {
            return { root: tree, truncated: state.truncated, nodes: state.count }
          }
          const lines = []
          renderOutline(tree, 0, lines)
          if (state.truncated) lines.push(`… (truncated at ${_maxNodes} nodes)`)
          return lines.join('\n')
        }
      }
    }
  }
}

function visibleText(node) {
  let out = ''
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) out += c.nodeValue
  }
  return out.replace(/\s+/g, ' ').trim()
}

function isHidden(el) {
  try {
    const cs = getComputedStyle(el)
    return cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0
  } catch { return false }
}

function nodeState(el) {
  const s = {}
  if (el.tagName === 'A' && el.getAttribute('href')) s.href = el.getAttribute('href')
  if (el.disabled) s.disabled = true
  if (el.checked !== undefined && (el.type === 'checkbox' || el.type === 'radio')) s.checked = !!el.checked
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    if (el.value) s.value = String(el.value).slice(0, 40)
    if (el.placeholder) s.placeholder = el.placeholder
  }
  if (el.tagName === 'SELECT' && el.selectedOptions?.[0]) s.value = el.selectedOptions[0].textContent.trim().slice(0, 40)
  if (el.tagName === 'IMG') s.alt = el.getAttribute('alt') || ''
  const aria = el.getAttribute('aria-label')
  if (aria) s.label = aria
  const role = el.getAttribute('role')
  if (role) s.role = role
  if (el.tagName === 'DETAILS') s.open = el.hasAttribute('open')
  return Object.keys(s).length ? s : null
}

function buildNode(el, rootRect, maxText, maxNodes, geometry, state) {
  if (state.count >= maxNodes) { state.truncated = true; return null }
  state.count++
  const node = { tag: el.localName }
  if (el.id) node.id = el.id
  const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
  if (cls.length) node.class = cls.join('.')
  if (geometry) {
    try {
      const r = el.getBoundingClientRect()
      node.box = [
        Math.round(r.left - rootRect.left), Math.round(r.top - rootRect.top),
        Math.round(r.width), Math.round(r.height),
      ]
    } catch { }
  }
  const text = visibleText(el)
  if (text) node.text = text.length > maxText ? text.slice(0, maxText - 1) + '…' : text
  const st = nodeState(el)
  if (st) node.state = st

  const children = []
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (SKIP_TAGS.has(c.tagName) || isHidden(c)) continue
    const child = buildNode(c, rootRect, maxText, maxNodes, geometry, state)
    if (child) children.push(child)
  }
  if (children.length) node.children = children

  // Collapse information-free wrappers: a lone child under a meaning-less container
  // hoists up (its own geometry survives; the wrapper's adds nothing an LLM needs).
  if (
    !MEANINGFUL_TAGS.has(el.tagName) && !node.id && !node.state && !node.text &&
    children.length === 1
  ) {
    state.count--
    return children[0]
  }
  return node
}

function renderOutline(node, depth, lines) {
  if (!node) return
  let line = '  '.repeat(depth) + node.tag
  if (node.id) line += `#${node.id}`
  if (node.class) line += `.${node.class}`
  if (node.box) line += ` [${node.box[0]},${node.box[1]} ${node.box[2]}x${node.box[3]}]`
  if (node.text) line += ` "${node.text}"`
  if (node.state) {
    const bits = Object.entries(node.state).map(([k, v]) => (v === true ? k : `${k}=${v}`))
    line += ` {${bits.join(' ')}}`
  }
  lines.push(line)
  if (node.children) for (const c of node.children) renderOutline(c, depth + 1, lines)
}

export default contextExport
