/**
 * Private provenance for helper nodes snapdom mounts in the live document.
 *
 * Public markers (`data-snapdom-internal`, `data-snapdom-sandbox`, `#snapdom-sandbox`,
 * `data-snapdom="injected-import"`) remain observable for CSS, tests and cleanup, but cannot
 * prove ownership: authors may validly use the same names. Destructive decisions such as
 * dropping or removing a subtree use this module-instance WeakSet instead.
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
