// src/utils/resolveCSSVars.js

/** Props donde típicamente aparece var() y conviene “materializar” si difieren del baseline */
const KEY_PROPS = ['fill', 'stroke', 'color', 'background-color', 'stop-color']

/** Cache de estilos base por (namespaceURI + tagName) */
const __BASELINE_CACHE = new Map()

/** Obtiene el estilo computado “base” (sin clase ni estilo) para un tag/namespace */
function getBaselineComputed(tagName, ns) {
  const key = ns + '::' + tagName.toLowerCase()
  let entry = __BASELINE_CACHE.get(key)
  if (entry) return entry

  // Crear elemento del mismo tipo fuera del flujo visual
  const doc = document
  const el = ns === 'http://www.w3.org/2000/svg'
    ? doc.createElementNS(ns, tagName)
    : doc.createElement(tagName)

  // Lo insertamos de forma que el UA pueda computar estilos, pero sin afectar layout
  // (un shadowRoot vacío temporal funciona bien)
  const holder = doc.createElement('div')
  holder.style.cssText = 'position:absolute;left:-99999px;top:-99999px;contain:strict;display:block;'
  holder.appendChild(el)
  doc.documentElement.appendChild(holder)

  const cs = getComputedStyle(el)
  const base = {}
  for (const p of KEY_PROPS) {
    base[p] = cs.getPropertyValue(p) || ''
  }

  holder.remove()
  __BASELINE_CACHE.set(key, base)
  return base
}

/**
 * General: resuelve var() en estilos inline/atributos. Además, si no hay var()
 * pero el valor computado de KEY_PROPS difiere del baseline, inlina ese valor.
 */
export function resolveCSSVars(sourceEl, cloneEl) {
  if (!(sourceEl instanceof Element) || !(cloneEl instanceof Element)) return

  // --- 0) Pre-chequeo ultra barato
  const styleAttr = sourceEl.getAttribute?.('style')
  let hasVar = !!(styleAttr && styleAttr.includes('var('))

  if (!hasVar && sourceEl.attributes?.length) {
    const attrs = sourceEl.attributes
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i]
      if (a && typeof a.value === 'string' && a.value.includes('var(')) { hasVar = true; break }
    }
  }

  // Leemos cs sólo si hace falta o si vamos a comparar con baseline
  let cs = null
  if (hasVar) {
    try { cs = getComputedStyle(sourceEl) } catch {}
  }

  // --- 1) Resolver var() en estilos inline
  if (hasVar) {
    const author = sourceEl.style
    if (author && author.length) {
      for (let i = 0; i < author.length; i++) {
        const prop = author[i]
        const val = author.getPropertyValue(prop)
        if (!val || !val.includes('var(')) continue
        const resolved = cs && cs.getPropertyValue(prop)
        if (resolved) {
          try { cloneEl.style.setProperty(prop, resolved.trim(), author.getPropertyPriority(prop)) } catch {}
        }
      }
    }
  }

  // --- 2) Resolver var() en atributos (genérico; si prop no existe en CSS, setProperty no hace nada)
  if (hasVar && sourceEl.attributes?.length) {
    const attrs = sourceEl.attributes
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i]
      if (!a || typeof a.value !== 'string' || !a.value.includes('var(')) continue
      const propName = a.name
      const resolved = cs && cs.getPropertyValue(propName)
      if (resolved) {
        try { cloneEl.style.setProperty(propName, resolved.trim()) } catch {}
      }
    }
  }

  // --- 3) Fallback general: cubrir reglas de hoja (clases) SIN buscar en CSSOM
  // Si NO vimos var() inline/attrs, quizás la clase aplicó var(). En ese caso,
  // comparamos KEY_PROPS contra baseline del mismo tag/namespace y, si difiere,
  // inlinamos el valor computado. Esto materializa p.ej. `.css-var-fill { fill: var(--x) }`
  if (!hasVar) {
    // Leemos cs aquí sólo si lo vamos a usar
    if (!cs) {
      try { cs = getComputedStyle(sourceEl) } catch { cs = null }
    }
    if (!cs) return

    const ns = sourceEl.namespaceURI || 'html'
    const base = getBaselineComputed(sourceEl.tagName, ns)

    for (const prop of KEY_PROPS) {
      const v = cs.getPropertyValue(prop) || ''
      const b = base[prop] || ''
      if (v && v !== b) {
        // Es distinto al baseline => hay estilo de hoja afectando (posiblemente via var()).
        try { cloneEl.style.setProperty(prop, v.trim()) } catch {}
      }
    }
  }
}
