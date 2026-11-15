/**
 * Private provenance for helper nodes snapdom mounts in the live document.
 *
 * Public markers (`data-snapdom-internal`, `data-snapdom-sandbox`, `#snapdom-sandbox`,
 * `data-snapdom="injected-import"`) remain observable for CSS, tests and cleanup, but cannot
 * prove ownership: authors may validly use the same names. Destructive decisions such as
 * dropping or removing a subtree use this module-instance WeakSet instead.
 *
 * Also the transient edits snapdom makes to the page's own nodes (`noteSelfWrite`), so their
 * mutation records are not taken for the page changing.
 * @module utils/ownership
 */

const internalNodes = new WeakSet()

/**
 * Mark a live helper element as created by this snapdom module instance.
 * @param {Element} node
 * @returns {Element}
 */
export function markInternalNode(node) {
  internalNodes.add(node)
  node.setAttribute('data-snapdom-internal', '')
  return node
}

/**
 * Report whether this snapdom module instance created a node.
 * @param {Node} node
 * @returns {boolean}
 */
export function isInternalNode(node) {
  return internalNodes.has(node)
}

/** node -> [what it held before snapdom wrote to it, what snapdom last wrote]. */
const selfWrites = new WeakMap()

/**
 * Record an edit snapdom makes to a page node and undoes before it returns: the text of a
 * clamped box (lineClamp.js), the inline style of a `content-visibility: auto` box
 * (prepare.helpers.js). Only edits whose forced state every capture of the node reproduces
 * belong here; the outline shim does not (a child captured alone is read without it).
 * @param {Node} node
 * @param {string} before - its text, or its `style.cssText`
 * @param {string} during - what snapdom wrote
 */
export function noteSelfWrite(node, before, during) {
  const w = selfWrites.get(node)
  if (w) w[1] = during
  else selfWrites.set(node, [before, during])
}

/**
 * Whether a mutation record on `node` is snapdom's own edit or its undo: the node holds what
 * it held before, or what snapdom wrote. Any other value is the page's, and the node is
 * forgotten so the records that follow count as the page's too.
 * @param {Node} node
 * @param {string} value - what the node holds now
 * @returns {boolean}
 */
export function isSelfWrite(node, value) {
  const w = selfWrites.get(node)
  if (!w) return false
  if (value === w[0] || value === w[1]) return true
  selfWrites.delete(node)
  return false
}
