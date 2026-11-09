/**
 * Text collection: the string a block actually paints, and where every visual
 * line of it sits.
 *
 * The module exists because three things the DOM will happily tell you are all
 * wrong for this job.
 *
 *  1. `textContent` is not what is painted. Whitespace collapses — 54 DOM chars
 *     to 37 rendered on the fixture this was built against — and
 *     `text-transform` rewrites glyphs. DOM offsets and rendered offsets are
 *     therefore DIFFERENT SPACES, and every offset a consumer sees here is in
 *     the rendered one. DOM offsets survive only inside the per-node map that
 *     `Range` has to be driven with.
 *  2. `selectNodeContents(blockEl).getClientRects()` returns duplicate rects the
 *     moment the block has inline children — 12 for 7 runs, measured. One Range
 *     per TEXT NODE is the only shape that reports each fragment exactly once.
 *     Per character is the other extreme and costs 95ms/35k chars against 4.1ms
 *     for the node-level walk; the one place a per-character probe is
 *     unavoidable — finding where a wrapped node changes line — is a binary
 *     search over PREFIXES of the stretch still in play (40ms for 35k justified,
 *     hyphenating chars over 372 lines).
 *  3. `rect.top` does not identify a line. A larger `font-size` span shares its
 *     line's BASELINE and not its top, so lines are clustered on
 *     `rect.top + fontBoundingBoxAscent` and on nothing else.
 *  4. A rect does not say which characters produced it. Where a line ENDS is
 *     therefore derived, and it is the one derivation whose bug corrupts the text
 *     instead of the geometry — so it is checked rather than trusted, and a break
 *     that cannot be checked is declared (`collect.text-line-break-unverified`).
 *     It was not, and the demo shipped `…de cada lín`/`ea, así que` where the
 *     browser paints `…de cada lí-`/`nea, así que`, in silence.
 *  5. The hyphen at a hyphenated break is not in the document at all. It is not a
 *     character the DOM has, so it cannot be in `characters` without inventing an
 *     offset; the SAME rect that proves the break happened also measures the
 *     glyph, and it is reported on `line.hyphen` (`collect.text-hyphen`).
 *
 * Metrics come from a canvas 2D context keyed on the FULL font shorthand, size
 * included: Chromium rounds `fontBoundingBox*` to integers per size, so a 12px
 * ascent scaled down from a 16px measurement can be a whole pixel out — two
 * baseline tolerances. Metrics are never scaled between sizes.
 *
 * Coordinates in `lines` are relative to the BORDER BOX of `blockEl`, which is
 * what `getBoundingClientRect` reports, so a caller that already holds the
 * block's frame needs no further arithmetic.
 */

import { parseColor } from '../css/color.js'
import { isExcluded } from '../exclusion.js'

/** Visual lines join with LSEP, never `\n`: `\n` makes a paragraph in Figma. */
const LSEP = '\u2028'

/** Two fonts on one line can disagree by half a px once their ascents are rounded. */
const BASELINE_TOL = 0.5

/** Above this spread the baselines are not one pitch and the caller must place per line. */
const PITCH_TOL = 0.5

const EPS = 1e-6

/** Elements carrying no inline text of their own, or whose text is another box's problem. */
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'OPTION', 'OPTGROUP', 'DATALIST',
  'RT', 'RP', 'INPUT', 'TEXTAREA', 'SELECT', 'IMG', 'SVG', 'MATH', 'CANVAS', 'VIDEO', 'IFRAME', 'OBJECT',
])

const RUBY_TAGS = new Set(['RT', 'RP'])

/**
 * The display values that keep a child's text inside THIS block's inline
 * formatting context. Everything else — `inline-block` included — lays its text
 * out in a context of its own and becomes its own node; descending into one
 * would put two independent line grids in a single `lines` array. Out-of-flow
 * and floated inlines need no test of their own: `position: absolute` and
 * `float` both blockify the computed `display`.
 */
const INLINE_DISPLAY = /^(inline|ruby|ruby-base|ruby-text|ruby-base-container|ruby-text-container)$/

/** CSS collapsible white space. U+00A0 is deliberately absent — NBSP never collapses. */
function isCollapsible(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f'
}

/** Strong RTL blocks, enough to know bidi reordering is in play. */
const RTL_CHARS = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0780-\u07BF\u0800-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
const NON_ASCII = /[^\u0000-\u007F]/

/**
 * Scripts that wrap between two letters with no space and no hyphen — Han, Kana,
 * Hangul, Thai, Lao, Khmer, Myanmar. A break found between two of these is a
 * break opportunity the browser is entitled to take, and so is verified rather
 * than suspect.
 */
const BREAK_ANYWHERE = new RegExp(
  '[\\u0E00-\\u0EFF\\u1000-\\u109F\\u1780-\\u17FF\\u1100-\\u11FF\\u2E80-\\u303F' +
  '\\u3040-\\u30FF\\u3130-\\u318F\\u31F0-\\u31FF\\u3400-\\u4DBF\\u4E00-\\u9FFF' +
  '\\uA960-\\uA97F\\uAC00-\\uD7FF\\uF900-\\uFAFF\\uFF00-\\uFFEF]'
)

/**
 * Characters a line may end on with no white space after them: the browser takes
 * a break opportunity after a hyphen, a dash, a slash, and the two invisible
 * ones that exist to offer it.
 */
const BREAK_AFTER = new RegExp('[-\\u00AD\\u2010\\u2012\\u2013\\u2014\\u200B\\u2027/\\\\]')

/**
 * What Chromium paints at a hyphenation break when `hyphenate-character` is
 * `auto`, in the order Blink picks it.
 *
 * `ComputedStyle::HyphenString()` returns U+2010 HYPHEN, and U+002D HYPHEN-MINUS
 * only when the primary font has no glyph for U+2010. The two are different
 * characters that almost every font gives the SAME advance, so nothing measurable
 * separates them and the order here is Blink's preference, not a measurement —
 * which is why the choice is declared rather than stated.
 */
const AUTO_HYPHENS = ['‐', '-']

/** The painted hyphen must sit on the line's trailing edge to within this, in px. */
const HYPHEN_EDGE_TOL = 0.75

/** Escapes inside a CSS `<string>`: `\2010`, `\2010 `, `\"`. */
const CSS_ESCAPE = /\\(?:([0-9a-fA-F]{1,6})[ \t\n\f]?|([^\n]))/g

/**
 * The value of a computed CSS `<string>`, unquoted and unescaped, or null when
 * the value is a keyword (`auto`) rather than a string.
 */
function cssString(value) {
  const s = String(value == null ? '' : value).trim()
  if (s.length < 2) return null
  const q = s[0]
  if ((q !== '"' && q !== "'") || s[s.length - 1] !== q) return null
  return s.slice(1, -1).replace(CSS_ESCAPE, (_, hex, ch) => (
    hex ? String.fromCodePoint(parseInt(hex, 16)) : ch
  ))
}

/**
 * The characters this block may paint at a hyphenation break, best first.
 *
 * An author who sets `hyphenate-character` has said which character it is and
 * there is nothing to guess; `auto` is a UA default and leaves two candidates,
 * which the caller separates by measuring the ink.
 *
 * @returns {{chars: string[], declared: string, explicit: boolean}}
 */
function hyphenCandidates(cs) {
  const declared = cs.hyphenateCharacter || cs.webkitHyphenateCharacter || 'auto'
  const explicit = cssString(declared)
  if (explicit !== null) return { chars: [explicit], declared, explicit: true }
  return { chars: AUTO_HYPHENS, declared, explicit: false }
}

/** `font-variant-caps` values that repaint letters as capitals. */
const SMALL_CAPS = /(small|petite)-caps|unicase/

/** Feature-detected once: `\p{...}` is a syntax error on engines without the flag. */
const EMOJI = (() => {
  try { return new RegExp('\\p{Extended_Pictographic}|\\p{Regional_Indicator}', 'u') } catch { /* older engine */ }
  try { return new RegExp('[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{FE0F}]', 'u') } catch { return null }
})()

/**
 * Off-screen, zero-height, out of flow and unpainted — the probe has to attach to
 * a live element without moving one pixel of it. `white-space: pre` is what makes
 * `innerText` hand the characters back one for one; `opacity` rather than
 * `visibility`, because a `visibility: hidden` subtree is skipped by the very
 * text iterator we are asking the question of.
 */
const PROBE_CSS = 'position:absolute!important;left:0!important;top:0!important;' +
  'width:max-content!important;height:0!important;overflow:hidden!important;' +
  'opacity:0!important;pointer-events:none!important;white-space:pre!important;' +
  'margin:0!important;padding:0!important;border:0!important;contain:layout style!important'

// ——— per-capture caches ———

const FALLBACK_KEY = {}
const STATES = new WeakMap()

/**
 * Caches keyed on the collect context, so one capture measures each font and each
 * element once across every block. `ctx` is never mutated — an unknown object's
 * key space belongs to whoever defined it.
 *
 * `root` is the capture root, and it bounds every walk that leaves the block:
 * a transform above it is re-applied by nobody, and an `<a>` above it is still
 * the link the text is inside of.
 */
function stateFor(ctx) {
  const key = ctx && typeof ctx === 'object' ? ctx : FALLBACK_KEY
  let S = STATES.get(key)
  if (!S) {
    S = {
      ctx2d: null,
      metrics: new Map(),
      styles: new WeakMap(),
      css: new WeakMap(),
      linear: new WeakMap(),
      lang: new WeakMap(),
      painted: new Map(),
      segmenters: new Map(),
      // Font resolution, all of it per capture: which family of a stack won, which
      // families this machine has, the page's FontFaces by family, its @font-face
      // rules, and what each embedded binary calls itself.
      family: new Map(),
      installed: new Map(),
      nameTables: new Map(),
      root: key.rootEl && key.rootEl.nodeType === 1 ? key.rootEl : null,
      exclude: [].concat(key.exclude || []),
    }
    STATES.set(key, S)
  }
  return S
}

function styleOf(el, S) {
  let cs = S.css.get(el)
  if (!cs) { cs = getComputedStyle(el); S.css.set(el, cs) }
  return cs
}

/**
 * The INHERITED language of an element, not its own `lang` attribute.
 *
 * It keys the `text-transform` cache, and the difference is the whole point:
 * `lang` is what makes `titi` upper-case to `TİTİ` in Turkish and `TITI` in
 * English. Keying on `el.lang` — the attribute, usually absent on the `<p>` and
 * present on a `<div>` three levels up — made two blocks with the same text and
 * different languages share one answer, and whichever was measured first won.
 */
function langOf(el, S) {
  const hit = S.lang.get(el)
  if (hit !== undefined) return hit
  let lang = ''
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const own = n.getAttribute && (n.getAttribute('lang') || n.getAttribute('xml:lang'))
    if (own) { lang = own; break }
  }
  const out = lang.toLowerCase()
  S.lang.set(el, out)
  return out
}

function px(value, fallback = 0) {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : fallback
}

function median(values) {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// ——— font metrics ———

function measurer(S) {
  if (!S.ctx2d) S.ctx2d = document.createElement('canvas').getContext('2d')
  return S.ctx2d
}

/**
 * The canvas font shorthand for a computed style. `font-stretch` is left out on
 * purpose: Chromium computes it as a percentage, which the shorthand does not
 * accept, and a rejected shorthand silently leaves the CONTEXT'S PREVIOUS FONT in
 * place — the one failure mode that would poison every metric measured after it.
 * The caller checks the round-trip rather than trust the assignment.
 */
function fontShorthand(cs, size) {
  const style = cs.fontStyle && cs.fontStyle !== 'normal' ? `${cs.fontStyle} ` : ''
  return `${style}${cs.fontWeight || 400} ${size}px ${cs.fontFamily}`
}

/**
 * Ascent and descent for one exact font string, cached on that string and never
 * on the family: the size is part of the key because the numbers are not linear
 * in it. `Hxg` spans a cap, an x-height and a descender, so a font whose
 * `fontBoundingBox*` is missing still yields something usable from the ink box.
 *
 * `note` travels with the record so a degraded measurement is reported by EVERY
 * block that uses the font, not only the first one to measure it.
 */
function metricsOf(fontCss, size, S) {
  const hit = S.metrics.get(fontCss)
  if (hit) return hit

  const c = measurer(S)
  c.font = fontCss
  let used = fontCss
  let note = null
  if (!c.font) {
    // The context refused the shorthand and kept whatever it had. Fall back to a
    // string it cannot refuse rather than silently measure the previous font.
    used = `${size}px sans-serif`
    c.font = used
    note = `the canvas rejected the font shorthand "${fontCss}" — metrics were measured with a generic sans-serif`
  }
  const m = c.measureText('Hxg')
  let ascent = m.fontBoundingBoxAscent
  let descent = m.fontBoundingBoxDescent
  if (!Number.isFinite(ascent) || !Number.isFinite(descent) || (!ascent && !descent)) {
    ascent = Number.isFinite(m.actualBoundingBoxAscent) ? m.actualBoundingBoxAscent : size * 0.8
    descent = Number.isFinite(m.actualBoundingBoxDescent) ? m.actualBoundingBoxDescent : size * 0.2
    note = 'fontBoundingBox metrics unavailable — baselines derived from the ink box, accurate to about a pixel'
  }
  const out = { ascent, descent, fontCss: used, note }
  S.metrics.set(fontCss, out)
  return out
}

/**
 * The advance of a short string in a run's font, in the block's own px.
 *
 * Safe to call after `metricsOf` and in any order: that function only assigns to
 * the shared context on a cache MISS and reads nothing back later, so moving the
 * font here cannot poison a cached metric. `letterSpacing` is added because
 * Chromium adds it after every glyph, the painted hyphen included.
 */
function advanceOf(text, style, S) {
  const c = measurer(S)
  c.font = style.fontCss
  const m = c.measureText(text)
  return m.width + (style.letterSpacing || 0) * [...text].length
}

// ——— text-transform ———

/**
 * Does this transform have anything to do to this string? Only used to tell a
 * probe that came back unchanged because there was nothing to change from one
 * that came back unchanged because the browser never answered.
 *
 * Built through `new RegExp` for the same reason EMOJI is: a `\p{...}` LITERAL is
 * a syntax error at parse time on an engine without the flag, which would take
 * the whole module down instead of one warning.
 */
const EXPECTS_CHANGE = (() => {
  try { return { uppercase: new RegExp('\\p{Ll}', 'u'), lowercase: new RegExp('\\p{Lu}', 'u') } } catch { /* older engine */ }
  return { uppercase: /[a-z]/, lowercase: /[A-Z]/ }
})()

/**
 * The PAINTED form of a text node's data, read back from the browser instead of
 * computed here.
 *
 * `text-transform: uppercase` is locale-dependent — Turkish dotless i, Greek
 * final sigma — and `String.prototype.toUpperCase` does not know the element's
 * language, so casing in JS would quietly report one string and paint another.
 * The probe inherits the transform AND the language from the real parent, so the
 * browser answers the only question it can answer. It is out of flow, zero-height
 * and removed in a `finally`, so nothing observes it and nothing reflows around
 * it; it is also only ever built for a node whose transform is not `none`.
 *
 * `prev` is the character the block has already painted before this node, and it
 * is load-bearing: `capitalize` upcases the letter after a word boundary, so the
 * same node reads "Wide" after a space and "wide" after a letter. Probing a node
 * on its own answers as though it started the block — MEASURED, the first word of
 * a `text-transform: capitalize` block came back lowercase, because the probe sat
 * directly after the element's own text with nothing between. The character goes
 * in front of the probe's text and comes straight back off the answer.
 *
 * Returns null when the answer is unusable, and the two ways it can be are
 * different: no answer at all (a detached or unrendered subtree), or an answer of
 * a different length. Length matters because every offset in this module reaches
 * the DOM through a `Range` over the source string; ß -> SS would shift all of
 * them onto a string that does not exist.
 */
function paintedText(el, data, prev, S) {
  // Every kind of white space is the same word boundary, and a real newline in
  // the probe risks `innerText` normalizing it away — which would fail the length
  // check below and throw away an answer that was going to be right.
  const lead = prev && /\s/.test(prev) ? ' ' : (prev || '')
  const key = `${styleOf(el, S).textTransform}\u0000${langOf(el, S)}\u0000${lead}\u0000${data}`
  if (S.painted.has(key)) return S.painted.get(key)

  let out = null
  let probe = null
  try {
    probe = document.createElement('span')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = PROBE_CSS
    probe.textContent = lead + data
    // FIRST child, not appended. Blink transforms a text node against the
    // character before it in the inline formatting context — and being out of
    // flow does not exempt the probe from that, MEASURED: appended last, the
    // probe sat directly after the element's own text and the first word of a
    // `capitalize` block came back lowercase. At the front, the only thing in
    // front of it is `lead`, which is the character that really precedes it.
    el.insertBefore(probe, el.firstChild)
    const text = probe.innerText
    if (typeof text === 'string' && text.length === lead.length + data.length) out = text.slice(lead.length)
  } catch {
    out = null
  } finally {
    if (probe && probe.parentNode) probe.parentNode.removeChild(probe)
  }
  S.painted.set(key, out)
  return out
}

// ——— run styles ———

/**
 * Whether a decoration set on this box's PARENT stops here instead of reaching
 * its contents. Out-of-flow and floated boxes take no decoration from their
 * parent, and neither do atomic inline-level boxes — an `inline-block` lays out
 * its own text and an underline on the line it sits in does not cross into it.
 * Internal table boxes are in the same family: the propagation the spec grants
 * to in-flow BLOCK-LEVEL boxes does not reach a cell through the anonymous table
 * wrappers between them.
 */
function stopsDecoration(cs) {
  if (!cs) return true
  if (cs.float && cs.float !== 'none') return true
  if (cs.position === 'absolute' || cs.position === 'fixed') return true
  const display = cs.display || ''
  return /^inline-|^-webkit-inline-/.test(display) || (/^table-/.test(display))
}

/**
 * One `text-decoration` declaration, split into one entry per painted line.
 * `underline line-through` is a single declaration and two lines, and a consumer
 * that holds one decoration has to see both to know which one it is dropping.
 */
function pushDecoration(out, cs) {
  const line = cs.textDecorationLine || 'none'
  if (!line || line === 'none') return
  const color = parseColor(cs.textDecorationColor || cs.color)
  const style = cs.textDecorationStyle || 'solid'
  const thickness = cs.textDecorationThickness === 'auto' ? null : px(cs.textDecorationThickness, 0)
  // `text-underline-offset` moves the underline off the position the font asks
  // for. Not reporting it is not neutral: a backend that DRAWS the line rather
  // than asking a renderer for it has to put it somewhere, and the only place it
  // can put it is the default — measured, that left `.ty-wavy`'s wave 3px above
  // the one Chromium paints, with the extent exactly right. `auto` stays null,
  // which is the honest answer: the offset is then the font's, and the font's
  // underline position is not in this document either.
  const rawOffset = cs.textUnderlineOffset || 'auto'
  const offset = rawOffset === 'auto' || rawOffset === 'normal' ? null : px(rawOffset, 0)
  for (const one of String(line).trim().split(/\s+/)) {
    if (!one || one === 'none') continue
    out.push({
      line: one,
      style,
      color: color ? color.rgba : null,
      colorCss: color ? color.srcCss : (cs.textDecorationColor || ''),
      thickness,
      offset,
      offsetCss: rawOffset,
    })
  }
}

/**
 * `text-decoration` does not inherit — it PROPAGATES. A `<span>` inside an
 * underlined `<a>` computes `text-decoration-line: none` and is still underlined,
 * so the only way to know is to walk back up. Each ancestor draws with its own
 * colour and thickness, which is why this is a list and not a value.
 *
 * The walk does NOT stop at the block: propagation reaches in-flow block-level
 * boxes too, and `<a href><div>card</div></a>` — the linked-card pattern — is
 * underlined by an anchor that sits above the block entirely. It stops at the
 * first box that breaks propagation, and at the capture root, because a
 * decoration set above the capture is not part of the capture.
 *
 * Order is innermost first: the decoration nearest the glyphs is `[0]`.
 */
function decorationsOf(el, S) {
  const out = []
  const root = S.root
  const top = typeof document !== 'undefined' ? document.documentElement : null
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const cs = styleOf(n, S)
    pushDecoration(out, cs)
    if (n === root || n === top) break
    if (stopsDecoration(cs)) break
  }
  return out
}

