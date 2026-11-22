/**
 * Is it worth asking the browser about `::first-letter` / `::first-line` at all?
 *
 * Two places probe them on every block of text — `paint.js` to declare a
 * `::first-line` the clone cannot materialise, `collect/text.js` to split a drop
 * cap off its paragraph — and each probe is a `getComputedStyle(el, pseudo)` plus
 * a property-by-property comparison against the element's own style. On a page
 * that has no such rule that is all cost and no answer: MEASURED on a 500-row
 * table (4,512 elements), the two probes were 55ms of a 330ms export, and more
 * than a third of the `getComputedStyle` calls the engine made (10,473 of 28,573).
 *
 * The probes already rest on one fact: a pseudo-element that no rule targets
 * reports the element's own values. The same fact read the other way is the gate
 * — a document whose style sheets never say `first-letter` or `first-line`
 * cannot make a probe answer anything but "same", so the probe is skipped.
 *
 * What keeps it honest:
 *
 *  - **It only ever skips on proof.** A sheet that cannot be read (cross-origin),
 *    more rules than the budget covers, an element inside a shadow tree (whose
 *    sheets are not the document's), or any error at all, answers "may apply" and
 *    the probe runs exactly as before.
 *  - **The selector text is what is searched**, so nested rules (`&::first-letter`),
 *    the legacy single-colon form and rules inside `@media`/`@supports`/`@layer`/
 *    `@container`/`@scope` are all seen, and so are `@import`ed sheets. A rule
 *    that does not match the element in question still answers "may apply": the
 *    gate does not match selectors, the browser does.
 *  - **It reads the document the element is in**, at the moment of the walk: the
 *    mounted clone lives in the page's document, so the page's own rules and the
 *    scoped ones snapdom ships with the clone are both in `document.styleSheets`.
 *  - **Small captures never pay for it.** The sheets are read once, and only
 *    after `WARM_UP` blocks have been probed the old way — a ten-element capture
 *    on a page with thousands of rules costs what it always did.
 *
 * Per capture: the verdict hangs off the state object the caller already keeps
 * for one walk, so a rule added between two captures is seen by the second.
 */

const MENTIONS = /first-l(?:etter|ine)/i

/** Blocks probed unconditionally before the sheets are read. */
const WARM_UP = 16

/**
 * Rules read before giving up and answering "may apply". Reading `selectorText`
 * is cheap but not free, and past this the scan would cost more than the probes
 * it is trying to save on an ordinary capture.
 */
const RULE_BUDGET = 5000

/**
 * @param {Document} doc
 * @returns {boolean} false ONLY when every sheet was read and none names either pseudo
 */
function sheetsMention (doc) {
  let budget = RULE_BUDGET
  const seen = new Set()

  const scanRules = (rules) => {
    for (let i = 0; i < rules.length; i++) {
      if (--budget < 0) return true
      const rule = rules[i]
      const selector = rule.selectorText
      if (typeof selector === 'string' && MENTIONS.test(selector)) return true
      if (rule.styleSheet && scanSheet(rule.styleSheet)) return true
      const nested = rule.cssRules
      if (nested && nested.length && scanRules(nested)) return true
    }
    return false
  }

  const scanSheet = (sheet) => {
    if (!sheet || seen.has(sheet)) return false
    seen.add(sheet)
    // Throws on a cross-origin sheet; the outer `try` turns that into "may apply".
    const rules = sheet.cssRules
    return rules ? scanRules(rules) : false
  }

  try {
    for (const sheet of doc.styleSheets) if (scanSheet(sheet)) return true
    for (const sheet of doc.adoptedStyleSheets || []) if (scanSheet(sheet)) return true
    return false
  } catch {
    return true
  }
}

/**
 * @param {object|null|undefined} state  the per-walk state of the caller; the
 *   verdict is cached on it. Without one the answer is always "may apply".
 * @param {Element} el  the element about to be probed
 * @returns {boolean} false when probing `::first-letter` / `::first-line` on
 *   `el` is known to change nothing
 */
export function firstPseudoMayApply (state, el) {
  if (!state || typeof state !== 'object' || !el) return true
  let gate = state.firstPseudoGate
  if (!gate) gate = state.firstPseudoGate = { asked: 0, verdicts: new Map() }
  if (gate.asked < WARM_UP) {
    gate.asked++
    return true
  }
  try {
    const doc = el.ownerDocument
    if (!doc || el.getRootNode() !== doc) return true
    let verdict = gate.verdicts.get(doc)
    if (verdict === undefined) {
      verdict = sheetsMention(doc)
      gate.verdicts.set(doc, verdict)
    }
    return verdict
  } catch {
    return true
  }
}
