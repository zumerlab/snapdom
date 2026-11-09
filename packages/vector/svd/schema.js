/**
 * SVD schema validator — strict by design.
 *
 * It rejects; it never repairs. A repaired document is a document whose bug
 * ships, and the whole point of SVD is that every loss is declared. The
 * orchestrator runs `validate` on its own output and throws, so a false
 * *negative* here is a silently broken export while a false *positive* is a
 * loud crash during development — the asymmetry is deliberate.
 *
 * What it checks, in three layers:
 *
 *  1. Per node, locally (`validateNode`): shape, enums, ranges, and the text
 *     offsets, which are self-contained because they index `text.characters`.
 *  2. Across the document (`validate`): every id in `children` resolves, the
 *     graph is a tree rooted at `root` — no cycles, no second parents, no
 *     unreachable islands — and every `assets` / `styles` / node reference
 *     lands on something that exists.
 *  3. The rule that outranks the rest of the schema (index.js invariant 9):
 *     **every node whose `fidelity.grade` is not `E` is named by an entry in
 *     `diagnostics`.** A degradation nobody declared is the failure mode this
 *     format exists to prevent.
 *
 * Fields the contract fixes are required. Fields it leaves open are
 * type-checked when present and never invented: this module must not decide,
 * by rejecting, what a collector is allowed to emit.
 *
 * No DOM, no dependencies — the harness fuzzes it from Node.
 */

// index.js re-exports validate/validateNode, so this import closes a cycle.
// It is safe *only* because nothing here dereferences these bindings at module
// scope: by the time any exported function runs, index.js has finished
// evaluating. Do not hoist them into a top-level `new Set(...)`.
import { SVD_VERSION, NODE_TYPES, FIDELITY } from './index.js'

const PAINT_TYPES = ['solid', 'linear', 'radial', 'angular', 'image']
const GRADIENT_TYPES = ['linear', 'radial', 'angular']
const GRADIENT_SHAPES = ['circle', 'ellipse']
const EFFECT_TYPES = ['dropShadow', 'innerShadow', 'layerBlur', 'backgroundBlur', 'colorMatrix']
const SHADOW_TYPES = ['dropShadow', 'innerShadow']
/** `feColorMatrix type="matrix"` is four rows of five, row-major. */
const COLOR_MATRIX_LEN = 20
const STROKE_ALIGNS = ['inside', 'center', 'outside']
const CLIP_MODES = ['rect', 'path']
const BOXES = ['border', 'padding', 'content', 'text']
const MASK_TYPES = ['alpha', 'luminance']
const DIRECTIONS = ['ltr', 'rtl']
const SEVERITIES = ['info', 'warn', 'error']

/** CSS `mix-blend-mode`, verbatim: a typo here is a silent visual change. */
const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'plus-lighter',
]

/** The root's `abs` is relative to itself, so its origin is 0 up to float noise. */
const ORIGIN_EPS = 1e-6

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isId = (v) => typeof v === 'string' && v.length > 0
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const quote = (v) => JSON.stringify(String(v))