/** The link the glyphs are inside of, from any depth up to the capture root. */
function hrefOf(el, S) {
  const root = S.root
  const top = typeof document !== 'undefined' ? document.documentElement : null
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n.tagName === 'A' && n.hasAttribute('href')) {
      // SVG anchors expose href as an SVGAnimatedString, not a string.
      return typeof n.href === 'string' ? n.href : (n.href && n.href.baseVal) || n.getAttribute('href')
    }
    if (n === root || n === top) break
  }
  return null
}

// ——— which family of the stack actually painted ———

/**
 * A CSS font stack is a list of WISHES and a font picker outside this machine
 * cannot read it: it is handed `-apple-system, "Segoe UI", system-ui, sans-serif`,
 * looks for one family of that name, finds nothing and substitutes. MEASURED
 * pasting into Figma (`FIGMA_FINDINGS.md` §5): the substitution alone widens a
 * line by 6.1%.
 *
 * So the family that WON in this browser is resolved here and emitted first, with
 * the page's stack kept behind it as the fallback it always was. Three sources,
 * in the order a browser itself would consult them:
 *
 *  1. `document.fonts` — a loaded `@font-face` whose family, style and
 *     `unicode-range` cover the text is what the browser used, full stop.
 *  2. the `name` table of that face's BINARY, when the rule carries the bytes
 *     inline. This is the classic mismatch: the page declares `"Inter var"` and
 *     the file says `Inter` / `SemiBold`, and only the second pair exists in a
 *     font picker. nameID 16/17 (typographic family/subfamily) with 1/2 behind.
 *  3. advance matching — the isolated candidate against the whole stack, over the
 *     block's own text. A family that is on this machine AND reproduces the
 *     stack's advances to within 0.01% is the one the browser picked. Both sides
 *     are measured at the same probe size, not the run's, so the comparison is
 *     self-consistent and the difference between two faces is as large as it gets.
 *
 * Nothing is emitted on a guess: a family that fails (3) is declared instead,
 * because forcing the wrong name on a font picker is worse than letting it
 * substitute — the substitution is at least visible to whoever pastes.
 */

/** Big enough that two different faces cannot agree on an advance by rounding. */
const FAMILY_PROBE_SIZE = 72

/** Advance difference, in px at `FAMILY_PROBE_SIZE`, that means "a different face". */
const FAMILY_EPS = 0.05

/** Relative tolerance when the two advances compared are the block's own text. */
const FAMILY_REL = 1e-4

/** The generics a candidate is probed against; a real face matches at most two by accident. */
const FAMILY_BASELINES = ['monospace', 'serif', 'sans-serif']

/** Wide, narrow, round and flat: any two faces disagree on the sum of these. */
const INSTALLED_PROBE = 'mmmMWWiil1I0OQ@gj'

/** Of the block's own text, the most that is worth measuring an advance over. */
const FAMILY_PROBE_MAX = 64

/** A font shorthand no caller passes, so a rejected assignment is detectable. */
const FONT_SENTINEL = '1px serif'

/**
 * Families CSS resolves by itself. Two different kinds live here and the
 * difference is the whole point of the diagnostic below: a GENERIC (`sans-serif`)
 * names a class and every viewer has one, while a SYSTEM keyword (`-apple-system`,
 * `system-ui`) names a real face — San Francisco on a Mac — that nothing outside
 * this machine can ask for by name.
 */
const SYSTEM_FAMILIES = new Set([
  '-apple-system', 'blinkmacsystemfont', 'system-ui', 'ui-serif', 'ui-sans-serif',
  'ui-monospace', 'ui-rounded',
])

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'math', 'emoji', 'fangsong',
  ...SYSTEM_FAMILIES,
])

/** The generic class a family belongs to, for a consumer estimating a substitution. */
const FAMILY_CLASS = {
  'ui-serif': 'serif', 'ui-monospace': 'monospace', 'ui-sans-serif': 'sans-serif',
  'system-ui': 'sans-serif', '-apple-system': 'sans-serif', blinkmacsystemfont: 'sans-serif',
  'ui-rounded': 'sans-serif',
}

/** An identifier CSS accepts unquoted; anything else has to be a `<string>`. */
const BARE_FAMILY = /^-?[A-Za-z_][A-Za-z0-9_-]*$/

/** `"Inter var", system-ui, sans-serif` -> `['Inter var', 'system-ui', 'sans-serif']`. */
function splitStack(stack) {
  const out = []
  let buf = ''
  let quote = ''
  for (const ch of String(stack == null ? '' : stack)) {
    if (quote) {
      if (ch === quote) quote = ''
      else buf += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === ',') {
      const name = buf.trim()
      if (name) out.push(name)
      buf = ''
      continue
    }
    buf += ch
  }
  const last = buf.trim()
  if (last) out.push(last)
  return out
}

function quoteFamily(name) {
  const clean = String(name == null ? '' : name).trim()
  return BARE_FAMILY.test(clean) ? clean : `"${clean.replace(/["\\]/g, '')}"`
}

/**
 * Assign a font shorthand and say whether the context TOOK it. A rejected
 * shorthand leaves the previous font in place, so a width measured after one
 * describes a font nobody asked for — the single failure mode that would poison
 * every comparison below.
 */
function setFont(c, css) {
  c.font = FONT_SENTINEL
  c.font = css
  return c.font !== FONT_SENTINEL
}

/** The advance of `text` in one font shorthand, or null when the shorthand was refused. */
function widthOf(css, text, S) {
  const c = measurer(S)
  if (!setFont(c, css)) return null
  return c.measureText(text).width
}

/**
 * Is this family on the machine at all?
 *
 * The probe is the classic one and its limits are known: a family is measured
 * against three generics, and it counts as present when it disagrees with any of
 * them. A face that is metrically identical to all three cannot be told from a
 * fallback this way — which is exactly why presence alone never decides the
 * winner, and the advance of the whole stack has to agree as well.
 */
function isInstalled(name, S) {
  const key = name.toLowerCase()
  const hit = S.installed.get(key)
  if (hit !== undefined) return hit
  let out = false
  if (GENERIC_FAMILIES.has(key)) {
    out = true
  } else {
    const q = quoteFamily(name)
    for (const base of FAMILY_BASELINES) {
      const alone = widthOf(`${FAMILY_PROBE_SIZE}px ${base}`, INSTALLED_PROBE, S)
      const with_ = widthOf(`${FAMILY_PROBE_SIZE}px ${q}, ${base}`, INSTALLED_PROBE, S)
      if (alone === null || with_ === null) continue
      if (Math.abs(alone - with_) > FAMILY_EPS) { out = true; break }
    }
  }
  S.installed.set(key, out)
  return out
}

// ——— document.fonts ———

// Exported for `collect/font.js`, the asynchronous other half of font resolution:
// it matches rules and reads binaries with the SAME arithmetic this module uses,
// because two copies of `weightRange` is how a bold run gets a regular file.
export const unquoteFamily = (v) => String(v == null ? '' : v).trim().replace(/^["']|["']$/g, '')

/** Every `FontFace` the page has, by lower-cased family. Null when there is no API. */
function facesByFamily(S) {
  if (S.faces !== undefined) return S.faces
  const set = typeof document !== 'undefined' ? document.fonts : null
  if (!set || typeof set.forEach !== 'function') {
    S.faces = null
    return null
  }
  const out = new Map()
  try {
    set.forEach((face) => {
      const family = unquoteFamily(face && face.family)
      if (!family) return
      const key = family.toLowerCase()
      if (!out.has(key)) out.set(key, [])
      out.get(key).push(face)
    })
  } catch {
    S.faces = null
    return null
  }
  S.faces = out
  return out
}

/** `U+0-10FFFF, U+4??` -> `[[lo, hi], …]`. Null means "everything", which is the default. */
export function parseUnicodeRange(value) {
  const s = String(value == null ? '' : value).trim()
  if (!s || s === 'U+0-10FFFF' || s === 'u+0-10ffff') return null
  const out = []
  for (const part of s.split(',')) {
    const m = /^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(part.trim())
    if (!m) return null
    if (m[2]) { out.push([parseInt(m[1], 16), parseInt(m[2], 16)]); continue }
    if (m[1].includes('?')) {
      out.push([parseInt(m[1].replace(/\?/g, '0'), 16), parseInt(m[1].replace(/\?/g, 'F'), 16)])
      continue
    }
    const one = parseInt(m[1], 16)
    out.push([one, one])
  }
  return out.length ? out : null
}

/** Does this face cover any of the code points the block paints in it? */
function coversAny(face, points) {
  const ranges = parseUnicodeRange(face && face.unicodeRange)
  if (!ranges) return true
  for (const cp of points) {
    for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return true
  }
  return false
}

/** `700`, `bold`, `100 900` -> `[min, max]`. */
export function weightRange(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase()
  if (!s || s === 'normal') return [400, 400]
  if (s === 'bold') return [700, 700]
  const parts = s.split(/\s+/).map(Number).filter(Number.isFinite)
  if (!parts.length) return [400, 400]
  return [parts[0], parts.length > 1 ? parts[1] : parts[0]]
}

/**
 * The face of a family the browser would use for this weight and style, or null
 * when the family has none that covers the text.
 *
 * Weight does NOT decide whether the FAMILY wins — a family with one 400 face
 * still serves a 700 request, synthesised — so it only picks among the faces that
 * are there. Nearest weight, style first, exactly as CSS font matching orders it.
 */
function pickFace(faces, weight, italic, points) {
  let best = null
  let bestScore = -Infinity
  for (const face of faces) {
    if (face.status && face.status !== 'loaded') continue
    if (!coversAny(face, points)) continue
    const faceItalic = /^(italic|oblique)/.test(String(face.style || 'normal'))
    const [lo, hi] = weightRange(face.weight)
    const distance = weight < lo ? lo - weight : weight > hi ? weight - hi : 0
    const score = (faceItalic === italic ? 1000 : 0) - distance
    if (score > bestScore) { bestScore = score; best = face }
  }
  return best
}

// ——— the `name` table of the binary ———

/**
 * The bytes of a `data:` URI, or null when the URI carries none we can read
 * synchronously. Only base64 is decoded: a percent-encoded font is legal and
 * nobody writes one, and guessing wrong would hand the parser noise.
 */
export function dataUriBytes(uri) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),/i.exec(uri)
  if (!m || !/;base64/i.test(m[2] || '')) return null
  try {
    const binary = atob(uri.slice(m[0].length))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** Every `@font-face` rule of the document, including the ones nested in `@media`. */
function fontFaceRules(S) {
  if (S.faceRules !== undefined) return S.faceRules
  const out = []
  const sheets = typeof document !== 'undefined' && document.styleSheets ? document.styleSheets : []
  const walk = (rules) => {
    for (const rule of rules) {
      // 5 is CSSFontFaceRule, 4 @media, 12 @supports, 13 @layer. `constructor.name`
      // is not reliable across engines and the numeric types are.
      if (rule.type === 5 || (rule.style && typeof rule.cssText === 'string' && /^@font-face/.test(rule.cssText))) {
        out.push(rule)
        continue
      }
      if (rule.cssRules) {
        try { walk(rule.cssRules) } catch { /* cross-origin */ }
      }
    }
  }
  for (const sheet of sheets) {
    try { walk(sheet.cssRules) } catch { /* a cross-origin sheet exposes no rules */ }
  }
  S.faceRules = out
  return out
}

const NAME_PLATFORM_SCORE = { 3: 10, 0: 8, 1: 6 }

function readTag(view, at) {
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))
}

/** The `name` table of a bare SFNT (`.ttf`, `.otf`, `.ttc`). */
function sfntTable(view, want) {
  let base = 0
  if (readTag(view, 0) === 'ttcf') base = view.getUint32(12)
  const count = view.getUint16(base + 4)
  for (let i = 0; i < count; i++) {
    const at = base + 12 + 16 * i
    if (readTag(view, at) !== want) continue
    return { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) }
  }
  return null
}

