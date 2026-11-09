/** One subtree exclusion rule for paint, inline text and clipboard traversal. */
export function isExcluded (el, rules = []) {
  for (const attr of ['data-snapdom-exclude', 'data-vector-exclude']) {
    if (el.hasAttribute && el.hasAttribute(attr)) return true
  }
  if (el.getAttribute && el.getAttribute('data-capture') === 'exclude') return true
  for (const rule of rules) {
    if (typeof rule === 'function') {
      if (rule(el)) return true
    } else if (typeof rule === 'string' && el.matches && el.matches(rule)) return true
  }
  return false
}