/** Short, unambiguous rendering of a bad value — errors are read, not parsed. */
function show (v) {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (typeof v === 'string') return JSON.stringify(v.length > 48 ? `${v.slice(0, 48)}…` : v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `array(${v.length})`
  if (typeof v === 'function') return 'function'
  return 'object'
}

const oneOf = (list) => list.map(quote).join(' | ')

// ——— field checkers ———
//
// Each takes the value, the field path, and `at(path, message)`. Paths are
// absolute within the node so an error can be pasted into a debugger.

/** Invariant 4: colors are [r,g,b,a] floats 0..1 in sRGB. */
function checkColor (v, path, at) {
  if (!Array.isArray(v) || v.length !== 4) {
    at(path, `must be an [r,g,b,a] array of 4 floats in 0..1 (got ${show(v)})`)
    return
  }
  for (let i = 0; i < 4; i++) {
    const c = v[i]
    if (!isNum(c)) at(`${path}[${i}]`, `must be a finite number (got ${show(c)})`)
    else if (c < 0 || c > 1) at(`${path}[${i}]`, `must be in 0..1 (got ${c})`)
  }
}

function checkRect (v, path, at) {
  if (!isObject(v)) {
    at(path, `must be an object {x, y, w, h} in CSS px (got ${show(v)})`)
    return
  }
  for (const k of ['x', 'y', 'w', 'h']) {
    if (!isNum(v[k])) at(`${path}.${k}`, `must be a finite number (got ${show(v[k])})`)
  }
  if (isNum(v.w) && v.w < 0) at(`${path}.w`, `must be >= 0 (got ${v.w})`)
  if (isNum(v.h) && v.h < 0) at(`${path}.h`, `must be >= 0 (got ${v.h})`)
}

function checkMatrix (v, path, at) {
  if (!Array.isArray(v) || v.length !== 6 || !v.every(isNum)) {
    at(path, `must be a 2x3 matrix [a,b,c,d,e,f] of finite numbers (got ${show(v)})`)
  }
}

/** tl, tr, br, bl — each an [rx, ry] pair, overlap factor already applied. */
function checkRadii (v, path, at) {
  if (!Array.isArray(v) || v.length !== 4) {
    at(path, `must be 4 corner pairs [tl, tr, br, bl] (got ${show(v)})`)
    return
  }
  v.forEach((corner, i) => {
    if (!Array.isArray(corner) || corner.length !== 2 ||
        !corner.every((n) => isNum(n) && n >= 0)) {
      at(`${path}[${i}]`, `must be [rx, ry], both finite and >= 0 (got ${show(corner)})`)
    }
  })
}

/** A point in the gradient's unit square, `[x, y]`. */
function checkUnitPoint (v, path, at) {
  if (!Array.isArray(v) || v.length !== 2 || !v.every(isNum)) {
    at(path, `must be [x, y] in the unit square (got ${show(v)})`)
  }
}

/**
 * `unit` keys, fixed per gradient type by the contract.
 *
 * They are checked because a consumer that probes for a key nobody emits does
 * not crash: it takes its default and paints something plausible and wrong.
 * That is exactly how every linear gradient once shipped flattened to
 * top-to-bottom — three consumers each invented a probe list (`from||start||p0`)
 * and the one that guessed `from` alone silently lost the gradient direction on
 * every layer. A key that is missing has to fail HERE, on the machine that
 * produced the document, not on the screen of whoever opens it.
 *
 *   linear   {p0, p1}                  gradient line endpoints
 *   radial   {center, radius, shape}   shape is 'circle' | 'ellipse'
 *   angular  {center, startAngle}      degrees CW from 12 o'clock
 *
 * Extra keys are allowed — `linear.angle` is carried for readability and costs
 * nothing. Only the absence of a normative key is an error.
 */
function checkUnit (p, path, at) {
  const u = p.unit
  if (!isObject(u)) {
    at(path, `must be the gradient geometry in the unit square (got ${show(u)})`)
    return
  }
  if (p.type === 'linear') {
    checkUnitPoint(u.p0, `${path}.p0`, at)
    checkUnitPoint(u.p1, `${path}.p1`, at)
    return
  }
  if (p.type === 'radial') {
    checkUnitPoint(u.center, `${path}.center`, at)
    // The contract spells the radius `[rx, ry]`; `css/gradient.js` still emits
    // the scalar it normalizes anisotropy out of (the ellipse is absorbed into
    // `transform`, so one number is enough). Both are accepted, and the day the
    // collector emits the pair this stops being a divergence worth a comment.
    const r = u.radius
    const okScalar = isNum(r) && r >= 0
    const okPair = Array.isArray(r) && r.length === 2 && r.every((n) => isNum(n) && n >= 0)
    if (!okScalar && !okPair) {
      at(`${path}.radius`, `must be [rx, ry] in unit space, or one number when the ` +
        `ellipse is absorbed into transform, all >= 0 (got ${show(r)})`)
    }
    if (!GRADIENT_SHAPES.includes(u.shape)) {
      at(`${path}.shape`, `must be one of ${oneOf(GRADIENT_SHAPES)} (got ${show(u.shape)})`)
    }
    return
  }
  checkUnitPoint(u.center, `${path}.center`, at)
  // The one asymmetry: a conic's angles are real screen angles, so the rotation
  // lives here and never in the matrix. A consumer that reads it as `angle` and
  // finds nothing paints the ramp starting at 3 o'clock.
  if (!isNum(u.startAngle)) {
    at(`${path}.startAngle`, `must be the start angle in degrees, clockwise from 12 o'clock ` +
      `(got ${show(u.startAngle)})`)
  }
}

function checkPaint (p, path, at) {
  if (!isObject(p)) {
    at(path, `must be a paint object (got ${show(p)})`)
    return
  }
  if (!PAINT_TYPES.includes(p.type)) {
    at(`${path}.type`, `must be one of ${oneOf(PAINT_TYPES)} (got ${show(p.type)})`)
    return
  }
  if (p.type === 'solid') {
    checkColor(p.color, `${path}.color`, at)
  } else if (p.type === 'image') {
    if (!isId(p.asset)) at(`${path}.asset`, `must be an asset id (got ${show(p.asset)})`)
  } else if (GRADIENT_TYPES.includes(p.type)) {
    // Invariant 6: unit-square geometry plus a 2x3 unit -> box matrix, never
    // percentages. The keys of `unit` are normative per type — see `checkUnit`.
    checkUnit(p, `${path}.unit`, at)
    checkMatrix(p.transform, `${path}.transform`, at)
    if (!Array.isArray(p.stops) || p.stops.length < 2) {
      at(`${path}.stops`, `must be an array of at least 2 stops (got ${show(p.stops)})`)
    } else {
      let prev = -Infinity
      p.stops.forEach((s, i) => {
        const sp = `${path}.stops[${i}]`
        if (!isObject(s)) {
          at(sp, `must be an object {t, color, srcCss} (got ${show(s)})`)
          return
        }
        // The stop position is `t`, the parameter along the gradient line, and
        // it is the same name `css/gradient.js` emits. It used to be renamed to
        // `p` on the way in; that spelling is gone from the format.
        if (!isNum(s.t) || s.t < 0 || s.t > 1) {
          at(`${sp}.t`, `must be the stop position, a number in 0..1 (got ${show(s.t)})`)
        } else {
          if (s.t < prev) at(`${sp}.t`, `must not go backwards: ${s.t} follows ${prev}`)
          prev = s.t
        }
        checkColor(s.color, `${sp}.color`, at)
      })
    }
  }
  if (p.clipBox !== undefined && !BOXES.includes(p.clipBox)) {
    at(`${path}.clipBox`, `must be one of ${oneOf(BOXES)} (got ${show(p.clipBox)})`)
  }
  if (p.notes !== undefined && !isStringArray(p.notes)) {
    at(`${path}.notes`, `must be an array of strings (got ${show(p.notes)})`)
  }
}

function checkStroke (s, path, at) {
  if (!isObject(s)) {
    at(path, `must be a stroke object (got ${show(s)})`)
    return
  }
  checkPaint(s.paint, `${path}.paint`, at)
  const w = s.weight
  if (isNum(w)) {
    if (w < 0) at(`${path}.weight`, `must be >= 0 (got ${w})`)
  } else if (Array.isArray(w)) {
    if (w.length !== 4 || !w.every((n) => isNum(n) && n >= 0)) {
      at(`${path}.weight`, `per-side weights must be 4 finite numbers >= 0 (got ${show(w)})`)
    }
  } else {
    at(`${path}.weight`, `must be a number or 4 per-side numbers (got ${show(w)})`)
  }
  if (s.align !== undefined && !STROKE_ALIGNS.includes(s.align)) {
    at(`${path}.align`, `must be one of ${oneOf(STROKE_ALIGNS)} (got ${show(s.align)})`)
  }
  if (s.dash !== undefined && s.dash !== null &&
      !(Array.isArray(s.dash) && s.dash.length > 0 && s.dash.every((n) => isNum(n) && n >= 0))) {
    at(`${path}.dash`, `must be null or an array of finite numbers >= 0 (got ${show(s.dash)})`)
  }
}

/**
 * A colour matrix: a run of the CSS filter functions that Filter Effects §8
 * *defines* as one — `saturate`, `grayscale`, `sepia`, `hue-rotate`, `invert`,
 * `brightness`, `contrast`, `opacity` — composed into their product. Because
 * each is a matrix by definition, the composition is exact and this effect
 * approximates nothing; the only thing left to declare is whether the backend
 * has the primitive.
 *
 * `values` is the 4x5 of `feColorMatrix type="matrix"`, row-major, with the
 * fifth row `[0,0,0,0,1]` implied. It operates on NON-PREMULTIPLIED sRGB in
 * 0..1 — §8 writes those matrices for sRGB, so an SVG backend must set
 * `color-interpolation-filters="sRGB"` on the primitive or it composites the
 * chain in linearRGB, which is a different colour and would be a silent one.
 *
 * `srcCss` is the chain the matrix came from, verbatim: it round-trips, and it
 * is the text a diagnostic quotes when a backend cannot keep the effect. A
 * matrix with no source is 20 numbers nobody can check.
 *
 * `backdrop` is required rather than defaulted because the two properties
 * filter different pixels — `backdrop-filter` recolours what shows THROUGH the
 * node, `filter` recolours the node itself — and a consumer that reads a
 * missing field as `false` paints the node instead of its backdrop.
 */
function checkColorMatrix (e, path, at) {
  const v = e.values
  if (!Array.isArray(v) || v.length !== COLOR_MATRIX_LEN) {
    at(`${path}.values`, `must be ${COLOR_MATRIX_LEN} floats — the 4x5 of ` +
      `feColorMatrix type="matrix", row-major (got ${show(v)})`)
  } else {
    v.forEach((n, i) => {
      if (!isNum(n)) at(`${path}.values[${i}]`, `must be a finite number (got ${show(n)})`)
    })
  }
  if (typeof e.srcCss !== 'string' || e.srcCss.length === 0) {
    at(`${path}.srcCss`, 'must be the CSS filter chain this matrix composes, verbatim ' +
      `(got ${show(e.srcCss)})`)
  }
  if (typeof e.backdrop !== 'boolean') {
    at(`${path}.backdrop`, 'must be true when the matrix comes from `backdrop-filter` and false ' +
      `when it comes from \`filter\`; the two recolour different pixels (got ${show(e.backdrop)})`)
  }
}

function checkEffect (e, path, at) {
  if (!isObject(e)) {
    at(path, `must be an effect object (got ${show(e)})`)
    return
  }
  if (!EFFECT_TYPES.includes(e.type)) {
    at(`${path}.type`, `must be one of ${oneOf(EFFECT_TYPES)} (got ${show(e.type)})`)
    return
  }
  // The one effect that is not a blur and does not carry one: a colour matrix
  // moves colours where they stand.
  if (e.type === 'colorMatrix') {
    checkColorMatrix(e, path, at)
    return
  }
  // Invariant 5: `blur` is the CSS radius. The emitter halves it for SVG sigma;
  // nobody else may reinterpret it.
  if (!isNum(e.blur) || e.blur < 0) {
    at(`${path}.blur`, `must be the CSS blur radius, a finite number >= 0 (got ${show(e.blur)})`)
  }
  if (!SHADOW_TYPES.includes(e.type)) return
  checkColor(e.color, `${path}.color`, at)
  if (!Array.isArray(e.offset) || e.offset.length !== 2 || !e.offset.every(isNum)) {
    at(`${path}.offset`, `must be [x, y] in CSS px (got ${show(e.offset)})`)
  }
  if (e.spread !== undefined && !isNum(e.spread)) {
    at(`${path}.spread`, `must be a finite number (got ${show(e.spread)})`)
  }
  if (e.behind !== undefined && typeof e.behind !== 'boolean') {
    at(`${path}.behind`, `must be a boolean (got ${show(e.behind)})`)
  }
}

const isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string')

/**
 * `start`/`end` are offsets into `characters`, `end` exclusive. `len` is null
 * when `characters` is unusable, so the range half is skipped rather than
 * reported against a length nobody can trust.
 */
function checkSpan (span, path, len, at) {
  const { start, end } = span
  const okStart = Number.isInteger(start) && start >= 0
  const okEnd = Number.isInteger(end) && end >= 0
  if (!okStart) at(`${path}.start`, `must be a non-negative integer offset into characters (got ${show(start)})`)
  if (!okEnd) at(`${path}.end`, `must be a non-negative integer offset into characters (got ${show(end)})`)
  if (okStart && okEnd && end < start) at(`${path}.end`, `must be >= start (start ${start}, got ${end})`)
  if (len === null) return
  if (okStart && start > len) at(`${path}.start`, `is ${start}, past the end of characters (length ${len})`)
  if (okEnd && end > len) at(`${path}.end`, `is ${end}, past the end of characters (length ${len})`)
}

/**
 * Text is where a downstream backend has no recourse: it cannot re-measure, so
 * anything missing here becomes a reflow nobody can see coming.
 */
function checkText (t, path, at) {
  if (!isObject(t)) {
    at(path, `must be an object on type:"text" nodes (got ${show(t)})`)
    return
  }

  let len = null
  const chars = t.characters
  if (typeof chars !== 'string') {
    at(`${path}.characters`, `must be a string (got ${show(chars)})`)
  } else if (chars.length === 0) {
    at(`${path}.characters`, 'must not be empty; a text node with no characters should have been pruned')
  } else {
    len = chars.length
    const nl = chars.indexOf('\n')
    if (nl !== -1) {
      at(`${path}.characters`,
        `must join visual lines with U+2028 (LSEP), never U+000A — found a newline at index ${nl}; ` +
        'a newline makes a paragraph and triggers paragraphSpacing downstream')
    }
  }

  if (typeof t.sourceText !== 'undefined' && typeof t.sourceText !== 'string') {
    at(`${path}.sourceText`, `must be the pre-text-transform string (got ${show(t.sourceText)})`)
  }
  if (!isNum(t.pitch) || t.pitch <= 0) {
    at(`${path}.pitch`,
      `must be the measured baseline-to-baseline distance, a number > 0 (got ${show(t.pitch)})`)
  }
  if (t.direction !== undefined && !DIRECTIONS.includes(t.direction)) {
    at(`${path}.direction`, `must be one of ${oneOf(DIRECTIONS)} (got ${show(t.direction)})`)
  }
  if (t.align !== undefined && typeof t.align !== 'string') {
    at(`${path}.align`, `must be a string (got ${show(t.align)})`)
  }
  for (const k of ['letterSpacing', 'wordSpacing', 'paragraphSpacing', 'trailingSpacingComp', 'widthSlackPx']) {
    if (t[k] !== undefined && !isNum(t[k])) at(`${path}.${k}`, `must be a finite number (got ${show(t[k])})`)
  }

  if (!Array.isArray(t.lines) || t.lines.length === 0) {
    at(`${path}.lines`, `must be a non-empty array of measured line boxes (got ${show(t.lines)})`)
  } else {
    let prevEnd = null
    t.lines.forEach((line, i) => {
      const lp = `${path}.lines[${i}]`
      if (!isObject(line)) {
        at(lp, `must be an object {start, end, x, w, baseline} (got ${show(line)})`)
        return
      }
      if (line.i !== undefined && line.i !== i) {
        at(`${lp}.i`, `must be the line's own index ${i} (got ${show(line.i)})`)
      }
      checkSpan(line, lp, len, at)
      if (!isNum(line.x)) at(`${lp}.x`, `must be a finite number (got ${show(line.x)})`)
      if (!isNum(line.w) || line.w < 0) at(`${lp}.w`, `must be the measured width, >= 0 (got ${show(line.w)})`)
      if (!isNum(line.baseline)) {
        at(`${lp}.baseline`, `must be the measured baseline in CSS px (got ${show(line.baseline)})`)
      }
      for (const k of ['asc', 'desc']) {
        if (line[k] !== undefined && !isNum(line[k])) at(`${lp}.${k}`, `must be a finite number (got ${show(line[k])})`)
      }
      // The glyph the browser paints at a hyphenation break. It is NOT in
      // `characters` on purpose — every offset in `runs`, `lines`, `frags` and
      // `spans` indexes that string and `sourceText` matches it one for one — so it
      // rides on the line that painted it, and its advance is already inside
      // `line.w`. A backend paints the line as `characters.slice(start, end) +
      // hyphen`. One character, because a break glyph is one glyph.
      if (line.hyphen !== undefined) {
        if (typeof line.hyphen !== 'string' || [...line.hyphen].length !== 1) {
          at(`${lp}.hyphen`, 'must be the single character the browser painted at this line\'s break ' +
            `(got ${show(line.hyphen)})`)
        }
      }
      // A line broken by something that is not a character (an inline image, a
      // float) tessellates into fragments. `line.w` is then the SUM of the
      // painted advances and only `frags` says where they sit, so a consumer
      // that stretches the whole line to `line.w` squeezes the glyphs. The
      // fragments must cover the line's span, in visual order, left to right.
      if (line.frags !== undefined) {
        if (!Array.isArray(line.frags) || line.frags.length === 0) {
          at(`${lp}.frags`, `must be a non-empty array of {x, w, start, end} (got ${show(line.frags)})`)
        } else {
          let prevFragEnd = null
          line.frags.forEach((frag, k) => {
            const fp = `${lp}.frags[${k}]`
            if (!isObject(frag)) {
              at(fp, `must be an object {x, w, start, end} (got ${show(frag)})`)
              return
            }
            checkSpan(frag, fp, len, at)
            if (!isNum(frag.x)) at(`${fp}.x`, `must be a finite number (got ${show(frag.x)})`)
            if (!isNum(frag.w) || frag.w < 0) at(`${fp}.w`, `must be the measured width, >= 0 (got ${show(frag.w)})`)
            if (prevFragEnd !== null && Number.isInteger(frag.start) && frag.start < prevFragEnd) {
              at(`${fp}.start`, `is ${frag.start}, before the previous fragment ended (${prevFragEnd}); ` +
                'fragments tessellate the line in visual order')
            }
            if (Number.isInteger(frag.end)) prevFragEnd = frag.end
          })
          const first = line.frags[0]
          const last = line.frags[line.frags.length - 1]
          if (isObject(first) && Number.isInteger(line.start) && first.start !== line.start) {
            at(`${lp}.frags[0].start`,
              `is ${show(first.start)}; the fragments must start where the line does (${line.start})`)
          }
          if (isObject(last) && Number.isInteger(line.end) && last.end !== line.end) {
            at(`${lp}.frags[${line.frags.length - 1}].end`,
              `is ${show(last.end)}; the fragments must end where the line does (${line.end})`)
          }
        }
      }
      // Measured word anchors, written only for justified blocks (2026-08-13):
      // justification puts each line's slack into the WORD GAPS, so no advance
      // arithmetic can place a word — only a measurement can. Unlike `frags`,
      // words do NOT tessellate: the gaps between them are the space characters,
      // which belong to no word. Each word is where its first glyph's advance
      // box starts, in the same units as `line.x`.
      if (line.words !== undefined) {
        if (!Array.isArray(line.words) || line.words.length < 2) {
          at(`${lp}.words`, `must be an array of at least two {x, w, start, end} (a line with one word has nothing to anchor) (got ${show(line.words)})`)
        } else {
          let prevWordEnd = null
          line.words.forEach((word, k) => {
            const wp = `${lp}.words[${k}]`
            if (!isObject(word)) {
              at(wp, `must be an object {x, w, start, end} (got ${show(word)})`)
              return
            }
            checkSpan(word, wp, len, at)
            if (!isNum(word.x)) at(`${wp}.x`, `must be a finite number (got ${show(word.x)})`)
            if (!isNum(word.w) || word.w < 0) at(`${wp}.w`, `must be the measured width, >= 0 (got ${show(word.w)})`)
            if (prevWordEnd !== null && Number.isInteger(word.start) && word.start < prevWordEnd) {
              at(`${wp}.start`, `is ${word.start}, before the previous word ended (${prevWordEnd}); ` +
                'words are in visual order and never overlap')
            }
            if (Number.isInteger(word.end)) prevWordEnd = word.end
          })
        }
      }
      // Lines are in visual order, so their spans only move forward. The LSEP
      // between them is why this is >= and not ===.
      if (prevEnd !== null && Number.isInteger(line.start) && line.start < prevEnd) {
        at(`${lp}.start`, `is ${line.start}, before the previous line ended (${prevEnd}); lines must be in visual order`)
      }
      if (Number.isInteger(line.end)) prevEnd = line.end
    })
  }

  if (!Array.isArray(t.runs) || t.runs.length === 0) {
    at(`${path}.runs`, `must be a non-empty array of styled runs (got ${show(t.runs)})`)
  } else {
    t.runs.forEach((run, i) => {
      const rp = `${path}.runs[${i}]`
      if (!isObject(run)) {
        at(rp, `must be an object {start, end, style} (got ${show(run)})`)
        return
      }
      checkSpan(run, rp, len, at)
      if (!isId(run.style)) at(`${rp}.style`, `must be a styles.text id (got ${show(run.style)})`)
      if (run.href !== undefined && run.href !== null && typeof run.href !== 'string') {
        at(`${rp}.href`, `must be a string (got ${show(run.href)})`)
      }
      // The measured baseline offset of a raised/lowered run (sup/sub,
      // `vertical-align`), positive downwards. Optional, but never a guess.
      if (run.dy !== undefined && !isNum(run.dy)) {
        at(`${rp}.dy`, `must be the measured baseline offset in CSS px, positive down (got ${show(run.dy)})`)
      }
    })
  }

  if (t.emit !== undefined && t.emit !== null) {
    if (!isObject(t.emit)) at(`${path}.emit`, `must be an object (got ${show(t.emit)})`)
    else if (t.emit.outlineAsset !== undefined && t.emit.outlineAsset !== null &&
             !isId(t.emit.outlineAsset)) {
      at(`${path}.emit.outlineAsset`, `must be null or an asset id (got ${show(t.emit.outlineAsset)})`)
    }
  }
}

/**
 * Everything about one node that does not need the rest of the document.
 * Cross-references (`children`, `assets`, `styles`, `diagnostics`) are
 * `validate`'s job — this function has no way to resolve them.
 *
 * @param {object} node
 * @param {string} id
 * @returns {string[]} errors, empty if valid
 */
export function validateNode (node, id) {
  const errors = []
  if (!isId(id)) errors.push(`node id must be a non-empty string (got ${show(id)})`)
  const label = `node ${quote(id)}`
  const at = (path, message) => errors.push(`${label}: ${path} ${message}`)

  if (!isObject(node)) {
    errors.push(`${label}: must be an object (got ${show(node)})`)
    return errors
  }

  if (!NODE_TYPES.includes(node.type)) {
    at('type', `must be one of ${oneOf(NODE_TYPES)} (got ${show(node.type)})`)
  }
  if (node.name !== undefined && typeof node.name !== 'string') {
    at('name', `must be a string (got ${show(node.name)})`)
  }

  // Invariant 2: both boxes, always. `abs` is what the harness asserts against
  // and the only one that survives reparenting.
  checkRect(node.frame, 'frame', at)
  checkRect(node.abs, 'abs', at)

  if (!isObject(node.paint)) {
    at('paint', `must be an object {z, stackingContext} (got ${show(node.paint)})`)
  } else {
    // Invariant 3: paint order is an integer index the backend sorts by, never
    // re-derives. A float means someone inserted by bisection.
    if (!Number.isInteger(node.paint.z)) {
      at('paint.z', `must be an integer back-to-front index (got ${show(node.paint.z)})`)
    }
    if (node.paint.stackingContext !== undefined && typeof node.paint.stackingContext !== 'boolean') {
      at('paint.stackingContext', `must be a boolean (got ${show(node.paint.stackingContext)})`)
    }
    if (node.paint.reason !== undefined && typeof node.paint.reason !== 'string') {
      at('paint.reason', `must be a string (got ${show(node.paint.reason)})`)
    }
  }

  if (!isNum(node.opacity) || node.opacity < 0 || node.opacity > 1) {
    at('opacity', `must be a number in 0..1 (got ${show(node.opacity)})`)
  }
  if (node.blend !== undefined && !BLEND_MODES.includes(node.blend)) {
    at('blend', `must be a CSS mix-blend-mode keyword (got ${show(node.blend)})`)
  }
  if (node.isolate !== undefined && typeof node.isolate !== 'boolean') {
    at('isolate', `must be a boolean (got ${show(node.isolate)})`)
  }

  if (node.transform !== undefined && node.transform !== null) {
    if (!isObject(node.transform)) {
      at('transform', `must be null or {m, decomposed} (got ${show(node.transform)})`)
    } else {
      checkMatrix(node.transform.m, 'transform.m', at)
      const d = node.transform.decomposed
      if (d !== undefined && d !== null) {
        if (!isObject(d)) {
          at('transform.decomposed', `must be an object (got ${show(d)})`)
        } else {
          for (const k of ['tx', 'ty', 'rot', 'sx', 'sy', 'skewX']) {
            if (!isNum(d[k])) at(`transform.decomposed.${k}`, `must be a finite number (got ${show(d[k])})`)
          }
          if (isNum(d.rot) && (d.rot < -180 || d.rot > 180)) {
            at('transform.decomposed.rot', `must be degrees clamped to -180..180 (got ${d.rot})`)
          }
        }
      }
    }
  }

  if (node.clip !== undefined && node.clip !== null) {
    if (!isObject(node.clip)) {
      at('clip', `must be null or an object {mode, box, radii} (got ${show(node.clip)})`)
    } else {
      if (!CLIP_MODES.includes(node.clip.mode)) {
        at('clip.mode', `must be one of ${oneOf(CLIP_MODES)} (got ${show(node.clip.mode)})`)
      }
      if (node.clip.box !== undefined && !BOXES.includes(node.clip.box)) {
        at('clip.box', `must be one of ${oneOf(BOXES)} (got ${show(node.clip.box)})`)
      }
      if (node.clip.radii !== undefined && node.clip.radii !== null) {
        checkRadii(node.clip.radii, 'clip.radii', at)
      }
    }
  }
  if (node.radii !== undefined && node.radii !== null) checkRadii(node.radii, 'radii', at)

  if (node.mask !== undefined && node.mask !== null) {
    if (!isObject(node.mask)) {
      at('mask', `must be null or an object {node, type} (got ${show(node.mask)})`)
    } else {
      if (!isId(node.mask.node)) at('mask.node', `must be a node id (got ${show(node.mask.node)})`)
      if (node.mask.type !== undefined && !MASK_TYPES.includes(node.mask.type)) {
        at('mask.type', `must be one of ${oneOf(MASK_TYPES)} (got ${show(node.mask.type)})`)
      }
    }
  }

  for (const [key, check] of [['fills', checkPaint], ['strokes', checkStroke], ['effects', checkEffect]]) {
    const list = node[key]
    if (list === undefined) continue
    if (!Array.isArray(list)) {
      at(key, `must be an array (got ${show(list)})`)
      continue
    }
    list.forEach((entry, i) => check(entry, `${key}[${i}]`, at))
  }

  if (!isObject(node.fidelity)) {
    at('fidelity', `must be an object {grade, notes} (got ${show(node.fidelity)})`)
  } else {
    if (!FIDELITY.includes(node.fidelity.grade)) {
      at('fidelity.grade', `must be one of ${oneOf(FIDELITY)} (got ${show(node.fidelity.grade)})`)
    }
    if (node.fidelity.notes !== undefined && !isStringArray(node.fidelity.notes)) {
      at('fidelity.notes', `must be an array of strings (got ${show(node.fidelity.notes)})`)
    }
    if (node.fidelity.reason !== undefined && typeof node.fidelity.reason !== 'string') {
      at('fidelity.reason', `must be a string (got ${show(node.fidelity.reason)})`)
    }
  }

  if (node.type === 'text') {
    checkText(node.text, 'text', at)
  } else if (node.text !== undefined && node.text !== null) {
    at('text', `is legal only on type:"text" nodes (this one is ${show(node.type)})`)
  }

  if (node.source !== undefined && node.source !== null) {
    if (!isObject(node.source)) at('source', `must be an object (got ${show(node.source)})`)
    else if (node.source.tag !== undefined && typeof node.source.tag !== 'string') {
      at('source.tag', `must be a string (got ${show(node.source.tag)})`)
    }
  }

  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) {
      at('children', `must be an array of node ids (got ${show(node.children)})`)
    } else {
      node.children.forEach((child, i) => {
        if (!isId(child)) at(`children[${i}]`, `must be a node id string (got ${show(child)})`)
      })
    }
  }

  return errors
}