/**
 * The `name` table of a WOFF1. Its tables are individually zlib-compressed and a
 * table that did not shrink is stored raw — which the `name` table, being short
 * and full of UTF-16 padding, very often is. When it is not, we say so rather
 * than pull in an inflater.
 */
function woffTable(view, want) {
  const count = view.getUint16(12)
  for (let i = 0; i < count; i++) {
    const at = 44 + 20 * i
    if (readTag(view, at) !== want) continue
    const offset = view.getUint32(at + 4)
    const comp = view.getUint32(at + 8)
    const orig = view.getUint32(at + 12)
    if (comp !== orig) {
      return { error: 'its `name` table is zlib-compressed inside the WOFF and nothing in the platform inflates it synchronously' }
    }
    return { offset, length: comp }
  }
  return null
}

function readNameString(view, at, length, platform) {
  let out = ''
  if (platform === 1) {
    for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(at + i))
  } else {
    for (let i = 0; i + 1 < length; i += 2) out += String.fromCharCode(view.getUint16(at + i))
  }
  return out.replace(/\u0000/g, '').trim()
}

/**
 * nameID 16/17 (typographic family and subfamily) with 1/2 behind them, English
 * preferred. The pair is what a font picker lists: the page's `"Inter var"` is a
 * CSS name the file never claims, and `Inter` / `SemiBold` is what the binary
 * says it is.
 *
 * @returns {{family: string|null, sub: string|null}|{error: string}}
 */
export function parseFontNames(bytes) {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const tag = readTag(view, 0)
    if (tag === 'wOF2') {
      return { error: 'it is WOFF2, whose every table is Brotli-compressed; nothing in the platform decompresses that synchronously' }
    }
    const table = tag === 'wOFF' ? woffTable(view, 'name') : sfntTable(view, 'name')
    if (!table) return { error: 'it carries no `name` table' }
    if (table.error) return table

    const at = table.offset
    const count = view.getUint16(at + 2)
    const strings = at + view.getUint16(at + 4)
    const best = { family: null, sub: null }
    const score = { family: -Infinity, sub: -Infinity }
    for (let i = 0; i < count; i++) {
      const rec = at + 6 + 12 * i
      const platform = view.getUint16(rec)
      const language = view.getUint16(rec + 4)
      const nameId = view.getUint16(rec + 6)
      const length = view.getUint16(rec + 8)
      const offset = view.getUint16(rec + 10)
      let key = null
      let rank = 0
      if (nameId === 16 || nameId === 1) { key = 'family'; rank = nameId === 16 ? 100 : 0 }
      else if (nameId === 17 || nameId === 2) { key = 'sub'; rank = nameId === 17 ? 100 : 0 }
      if (!key) continue
      const english = (platform === 3 && language === 0x0409) || (platform === 1 && language === 0) || platform === 0
      const total = rank + (english ? 20 : 0) + (NAME_PLATFORM_SCORE[platform] || 0)
      if (total <= score[key]) continue
      const value = readNameString(view, strings + offset, length, platform)
      if (!value) continue
      score[key] = total
      best[key] = value
    }
    if (!best.family && !best.sub) return { error: 'its `name` table holds no family record' }
    return best
  } catch (error) {
    return { error: `its binary could not be read (${error && error.message})` }
  }
}

/**
 * What the binary behind an `@font-face` family calls itself, when the rule
 * carries the bytes inline. A `url()` pointing at a file is deliberately not
 * fetched: this collector is synchronous, and a family resolved on the next tick
 * is a family the emitters have already written.
 *
 * @returns {{family: string|null, sub: string|null}|{error: string}|null}
 */
function nameTableFor(cssFamily, weight, italic, S) {
  const key = `${cssFamily.toLowerCase()} ${weight} ${italic}`
  const hit = S.nameTables.get(key)
  if (hit !== undefined) return hit

  // One family is several rules — 400, 700, italic — and they are different
  // FILES with different `name` tables. Reading whichever comes first would hand
  // a bold run the subfamily of the regular file, so the rules are ordered the
  // way CSS orders faces: style first, then nearest weight.
  const rules = []
  for (const rule of fontFaceRules(S)) {
    let declared = ''
    let src = ''
    let w = ''
    let style = ''
    try {
      declared = unquoteFamily(rule.style.getPropertyValue('font-family'))
      src = rule.style.getPropertyValue('src') || ''
      w = rule.style.getPropertyValue('font-weight') || ''
      style = rule.style.getPropertyValue('font-style') || ''
    } catch { continue }
    if (declared.toLowerCase() !== cssFamily.toLowerCase()) continue
    const [lo, hi] = weightRange(w)
    const distance = weight < lo ? lo - weight : weight > hi ? weight - hi : 0
    const ruleItalic = /^(italic|oblique)/.test(style || 'normal')
    rules.push({ src, score: (ruleItalic === italic ? 1000 : 0) - distance })
  }
  rules.sort((a, b) => b.score - a.score)

  let out = null
  for (const rule of rules) {
    const m = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/i.exec(rule.src)
    const url = m ? (m[1] || m[2] || m[3] || '') : ''
    if (!/^data:/i.test(url)) {
      out = out || { error: 'its `@font-face` rule points at a file rather than carrying the bytes inline, and this collector is synchronous' }
      continue
    }
    const bytes = dataUriBytes(url)
    if (!bytes) {
      out = out || { error: 'its `@font-face` rule carries a data URI this build cannot decode (only base64 is read)' }
      continue
    }
    const names = parseFontNames(bytes)
    if (!names.error) { out = names; break }
    out = out || names
  }
  S.nameTables.set(key, out)
  return out
}

// ——— the resolution ———

/**
 * @typedef {object} FamilyResolution
 * @property {string} family        the name to emit — the binary's when it was readable
 * @property {string} cssFamily     the family OF THE STACK that won, before any rename
 * @property {string} stack         the emitted stack: resolved family first, page's behind
 * @property {string} source        'fontface' | 'name-table' | 'metrics' | 'generic' | 'unresolved'
 * @property {string|null} styleName  the binary's typographic subfamily (`SemiBold`)
 * @property {string} genericClass  'sans-serif' | 'serif' | 'monospace' | …
 * @property {boolean} referenceable  false when the winner is a system face nobody can name
 * @property {boolean} webfont      the page supplied it with `@font-face`
 * @property {boolean} verified     the isolated family reproduces the whole stack's advances
 */

/** Up to `FAMILY_PROBE_MAX` characters of what this element actually paints. */
function familyProbe(el) {
  const text = (el && typeof el.textContent === 'string' ? el.textContent : '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, FAMILY_PROBE_MAX) : INSTALLED_PROBE
}

/**
 * Which family of `cs.fontFamily` this browser actually painted with.
 *
 * @param {CSSStyleDeclaration|Record<string,string>} cs
 * @param {Element} el   the element the characters live in — its text is the probe
 * @returns {FamilyResolution}
 */
function resolveFamily(cs, el, S, warn) {
  const stack = String(cs.fontFamily || '')
  const families = splitStack(stack)
  const first = families[0] || 'sans-serif'
  const weight = parseInt(cs.fontWeight, 10) || (cs.fontWeight === 'bold' ? 700 : 400)
  const italic = /^(italic|oblique)/.test(cs.fontStyle || '')
  const probe = familyProbe(el)
  const key = `${stack}\u0000${weight}\u0000${italic}\u0000${probe}`
  const hit = S.family.get(key)
  if (hit) {
    if (hit.note) warn(hit.note)
    return hit
  }

  const points = [...new Set([...probe])].map((ch) => ch.codePointAt(0))
  const size = FAMILY_PROBE_SIZE
  const head = `${italic ? 'italic ' : ''}${weight} ${size}px `
  const stackWidth = widthOf(head + stack, probe, S)
  const matches = (family) => {
    if (stackWidth === null) return false
    const w = widthOf(head + quoteFamily(family), probe, S)
    return w !== null && Math.abs(w - stackWidth) <= Math.max(FAMILY_EPS, FAMILY_REL * stackWidth)
  }

  const faces = facesByFamily(S)
  let out = null
  let note = null
  /** A family that is present but does not reproduce the stack — kept for the message. */
  const nearMiss = []

  for (const family of families) {
    const lower = family.toLowerCase()
    const list = faces ? faces.get(lower) : null
    const face = list && list.length ? pickFace(list, weight, italic, points) : null
    if (face) {
      // Step 2: the binary renames it wherever the page's CSS name is not the
      // name the file claims — `"Inter var"` -> `Inter` / `SemiBold`.
      const names = nameTableFor(family, weight, italic, S)
      // A variable face covers a RANGE of weights and its `name` table names one
      // instance of it — `Inter` / `Regular` for a file that also paints 700. The
      // family is still right; the subfamily would be a lie, so it is dropped and
      // the consumer derives the style from the weight it already has.
      const [lo, hi] = weightRange(face.weight)
      const variable = lo !== hi
      const renamed = names && !names.error && names.family ? names.family : null
      if (names && names.error) {
        note = {
          code: 'collect.text-font-name-unread',
          grade: 'A',
          severity: 'warn',
          message: `"${family}" is served by an @font-face rule of this page and the name its own binary ` +
            `claims could not be read: ${names.error}. The export therefore carries the CSS family name, ` +
            'which is a name the page invented and the file may not answer to — a font picker that lists ' +
            'fonts by what their `name` table says (Figma does) will not find it and will substitute.',
        }
      }
      out = {
        family: renamed || family,
        cssFamily: family,
        source: renamed ? 'name-table' : 'fontface',
        styleName: !variable && names && !names.error && names.sub ? names.sub : null,
        webfont: true,
        verified: matches(family),
      }
      break
    }
    if (GENERIC_FAMILIES.has(lower)) {
      out = { family, cssFamily: family, source: 'generic', styleName: null, webfont: false, verified: true }
      break
    }
    if (!isInstalled(family, S)) continue
    if (!matches(family)) { nearMiss.push(family); continue }
    out = { family, cssFamily: family, source: 'metrics', styleName: null, webfont: false, verified: true }
    break
  }

  if (!out) {
    out = {
      family: first,
      cssFamily: first,
      source: 'unresolved',
      styleName: null,
      webfont: false,
      verified: false,
    }
    note = {
      code: 'collect.text-family-unresolved',
      grade: 'A',
      severity: 'warn',
      message: `the family that painted this text could not be identified inside the stack ${stack}: ` +
        (nearMiss.length
          ? `${nearMiss.join(', ')} ${nearMiss.length > 1 ? 'are' : 'is'} on this machine but ` +
            `${nearMiss.length > 1 ? 'none of them reproduces' : 'it does not reproduce'} the advances the ` +
            'whole stack measures'
          : 'no family in it is on this machine and none reproduces the advances the whole stack measures') +
        '. The stack is emitted exactly as the page wrote it, so a font picker that cannot read a stack ' +
        'substitutes — which is what it would have done anyway, and is now said out loud instead of guessed at.',
    }
  }

  const lower = out.family.toLowerCase()
  out.generic = GENERIC_FAMILIES.has(lower)
  out.system = SYSTEM_FAMILIES.has(lower)
  // A system keyword names a REAL face — San Francisco, Segoe UI — that only this
  // machine can call by that name; a generic names a class every viewer resolves
  // to something of its own. Only the first of the two is a face the export can
  // neither carry nor name, which is what `referenceable` is asked about.
  out.referenceable = !out.system
  out.genericClass = FAMILY_CLASS[lower] || (GENERIC_FAMILIES.has(lower) ? out.family : null) ||
    familyClassOf(families)
  // Only a resolution that reproduced the stack's own advances is put in FRONT of
  // it. Everything else leaves the page's stack exactly as it was: a name forced
  // on a font picker is a substitution nobody can see, and a stack it cannot read
  // is one it substitutes for visibly. A generic never goes in front either — it
  // would beat a family the destination may well have.
  const wins = out.verified && !out.generic &&
    unquoteFamily(first).toLowerCase() !== out.family.toLowerCase()
  out.stack = wins ? `${quoteFamily(out.family)}, ${stack}` : stack
  out.note = note

  S.family.set(key, out)
  if (note) warn(note)
  return out
}

/** How the winner was decided, in words, for the diagnostic that reports it. */
const RESOLVED_BY = {
  fontface: 'an @font-face rule of this page declares it and the face is loaded',
  'name-table': 'an @font-face rule of this page declares it, and this is the name its own binary claims ' +
    '(the `name` table, ids 16/17) — which is the name a font picker lists and the CSS name is not',
  metrics: 'it is the first family of the stack that is on this machine AND reproduces the advances the ' +
    'whole stack measures, character for character',
  generic: 'it is the generic the stack falls through to',
  unresolved: 'nothing in the stack could be identified',
}

/** The UI face a system keyword names here, when the platform is one we can name. */
function systemFaceName() {
  const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : ''
  if (/Mac OS X|Macintosh/.test(ua)) return 'San Francisco, which this machine reports as macOS'
  if (/Windows/.test(ua)) return 'Segoe UI, which this machine reports as Windows'
  if (/Android/.test(ua)) return 'Roboto, which this machine reports as Android'
  return null
}

/**
 * What the export will say the font is, and what the destination will make of it.
 *
 * Two different pieces of news, and conflating them would hide the actionable one:
 * a family that was resolved and put in front of the stack is a WIN and is stated
 * so a reader can see it happened, while a family that is a system keyword is a
 * dead end — `-apple-system` is not a font name, it is this machine's word for its
 * own UI face, and no picker anywhere can be handed it.
 */
function declareFamilies(styles, warn) {
  // Named by FAMILY and never by style id: the ids in `styles` are local to this
  // block, and the document renumbers them — a message naming `ts_0` would name a
  // different style in the document it ends up in.
  const promoted = new Set()
  const unnameable = new Set()
  const by = new Set()
  for (const id of Object.keys(styles)) {
    const st = styles[id]
    if (!st || typeof st.family !== 'string') continue
    if (st.fontFamily !== st.stackCss) {
      promoted.add(`${st.cssFamily} → ${st.family}${st.resolvedStyleName ? ` / ${st.resolvedStyleName}` : ''}`)
      by.add(st.resolvedFrom)
    }
    if (st.referenceable === false) unnameable.add(st.family)
  }

  if (promoted.size) {
    warn({
      code: 'collect.text-family-resolved',
      grade: 'E',
      severity: 'info',
      message: 'the family that actually painted was resolved and is emitted IN FRONT of the page\'s stack — ' +
        `${[...promoted].join(', ')}. A font picker does not resolve a CSS stack: it takes one name, fails to ` +
        'find it and substitutes, which measures 6.1% wider in Figma. The stack stays behind the resolved name ' +
        `as the fallback it always was. Resolved because ${[...by].map((s) => RESOLVED_BY[s] || s).join('; ')}.`,
    })
  }
  if (unnameable.size) {
    const face = systemFaceName()
    warn({
      code: 'collect.text-family-system',
      grade: 'A',
      severity: 'warn',
      message: `the family that painted this text (${[...unnameable].join(', ')}) is a system keyword, and a ` +
        'system keyword is not a font name: it is this machine\'s word for its own UI face' +
        (face ? ` — ${face} — ` : ' ') +
        'and no font picker anywhere can be asked for it by name. There is nothing to resolve and nothing to ' +
        'emit: the export carries the stack as the page wrote it and the destination substitutes. MEASURED ' +
        'pasting into Figma, that substitution alone makes a line 6.1% wider, and everything anchored to the ' +
        'end of a line moves with it. The only real fix is embedding the binary, which v0 does not do.',
    })
  }
}

/** The generic the stack itself names, which is the class a substitute is drawn from. */
function familyClassOf(families) {
  for (let i = families.length - 1; i >= 0; i--) {
    const lower = families[i].toLowerCase()
    if (FAMILY_CLASS[lower]) return FAMILY_CLASS[lower]
    if (GENERIC_FAMILIES.has(lower)) return lower
  }
  return 'sans-serif'
}

/**
 * Every computed property a run style is built from. `::first-letter` overlays a
 * few of them onto the style of the element the letter actually lives in, and
 * this is the list that overlay has to cover.
 */
const STYLE_PROPS = [
  'fontStyle', 'fontWeight', 'fontFamily', 'fontSize', 'fontStretch', 'fontVariant', 'fontVariantCaps',
  'fontFeatureSettings', 'fontVariationSettings', 'letterSpacing', 'wordSpacing', 'lineHeight',
  'color', 'webkitTextFillColor', 'webkitTextStrokeWidth', 'webkitTextStrokeColor', 'textTransform',
]

/**
 * Everything that makes one stretch of characters a different run. Cached per
 * element, because a text node's style is entirely its parent's and the same
 * `<em>` is asked about once per text node inside it.
 */
function textStyleOf(el, blockEl, S, warn) {
  const hit = S.styles.get(el)
  if (hit && hit.blockEl === blockEl) {
    if (hit.note) warn(hit.note)
    return hit
  }
  const style = buildTextStyle(el, styleOf(el, S), blockEl, S, warn)
  S.styles.set(el, style)
  return style
}

/**
 * @param {Element} el       the element the characters live in — it owns the
 *                           decorations and the link, which are not properties
 *                           of `cs` and do not come from a pseudo-element
 * @param {CSSStyleDeclaration|Record<string,string>} cs  the computed values to read
 */
function buildTextStyle(el, cs, blockEl, S, warn) {
  const size = px(cs.fontSize, 16)
  const metrics = metricsOf(fontShorthand(cs, size), size, S)
  if (metrics.note) warn(metrics.note)

  // -webkit-text-fill-color wins over `color` wherever both are set, and it is
  // what `background-clip: text` sets to `transparent`.
  const fillCss = cs.webkitTextFillColor || cs.color
  const fill = parseColor(fillCss)
  const strokeWidth = px(cs.webkitTextStrokeWidth, 0)
  const stroke = strokeWidth > EPS ? parseColor(cs.webkitTextStrokeColor || cs.color) : null

  // `font-variant` is a shorthand, and the ONE longhand of the family that
  // changes which glyphs are painted is `font-variant-caps`. Reading the
  // shorthand alone loses it whenever another longhand is set: Chromium then
  // serializes the shorthand as the list it can serialize, and `small-caps` is
  // simply not in it. Both are read and the caps value is merged in, because
  // `variant` is what the emitters look at — `emit/pdf.js` synthesises small
  // caps off exactly this string (`splitSmallCaps`), and inventing a second
  // field would give it two places to look.
  const variantCaps = cs.fontVariantCaps && cs.fontVariantCaps !== 'normal' ? cs.fontVariantCaps : ''
  const variantShort = cs.fontVariant && cs.fontVariant !== 'normal' ? cs.fontVariant : ''
  const fontVariant = variantCaps && !variantShort.includes(variantCaps)
    ? (variantShort ? `${variantShort} ${variantCaps}` : variantCaps)
    : (variantShort || 'normal')

  // Which family of the stack this browser really painted with. It is emitted in
  // FRONT of the stack, because a font picker outside this machine reads a stack
  // as one name, fails to find it and substitutes — 6.1% wider, measured.
  const resolved = resolveFamily(cs, el, S, warn)

  const lineHeightNormal = cs.lineHeight === 'normal'
  const style = {
    blockEl,
    note: fill ? null : `the text colour "${fillCss}" could not be parsed — treated as opaque black`,
    fontFamily: resolved.stack,
    family: resolved.family,
    // The family OF THE STACK that won, before the binary renamed it: it is the
    // name `@font-face` knows this face by, so it is what a lookup against the
    // page's own rules has to use.
    cssFamily: resolved.cssFamily,
    stackCss: cs.fontFamily,
    resolvedFrom: resolved.source,
    resolvedStyleName: resolved.styleName,
    genericClass: resolved.genericClass,
    referenceable: resolved.referenceable,
    webfont: resolved.webfont,
    fontSize: size,
    fontWeight: parseInt(cs.fontWeight, 10) || (cs.fontWeight === 'bold' ? 700 : 400),
    fontStyle: cs.fontStyle || 'normal',
    fontStretch: cs.fontStretch || 'normal',
    fontVariant,
    fontVariantCaps: variantCaps || 'normal',
    fontFeatureSettings: cs.fontFeatureSettings || 'normal',
    fontVariationSettings: cs.fontVariationSettings || 'normal',
    // 'normal' is not a length: a consumer that assigns it to a canvas keeps the
    // previous value, so both are resolved to numbers once, here.
    letterSpacing: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing, 0),
    wordSpacing: cs.wordSpacing === 'normal' ? 0 : px(cs.wordSpacing, 0),
    lineHeight: lineHeightNormal ? metrics.ascent + metrics.descent : px(cs.lineHeight, size),
    lineHeightNormal,
    color: fill ? fill.rgba : [0, 0, 0, 1],
    colorCss: fill ? fill.srcCss : fillCss,
    decorations: decorationsOf(el, S),
    textTransform: cs.textTransform || 'none',
    strokeWidth,
    strokeColor: stroke ? stroke.rgba : null,
    href: hrefOf(el, S),
    ascent: metrics.ascent,
    descent: metrics.descent,
    fontCss: metrics.fontCss,
  }
  style.key = [
    style.fontFamily, style.family, style.resolvedStyleName,
    style.fontSize, style.fontWeight, style.fontStyle, style.fontStretch,
    style.fontVariant, style.fontVariantCaps, style.fontFeatureSettings, style.fontVariationSettings,
    style.letterSpacing, style.wordSpacing, style.lineHeight, style.colorCss,
    style.decorations.map(d => `${d.line}|${d.style}|${d.colorCss}|${d.thickness}`).join('&'),
    style.textTransform, style.strokeWidth, style.strokeColor && style.strokeColor.join(','), style.href,
  ].join('\u0000')

  if (style.note) warn(style.note)
  return style
}

