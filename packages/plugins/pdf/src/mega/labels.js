/**
 * /PageLabels: the viewer's page field agreeing with the printed folio.
 *
 * The generated contents already numbers BODY pages from 1 and leaves front
 * matter out, and the pageNumbers furniture stamps the same body count. Without
 * /PageLabels a viewer numbers physical pages — cover is "1", the first body
 * page is "3" — and the index appears off by the size of the front matter.
 * The number tree below is that same folio convention said in PDF: front matter
 * in lowercase roman, body decimal from 1, a closing page continuing the body
 * count because a colophon is still a page of the document.
 *
 * This is deliberately NOT configurable. The one honest knob — "make the labels
 * match a custom `pageNumbers.format`" — cannot exist, because a format function
 * cannot be mirrored into a static number tree. The default convention is the
 * one every viewer, print dialog and "page 3 of 12" conversation assumes.
 */

/**
 * @param {object} counts
 * @param {number} counts.front  cover + contents pages
 * @param {number} counts.body   body pages
 * @param {number} counts.back   closing pages
 * @returns {string|null} the /PageLabels VALUE — a number tree dictionary — or
 *   null when every label a viewer would invent is already right
 */
export function pageLabels({ front, body, back }) {
  // One physical page with no front matter labels itself "1" unaided; front
  // matter or a multi-page body is where viewers start lying about folios.
  if (!front && front !== 0) return null
  if (front === 0 && back === 0) return null
  const nums = []
  if (front > 0) {
    nums.push('0 << /S /r >>')
    nums.push(`${front} << /S /D >>`)
  } else {
    nums.push('0 << /S /D >>')
  }
  // Back pages continue the body's decimal run — no entry needed: a number tree
  // range extends until the next key.
  void body
  void back
  return `<< /Nums [${nums.join(' ')}] >>`
}
