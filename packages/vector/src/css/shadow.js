/**
 * `box-shadow` / `text-shadow` -> `{shadows: Effect[], warnings: string[]}`.
 *
 * The grammar is `<color>? && [<length>{2,4} && inset?]`, and the `&&` is the
 * whole difficulty: the colour, the keyword and the length run may appear in any
 * order, and only the lengths are ordered among themselves (x, y, blur, spread).
 * Chromium serialises colour-first, Firefox has historically serialised
 * colour-last, and an author's own string may do either — so nothing here may
 * assume a position.
 *
 * `blur` is the CSS radius VERBATIM. SVG sigma is `blur / 2` and that division
 * belongs to the emitter (svd invariant 5); doing it here would make the value
 * mean two different things depending on who read it.
 *
 * Pure: no DOM, no `getComputedStyle`.
 */
import { parseColor } from './color.js'

/**
 * Absolute units only. `em`/`rem`/`ex`/`ch`/`vw`… need a font or a viewport this
 * module does not have and must not guess at; a computed style never contains
 * them anyway, so meeting one means the input is an authored string and the
 * honest answer is to say we could not read it.
 */
const ABS_UNITS = {
  px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 25.4 / 4,
}

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i

/** `null` when the token is not a length — that is how the caller tells lengths from colours. */
function toPx(token) {
  const m = NUMBER.exec(token)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const unit = m[2].toLowerCase()
  // A bare number is a length only when it is zero; `5` alone is invalid CSS and
  // treating it as 5px would invent geometry.
  if (!unit) return n === 0 ? 0 : null
  const k = ABS_UNITS[unit]
  return k === undefined ? null : n * k
}

/**
 * Split on `sep` at paren depth 0. `rgba(0, 0, 0, .5)` carries commas of its own
 * and `color-mix(in srgb, a 40%, b)` carries both commas and spaces, so a naive
 * `split(',')` cuts a single shadow into three unparseable fragments.
 */
function splitTop(str, sep) {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '(') depth++
    else if (ch === ')') { if (depth > 0) depth-- }
    else if (depth === 0 && ch === sep) { out.push(str.slice(start, i)); start = i + 1 }
  }
  out.push(str.slice(start))
  return out
}

/** Same depth rule, on whitespace: `rgb(0 0 0 / 50%)` must survive as one token. */
function tokenize(str) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of str) {
    if (ch === '(') { depth++; cur += ch } else if (ch === ')') {
      if (depth > 0) depth--
      cur += ch
    } else if (depth === 0 && /\s/.test(ch)) {
      if (cur) { out.push(cur); cur = '' }
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/**
 * Parse a `box-shadow` / `text-shadow` value.
 *
 * @param {string} css                    the whole declaration, comma-separated
 * @param {object} [options]
 * @param {boolean} [options.inset=true]  `false` for `text-shadow`, where neither
 *                                        the `inset` keyword nor a spread is legal
 * @param {string} [options.currentColor] the element's used `color`, for the
 *                                        colourless form. The initial value of a
 *                                        shadow colour IS `currentColor`, and only
 *                                        the caller has it; without it the answer
 *                                        is opaque black plus a warning, which is
 *                                        wrong on every coloured shadow.
 * @returns {{shadows: Array<{type:'dropShadow'|'innerShadow', color:number[],
 *                            offset:number[], blur:number, spread:number, behind:boolean}>,
 *            warnings: string[]}}
 *   `shadows` in CSS order (first declared shadow first — the emitter paints it
 *   on top), `warnings` listing everything dropped, clamped or assumed.
 *
 *   The warnings used to ride along as a non-enumerable property of the returned
 *   array, which both callers ignored: a shadow that fell back to opaque black
 *   reached the document with grade `E` and no diagnostic. A degradation channel
 *   nobody can forget is worth the signature change — see CONTRACT.md, which
 *   still documents the old `Effect[]` return.
 */
export function parseShadows(css, options = {}) {
  const { inset: insetAllowed = true, currentColor = null } = options
  const out = []
  const warnings = []
  // Resolved once: the same `color` serves every shadow in the list.
  const current = currentColor ? parseColor(currentColor) : null
  if (currentColor && !current) {
    warnings.push(`shadow: currentColor "${currentColor}" could not be parsed; colourless shadows fall back to opaque black`)
  }

  const src = typeof css === 'string' ? css.trim() : ''
  if (!src || src === 'none') return { shadows: out, warnings }

  for (const raw of splitTop(src, ',')) {
    const decl = raw.trim()
    if (!decl) continue

    const lengths = []
    const rest = []
    let isInset = false
    let bad = null

    for (const token of tokenize(decl)) {
      if (/^inset$/i.test(token)) { isInset = true; continue }
      // A token that looks numeric is meant as a length, so a unit we cannot
      // resolve is an error rather than an invitation to try it as a colour.
      if (NUMBER.test(token)) {
        const px = toPx(token)
        if (px === null) { bad = token; break }
        lengths.push(px)
        continue
      }
      rest.push(token)
    }

    if (bad) {
      warnings.push(`shadow: unsupported length "${bad}" in "${decl}" — shadow dropped`)
      continue
    }
    if (lengths.length < 2 || lengths.length > 4) {
      warnings.push(`shadow: expected 2-4 lengths in "${decl}", got ${lengths.length} — shadow dropped`)
      continue
    }
    if (isInset && !insetAllowed) {
      warnings.push(`shadow: "inset" is not valid here ("${decl}") — shadow dropped`)
      continue
    }

    let [x, y, blur = 0, spread = 0] = lengths
    if (blur < 0) {
      warnings.push(`shadow: negative blur ${blur} in "${decl}" — clamped to 0`)
      blur = 0
    }
    if (spread !== 0 && !insetAllowed) {
      warnings.push(`shadow: spread is not valid on text-shadow ("${decl}") — ignored`)
      spread = 0
    }

    let color = [0, 0, 0, 1]
    const colorSrc = rest.length ? rest.join(' ') : ''
    // The initial value of the colour IS `currentColor`, and Chromium serialises
    // `filter: drop-shadow(0 1px 2px)` without one, so the colourless form is the
    // common case rather than an authored curiosity.
    if (!colorSrc || /^currentcolor$/i.test(colorSrc)) {
      if (current) {
        color = current.rgba
        for (const w of current.warnings || []) warnings.push(`shadow color (currentColor) in "${decl}": ${w}`)
      } else {
        warnings.push(`shadow: no color in "${decl}" — currentColor was not supplied by the caller, assumed opaque black`)
      }
    } else {
      // Anything left is the colour. Joining rather than taking rest[0] keeps
      // legacy space-separated forms that slipped past the tokenizer readable.
      const parsed = parseColor(colorSrc)
      if (parsed) {
        color = parsed.rgba
        // `parseColor` approximates too (canvas round-trip, gamut mapping); its
        // warnings are about THIS shadow's colour and die here if not forwarded.
        for (const w of parsed.warnings || []) warnings.push(`shadow color in "${decl}": ${w}`)
      } else {
        warnings.push(`shadow: unparseable color "${colorSrc}" in "${decl}" — assumed opaque black`)
      }
    }

    out.push({
      type: isInset ? 'innerShadow' : 'dropShadow',
      color,
      offset: [x, y],
      blur,
      spread,
      behind: false,
    })
  }

  return { shadows: out, warnings }
}