// ——— ::first-letter ———

/**
 * A difference between `getComputedStyle(el)` and `getComputedStyle(el,
 * '::first-letter')` in an INHERITED property means a rule matched the pseudo:
 * with no rule at all the browser hands back the element's own values.
 *
 * Only inherited ones, and that is the whole subtlety — a pseudo-element with no
 * rule at all reports `padding: 0` under an element with `padding: 8px`, and
 * `text-decoration-line: none` under an underlined `<a>`, because neither
 * inherits. Testing those said "first letter!" on every padded block in the page.
 */
const FIRST_LETTER_PROPS = STYLE_PROPS

/** Unicode punctuation, which the first typographic letter unit swallows on both sides. */
const PUNCT = (() => {
  try { return new RegExp('[\\p{P}\\p{S}]', 'u') } catch { /* older engine */ }
  return /["'“”‘’«»([{<¿¡.,;:!?\-—–]/
})()

/**
 * How many characters of `data` the first typographic letter unit covers:
 * leading white space, then any leading punctuation, then ONE grapheme, then the
 * punctuation stuck to its right — which is what CSS puts in the pseudo's box.
 * Zero when there is no letter here at all.
 */
function firstLetterLength(data, lang, S) {
  let i = 0
  while (i < data.length && /\s/.test(data[i])) i++
  while (i < data.length && PUNCT.test(data[i])) i++
  if (i >= data.length) return 0
  const starts = graphemeStarts(data.slice(i), lang, S)
  i += starts && starts.length > 1 ? starts[1] : (data.codePointAt(i) > 0xFFFF ? 2 : 1)
  while (i < data.length && PUNCT.test(data[i])) i++
  return i
}

/**
 * Split the first piece in two when the block has a `::first-letter`.
 *
 * The pseudo is a real box with its own font, and measuring its glyph with the
 * ELEMENT'S metrics is how a 52px drop cap came out as a 13.5px letter stretched
 * to the drop cap's 37px advance — a smear, and the only visible defect left in
 * the demo. The overlay is per-property rather than wholesale: the pseudo's
 * computed style inherits from the block, so a first letter that sits inside a
 * `<b>` would lose its weight if the whole style were replaced.
 *
 * Mutates `pieces` in place, and reports through `warn` what the split could not
 * carry. Whether the split was right is decided later, against the rect the
 * browser painted.
 */
function splitFirstLetter(pieces, blockEl, blockCs, S, warn) {
  if (!pieces.length) return
  let flCs = null
  try { flCs = getComputedStyle(blockEl, '::first-letter') } catch { return }
  if (!flCs) return
  let changed
  try {
    changed = FIRST_LETTER_PROPS.filter(prop => flCs[prop] !== blockCs[prop])
  } catch { return }
  if (!changed.length) return

  // The first piece that paints a letter. Anything before it is white space that
  // collapses away, and the pseudo attaches to the first one that is not.
  let index = 0
  let length = 0
  for (; index < pieces.length; index++) {
    length = firstLetterLength(pieces[index].t.node.data, langOf(pieces[index].t.el, S), S)
    if (length > 0) break
  }
  if (index >= pieces.length || !length) return
  const piece = pieces[index]

  const overlaid = {}
  for (const prop of STYLE_PROPS) overlaid[prop] = piece.t.cs[prop]
  for (const prop of changed) overlaid[prop] = flCs[prop]
  const style = buildTextStyle(piece.t.el, overlaid, blockEl, S, warn)
  // Not inherited, so it is only readable once the split is decided: a pseudo
  // with no rule reports `none` here whatever the element does.
  const line = flCs.textDecorationLine
  if (line && line !== 'none' && line !== piece.t.cs.textDecorationLine) {
    style.decorations = style.decorations.slice()
    pushDecoration(style.decorations, flCs)
  }
  // The style is per-block, not per-element: the cache would hand this one to
  // every other text node of the same element.
  style.key = `${style.key}::first-letter`

  if (length < piece.to) {
    const rest = { ...piece, from: length, rStart: piece.t.rAt[length], style: piece.style }
    Object.assign(piece, { to: length, rEnd: piece.t.rAt[length], style, firstLetter: true })
    pieces.splice(index + 1, 0, rest)
  } else {
    // Nothing to split off — the letter already IS the whole text node. That is
    // the normal shape in snapdom's clone, which materialises `::first-letter`
    // into its own `<span>`; the old early return here treated "no split needed"
    // as "no pseudo", and a 52px orange drop cap was emitted with the paragraph's
    // 16.5px font stretched across its 37px advance. The overlay is the entire
    // point of this function and applies whether or not the piece has to be cut.
    Object.assign(piece, { style, firstLetter: true })
  }

  if (changed.includes('textTransform')) {
    warn('::first-letter sets its own text-transform — the painted string was read back per text node ' +
      'and carries the block\'s transform at that position')
  }
  const box = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth']
    .some(prop => px(flCs[prop], 0) > 0)
  if (box) {
    warn('::first-letter has padding or a border of its own — it is a box around the glyph and the run ' +
      'carries only the glyph, so a backend that draws a background or a border for it has nothing to draw')
  }
}

// ——— the walk ———

/**
 * `white-space` still computes to one keyword in Chromium, but the longhands are
 * what the spec now defines the behaviour on, so they win where they exist.
 * `break-spaces` and `preserve-spaces` differ from `preserve` only in how they
 * WRAP, which the browser has already decided by the time we read rects.
 */
function collapseMode(cs) {
  const long = cs.whiteSpaceCollapse
  if (long) {
    if (long === 'collapse') return 'collapse'
    if (long === 'preserve-breaks') return 'preserve-breaks'
    return 'preserve'
  }
  const ws = cs.whiteSpace
  if (ws === 'pre' || ws === 'pre-wrap' || ws === 'break-spaces') return 'preserve'
  if (ws === 'pre-line') return 'preserve-breaks'
  return 'collapse'
}

/**
 * The text nodes of THIS block's inline formatting context, in document order.
 *
 * `SHOW_ELEMENT` is in the mask only so the filter can return `FILTER_REJECT` and
 * prune a subtree: with `SHOW_TEXT` alone the filter is never asked about an
 * element, and a nested block's text would land in its parent's line grid. Every
 * element that is not pruned returns `FILTER_SKIP` — visited for its children,
 * never emitted.
 */
function collectTextNodes(blockEl, S, flags) {
  const texts = []
  // Something that is not a character has just gone past: a `<br>`, an image, an
  // `inline-block`, a form control. It carries a break opportunity that leaves no
  // white space behind, so the next text node has to remember it was there —
  // otherwise a line that ends at a `<br>` looks exactly like a word cut in half.
  let afterBox = false
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.data ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      }
      // Paint traversal can omit this inline node while its parent still owns
      // the formatting context. Prune it here too, before reading any text.
      if (isExcluded(node, S.exclude)) { afterBox = true; return NodeFilter.FILTER_REJECT }
      const tag = node.tagName.toUpperCase()
      if (tag === 'BR' || tag === 'WBR') { afterBox = true; return NodeFilter.FILTER_REJECT }
      if (SKIP_TAGS.has(tag)) {
        if (RUBY_TAGS.has(tag)) flags.ruby = true
        else afterBox = true
        return NodeFilter.FILTER_REJECT
      }
      if (tag === 'SLOT') { flags.shadow = true; return NodeFilter.FILTER_SKIP }
      if (node.shadowRoot) flags.shadow = true
      const cs = styleOf(node, S)
      if (cs.display === 'none') return NodeFilter.FILTER_REJECT
      if (cs.contentVisibility === 'hidden') { flags.contentVisibility = true; return NodeFilter.FILTER_REJECT }
      // Generates no box: its children belong to the parent's context.
      if (cs.display === 'contents') return NodeFilter.FILTER_SKIP
      if (!INLINE_DISPLAY.test(cs.display)) { afterBox = true; return NodeFilter.FILTER_REJECT }
      if (cs.verticalAlign && cs.verticalAlign !== 'baseline') flags.verticalAlign = true
      return NodeFilter.FILTER_SKIP
    },
  })

  while (walker.nextNode()) {
    const node = walker.currentNode
    const el = node.parentElement
    if (!el) continue
    const cs = styleOf(el, S)
    // visibility is inherited and a descendant may turn it back on, so the text
    // node's own parent is the whole answer for that node.
    // A text node that is not collected does not consume the pending box either:
    // the break opportunity belongs to the next node that really paints.
    if (cs.visibility !== 'visible') { flags.hidden += 1; continue }
    if (cs.verticalAlign && cs.verticalAlign !== 'baseline') flags.verticalAlign = true
    texts.push({ node, el, cs, mode: collapseMode(cs), afterBox })
    afterBox = false
  }
  return texts
}

// ——— the rendered string ———

/**
 * Phase-one white space processing, over the whole block at once because a run of
 * collapsible space crosses text-node boundaries: `<em>a </em> <b>b</b>` paints
 * one space, not three.
 *
 * Produces, in one pass:
 *   rendered   the painted characters, `text-transform` applied
 *   source     the same positions BEFORE `text-transform` — the same length by
 *              construction, so the two index identically
 *   trimmable  which of them may still be removed at a line edge (phase two)
 *   isBreak    which of them are forced breaks, and so are not characters at all
 * and, per text node, `rAt[domOffset] -> rendered index`: the only bridge between
 * the space `Range` speaks and the space everything else here does.
 */
