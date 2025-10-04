/**
 * Resolve any author-specified CSS variable usages (var(...)) into computed values
 * on the cloned element. Works for HTML & SVG, inline styles and attributes,
 * without relying on tag/attribute whitelists.
 *
 * @param {Element} sourceEl - Original element in live DOM
 * @param {HTMLElement|SVGElement} cloneEl - Cloned element (detached)
 */
export function resolveCSSVars(sourceEl, cloneEl) {
  if (!(sourceEl instanceof Element) || !(cloneEl instanceof Element)) return

  // Ultra-cheap precheck: only proceed if we find at least one "var(" in style or attrs
  const styleAttr = sourceEl.getAttribute?.('style')
  let hasVar = !!(styleAttr && styleAttr.includes('var('))
  if (!hasVar && sourceEl.attributes?.length) {
    const attrs = sourceEl.attributes
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i]
      if (a && typeof a.value === 'string' && a.value.includes('var(')) { hasVar = true; break }
    }
  }
  if (!hasVar) return

  // Single computed style read per affected element
  let cs
  try { cs = getComputedStyle(sourceEl) } catch { return }

  // 1) Inline styles by the author that contain var()
  const author = sourceEl.style
  if (author && author.length) {
    for (let i = 0; i < author.length; i++) {
      const prop = author[i]
      const val = author.getPropertyValue(prop)
      if (!val || !val.includes('var(')) continue
      const resolved = cs.getPropertyValue(prop)
      if (resolved) {
        try {
          cloneEl.style.setProperty(prop, resolved.trim(), author.getPropertyPriority(prop))
        } catch {}
      }
    }
  }

  // 2) Attributes with var(): attempt to resolve using the same attribute name as CSS property
  if (sourceEl.attributes?.length) {
    const attrs = sourceEl.attributes
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i]
      if (!a || typeof a.value !== 'string' || !a.value.includes('var(')) continue

      const propName = a.name // generic: no lists
      let resolved = ''
      try { resolved = cs.getPropertyValue(propName) } catch {}
      if (resolved) {
        try { cloneEl.style.setProperty(propName, resolved.trim()) } catch {}
      }
    }
  }
}