/**
 * `root` is written `{"$ref": "n_0"}` in the format skeleton but `buildPaintTree`
 * hands back a bare `rootId`, so both spellings are accepted here — only
 * *resolving* is normative. Returns null when it is neither.
 */
function readRootId (root) {
  if (isId(root)) return root
  if (isObject(root) && isId(root.$ref)) return root.$ref
  return null
}

/**
 * Node ids named by a diagnostic. `node` is the primary field; `from`/`to`
 * (promotions) and `overlaps` also name real nodes, and an array-valued `nodes`
 * is a list — the scalar one is a *count* (`"nodes": 18`) and is skipped.
 */
function diagnosticNodeIds (diagnostics) {
  const ids = new Set()
  for (const d of diagnostics) {
    if (!isObject(d)) continue
    for (const key of ['node', 'from', 'to']) if (isId(d[key])) ids.add(d[key])
    for (const key of ['nodes', 'overlaps']) {
      if (Array.isArray(d[key])) for (const v of d[key]) if (isId(v)) ids.add(v)
    }
  }
  return ids
}

/**
 * Cycles among nodes the root cannot reach. A node has at most one parent by
 * the time this runs, so walking parent links from each unreachable node finds
 * every cycle in linear time — and "cycle" is a far more actionable diagnosis
 * than the "unreachable" every member would otherwise get.
 */