function buildRendered(texts, S, flags) {
  const rendered = []
  const source = []
  const trimmable = []
  const isBreak = []
  // Leading collapsible space at the start of a block is removed, so the machine
  // starts in the state that eats it.
  let pendingSpace = true

  for (const t of texts) {
    const data = t.node.data
    const len = data.length
    const rAt = new Int32Array(len + 1).fill(-1)
    const mark = (k) => { if (rAt[k] === -1) rAt[k] = rendered.length }

    let painted = null
    if (t.cs.textTransform && t.cs.textTransform !== 'none') {
      // The character already painted before this node is what tells `capitalize`
      // whether this node starts a word.
      painted = paintedText(t.el, data, rendered.length ? rendered[rendered.length - 1] : '', S)
      if (painted === null) flags.transformUnresolved = true
      else if (painted === data) {
        const expect = EXPECTS_CHANGE[t.cs.textTransform.split(' ')[0]]
        if (expect && expect.test(data)) flags.transformUnresolved = true
      }
      if (t.cs.textTransform.includes('capitalize')) flags.capitalize = true
    }

    t.start = rendered.length
    for (let k = 0; k < len; k++) {
      const ch = data[k]
      if (t.mode !== 'preserve' && isCollapsible(ch)) {
        if (t.mode === 'preserve-breaks' && ch === '\n') {
          mark(k)
          rendered.push('\n'); source.push('\n'); trimmable.push(0); isBreak.push(1)
          pendingSpace = true
          continue
        }
        if (!pendingSpace) {
          // The collapsed space takes the position of the FIRST character of the
          // run it stands for, which is where a caret in it would sit.
          mark(k)
          rendered.push(' '); source.push(' '); trimmable.push(1); isBreak.push(0)
          pendingSpace = true
        }
        continue
      }
      if (t.mode === 'preserve' && (ch === '\n' || ch === '\r')) {
        // CR, LF and CRLF are one segment break between them.
        if (ch === '\r' && data[k + 1] === '\n') continue
        mark(k)
        rendered.push('\n'); source.push('\n'); trimmable.push(0); isBreak.push(1)
        pendingSpace = false
        continue
      }
      if (ch === '\t') flags.tabs = true
      mark(k)
      rendered.push(painted ? painted[k] : ch)
      source.push(ch)
      trimmable.push(0)
      isBreak.push(0)
      pendingSpace = false
    }
    rAt[len] = rendered.length
    for (let k = len - 1; k >= 0; k--) if (rAt[k] === -1) rAt[k] = rAt[k + 1]
    t.rAt = rAt
    t.end = rendered.length
  }

  // Trailing collapsible space at the end of a block is removed too.
  while (rendered.length && trimmable[rendered.length - 1]) {
    rendered.pop(); source.pop(); trimmable.pop(); isBreak.pop()
  }
  for (const t of texts) {
    if (t.start > rendered.length) t.start = rendered.length
    if (t.end > rendered.length) t.end = rendered.length
  }

  return { rendered, source, trimmable, isBreak }
}

// ——— baseline clustering ———

/**
 * Index of the cluster a baseline belongs to, or the insertion point when it
 * belongs to none. Monotone in `baseline` either way, which is what lets the
 * line probe below be binary-searched.
 */
function clusterAt(clusters, baseline) {
  let lo = 0
  let hi = clusters.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (clusters[mid].baseline < baseline - BASELINE_TOL) lo = mid + 1
    else hi = mid
  }
  const c = clusters[lo]
  return { at: lo, hit: c && Math.abs(c.baseline - baseline) <= BASELINE_TOL ? c : null }
}

function addRect(clusters, baseline, rect) {
  const { at, hit } = clusterAt(clusters, baseline)
  let c = hit
  if (!c) {
    c = { baseline, sum: 0, n: 0, rects: [], width: 0 }
    clusters.splice(at, 0, c)
  }
  c.sum += baseline
  c.n += 1
  // The running mean, not the first sighting: two fonts on one line disagree by
  // up to half a pixel, and the cluster should sit between them rather than on
  // whichever rect happened to be measured first.
  c.baseline = c.sum / c.n
  c.rects.push(rect)
  c.width += rect.width
  return c
}

function overlaps(a, b, slack) {
  return a.left < b.right - slack && b.left < a.right - slack
}

/** The ink box of a cluster: how far its rects reach above and below, in px. */
function inkBox(cluster) {
  let top = Infinity
  let bottom = -Infinity
  for (const r of cluster.rects) {
    if (r.top < top) top = r.top
    if (r.bottom > bottom) bottom = r.bottom
  }
  return { top, bottom, h: bottom - top }
}

/** How much of the smaller of two ink boxes the other one covers, 0..1. */
function inkOverlap(a, b) {
  const top = Math.max(a.top, b.top)
  const bottom = Math.min(a.bottom, b.bottom)
  const min = Math.min(a.h, b.h)
  if (!(min > 0)) return 0
  return Math.max(0, bottom - top) / min
}

/** Below this share of ink overlap two baseline groups are two real lines. */
const FOLD_INK = 0.5

/** A shifted group sits well inside one line box of its host. */
const FOLD_PITCH = 0.6

/**
 * `vertical-align` shifts a run's baseline without taking it off the line, so a
 * superscript clusters on its own and the block appears to paint twice the lines
 * it does. Folding it back is only attempted when some inline in the block really
 * is shifted; the ordinary case stays exactly the contract's rule — baseline, and
 * nothing else.
 *
 * The reference pitch comes from CSS — the largest USED `line-height` among the
 * block's runs — and never from the gaps being classified. Deriving it from them
 * was the bug: a one-line block with a `<sub>` has exactly ONE gap, so the median
 * gap WAS that gap, every test passed by construction, nothing ever folded, and
 * `H<sub>2</sub>O` came out as two lines with the `H` stretched to the width of
 * the whole block. Reading `line-height` as a CLASSIFIER is legitimate; what the
 * contract forbids is reporting it as a measurement, and `pitch` is still
 * measured between the baselines this function decides on.
 *
 * Two tests have to agree before a group folds, and each one alone is enough to
 * refuse: the two groups' INK must overlap vertically — two real lines never
 * overlap by half their height, a `sup` always does — and none of their rects may
 * overlap horizontally, because a superscript sits BETWEEN the glyphs of its line
 * where a genuine second line sits over them.
 *
 * @param {object[]} clusters   baseline groups, ascending
 * @param {number} refPitch     largest used line-height in the block, in the same
 *                              (viewport) units as the baselines
 * @returns {{lineOf: number[], folded: boolean[], shift: number[]}} cluster index
 *          -> line index, which clusters were folded INTO another one, and how far
 *          each one sits off its line's baseline (px, positive downwards)
 */
function foldShifted(clusters, refPitch, warn) {
  const plain = {
    lineOf: clusters.map((_, i) => i),
    folded: clusters.map(() => false),
    shift: clusters.map(() => 0),
  }
  if (clusters.length < 2) return plain

  const ink = clusters.map(inkBox)
  const host = clusters.map((_, i) => i)
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]
    let best = -1
    let bestGap = Infinity
    for (const j of [i - 1, i + 1]) {
      const n = clusters[j]
      // A cluster that has itself been folded is not a host: chains would make
      // "which line is this" depend on the order the folds were decided in.
      if (!n || host[j] !== j) continue
      // The wider group is the line; the narrower one is what was shifted off it.
      if (!(c.width < n.width)) continue
      const gap = Math.abs(c.baseline - n.baseline)
      if (refPitch > 0 && gap > FOLD_PITCH * refPitch) continue
      if (inkOverlap(ink[i], ink[j]) < FOLD_INK) continue
      let clear = true
      for (const a of c.rects) {
        for (const b of n.rects) if (overlaps(a, b, 1)) { clear = false; break }
        if (!clear) break
      }
      if (clear && gap < bestGap) { best = j; bestGap = gap }
    }
    if (best >= 0) host[i] = best
  }

  let folded = 0
  let next = 0
  const lineOfHost = new Map()
  for (let i = 0; i < clusters.length; i++) {
    if (host[i] !== i) { folded++; continue }
    lineOfHost.set(i, next++)
  }
  if (!folded) return plain
  warn(`${folded} baseline group(s) shifted by vertical-align were folded back into the line they paint on — ` +
    'the line carries the host baseline and each shifted run carries its own offset in `dy`, which a ' +
    'backend that places one baseline per line has to apply to paint the run where the page paints it')
  return {
    lineOf: clusters.map((_, i) => lineOfHost.get(host[i])),
    folded: host.map((h, i) => h !== i),
    shift: clusters.map((c, i) => (host[i] === i ? 0 : c.baseline - clusters[host[i]].baseline)),
  }
}

// ——— grapheme boundaries ———

function segmenterFor(lang, S) {
  const key = lang || ''
  if (S.segmenters.has(key)) return S.segmenters.get(key)
  let seg = null
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      seg = new Intl.Segmenter(lang || undefined, { granularity: 'grapheme' })
    }
  } catch { seg = null }
  S.segmenters.set(key, seg)
  return seg
}

function graphemeStarts(str, lang, S) {
  const seg = segmenterFor(lang, S)
  if (!seg || !str) return null
  const starts = []
  for (const piece of seg.segment(str)) starts.push(piece.index)
  starts.push(str.length)
  return starts
}

/**
 * Nearest grapheme start. Boundaries are shared — one run's end is the next
 * one's start — so snapping the VALUE keeps both sides on the same character and
 * cannot open a gap.
 */
function snapTo(starts, i) {
  if (!starts) return i
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid] < i) lo = mid + 1
    else hi = mid
  }
  if (starts[lo] === i || lo === 0) return starts[lo]
  const prev = starts[lo - 1]
  return i - prev <= starts[lo] - i ? prev : starts[lo]
}

// ——— block-level facts ———

function resolveAlign(value, direction, blockEl) {
  const rtl = direction === 'rtl'
  if (value === 'start') return rtl ? 'right' : 'left'
  if (value === 'end') return rtl ? 'left' : 'right'
  if (value === 'match-parent') {
    const p = blockEl.parentElement
    const pd = p ? getComputedStyle(p).direction : 'ltr'
    return pd === 'rtl' ? 'right' : 'left'
  }
  if (value === '-webkit-left' || value === '-internal-left') return 'left'
  if (value === '-webkit-right' || value === '-internal-right') return 'right'
  if (value === '-webkit-center' || value === '-internal-center') return 'center'
  return value
}

const IDENTITY_LINEAR = { m: [1, 0, 0, 1], ok: true }

/** `[a,b,c,d]` of `p · q`, SVG order: x' = a·x + c·y, y' = b·x + d·y. */
function mul2(p, q) {
  return [
    p[0] * q[0] + p[2] * q[1],
    p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3],
  ]
}

const ZERO_ANGLE = /^-?0(\.0+)?(deg|grad|rad|turn)?$/

/**
 * The 2x2 linear part of ONE element's transforms, in the order CSS applies
 * them. `rotate`/`scale`/`translate` are separate computed properties that the
 * `transform` string does not contain; a rotation is not decomposed, it is
 * refused — `ok:false` means "the chain is not an axis-aligned scale", which is
 * all the caller needs to know.
 */
function ownLinear(cs) {
  let m = null
  const scale = cs.scale
  if (scale && scale !== 'none') {
    const parts = String(scale).trim().split(/\s+/).map(Number)
    if (!parts.length || !parts.every(Number.isFinite)) return { m: [1, 0, 0, 1], ok: false }
    m = [parts[0], 0, 0, parts.length > 1 ? parts[1] : parts[0]]
  }
  const rotate = cs.rotate
  if (rotate && rotate !== 'none' && !ZERO_ANGLE.test(String(rotate).trim())) {
    return { m: m || [1, 0, 0, 1], ok: false }
  }
  const transform = cs.transform
  if (transform && transform !== 'none') {
    try {
      const t = new DOMMatrix(transform)
      m = m ? mul2([t.a, t.b, t.c, t.d], m) : [t.a, t.b, t.c, t.d]
    } catch {
      // Unparseable means unknown, and unknown has to be reported.
      return { m: m || [1, 0, 0, 1], ok: false }
    }
  }
  return m ? { m, ok: true } : IDENTITY_LINEAR
}

/**
 * The linear map from this element's own coordinates to the ones client rects
 * are reported in — every transform between it and the capture root, its own
 * included, composed outermost-last.
 *
 * It matters because a client rect is measured AFTER those transforms and the
 * node this text lands on is emitted BEFORE them: `paint.js` takes the node's
 * geometry from the untransformed layout chain and the backend re-applies the
 * matrix. A `scale(2)` anywhere above the block therefore doubled every width,
 * baseline and pitch reported here and the backend doubled them again.
 */
function linearAbove(el, S) {
  const chain = []
  let base = null
  const top = typeof document !== 'undefined' ? document.documentElement : null
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const cached = S.linear.get(n)
    if (cached) { base = cached; break }
    chain.push(n)
    if (n === S.root || n === top) break
  }
  let out = base || IDENTITY_LINEAR
  for (let i = chain.length - 1; i >= 0; i--) {
    const own = ownLinear(styleOf(chain[i], S))
    out = own === IDENTITY_LINEAR && out.ok
      ? out
      : { m: mul2(out.m, own.m), ok: out.ok && own.ok }
    S.linear.set(chain[i], out)
  }
  return out
}

/**
 * How much the chain above this element scales it, and whether that is all it
 * does. A pure axis-aligned scale is exactly divisible out of every measurement;
 * a rotation, a skew or a mirror is not, because a client rect is then the
 * bounding box of a quad and `rect.top + ascent` is not a baseline at all.
 */
function chainScale(el, S) {
  const { m, ok } = linearAbove(el, S)
  const [a, b, c, d] = m
  const axis = ok && Math.abs(b) <= EPS && Math.abs(c) <= EPS && a > EPS && d > EPS
  const sx = axis ? a : 1
  const sy = axis ? d : 1
  return { sx, sy, skewed: !axis, scaled: axis && (Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4) }
}

// ——— fragments ———

/** Rects nearer than this are one fragment; anything wider is a real hole. */
const FRAG_GAP = 0.5

/**
 * The painted pieces of one line, and the characters each one carries.
 *
 * A line's bounding box is not its text: an `<img>`, an `<input>` or an
 * `inline-block` sits INSIDE the line and inside the box, and is deliberately
 * absent from `characters` — it is another node's job. So is the padding of an
 * inline `<code>`. `line.w` used to be the box, and a backend fitting the string
 * to it stretched `icon label` across the icon as well: +83%, measured, with no
 * diagnostic. Splitting the line at the holes gives every stretch of glyphs the
 * x and the width the browser actually painted it at.
 *
 * Returns null when the line is one uninterrupted run of glyphs (the ordinary
 * case, where `line.w` is already right) or when the fragments cannot be trusted
 * to carry a contiguous range of characters each.
 *
 * @returns {{x:number, w:number, start:number, end:number}[]|null}
 */
/**
 * The painted extent of each STYLE stretch on one line: where the run that
 * carries it starts and stops, in the same space as `line.x`.
 *
 * A `Run` is character offsets and nothing else, and `fragmentsOf` above merges
 * the per-piece rects it measured into holes-and-glyphs before anyone downstream
 * sees them — so a backend asked to draw a decoration SVG has no primitive for
 * (a wavy underline) over `characters 23-41 of this line` had no extent to draw
 * it over and fell back to a straight line. These are the same rects, kept
 * instead of thrown away: one entry per contiguous stretch of one piece on one
 * line, tiling the line's characters in logical order.
 *
 * @returns {{start:number, end:number, x:number, w:number}[]|null}
 */
function spansOf(segs, rToChar, blockRect, sx) {
  if (!segs || !segs.length) return null
  const out = []
  for (const s of segs) {
    let left = Infinity
    let right = -Infinity
    for (let k = 0; k < s.piece.rects.length; k++) {
      if (s.piece.clusterOf[k] !== s.cluster) continue
      const r = s.piece.rects[k]
      if (!(r.width > 0)) continue
      if (r.left < left) left = r.left
      if (r.right > right) right = r.right
    }
    if (!Number.isFinite(left)) continue
    const start = rToChar[s.rStart]
    const end = rToChar[s.rEnd]
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    out.push({ start, end, x: (left - blockRect.left) / sx, w: (right - left) / sx })
  }
  if (!out.length) return null
  out.sort((a, b) => a.start - b.start || a.x - b.x)
  return out
}

function fragmentsOf(segs, line, rToChar, blockRect, sx) {
  if (!segs || segs.length < 2) return null
  const items = []
  for (const s of segs) {
    let left = Infinity
    let right = -Infinity
    for (let k = 0; k < s.piece.rects.length; k++) {
      if (s.piece.clusterOf[k] !== s.cluster) continue
      const r = s.piece.rects[k]
      if (!(r.width > 0)) continue
      if (r.left < left) left = r.left
      if (r.right > right) right = r.right
    }
    if (!Number.isFinite(left)) continue
    items.push({ left, right, start: rToChar[s.rStart] })
  }
  if (items.length < 2) return null
  items.sort((a, b) => a.left - b.left)
  // Visual order and logical order are the same thing only in one direction. If
  // they disagree the line is bidi-reordered and the caller has already been told
  // that its offsets are logical; splitting it here would be a lie with an x on it.
  for (let k = 1; k < items.length; k++) if (items[k].start < items[k - 1].start) return null

  const groups = [{ left: items[0].left, right: items[0].right, start: items[0].start }]
  for (let k = 1; k < items.length; k++) {
    const last = groups[groups.length - 1]
    if (items[k].left <= last.right + FRAG_GAP) {
      if (items[k].right > last.right) last.right = items[k].right
      continue
    }
    groups.push({ left: items[k].left, right: items[k].right, start: items[k].start })
  }
  if (groups.length < 2) return null

  const frags = []
  for (let k = 0; k < groups.length; k++) {
    const g = groups[k]
    const start = k === 0 ? line.start : Math.min(Math.max(g.start, line.start), line.end)
    frags.push({
      x: (g.left - blockRect.left) / sx,
      w: (g.right - g.left) / sx,
      start,
      end: line.end,
    })
    if (k > 0 && frags[k].start < frags[k - 1].start) frags[k].start = frags[k - 1].start
    if (k > 0) frags[k - 1].end = frags[k].start
  }
  return frags
}

