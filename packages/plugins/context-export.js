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
 * The snapshot is taken during the capture, not when toContext() is called: a deferred read
 * would describe whatever the page looks like THEN, which is a different instant from the
 * image. toContext() only formats what was already frozen — `format` and `maxTextLength`
 * still apply per call; `maxNodes` and `geometry` are decided when the snapshot is taken.
 *
 * @param {Object} [options]
 * @param {'outline'|'json'} [options.format='outline']
 * @param {number} [options.maxTextLength=120] - Per-node text cap (ellipsised)
 * @param {number} [options.maxNodes=800] - Hard cap; output notes truncation
 * @param {boolean} [options.geometry=true] - Include bounding boxes
 * @param {'clone'|'render'} [options.needs='render'] - How far the capture runs.
 *   'clone' skips the render; result.url then throws.
 * @returns {Object} SnapDOM plugin
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'TITLE'])

/* Sensitive-input guard (self-contained: this package publishes standalone).
 * Secrets are EXCLUDED, never truncated — a truncated password is still a leak. */
const SENSITIVE_AC = new Set(['current-password', 'new-password', 'one-time-code'])
function isSensitiveInput(el) {
  if (!el || el.tagName !== 'INPUT') return false
  const type = (el.getAttribute('type') || 'text').toLowerCase()
  if (type === 'password' || type === 'email' || type === 'tel') return true
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase()
  if (!ac) return false
  for (const token of ac.split(/\s+/)) {
    if (SENSITIVE_AC.has(token) || token.startsWith('cc-')) return true
  }
  return false
}
function maskedValue(value) {
  return '\u2022'.repeat(Math.min(String(value ?? '').length, 12))
}

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
  // `needs` names how far the capture has to run. This export reads the live page in
  // beforeClone, so it does not need pixels: `contextExport({ needs: 'clone' })` skips the
  // render. It cannot go shallower than that any more, and it should not: a capture that
  // takes no clone is not a capture, it is this plugin calling its own function.
  const needs = options.needs ?? 'render'

  return {
    name: 'context-export',
    needs,

    // The freeze. Everything below reads the live DOM, so it has to happen while the
    // capture's instant is still the page's instant.
    beforeClone(ctx) {
      const el = ctx.element
      const state = {
        count: 0,
        truncated: false,
        // The capture's ONE exclusion policy (src/core/context.js). Absent only when a
        // caller drives the hook with a hand-built context.
        exclude: typeof ctx.shouldExclude === 'function' ? ctx.shouldExclude : NEVER,
      }
      const root = buildNode(el, el.getBoundingClientRect(), maxNodes, geometry, state)
      ctx.__contextSnapshot = { root, truncated: state.truncated, nodes: state.count }
    },

    defineExports() {
      return {
        context: async (ctx, opts = {}) => {
          const snap = ctx.__contextSnapshot
          if (!snap) throw new Error('[snapdom] context-export: this capture carries no snapshot (it never ran beforeClone). It is not re-read on demand — that would be a different instant.')
          // Core carries its image format in every normalized export bag. Only this
          // plugin's two formats override its factory default.
          const _format = opts.format === 'json' || opts.format === 'outline' ? opts.format : format
          const _maxText = opts.maxTextLength ?? maxTextLength
          const _geometry = opts.geometry ?? geometry

          const root = snap.root && project(snap.root, _maxText, _geometry)
          if (_format === 'json') {
            return { root, truncated: snap.truncated, nodes: snap.nodes }
          }
          const lines = []
          renderOutline(root, 0, lines)
          if (snap.truncated) lines.push(`… (truncated at ${maxNodes} nodes)`)
          return lines.join('\n')
        }
      }
    }
  }
}

const NEVER = () => false

function visibleText(node) {
  let out = ''
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) out += c.nodeValue
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** What actually paints under `el`, mirroring deepClone: a <slot> renders its assigned
 *  elements, and an open shadow root renders in place of the host's light children —
 *  except unassigned ones, which core clones after the shadow fragment. Walking only
 *  `children` made every shadow-DOM component invisible to the export. */
function renderedChildren(el) {
  if (el.localName === 'slot') {
    const assigned = el.assignedElements?.({ flatten: true }) || []
    return assigned.length ? assigned : el.children
  }
  const sr = el.shadowRoot
  if (!sr) return el.children
  const slotted = new Set()
  for (const s of sr.querySelectorAll('slot')) for (const n of s.assignedElements()) slotted.add(n)
  return [...sr.children, ...Array.from(el.children).filter((c) => !slotted.has(c))]
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
    // Sensitive inputs: value NEVER emitted (exclusion, not truncation — a truncated
    // password is still a leak). Other inputs: masked; the agent sees "has content".
    if (el.value && !isSensitiveInput(el)) { s.value = maskedValue(el.value); s.hasValue = true }
    else if (el.value) s.hasValue = true
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

function buildNode(el, rootRect, maxNodes, geometry, state) {
  if (state.count >= maxNodes) { state.truncated = true; return null }
  // Excluded subtrees are not walked at all: `exclude` is the redaction feature, and a
  // semantic export that ignored it would hand the redacted text straight to a model.
  if (state.exclude(el)) return null
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
  if (text) node.text = text
  const st = nodeState(el)
  if (st) node.state = st

  const children = []
  for (const c of renderedChildren(el)) {
    if (SKIP_TAGS.has(c.tagName) || isHidden(c)) continue
    const child = buildNode(c, rootRect, maxNodes, geometry, state)
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

/** Export-time formatting of the frozen snapshot: text caps and geometry are presentation,
 *  so they stay per-call, and neither touches the DOM. */
function project(node, maxText, geometry) {
  const out = { tag: node.tag }
  if (node.id) out.id = node.id
  if (node.class) out.class = node.class
  if (geometry && node.box) out.box = [...node.box]
  if (node.text) out.text = node.text.length > maxText ? node.text.slice(0, maxText - 1) + '…' : node.text
  if (node.state) out.state = { ...node.state }
  if (node.children) out.children = node.children.map((c) => project(c, maxText, geometry))
  return out
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