function findCycles (ids, parent, reachable) {
  const cycles = []
  const settled = new Set()
  for (const start of ids) {
    if (reachable.has(start) || settled.has(start)) continue
    const path = []
    const seen = new Map()
    let cur = start
    while (cur !== undefined && !reachable.has(cur) && !settled.has(cur)) {
      if (seen.has(cur)) {
        cycles.push(path.slice(seen.get(cur)).reverse())
        break
      }
      seen.set(cur, path.length)
      path.push(cur)
      cur = parent.get(cur)
    }
    for (const id of path) settled.add(id)
  }
  return cycles
}

/**
 * Validate a whole SVD document.
 *
 * @param {object} doc
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validate (doc) {
  const errors = []
  const push = (message) => errors.push(message)

  if (!isObject(doc)) {
    return { ok: false, errors: [`document must be an object (got ${show(doc)})`] }
  }

  if (doc.schema !== SVD_VERSION) {
    push(`schema must be ${quote(SVD_VERSION)} (got ${show(doc.schema)})`)
  }
  if (doc.generator !== undefined && !isObject(doc.generator)) {
    push(`generator must be an object (got ${show(doc.generator)})`)
  }
  if (doc.capture !== undefined && !isObject(doc.capture)) {
    push(`capture must be an object (got ${show(doc.capture)})`)
  }
  if (doc.report !== undefined && !isObject(doc.report)) {
    push(`report must be an object (got ${show(doc.report)})`)
  }

  const assets = isObject(doc.assets) ? doc.assets : null
  if (assets === null) push(`assets must be an object keyed by asset id (got ${show(doc.assets)})`)
  else {
    for (const id of Object.keys(assets)) {
      const asset = assets[id]
      if (!isObject(asset)) {
        push(`assets[${quote(id)}] must be an object (got ${show(asset)})`)
        continue
      }
      if (!isId(asset.kind)) push(`assets[${quote(id)}].kind must be a non-empty string (got ${show(asset.kind)})`)
      for (const k of ['w', 'h']) {
        if (asset[k] !== undefined && (!isNum(asset[k]) || asset[k] < 0)) {
          push(`assets[${quote(id)}].${k} must be a finite number >= 0 (got ${show(asset[k])})`)
        }
      }
    }
  }

  const styles = isObject(doc.styles) ? doc.styles : null
  if (styles === null) push(`styles must be an object (got ${show(doc.styles)})`)
  const textStyles = styles !== null && isObject(styles.text) ? styles.text : null
  if (styles !== null && textStyles === null) {
    push(`styles.text must be an object keyed by text style id (got ${show(styles.text)})`)
  }
  if (textStyles !== null) {
    for (const id of Object.keys(textStyles)) {
      const style = textStyles[id]
      const sp = `styles.text[${quote(id)}]`
      if (!isObject(style)) {
        push(`${sp} must be an object (got ${show(style)})`)
        continue
      }
      const at = (path, message) => push(`${sp}.${path} ${message}`)
      if (!isNum(style.size) || style.size <= 0) at('size', `must be a number > 0 (got ${show(style.size)})`)
      if (style.weight !== undefined && !isNum(style.weight)) at('weight', `must be a number (got ${show(style.weight)})`)
      if (style.italic !== undefined && typeof style.italic !== 'boolean') {
        at('italic', `must be a boolean (got ${show(style.italic)})`)
      }
      for (const k of ['letterSpacing', 'wordSpacing']) {
        if (style[k] !== undefined && !isNum(style[k])) at(k, `must be a finite number (got ${show(style[k])})`)
      }
      if (style.fills !== undefined) {
        if (!Array.isArray(style.fills)) at('fills', `must be an array (got ${show(style.fills)})`)
        else style.fills.forEach((p, i) => checkPaint(p, `fills[${i}]`, at))
      }
      if (isId(style.font) && assets !== null && !has(assets, style.font)) {
        push(`${sp}.font references ${quote(style.font)}, which is not in assets`)
      }
    }
  }

  const diagnostics = Array.isArray(doc.diagnostics) ? doc.diagnostics : null
  if (diagnostics === null) push(`diagnostics must be an array (got ${show(doc.diagnostics)})`)

  const nodes = isObject(doc.nodes) ? doc.nodes : null
  if (nodes === null) {
    push(`nodes must be an object keyed by node id (got ${show(doc.nodes)})`)
    return { ok: false, errors }
  }

  const ids = Object.keys(nodes)
  if (ids.length === 0) push('nodes is empty; a document always has at least its root node')

  const rootId = readRootId(doc.root)
  if (rootId === null) {
    push(`root must be a node id or {$ref: id} (got ${show(doc.root)})`)
  } else if (!has(nodes, rootId)) {
    push(`root references ${quote(rootId)}, which is not in nodes`)
  }

  // Per-node checks, plus the parent map the tree checks below are built on.
  const parent = new Map()
  for (const id of ids) {
    const node = nodes[id]
    for (const e of validateNode(node, id)) push(e)
    if (!isObject(node) || !Array.isArray(node.children)) continue
    node.children.forEach((childId, i) => {
      if (!isId(childId)) return                     // already reported by validateNode
      if (!has(nodes, childId)) {
        push(`node ${quote(id)}: children[${i}] references ${quote(childId)}, which is not in nodes`)
        return
      }
      if (childId === id) {
        push(`node ${quote(id)}: children[${i}] references itself`)
        return
      }
      const prev = parent.get(childId)
      if (prev === id) {
        push(`node ${quote(childId)} appears twice in the children of ${quote(id)}`)
      } else if (prev !== undefined) {
        push(`node ${quote(childId)} is a child of both ${quote(prev)} and ${quote(id)}; ` +
          'the tree is DOM containment, so a node has exactly one parent and one frame')
      } else {
        parent.set(childId, id)
      }
    })
  }

  if (rootId !== null && parent.has(rootId)) {
    push(`root ${quote(rootId)} is also a child of ${quote(parent.get(rootId))}; the root has no parent`)
  }

  // Reachability doubles as the cycle guard: the visited set is what keeps a
  // cyclic children graph from spinning here forever.
  const reachable = new Set()
  if (rootId !== null && has(nodes, rootId)) {
    const stack = [rootId]
    while (stack.length) {
      const id = stack.pop()
      if (reachable.has(id)) continue
      reachable.add(id)
      const node = nodes[id]
      if (!isObject(node) || !Array.isArray(node.children)) continue
      for (const child of node.children) if (isId(child) && has(nodes, child)) stack.push(child)
    }
  }

  const inCycle = new Set()
  for (const cycle of findCycles(ids, parent, reachable)) {
    for (const id of cycle) inCycle.add(id)
    push(`cycle in children: ${cycle.map(quote).join(' -> ')} -> ${quote(cycle[0])}`)
  }
  for (const id of ids) {
    if (reachable.has(id) || inCycle.has(id)) continue
    push(`node ${quote(id)} is unreachable from root; every node hangs off the root or does not exist`)
  }

  // The root's own `abs` is measured against itself (invariant 2).
  if (rootId !== null && isObject(nodes[rootId]) && isObject(nodes[rootId].abs)) {
    const abs = nodes[rootId].abs
    for (const k of ['x', 'y']) {
      if (isNum(abs[k]) && Math.abs(abs[k]) > ORIGIN_EPS) {
        push(`node ${quote(rootId)}: abs.${k} must be 0 on the root — abs is relative to the ` +
          `capture root's own border box (got ${abs[k]})`)
      }
    }
  }

  // Reference resolution: assets, text styles, mask targets.
  for (const id of ids) {
    const node = nodes[id]
    if (!isObject(node)) continue
    const label = `node ${quote(id)}`
    if (Array.isArray(node.fills)) {
      node.fills.forEach((fill, i) => {
        if (!isObject(fill) || !isId(fill.asset)) return
        if (assets !== null && !has(assets, fill.asset)) {
          push(`${label}: fills[${i}].asset references ${quote(fill.asset)}, which is not in assets`)
        }
      })
    }
    if (isObject(node.mask) && isId(node.mask.node) && !has(nodes, node.mask.node)) {
      push(`${label}: mask.node references ${quote(node.mask.node)}, which is not in nodes`)
    }
    if (node.type !== 'text' || !isObject(node.text)) continue
    if (Array.isArray(node.text.runs)) {
      node.text.runs.forEach((run, i) => {
        if (!isObject(run) || !isId(run.style)) return
        if (textStyles !== null && !has(textStyles, run.style)) {
          push(`${label}: text.runs[${i}].style references ${quote(run.style)}, which is not in styles.text`)
        }
      })
    }
    const outline = isObject(node.text.emit) ? node.text.emit.outlineAsset : undefined
    if (isId(outline) && assets !== null && !has(assets, outline)) {
      push(`${label}: text.emit.outlineAsset references ${quote(outline)}, which is not in assets`)
    }
  }

  if (diagnostics === null) return { ok: errors.length === 0, errors }

  diagnostics.forEach((d, i) => {
    if (!isObject(d)) {
      push(`diagnostics[${i}] must be an object (got ${show(d)})`)
      return
    }
    if (!isId(d.code)) push(`diagnostics[${i}].code must be a non-empty string (got ${show(d.code)})`)
    if (d.severity !== undefined && !SEVERITIES.includes(d.severity)) {
      push(`diagnostics[${i}].severity must be one of ${oneOf(SEVERITIES)} (got ${show(d.severity)})`)
    }
    if (d.node !== undefined && !isId(d.node)) {
      push(`diagnostics[${i}].node must be a node id (got ${show(d.node)})`)
    } else if (isId(d.node) && !has(nodes, d.node)) {
      push(`diagnostics[${i}] (${quote(d.code)}) references node ${quote(d.node)}, which is not in nodes`)
    }
  })

  // The rule that outranks the rest of the schema: nothing degrades silently.
  const declared = diagnosticNodeIds(diagnostics)
  for (const id of ids) {
    const node = nodes[id]
    if (!isObject(node) || !isObject(node.fidelity)) continue
    const grade = node.fidelity.grade
    if (!FIDELITY.includes(grade) || grade === 'E') continue
    if (declared.has(id)) continue
    push(`node ${quote(id)}: fidelity.grade is ${quote(grade)} but no diagnostics entry names it. ` +
      'Every node graded other than "E" lost something, and a loss nobody declared is a bug — ' +
      `add a diagnostics entry with node: ${quote(id)}`)
  }

  return { ok: errors.length === 0, errors }
}