// ——— the collector ———

/**
 * @typedef {object} Line
 * @property {number} i         visual line index, 0-based, top to bottom
 * @property {number} start     offset into `characters`, inclusive
 * @property {number} end       offset into `characters`, exclusive
 * @property {number} x         left edge of the painted line, relative to blockEl's border box
 * @property {number} w         painted width: the sum of the glyph advances, which is the
 *                              bounding box only while nothing interrupts the line
 * @property {number} baseline  relative to blockEl's border box, Y down
 * @property {number} asc       baseline to the top of the tallest rect on the line
 * @property {number} desc      baseline to the bottom of the deepest rect on the line
 * @property {Frag[]} [frags]   present only when something that is not a character sits
 *                              inside the line and splits it in two or more painted
 *                              stretches. They tile `[start, end)` and are left to right.
 * @property {string} [hyphen]  the break glyph the browser painted at the END of this line
 *                              and the document does not contain — `hyphens: auto` cutting
 *                              a word. It is NOT in `characters`, because every offset here
 *                              indexes that string and `sourceText` matches it character for
 *                              character. Its advance IS already inside `w`, `spans` and
 *                              `frags`: the browser reports it as ink of this line. A backend
 *                              paints the line as `characters.slice(start, end) + hyphen`.
 */

/**
 * @typedef {object} Frag
 * @property {number} x      left edge of this stretch, relative to blockEl's border box
 * @property {number} w      its measured width
 * @property {number} start  offset into `characters`, inclusive
 * @property {number} end    offset into `characters`, exclusive
 */

/**
 * @typedef {object} Run
 * @property {number} start        offset into `characters`, inclusive
 * @property {number} end          offset into `characters`, exclusive
 * @property {string} style        key into the returned `styles` map
 * @property {string|null} href    the enclosing `<a>`'s href, or null
 * @property {number} dy           offset from its line's baseline, positive down. Non-zero
 *                                 only for a run `vertical-align` moved off the line it
 *                                 belongs to — a `<sup>`, a `<sub>`. Its line still carries
 *                                 the baseline the rest of the line paints on.
 */

/**
 * Collect the text of one block's inline formatting context.
 *
 * `characters` is the painted string: visual lines joined with U+2028 (LSEP),
 * never `\n`. `sourceText` is the same string before `text-transform`; the two
 * are the SAME LENGTH and index identically, because a transform that changed
 * the length is refused and reported in `warnings` instead. Every offset in
 * `lines` and `runs` indexes `characters`, and every one sits on a grapheme
 * boundary wherever `Intl.Segmenter` is there to say where those are.
 *
 * `runs` tile `characters` exactly — every character has one style and no more.
 * `styles` maps `ts_N` -> TextStyle, deduplicated within this call.
 *
 * `characters` holds only what the DOM holds. The one thing the browser paints
 * that no character stands for is the hyphen at a hyphenated break, and it goes
 * on `line.hyphen` for exactly that reason: a character invented here would move
 * every offset after it and would have to be invented in `sourceText` too, which
 * is the page's own text.
 *
 * `pitch` is MEASURED between consecutive baselines (their median difference),
 * never read from `line-height`. A single-line block has no difference to
 * measure and falls back to the used line-height, which says so in `warnings`.
 * The one other place CSS `line-height` is read is as the reference pitch that
 * tells a `vertical-align`-shifted baseline group from a second line — a
 * classifier, never a reported measurement.
 *
 * Every number in `lines` is in the block's OWN units: an axis-aligned scale
 * anywhere between the block and the capture root is divided out, because the
 * node these lines land on carries that transform and applies it again.
 *
 * `warnings` is prose the orchestrator grades, except where a warning reports
 * something exact, which arrives as `{code, grade, severity, message}` so that
 * succeeding cannot degrade the node.
 *
 * @param {Element} blockEl  an element with a text-carrying inline formatting context
 * @param {CollectCtx} ctx
 * @returns {{characters:string, lines:Line[], runs:Run[], pitch:number,
 *            align:string, direction:string, styles:Record<string,TextStyle>,
 *            sourceText:string,
 *            warnings:Array<string|{code:string,grade:string,severity:string,message:string}>}|null}
 */
export function collectText(blockEl, ctx) {
  if (!blockEl || blockEl.nodeType !== 1) return null

  const S = stateFor(ctx)
  if (isExcluded(blockEl, S.exclude)) return null
  /** @type {Array<string|{code:string, grade:string, severity:string, message:string}>} */
  const warnings = []
  // Prose is the default and the orchestrator grades it; the object form is for
  // the one case prose cannot express — something exact, which must not degrade
  // the node for having succeeded. Deduplicated by identity, or by code.
  const warn = (w) => {
    if (!w) return
    if (typeof w === 'object') {
      if (!warnings.some(x => x && typeof x === 'object' && x.code === w.code)) warnings.push(w)
      return
    }
    if (!warnings.includes(w)) warnings.push(w)
  }

  const flags = {
    ruby: false, shadow: false, verticalAlign: false, tabs: false, capitalize: false,
    transformUnresolved: false, contentVisibility: false, hidden: 0, noRects: 0, fragmented: 0,
    holes: 0, holeLines: 0, mixedShift: false,
  }

  const texts = collectTextNodes(blockEl, S, flags)
  if (!texts.length) return null

  const { rendered, source, trimmable, isBreak } = buildRendered(texts, S, flags)
  if (!rendered.length) return null

  const blockCs = styleOf(blockEl, S)
  const blockRect = blockEl.getBoundingClientRect()
  const range = document.createRange()

  // Client rects are measured after every transform between here and the capture
  // root; the node this text lands on is emitted before them. Everything read off
  // a rect below is divided by this, so `lines` is in the block's own units.
  const chain = chainScale(blockEl, S)
  const { sx, sy } = chain

  // ——— pieces: one measured stretch of one text node ———

  /**
   * A piece is a DOM range inside ONE text node that carries ONE run style.
   * There is exactly one per text node until `::first-letter` splits the first
   * one, and the split has to happen before anything is measured: the pseudo has
   * its own font, so it has its own ascent, and the ascent is what turns a rect
   * into a baseline.
   */
  const pieces = []
  for (const t of texts) {
    t.style = textStyleOf(t.el, blockEl, S, warn)
    pieces.push({ t, from: 0, to: t.node.data.length, rStart: t.start, rEnd: t.end, style: t.style })
  }
  splitFirstLetter(pieces, blockEl, blockCs, S, warn)

  // ——— rects -> baseline clusters ———

  for (const p of pieces) {
    range.setStart(p.t.node, p.from)
    range.setEnd(p.t.node, p.to)
    const rects = []
    for (const r of range.getClientRects()) {
      // Zero height is not a fragment. Zero WIDTH is: an empty line inside a
      // `pre` paints nothing and its rect is the only evidence the line exists.
      if (r.height > 0) rects.push(r)
    }
    p.rects = rects
    if (!rects.length && /\S/.test(p.t.node.data.slice(p.from, p.to))) flags.noRects += 1
  }

  // `::first-letter` does not apply to every block whose selector matches it —
  // a block that starts with an image has no first letter to give it. The box
  // the browser painted is the answer: a rect the height of the pseudo's font
  // means the pseudo is really there, and anything else means the split was a
  // guess, and a guess with the wrong ascent in it is a wrong baseline.
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]
    if (!p.firstLetter) continue
    const want = (p.style.ascent + p.style.descent) * sy
    const got = p.rects.length ? p.rects[0].height : 0
    if (want > 0 && Math.abs(got - want) <= Math.max(2, 0.25 * want)) continue
    warn('a ::first-letter rule matches this block but the browser painted the first letter at the ' +
      'element\'s own size — the pseudo does not apply here and its style was not used')
    p.style = pieces[i + 1] ? pieces[i + 1].style : p.t.style
    p.firstLetter = false
  }

  const clusters = []
  // The reference line box: the block's own strut, which is there whether or not
  // anything paints on it, and every run that does paint. `normal` is not a
  // length and contributes nothing — the runs cover it.
  let refPitch = blockCs.lineHeight === 'normal' ? 0 : px(blockCs.lineHeight, 0)
  for (const p of pieces) {
    // The ascent is a font measurement, in the block's own units; the rect it is
    // added to is in the viewport's. One of them has to move, and scaling the
    // ascent is exact where scaling a rounded rect back would not be.
    p.ascentVp = p.style.ascent * sy
    if (!p.rects.length) continue
    if (p.style.lineHeight > refPitch) refPitch = p.style.lineHeight
    p.clusterOf = new Array(p.rects.length)
    const seen = new Set()
    for (let k = 0; k < p.rects.length; k++) {
      const c = addRect(clusters, p.rects[k].top + p.ascentVp, p.rects[k])
      // The same node twice on one baseline is a visual split of one logical
      // stretch: bidi reordering, or a fragment that took a hyphen.
      if (seen.has(c)) flags.fragmented += 1
      seen.add(c)
    }
  }
  if (!clusters.length) return null
  for (const p of pieces) {
    if (!p.rects) continue
    for (let k = 0; k < p.rects.length; k++) {
      p.clusterOf[k] = clusterAt(clusters, p.rects[k].top + p.ascentVp).at
    }
  }

  const fold = flags.verticalAlign
    ? foldShifted(clusters, refPitch * sy, warn)
    : { lineOf: clusters.map((_, i) => i), folded: clusters.map(() => false), shift: clusters.map(() => 0) }
  const lineOf = fold.lineOf
  let lineCount = 0
  for (const l of lineOf) if (l + 1 > lineCount) lineCount = l + 1

  // ——— which characters are on which line ———

  /**
   * The line the LAST painted fragment of `[from, off)` lands on, or -1 when
   * nothing in that range paints at all.
   *
   * The question is asked backwards on purpose. Asking it forwards — "which line
   * does the text from `off` on start on" — is what cut four words in half in the
   * demo, and it is not a rounding error: when the browser breaks a word it
   * paints a hyphen at the end of the line, and Chromium attributes that hyphen's
   * rect to the DOM offset AFTER the break. MEASURED on `.ty-just`: the range
   * starting at the `n` of `línea` reports two rects, the hyphen at x=905.7 on
   * line 1 and the `n` at x=478 on line 2, so a search reading the FIRST rect
   * concludes the `n` is still on line 1, steps one character right, and turns
   * `…de cada lí-` / `nea, así que…` into `…de cada lín` / `ea, así que…`. No
   * character is lost, so nothing downstream can notice.
   *
   * A prefix cannot be contaminated that way: the break glyph of line n is
   * painted before the glyphs of line n+1 and therefore never last. The predicate
   * `lastClusterTo(from, off) >= target` is monotone in `off` for the same reason
   * the forward one was, and it identifies the character at `off - 1` — the first
   * one on the new line — rather than the offset the hyphen hangs off.
   */
  const lastClusterTo = (p, from, off) => {
    range.setStart(p.t.node, from)
    range.setEnd(p.t.node, off)
    let at = -1
    for (const r of range.getClientRects()) {
      if (r.height <= 0) continue
      at = clusterAt(clusters, r.top + p.ascentVp).at
    }
    return at
  }

  let lineStartR = new Array(lineCount).fill(Infinity)
  /** One contiguous stretch of one piece on one line, with the rects it painted. */
  const segments = []
  /**
   * Where every line's first character sits in the DOM, so the break that put it
   * there can be checked against the browser rather than trusted. Keyed by the
   * rendered offset the line starts at, which is what `lineStartR` holds.
   */
  const breakSites = new Map()
  for (const p of pieces) {
    if (!p.rects.length) continue
    const touched = [...new Set(p.clusterOf)].sort((a, b) => a - b)
    const mine = []
    let from = p.from
    for (let j = 0; j < touched.length; j++) {
      if (j > 0) {
        // Binary search for the first DOM offset that has crossed onto cluster
        // `touched[j]`. Walking characters from the start would be 95ms/35k
        // chars; this is log2(len) probes per break and measures ~18ms on the
        // same input. Each probe is a prefix bounded on the LEFT by the break
        // already found, so it measures the two lines around this one and not
        // the whole node.
        const prev = from
        const target = touched[j]
        let lo = prev + 1
        let hi = p.to
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (lastClusterTo(p, prev, mid) >= target) hi = mid
          else lo = mid + 1
        }
        from = Math.max(prev, Math.min(lo, p.to) - 1)
      }
      const line = lineOf[touched[j]]
      const r = j === 0 ? p.rStart : p.t.rAt[Math.min(from, p.to)]
      if (r < lineStartR[line]) lineStartR[line] = r
      if (!breakSites.has(r)) breakSites.set(r, { piece: p, dom: Math.min(from, p.to), cluster: touched[j] })
      mine.push({ piece: p, cluster: touched[j], line, rStart: r, rEnd: p.rEnd })
      if (j > 0) mine[j - 1].rEnd = r
    }
    // The run this piece becomes paints off the line's baseline by this much.
    // Wrapping inside a shifted inline gives every fragment the same shift, so
    // the first one answers for the piece; anything else is reported.
    p.dy = fold.shift[touched[0]] / sy
    for (const c of touched) {
      if (Math.abs(fold.shift[c] / sy - p.dy) > BASELINE_TOL) flags.mixedShift = true
    }
    segments.push(...mine)
  }

  // Lines are numbered by baseline, and all but one thing in an inline formatting
  // context paints in that order. The exception is a float — a `::first-letter`
  // drop cap sits ON the first line and BELOW its baseline — and it would put the
  // capital in the middle of `characters`. Where the two orders disagree, the
  // characters win: each line keeps its own measured baseline, so nothing moves
  // on the page, and the string stays readable in logical order.
  if (lineStartR.every(Number.isFinite)) {
    const order = lineStartR.map((_, i) => i)
      .sort((a, b) => (lineStartR[a] - lineStartR[b]) || (a - b))
    if (order.some((old, i) => old !== i)) {
      const renumber = new Array(lineCount)
      order.forEach((old, i) => { renumber[old] = i })
      for (let c = 0; c < lineOf.length; c++) lineOf[c] = renumber[lineOf[c]]
      for (const s of segments) s.line = renumber[s.line]
      lineStartR = order.map(old => lineStartR[old])
      warn('a line of this block paints out of top-to-bottom order (a floated ::first-letter, or a ' +
        'float taking the first characters of the block below the ones after them) — the lines are ' +
        'ordered by the characters they carry and each one carries its own measured baseline')
    }
  }

  // The lines tile the rendered string with no gaps: whatever falls between two
  // measured fragments — collapsed space, a `<br>`, a soft hyphen — belongs to
  // the line before it, where phase-two trimming can still take it out.
  lineStartR[0] = 0
  for (let i = 1; i < lineCount; i++) {
    if (!Number.isFinite(lineStartR[i]) || lineStartR[i] < lineStartR[i - 1]) lineStartR[i] = lineStartR[i - 1]
  }

  // ——— characters, sourceText, and the rendered -> characters map ———

  const chars = []
  const srcChars = []
  const rToChar = new Int32Array(rendered.length + 1).fill(-1)
  const lineText = []
  for (let i = 0; i < lineCount; i++) {
    let s = lineStartR[i]
    let e = i + 1 < lineCount ? lineStartR[i + 1] : rendered.length
    // Phase two: space that survived collapsing is still removed at a line edge,
    // and a forced break is a separator rather than a character.
    while (s < e && (trimmable[s] || isBreak[s])) s++
    while (e > s && (trimmable[e - 1] || isBreak[e - 1])) e--
    if (i > 0) { chars.push(LSEP); srcChars.push(LSEP) }
    const start = chars.length
    for (let k = s; k < e; k++) {
      if (isBreak[k]) continue
      rToChar[k] = chars.length
      chars.push(rendered[k])
      srcChars.push(source[k])
    }
    // `rFrom`/`rTo` are the same span in the RENDERED string, which is where the
    // break check below has to look: what a line dropped at its edges is exactly
    // the evidence that the browser had a break opportunity there.
    lineText.push({ start, end: chars.length, rFrom: s, rTo: e })
  }
  const characters = chars.join('')
  const sourceText = srcChars.join('')
  if (!characters) return null

  // Every rendered offset maps forward to the first character that survived at or
  // after it, so a boundary that landed inside trimmed space resolves to the same
  // place from both sides of it.
  rToChar[rendered.length] = characters.length
  for (let k = rendered.length - 1; k >= 0; k--) if (rToChar[k] === -1) rToChar[k] = rToChar[k + 1]

  // ——— every break is checked against the browser, and one that cannot be is declared ———

  /**
   * The ink the browser painted at this break — a hyphen — or null.
   *
   * The evidence is the same artefact that caused the bug: the rect of the first
   * character of the new line carries the hyphen of the OLD one. A rect on an
   * earlier cluster for a one-character range is therefore ink the browser put at
   * the break, and nothing else in an inline formatting context produces it.
   *
   * MEASURED on `.ty-just`: the range over the `n` of `línea` reports the hyphen
   * at 905.73..912 on line 1 and the `n` at 478..485.77 on line 2. The rect is
   * returned rather than a boolean because its WIDTH is the only thing that says
   * which character was painted — 6.266px against 6.2556px for U+2010 in this
   * font, and 7.765px for an en dash.
   *
   * @returns {{rect:DOMRect, cluster:number, style:object}|null}
   */
  const breakInkAt = (site) => {
    if (!site || site.dom >= site.piece.to) return null
    range.setStart(site.piece.t.node, site.dom)
    range.setEnd(site.piece.t.node, site.dom + 1)
    let best = null
    for (const r of range.getClientRects()) {
      if (r.height <= 0) continue
      const cluster = clusterAt(clusters, r.top + site.piece.ascentVp).at
      if (cluster >= site.cluster) continue
      // Nearest cluster first, then the widest rect on it: the break glyph is the
      // ink closest to the break, and the browser reports it as its own rect.
      if (!best || cluster > best.cluster || (cluster === best.cluster && r.width > best.rect.width)) {
        // `el` and `style` are the piece's, because the browser attributed the
        // ink to it: `hyphenate-character` inherits, so the element the
        // characters live in is the one that says which glyph this is, not the
        // block — an `<em>` may perfectly well set its own.
        best = { rect: r, cluster, style: site.piece.style, el: site.piece.t.el }
      }
    }
    return best
  }

  /**
   * Line index -> the ink painted at the break that STARTS it, on the line
   * before. Probed only where a hyphen can be: a break with collapsible white
   * space between the two lines is a break ON that space, and the browser paints
   * no glyph for it — measured, the space itself then reports a 0.016px rect on
   * each line, which is a caret box and not a hyphen.
   */
  const breakInk = new Map()
  for (let i = 1; i < lineCount; i++) {
    const k = lineText[i].rFrom
    if (k <= 0 || k >= rendered.length || lineText[i].rTo <= k) continue
    if (k > lineText[i - 1].rTo) continue
    const ink = breakInkAt(breakSites.get(lineStartR[i]))
    if (ink) breakInk.set(i, ink)
  }

  // The block asked for breaks inside words, so finding one is not evidence of
  // anything going wrong.
  const breaksWords = /break-all|anywhere/.test(blockCs.wordBreak || '') ||
    /anywhere|break-word/.test(blockCs.overflowWrap || blockCs.wordWrap || '') ||
    (blockCs.lineBreak === 'anywhere')

  /**
   * The rendered offsets where two lines may part with no white space between
   * them for a reason that is not a wrap at all.
   *
   * A floated `::first-letter` is one: the drop cap sits on a baseline of its own
   * and becomes a line of its own, so `C` / `ada bloque…` looks exactly like a
   * word cut in half and is not one. The other is a box — a `<br>`, an image, a
   * control, an `inline-block` — sitting between two text nodes: it carries a
   * break opportunity and leaves no character behind, so `rotate` / `−14°` across
   * a `<br>` is as legitimate a break as one on a space.
   */
  const boxBreaks = new Set()
  for (const p of pieces) if (p.firstLetter) boxBreaks.add(p.rEnd)
  for (const t of texts) if (t.afterBox) boxBreaks.add(t.start)

  const unverified = []
  for (let i = 1; i < lineCount; i++) {
    const k = lineText[i].rFrom
    // A line that carries no characters of its own has no break of its own.
    if (k <= 0 || k >= rendered.length || lineText[i].rTo <= k) continue
    // White space and a forced break ARE the break opportunity, and phase two
    // has already taken them out of both lines. Whatever the two lines dropped
    // between them is therefore the evidence, and the ordinary case leaves a
    // gap here. A break with NO gap cut two characters apart that the browser
    // was painting side by side, and that needs a reason.
    if (k > lineText[i - 1].rTo) continue
    if (boxBreaks.has(k)) continue
    const before = rendered[k - 1]
    const after = rendered[k]
    if (BREAK_AFTER.test(before)) continue
    if (BREAK_ANYWHERE.test(before) || BREAK_ANYWHERE.test(after)) continue
    if (breaksWords) continue
    if (breakInk.has(i)) continue
    unverified.push(`…${rendered.slice(Math.max(0, k - 12), k).join('')}|${rendered.slice(k, k + 12).join('')}…`)
  }
  if (unverified.length) {
    warn({
      code: 'collect.text-line-break-unverified',
      grade: 'A',
      severity: 'error',
      message: `${unverified.length} line break(s) of this block fall inside a word, and the browser painted ` +
        'no hyphen there and asked for no break inside words — so where these lines were cut could not be ' +
        'verified and the characters may be split between them differently than the page paints them: ' +
        unverified.slice(0, 6).join(' · ') + (unverified.length > 6 ? ` (and ${unverified.length - 6} more)` : ''),
    })
  }
  // The lines have to tile the rendered string with no gap and no overlap, or a
  // character belongs to two lines or to none. It is an invariant of how
  // `lineStartR` is built and it is asserted anyway: this is the one module
  // whose bug corrupts the TEXT, and the check costs one pass.
  let tiled = true
  for (let i = 1; i < lineCount && tiled; i++) tiled = lineStartR[i] >= lineStartR[i - 1]
  if (!tiled || lineStartR[0] !== 0) {
    warn({
      code: 'collect.text-lines-not-tiling',
      grade: 'O',
      severity: 'error',
      message: 'the visual lines of this block do not tile its rendered text — the characters reported per ' +
        'line are not the characters the page paints on them',
    })
  }

  // ——— lines ———

  const buckets = []
  for (let i = 0; i < lineCount; i++) buckets.push({ rects: [], sum: 0, n: 0 })
  for (let c = 0; c < clusters.length; c++) {
    const b = buckets[lineOf[c]]
    b.rects.push(...clusters[c].rects)
    // A folded cluster contributes its ink — that is what it was folded for —
    // and NOT its baseline: averaging a superscript's raised baseline into the
    // line it sits on moved the whole line up by 2px and then reported the
    // result as "the pitch varies", which named the symptom and not the cause.
    if (fold.folded[c]) continue
    b.sum += clusters[c].sum
    b.n += clusters[c].n
  }

  const segsByLine = []
  for (let i = 0; i < lineCount; i++) segsByLine.push([])
  for (const s of segments) if (segsByLine[s.line]) segsByLine[s.line].push(s)

  const lines = []
  /** Each line's painted extent in VIEWPORT px, which is where rects are read. */
  const edgeVp = []
  for (let i = 0; i < lineCount; i++) {
    const b = buckets[i]
    const baselineVp = b.n ? b.sum / b.n : blockRect.top
    // A zero-width rect carries a baseline but no ink, so it establishes that the
    // line exists and never how wide it is — unless it is all the line has.
    const inked = b.rects.filter(r => r.width > 0)
    const used = inked.length ? inked : b.rects
    let left = Infinity
    let right = -Infinity
    for (const r of used) {
      if (r.left < left) left = r.left
      if (r.right > right) right = r.right
    }
    let asc = 0
    let desc = 0
    for (const r of b.rects) {
      if (baselineVp - r.top > asc) asc = baselineVp - r.top
      if (r.bottom - baselineVp > desc) desc = r.bottom - baselineVp
    }
    if (!Number.isFinite(left)) { left = blockRect.left; right = blockRect.left }
    edgeVp.push({ left, right })
    const line = {
      i,
      start: lineText[i].start,
      end: lineText[i].end,
      x: (left - blockRect.left) / sx,
      w: (right - left) / sx,
      baseline: (baselineVp - blockRect.top) / sy,
      asc: asc / sy,
      desc: desc / sy,
    }
    const spans = spansOf(segsByLine[i], rToChar, blockRect, sx)
    if (spans) line.spans = spans
    const frags = fragmentsOf(segsByLine[i], line, rToChar, blockRect, sx)
    if (frags) {
      line.frags = frags
      flags.holes += frags.length - 1
      flags.holeLines += 1
      // The advance the glyphs really take, which is what a backend has to fit
      // them into. The bounding box is not it the moment something that is not
      // a character sits inside the line.
      let advance = 0
      for (const f of frags) advance += f.w
      line.w = advance
    }
    lines.push(line)
  }

  // ——— the hyphen the browser paints and the document does not contain ———

  const direction = blockCs.direction || 'ltr'
  const align = resolveAlign(blockCs.textAlign || 'start', direction, blockEl)

  /**
   * `hyphens: auto` cuts a word and paints a hyphen at the end of the line. It is
   * not a character of the document, so it cannot be in `characters` — and a line
   * that ends `…de cada lí` instead of `…de cada lí‐` does not read as a word
   * split in two, it reads as a mistake.
   *
   * It travels on the LINE, and that is a decision, not a shortcut. `characters`
   * is the coordinate system: every offset in `runs`, `lines`, `frags` and
   * `spans` indexes it, and `sourceText` is the same string before
   * `text-transform` — the SAME LENGTH, indexing identically, and asserted
   * character for character against the live `textContent`. A character inserted
   * into `characters` is a character the page does not have: it would shift every
   * offset after it in four arrays, and it would either break that identity or
   * put a hyphen into `sourceText`, which is the original text of the page. A
   * field the backend appends when it paints the line moves nothing and cannot be
   * mistaken for content.
   *
   * The advance is already inside `line.w`, `line.spans` and `line.frags`: the
   * browser reports the hyphen as ink of the line it is painted on (MEASURED —
   * the line's rect ends at 912, which is the hyphen's right edge and not the
   * `í`'s at 905.73), which is exactly why the trailing-edge test below is the
   * one that decides. So a backend that appends `line.hyphen` and fits the result
   * to `line.w` is exact, and one that ignores it paints a line 6.27px short of
   * the ink and a word that looks misspelt.
   */
  const hyphenated = []
  const hyphenUnsure = []
  const hyphenUnplaced = []
  const hyphenSoft = []
  const declaredChars = new Set()
  let anyExplicit = false
  for (const [i, ink] of breakInk) {
    const cand = hyphenCandidates(ink.el ? styleOf(ink.el, S) : blockCs)
    declaredChars.add(cand.declared)
    anyExplicit = anyExplicit || cand.explicit
    const prev = lines[i - 1]
    const edge = edgeVp[i - 1]
    const w = ink.rect.width / sx
    const at = `…${characters.slice(Math.max(prev ? prev.start : 0, (prev ? prev.end : 0) - 14), prev ? prev.end : 0)}`
    // Three things have to hold before a character the DOM does not have is
    // added to the output: the ink is on the line BEFORE the break, it sits on
    // that line's trailing edge, and it is wide enough to be a glyph. Anything
    // else is ink this function has not identified, and it is declared instead.
    if (!prev || !edge || lineOf[ink.cluster] !== i - 1 || !(w > EPS)) {
      hyphenUnplaced.push(`${at}| (${w.toFixed(2)}px of ink, on no line of its own)`)
      continue
    }
    const off = direction === 'rtl' ? ink.rect.left - edge.left : ink.rect.right - edge.right
    if (Math.abs(off) > HYPHEN_EDGE_TOL * sx) {
      hyphenUnplaced.push(`${at}| (${w.toFixed(2)}px of ink, ${Math.abs(off / sx).toFixed(2)}px off the line edge)`)
      continue
    }
    let pick = null
    let adv = 0
    let err = Infinity
    for (const ch of cand.chars) {
      if (!ch) continue
      const a = advanceOf(ch, ink.style, S)
      // Strictly nearer, so a tie keeps the first candidate — which is the one
      // Blink prefers, and the two `auto` candidates are almost always a tie.
      if (Math.abs(a - w) < err) { err = Math.abs(a - w); adv = a; pick = ch }
    }
    if (pick === null) {
      hyphenUnplaced.push(`${at}| (${w.toFixed(2)}px of ink, and hyphenate-character is ${cand.declared})`)
      continue
    }
    prev.hyphen = pick
    hyphenated.push(`${at}${pick}`)
    if (err > Math.max(0.5, 0.15 * w)) {
      hyphenUnsure.push(`${at}${pick} (${w.toFixed(2)}px painted, ${adv.toFixed(2)}px for the character chosen)`)
    }
    // A break the author asked for with U+00AD: the soft hyphen IS in
    // `characters`, at the end of this line, and it advances zero — MEASURED,
    // `measureText('­')` is 0 and the painted glyph is the same 6.27px
    // hyphen as an automatic break. So the glyph is still unaccounted for and
    // `line.hyphen` still carries it; what changes is that a renderer which
    // paints U+00AD as a hyphen of its own would then draw two.
    if (prev.end > prev.start && characters[prev.end - 1] === '­') hyphenSoft.push(i - 1)
  }

  if (hyphenated.length) {
    warn({
      code: 'collect.text-hyphen',
      grade: 'E',
      severity: 'info',
      message: `${hyphenated.length} line(s) of this block end in a hyphen the browser painted at a break ` +
        `and the document does not contain (hyphens: ${blockCs.hyphens || 'manual'}): ` +
        `${hyphenated.slice(0, 6).join(' · ')}${hyphenated.length > 6 ? ` (and ${hyphenated.length - 6} more)` : ''}. ` +
        'It is carried on `line.hyphen` and deliberately NOT in `characters`, which every offset in `runs`, ' +
        '`lines`, `frags` and `spans` indexes and which `sourceText` matches character for character — ' +
        'inserting it there would move all of them. Its advance is already inside `line.w`, `line.spans` and ' +
        '`line.frags`, because the browser paints it as ink of the line, so a backend that appends ' +
        '`line.hyphen` to the line is exact and one that ignores it paints a word that reads as misspelt' +
        (anyExplicit
          ? ` (the character is hyphenate-character: ${[...declaredChars].join(', ')})`
          : ' (hyphenate-character is auto, so the character is the one Blink picks — U+2010 HYPHEN, or ' +
            'U+002D HYPHEN-MINUS when the font has no glyph for it — chosen here by matching the painted ' +
            'advance, which the two do not usually differ in)'),
    })
  }
  if (hyphenSoft.length) {
    warn({
      code: 'collect.text-hyphen-soft',
      grade: 'E',
      severity: 'info',
      message: `${hyphenSoft.length} of those line(s) (${hyphenSoft.join(', ')}) end in U+00AD SOFT HYPHEN, ` +
        'which IS a character of the document and is in `characters` — it just advances zero and paints ' +
        'nothing until a line breaks on it. The break glyph is still on `line.hyphen`, because a backend that ' +
        'sets one line per element never asks its renderer to break and so never gets the glyph; a renderer ' +
        'that paints U+00AD as a hyphen at the end of a run would draw two',
    })
  }
  if (hyphenUnsure.length) {
    warn({
      code: 'collect.text-hyphen-char-unverified',
      grade: 'A',
      severity: 'warn',
      message: `the hyphen painted at ${hyphenUnsure.length} break(s) of this block does not have the advance ` +
        `of any character hyphenate-character (${[...declaredChars].join(', ')}) allows: ` +
        `${hyphenUnsure.slice(0, 4).join(' · ')}. ` +
        'The nearest candidate is on `line.hyphen` anyway — a line that reads as a word cut in two is worth ' +
        'more than a line that reads as a mistake — but it is the wrong width and may be the wrong glyph',
    })
  }
  if (hyphenUnplaced.length) {
    warn({
      code: 'collect.text-hyphen-unplaced',
      grade: 'A',
      severity: 'warn',
      message: `the browser painted ink at ${hyphenUnplaced.length} line break(s) of this block that is not a ` +
        'character of the document, and it could not be placed at the end of a line: ' +
        `${hyphenUnplaced.slice(0, 4).join(' · ')}. No hyphen is carried for those lines, so they end one ` +
        'glyph short of what the page paints',
    })
  }

  // ——— pitch ———

  let pitch
  const diffs = []
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i].baseline - lines[i - 1].baseline
    // A float that took the first characters below the ones after them makes one
    // step run backwards. It is not a line pitch and it must not be medianed into
    // one — the block already carries the warning that says why it is there.
    if (d > 0) diffs.push(d)
  }
  if (diffs.length) {
    pitch = median(diffs)
    let spread = 0
    for (const d of diffs) spread = Math.max(spread, Math.abs(d - pitch))
    if (spread > PITCH_TOL) {
      warn(`baseline pitch varies by ${spread.toFixed(2)}px around ${pitch.toFixed(2)}px — place every line at its own baseline instead of stepping by pitch`)
    }
  } else {
    // The LARGEST used line-height in the block, not the first run's: the first
    // text node of a block can perfectly well be a `<sup>` or a `<small>`.
    pitch = refPitch > 0 ? refPitch : px(blockCs.lineHeight, 0)
    warn(lines.length > 1
      ? 'no two lines of this block step downwards, so there is no baseline difference to measure — pitch falls back to the used line-height and is not a measurement'
      : 'a single visual line has no baseline difference to measure — pitch falls back to the used line-height and is not a measurement')
  }

  // ——— runs and styles ———

  const styles = {}
  const idByKey = new Map()
  const styleId = (style) => {
    let id = idByKey.get(style.key)
    if (!id) {
      id = `ts_${idByKey.size}`
      idByKey.set(style.key, id)
      const rest = { ...style }
      delete rest.blockEl
      delete rest.key
      delete rest.note
      styles[id] = rest
    }
    return id
  }

  const raw = []
  for (const p of pieces) {
    const id = styleId(p.style)
    const dy = p.dy || 0
    const prev = raw[raw.length - 1]
    if (prev && prev.style === id && prev.dy === dy) { prev.rEnd = p.rEnd; continue }
    raw.push({ rStart: p.rStart, rEnd: p.rEnd, style: id, href: p.style.href, dy })
  }

  const starts = graphemeStarts(characters, langOf(blockEl, S), S)
  if (!starts && NON_ASCII.test(characters)) {
    warn('Intl.Segmenter is unavailable — offsets are UTF-16 indices and may split a grapheme cluster')
  }

  const mapped = []
  for (const r of raw) {
    const start = snapTo(starts, rToChar[r.rStart])
    const end = snapTo(starts, rToChar[r.rEnd])
    const prev = mapped[mapped.length - 1]
    if (prev && prev.style === r.style && prev.href === r.href && prev.dy === r.dy) {
      if (end > prev.end) prev.end = end
      continue
    }
    mapped.push({ start, end, style: r.style, href: r.href, dy: r.dy })
  }
  for (let i = 1; i < mapped.length; i++) {
    if (mapped[i].start < mapped[i - 1].start) mapped[i].start = mapped[i - 1].start
  }
  // A run whose start reaches the next one's is empty once the runs are tiled;
  // dropping it here — rather than after tiling — is what keeps the tiling total.
  const runs = mapped.filter((r, i) => i === mapped.length - 1 || mapped[i + 1].start > r.start)
  for (let i = 0; i < runs.length - 1; i++) runs[i].end = runs[i + 1].start
  if (runs.length) {
    runs[0].start = 0
    runs[runs.length - 1].end = characters.length
  }

  for (const l of lines) {
    l.start = snapTo(starts, l.start)
    l.end = snapTo(starts, l.end)
    if (l.end < l.start) l.end = l.start
    if (l.spans) {
      for (const s of l.spans) {
        s.start = Math.min(Math.max(snapTo(starts, s.start), l.start), l.end)
        s.end = Math.min(Math.max(snapTo(starts, s.end), l.start), l.end)
      }
      l.spans = l.spans.filter((s) => s.end > s.start)
      if (!l.spans.length) delete l.spans
    }
    if (!l.frags) continue
    for (const f of l.frags) {
      f.start = Math.min(Math.max(snapTo(starts, f.start), l.start), l.end)
      f.end = Math.min(Math.max(snapTo(starts, f.end), l.start), l.end)
    }
    l.frags[0].start = l.start
    l.frags[l.frags.length - 1].end = l.end
    for (let i = 1; i < l.frags.length; i++) {
      if (l.frags[i].start < l.frags[i - 1].start) l.frags[i].start = l.frags[i - 1].start
      l.frags[i - 1].end = l.frags[i].start
    }
  }

  // ——— per-word anchors for justified lines ———
  //
  // Justification is the one alignment where "x + advances" cannot reproduce a
  // line: the browser distributes each line's slack between its WORD GAPS, so
  // every word after the first sits somewhere no advance arithmetic predicts —
  // it has to be measured. One Range per word, only on justified blocks, so the
  // cost lands exactly where the problem is.
  //
  // Anchors are written only where they are trustworthy: an axis-aligned chain
  // (a bbox'd rect is not a word), no RTL anywhere (offsets here are logical
  // and an anchor is a visual claim — `fragmentsOf` refuses bidi the same way),
  // and lines with at least two words. Every line of the block gets them,
  // including the unjustified last one: its anchors are exact too, and one rule
  // with no special case beats two rules with one.
  if (align === 'justify' && !chain.skewed && direction !== 'rtl' && !RTL_CHARS.test(characters)) {
    // characters index -> rendered index. `rToChar` is the other direction, and
    // LSEP positions (which no word contains) simply stay -1.
    const rOf = new Int32Array(characters.length).fill(-1)
    for (let k = 0; k < rendered.length; k++) if (rToChar[k] >= 0) rOf[rToChar[k]] = k
    // Pieces are in rendered order, so a forward cursor finds each word's piece
    // without rescanning — words are visited left to right.
    const pieceAt = (r, fromIndex) => {
      for (let i = fromIndex; i < pieces.length; i++) {
        const p = pieces[i]
        if (p.rStart <= r && r < p.rEnd && p.to > p.from) return i
      }
      return -1
    }
    // First DOM offset of `p` whose rendered index has reached `r`. `rAt` is
    // monotone (built forward, holes filled from the right), so this is a plain
    // lower bound.
    const domAt = (p, r) => {
      const rAt = p.t.rAt
      let lo = p.from
      let hi = p.to
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (rAt[mid] >= r) hi = mid
        else lo = mid + 1
      }
      return lo
    }
    for (const line of lines) {
      const words = []
      let at = line.start
      while (at < line.end) {
        while (at < line.end && /\s/.test(characters[at])) at++
        if (at >= line.end) break
        let end = at
        while (end < line.end && !/\s/.test(characters[end])) end++
        words.push({ start: at, end })
        at = end
      }
      if (words.length < 2) continue
      let ok = true
      let cursor = 0
      let prevLeft = -Infinity
      for (const word of words) {
        const rA = rOf[word.start]
        const rB = rOf[word.end - 1]
        const ia = rA >= 0 ? pieceAt(rA, cursor) : -1
        const ib = ia >= 0 && rB >= rA ? pieceAt(rB, ia) : -1
        if (ib < 0) { ok = false; break }
        cursor = ia
        const pa = pieces[ia]
        const pb = pieces[ib]
        range.setStart(pa.t.node, domAt(pa, rA))
        range.setEnd(pb.t.node, Math.min(domAt(pb, rB) + 1, pb.to))
        let left = Infinity
        let right = -Infinity
        for (const r of range.getClientRects()) {
          if (!(r.width > 0) || !(r.height > 0)) continue
          if (r.left < left) left = r.left
          if (r.right > right) right = r.right
        }
        // A word whose rect walks BACKWARDS is a reorder this walk does not
        // model (or a wrap the line map disagrees with); the whole line's
        // anchors are dropped rather than half-trusted.
        if (!Number.isFinite(left) || left <= prevLeft) { ok = false; break }
        prevLeft = left
        word.x = (left - blockRect.left) / sx
        word.w = (right - left) / sx
      }
      if (ok) line.words = words
    }
  }

  // ——— everything that is not exact says so ———

  if (!/^horizontal/.test(blockCs.writingMode || 'horizontal-tb')) {
    warn(`writing-mode: ${blockCs.writingMode} — lines, baselines and pitch are reported in the horizontal model and do not describe the painted geometry`)
  }
  if (chain.skewed) {
    warn('a rotation or skew above this block makes every client rect an axis-aligned bounding box — x, w and baseline are the box, not the line')
  } else if (chain.scaled) {
    // Exact, and therefore not a degradation: an axis-aligned scale divides out
    // of a client rect without residue. It is still declared, because the numbers
    // here disagree with the ones the page reports and a reader has to know why.
    warn({
      code: 'collect.text-scale-normalized',
      grade: 'E',
      severity: 'info',
      message: `a scale of ${sx.toFixed(4)}x${sy.toFixed(4)} above this block was divided out of every ` +
        'measurement — x, w, baseline, asc, desc and pitch are in the block\'s own untransformed units, ' +
        'which is where the emitted transform applies it again',
    })
  }
  if (/justify/.test(blockCs.textAlign || '')) {
    warn(lines.some((l) => l.words)
      ? 'text-align: justify — the slack goes into the word gaps, so every word\'s x was measured and travels on `line.words`; a backend that anchors each word reproduces the justification exactly'
      : 'text-align: justify — the extra advance is distributed between words per line, so one advance width per line will not reproduce it (and no per-word anchors could be measured here: a skewed chain, RTL, or one-word lines)')
  }
  // Two different findings, and conflating them would name the wrong cause: a
  // fragmented line is only evidence of bidi when there is RTL text to reorder.
  // A tab stop, a hyphenation break and an ellipsis fragment lines just as well.
  if (RTL_CHARS.test(characters)) {
    warn('bidirectional text — visual order within a line is not logical order, and every offset here is logical')
  } else if (flags.fragmented) {
    warn(`${flags.fragmented} line(s) carry a text node as more than one visual fragment (a tab stop, a hyphenation break or a font fallback) — the fragments are reported as one contiguous range`)
  }
  if (EMOJI && EMOJI.test(characters)) {
    warn('emoji present — a colour glyph does not advance like the font measured here, so the line box does not expand the same way')
  }
  const smallCaps = []
  const stroked = []
  for (const id of Object.keys(styles)) {
    const st = styles[id]
    if (st.decorations.length > 1) {
      // They all paint. `<a>` underlined + `<span>` struck through is two lines
      // over the same glyphs, and every consumer this repo has holds one.
      warn(`${st.decorations.length} text-decorations paint over ${id} (${st.decorations.map(d => d.line).join(' + ')}) — ` +
        'they are reported innermost first in `decorations`, and a consumer that holds a single ' +
        'decoration keeps the first and loses the rest')
    }
    if (st.strokeWidth > EPS) stroked.push(`${id} (${st.strokeWidth}px)`)
    if (SMALL_CAPS.test(st.fontVariantCaps)) smallCaps.push(`${id} (${st.fontVariantCaps})`)
    if (st.color[3] === 0) {
      warn(`${id} paints with a fully transparent fill (-webkit-text-fill-color or background-clip: text) — a solid fill does not reproduce it`)
    }
  }
  // Both of these used to travel in the style and be dropped by every backend
  // without a word. Collecting them is not enough — a consumer that ignores them
  // paints the wrong glyphs (small caps) or a filled shape where the page paints
  // a hollow one (a stroke), and the reader has to be told which one it is.
  if (smallCaps.length) {
    warn({
      code: 'collect.text-small-caps',
      grade: 'A',
      severity: 'warn',
      message: `font-variant-caps repaints ${smallCaps.join(', ')} as capitals. The value travels on the run ` +
        'style as `variant`; a backend that ignores it paints the lower-case letters at full size, and one ' +
        'that has no small-cap face can only synthesise them by drawing the lower-case letters upper-case at ' +
        'about 0.8em (`emit/pdf.js` does exactly that), which is a different set of shapes from a designed face',
    })
  }
  if (stroked.length) {
    warn({
      code: 'collect.text-stroke',
      grade: 'A',
      severity: 'warn',
      message: `-webkit-text-stroke paints over ${stroked.join(', ')}. The width and the colour travel on the ` +
        'run style as `strokeWidth`/`strokeColor`; a backend that ignores them paints solid glyphs where the ' +
        'page paints outlined ones. The stroke is also CENTRED on the glyph outline and half of it falls ' +
        'outside the rects measured here, so the line box is narrower than the ink',
    })
  }
  declareFamilies(styles, warn)
  if (blockCs.backgroundClip === 'text' || blockCs.webkitBackgroundClip === 'text') {
    warn('background-clip: text — the glyphs are a mask over the background and no solid text fill reproduces them')
  }
  if (blockCs.textOverflow && blockCs.textOverflow !== 'clip') {
    warn(`text-overflow: ${blockCs.textOverflow} — the painted ellipsis is not a character and is absent from characters`)
  }
  if (blockCs.webkitLineClamp && blockCs.webkitLineClamp !== 'none') {
    warn('-webkit-line-clamp — clamped lines paint nothing and report no rects, so text past the clamp has no geometry')
  }
  // Only when nothing was found: a hyphen that WAS found is reported by
  // `collect.text-hyphen` above, with the lines it sits on. This is the other
  // half — the block asked for hyphenation, several lines could have taken it,
  // and no break glyph turned up on any of them.
  if (blockCs.hyphens === 'auto' && lineCount > 1 && !hyphenated.length) {
    warn('hyphens: auto — no line of this block ends in a painted hyphen, so every break here fell on a ' +
      'space or a character that already offered one; a hyphen the browser did paint is not a character of ' +
      'the document and would be reported on `line.hyphen`, never inside `characters`')
  }
  if (flags.mixedShift) {
    warn('a run shifted by vertical-align wraps onto more than one line and its offset is not the same on ' +
      'each of them — `dy` carries the offset it has on the first')
  }
  if (flags.holes) {
    warn(`${flags.holes} hole(s) across ${flags.holeLines} line(s): something that is not a character sits ` +
      'inside the line (an image, an inline-block, a form control, or the padding of an inline box). ' +
      '`line.w` is the sum of the painted glyph advances and `line.frags` carries the measured x and width ' +
      'of every stretch of glyphs — a backend that fits the whole string to one width stretches it across the hole')
  }
  if (flags.tabs) {
    warn('preserved tab characters — tab-stop advance is not modelled, so a line width containing one is approximate')
  }
  if (flags.capitalize && texts.length > 1) {
    warn('text-transform: capitalize is resolved one text node at a time, with the single preceding character for context — a word boundary that depends on more than that character may capitalize differently than it paints')
  }
  if (flags.transformUnresolved) {
    warn('text-transform could not be read back from the browser, or it changes the string length — characters carries the untransformed text at those positions')
  }
  if (flags.hidden) warn(`${flags.hidden} text node(s) under visibility:hidden were left out of the text`)
  if (flags.noRects) warn(`${flags.noRects} text node(s) have text but no client rects — clipped, clamped, or not laid out`)
  if (flags.ruby) warn('ruby annotations (rt/rp) were left out — they paint on their own baseline and belong to their own node')
  if (flags.shadow) warn('shadow DOM or slotted content inside this block is out of scope for v0 and its text was not collected')
  if (flags.contentVisibility) warn('a content-visibility:hidden subtree was skipped — its text is not laid out and has no geometry')

  return { characters, lines, runs, pitch, align, direction, styles, sourceText, warnings }
}

export default collectText
