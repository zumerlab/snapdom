/**
 * snapdom Pro — the snapdom adapter.
 *
 * **This is the only file in the engine allowed to know snapdom exists.** Every
 * other module takes elements and computed styles and does not care which tree
 * they came from; this one produces that tree.
 *
 * The engine walks snapdom's CLONE, not the live DOM (see `packages/CONTRACT.md`).
 * The clone is where snapdom has already solved membership: pseudo-elements are
 * materialised into real `<span>`s, shadow DOM is flattened with its CSS
 * rewritten, icon fonts are resolved to `<img>`, backgrounds and images are
 * inlined past CORS, scroll is applied as a translate. Only geometry and paint
 * are left, and those are what the collectors do.
 *
 * **The clone arrives through the plugin system, like everything else that
 * extends snapdom.** `vector()` in `../index.js` is a plugin of exactly the shape
 * the twelve official ones have (`snapdom/packages/plugins/`): a factory returning
 * `{name, hook…, defineExports}`. `handoffFrom` below is the one function that
 * knows what a hook state looks like, and `mountClone` takes it from there.
 *
 * The hook is `beforeRender`, after v3 has added `fontsCSS`, `baseCSS` and
 * `scrollbarCSS` to the same capture context that already carries `clone`,
 * `classCSS`, `styleCache` and `nodeMap`. `styleMap` is on `options.__session`.
 *
 * **`afterClone` is too early**, which is why the later hook: the
 * images, background images and fonts have not been inlined yet (that is the
 * `assetsPhase`/`fontsPhase` pair further down) and there is no `fontsCSS` at
 * all. A clone whose assets are already resolved past CORS is half of what this
 * engine walks the clone FOR.
 *
 * The hand-off rides on the capture context. `state.options` aliases `state`
 * in v3; `buildResult` spreads that context into each export view, so the
 * hand-off survives without storing capture state on the plugin instance.
 *
 * One value the hand-off cannot get that way is `classPrefixCSS`: `captureDOM`
 * keeps it local and only passes it to internal `__retain`, not public hooks.
 * It is recovered here from `classCSS`, which begins with it — see
 * `classPrefixFrom`.
 *
 * Mounting is not a detail either:
 *
 *  - **light DOM, never a shadow root.** Chromium ignores `@font-face` inside a
 *    shadow root, and a clone laid out with substituted fonts measures nothing
 *    useful — every `textLength` in the export would be a lie.
 *  - **the page's own stylesheets still apply.** The clone keeps its original
 *    class names and ids, so mounting it in the same document reproduces the
 *    live cascade rather than re-deriving it. `classPrefixCSS` supplies what the
 *    cascade cannot: the shadow-scoped rules, the scoped `::marker`/
 *    `::first-line` rules, and the `PSEUDO_SUPPRESS` rule that stops a
 *    materialised `::before` from being painted twice.
 *  - **offscreen, not hidden.** `display:none` has no layout and `visibility:
 *    hidden` still reflows the page; `position:fixed; left:-99999px` with
 *    `contain:layout style` has a full layout, is off every screen, and cannot
 *    disturb the document it is borrowed into.
 *
 * Borrowing the page's cascade is what makes the mount cheap and faithful, and
 * it is also where all four ways it goes wrong come from. Each has its own
 * repair below, each was found by `drift` rather than by reasoning, and each
 * carries the number it was worth:
 *
 *  1. the host has no width, so a `width:auto` root shrink-wraps instead of
 *     filling the space it filled on the page — `sizeHost`, 628px;
 *  2. nothing in the page styles a node snapdom INVENTED, so a materialised
 *     `::before` sized only by CSS arrives 0×0 — `synthRulesFrom`, 18px;
 *  3. a scroll wrapper interposes itself and breaks every `>` chain that crosses
 *     it, for the whole subtree — `synthRulesFrom` again, 268px;
 *  4. connecting the clone UPGRADES its custom elements and the browser gives
 *     them back the shadow roots snapdom flattened away —
 *     `defuseUpgradedShadowRoots`, 37.72px.
 *
 * With all four in, nine fixtures across two demo pages and a scrolled-container
 * fixture measure 0.00px of drift — median, p95 and max. `drift` re-measures it
 * on every capture, because the whole architecture rests on the number and a
 * number nobody checks is a promise.
 *
 * @module adapters/snapdom
 */

/**
 * Stamped on the two nodes this module adds to the page, so anything it ever
 * leaks is one `querySelectorAll` away instead of anonymous debris.
 */
const MARK = 'data-snapdom-vector'

/**
 * See the module comment: offscreen with a real layout, contained.
 *
 * `position:fixed` with no width shrink-wraps, and a block-level clone root then
 * sizes to its own content instead of to the width it had on the page. Measured:
 * a `<div>` that was 968px wide live came out 340px wide in the clone, and every
 * line in it wrapped somewhere else. `sizeHost` puts the width back — this
 * constant is only what does not depend on the element.
 */
const HOST_CSS = 'position:fixed;left:-99999px;top:0;contain:layout style;display:block;'

/**
 * Give the host the box the clone root had on the page, so a root with
 * `width:auto` resolves against the same available space.
 *
 * The size is read from the computed style rather than `getBoundingClientRect`
 * on purpose: `outerTransforms:true` keeps the root's own transform on the
 * clone, and a bounding rect of a rotated element is its bounding box, not its
 * layout box. `cs.width`/`cs.height` are the used content box, in subpixels,
 * with no transform applied.
 *
 * Margins are added back because the host is the clone root's containing block
 * now: a block child with `margin:0 24px` would otherwise lay out 48px narrower
 * than it did on the page.
 *
 * @param {HTMLElement} host
 * @param {Element} element live capture root
 */
function sizeHost (host, element) {
  const cs = typeof getComputedStyle === 'function' ? getComputedStyle(element) : null
  if (!cs) return
  const n = (v) => {
    const value = parseFloat(v)
    return Number.isFinite(value) ? value : 0
  }
  const w = n(cs.width) + n(cs.paddingLeft) + n(cs.paddingRight) +
    n(cs.borderLeftWidth) + n(cs.borderRightWidth) + n(cs.marginLeft) + n(cs.marginRight)
  const h = n(cs.height) + n(cs.paddingTop) + n(cs.paddingBottom) +
    n(cs.borderTopWidth) + n(cs.borderBottomWidth) + n(cs.marginTop) + n(cs.marginBottom)
  // A zero here would be worse than leaving the host to shrink-wrap: it would
  // collapse the clone instead of merely letting it choose its own width.
  if (w > 0) host.style.width = `${w}px`
  if (h > 0) host.style.height = `${h}px`
}

/** Stamped on the clone nodes that get a snapshot rule of their own. */
const SYNTH = 'data-snapdom-vector-synth'

/**
 * snapdom's own suppressor for the pseudo-elements it materialised, verbatim
 * from `snapdom/src/core/prepare.js:130`. That file is the source of truth; this
 * is a copy because the string is also the ANCHOR the split below needs, and a
 * copy that stops matching is detected (see `classPrefixFrom`) rather than
 * silently wrong.
 */
const PSEUDO_SUPPRESS =
  '[data-snapdom-has-after]::after,[data-snapdom-has-before]::before{content:none!important;display:none!important}'

/** One scoped `::marker`/`::first-line` rule, as `pseudo.js:460` writes them. */
const SCOPED_PSEUDO_RE = /^\[data-sd-p\d+\]::(?:marker|first-line)\{[^}]*\}/

/**
 * `classPrefixCSS` back out of `classCSS`.
 *
 * The mount needs the front half of snapdom's CSS and must not have the back
 * half. `prepare.js:133-134` builds the string as
 *
 *   classCSS = shadowScopedCSS + PSEUDO_SUPPRESS + __pseudoCSS + `.c1{…}.c2{…}…`
 *              └───────────────── classPrefixCSS ─────────────┘
 *
 * and the boundary is findable exactly, without parsing CSS or guessing: the
 * middle term is a fixed literal, and the third is a run of rules with one
 * grammar (`[data-sd-pN]::marker{…}`). Everything after that run is the
 * generated per-node style snapshots, which are the rules that must NOT be
 * injected — mounting those on top of the page's cascade freezes used widths and
 * re-wraps text (measured: fx-table's pixel diff 2.071 → 10.254).
 *
 * `exact:false` means the anchor was not found — a snapdom whose suppressor
 * string moved. The caller declares that rather than guessing a boundary: the
 * literal alone still stops a materialised `::before` painting twice, and what
 * is lost is the shadow-scoped rules, which is a fidelity claim someone has to
 * be told about.
 *
 * @param {string} classCSS
 * @returns {{css: string, exact: boolean}}
 */
function classPrefixFrom (classCSS) {
  const css = typeof classCSS === 'string' ? classCSS : ''
  const at = css.indexOf(PSEUDO_SUPPRESS)
  if (at < 0) return { css: PSEUDO_SUPPRESS, exact: false }
  let end = at + PSEUDO_SUPPRESS.length
  for (;;) {
    const m = SCOPED_PSEUDO_RE.exec(css.slice(end))
    if (!m) break
    end += m[0].length
  }
  return { css: css.slice(0, end), exact: true }
}

/**
 * Stamped on a clone node whose shadow root this module emptied. `paint.js`
 * reads it: a shadow root it did not expect is an error, and this one it did.
 */
export const DEFUSED_SHADOW_ATTR = 'data-snapdom-vector-defused'

/**
 * Undo the damage that mounting does to custom elements.
 *
 * `cloneNode` never copies a shadow root, so snapdom's clone arrives with every
 * shadow tree already flattened into light DOM and its CSS rewritten to scoped
 * classes. Then we connect it to the document — and the browser UPGRADES every
 * custom element in it. `connectedCallback` runs, `attachShadow` gives the clone
 * a brand-new shadow tree, and the flattened content snapdom worked out is
 * either hidden behind it or, worse, slotted INSIDE the component's own markup
 * and rendered twice.
 *
 * Measured on a `<sd-badge>` whose shadow root is `<span class="b"><slot></slot></span>`:
 * the clone came out 130.63×34.50 against a live 92.91×25.75 — the badge inside
 * the badge — and it dragged its three flex siblings 37.72px with it.
 *
 * The repair is exact, not a heuristic: **any** shadow root on a clone node was
 * created by that upgrade, because a clone cannot have inherited one. Replacing
 * its content with a bare `<slot>` is the identity transform for the flattened
 * light DOM — it renders as if there were no shadow root at all. Measured on the
 * same badge: 92.91×25.75, and the fixture's drift went 37.72px → 0.00px.
 *
 * Two things it cannot reach, both declared rather than papered over: a `closed`
 * shadow root is not exposed to script at all, and a `connectedCallback` that
 * rewrites its own light DOM has already done so by the time we look.
 *
 * @param {Element} clone mounted clone root
 * @returns {Element[]} the hosts that were defused
 */
function defuseUpgradedShadowRoots (clone) {
  const defused = []
  const all = [clone]
  for (const el of clone.querySelectorAll('*')) all.push(el)
  for (const el of all) {
    if (!el.shadowRoot) continue
    try {
      el.shadowRoot.replaceChildren(el.ownerDocument.createElement('slot'))
      el.setAttribute(DEFUSED_SHADOW_ATTR, '')
      defused.push(el)
    } catch { /* a shadow root we cannot rewrite stays as it is, and paint.js says so */ }
  }
  return defused
}

/** snapdom's marker on the span it materialises a `::first-letter` into. */
const FIRST_LETTER = '::first-letter'

/**
 * The inner div `wrapScrolledClone` (snapdom/src/core/prepare.js) puts inside a
 * scrolled container to carry `translate(-scrollX, -scrollY)`.
 *
 * Identified by signature because snapdom gives it no attribute of its own; this
 * is the same test `paint.js` uses, kept as a copy rather than an import so the
 * adapter stays the bottom of the stack and depends on nothing above it. Note
 * that `all: unset` is read off the CSSOM, never off the style ATTRIBUTE, which
 * Chromium serializes expanded into every longhand the shorthand covers.
 *
 * @param {Element} el
 */
function isScrollWrapper (el) {
  if (!el || el.tagName !== 'DIV' || !el.style) return false
  if (el.attributes.length !== 1 || !el.hasAttribute('style')) return false
  const s = el.style
  return s.all === 'unset' && s.display === 'inline-block' && s.width === '100%' &&
    s.willChange === 'transform' && /^translate\(/.test(s.transform || '')
}

/**
 * Style rules for the clone nodes the page cannot style, and only those.
 *
 * snapdom keeps every clone node's computed style in a style key and stamps the
 * node with a generated class (`c1`, `c2`, …) that carries it; those rules go
 * into the SVG it renders and are deliberately left out of the mount — see
 * `classPrefixFrom`, which cuts them off the front half of `classCSS`. Mounted in
 * the page, the clone is painted by the page's own stylesheets instead, which
 * is what makes the mount faithful — the clone kept its class names, so it gets
 * the same cascade the original had. Measured: drift 0.00–0.03px that way.
 *
 * Injecting ALL of snapdom's rules on top of that is worse, not better, and this
 * was measured too: scoped to the host they outrank the page's own selectors,
 * and a frozen used-width where the page had none re-wrapped a paragraph
 * (`<b>` 395×47 live vs 119×19 in the clone) and shifted a table row by 27.81px.
 * fx-table's pixel diff went 2.071 → 10.254 on that experiment alone.
 *
 * What the page genuinely cannot style is the nodes snapdom INVENTED: a
 * materialised `::before` is a `<span>` no author selector matches. Left to the
 * cascade it has no box at all — measured, a `::before` with
 * `content:""; width:6px; height:6px` came out 0×0 and every pill carrying one
 * was 6px narrow. Those nodes, and no others, get their snapshot back here.
 *
 * A node with no live counterpart in `nodeMap` is exactly the definition of
 * invented, so the map is the test rather than a list of snapdom's attribute
 * names that would rot the next time it grows one.
 *
 * **`::first-letter` is the one exception, and it is not a special case for its
 * own sake.** snapdom stops a materialised `::before`/`::after` from painting
 * twice with `PSEUDO_SUPPRESS` (`[data-snapdom-has-before]::before{content:none}`),
 * which leaves the span as the only carrier; there is no such suppressor for
 * `::first-letter`, so the page's own rule still matches the clone paragraph and
 * still draws the drop cap. Styling the span as well makes two floats out of one.
 * Measured on fx-type: the paragraph re-wrapped and a `<b>` moved a whole line,
 * 276.61px of drift, so the span is left alone here.
 *
 * That leaves a known hole, and it is a hole in the DESCRIPTION rather than the
 * layout: the browser paints the drop cap from the page's rule, but the engine
 * reads `getComputedStyle(span)`, which knows nothing about it. `collect/text.js`
 * closes it by asking the parent for its `::first-letter` style — a paint-only
 * subset applied here does not work, because a `font-size` on the span changes
 * its own strut and moves the line (measured: 32.69px median drift, pixel diff
 * 5.58 → 17.86).
 *
 * @param {Element} clone  the clone root, not yet mounted
 * @param {Map<Node, Node>|undefined} nodeMap clone node -> live node
 * @param {Map<Node, string>|undefined} styleMap clone node -> style key
 * @returns {string} CSS, '' when nothing was synthesized
 */
function synthRulesFrom (clone, nodeMap, styleMap) {
  if (!styleMap || typeof styleMap.get !== 'function') return ''
  if (!nodeMap || typeof nodeMap.get !== 'function') return ''
  let css = ''
  let n = 0
  const all = [clone]
  for (const el of clone.querySelectorAll('*')) all.push(el)
  // Everything below a scroll wrapper, found in one pass: `querySelectorAll`
  // yields document order, so a parent is always seen before its children.
  const stranded = new Set()

  for (const el of all) {
    // A real node under a scroll wrapper is in the same position as an invented
    // one. The wrapper is interposed between a container and its content, and
    // that breaks every `>` chain that crosses it — not only at the first level:
    // `.scroller > div` fails, and so does `.scroller > div > p:first-child`
    // three nodes down. Measured on a 300×150 scroller: the direct child laid
    // out 300×48 against a live 300×316 (268px), and with only direct children
    // repaired the paragraphs inside it were still 14px out, having picked up
    // the UA's `margin: 1em 0` in place of the author's `margin: 0 0 8px`.
    const parent = el.parentElement
    if (parent && (stranded.has(parent) || isScrollWrapper(parent))) stranded.add(el)
    // Not `!nodeMap.get(el.parentElement)`, which is the same idea and wrong:
    // `nodeMap` does not hold every element, so "unmapped parent" also catches
    // ordinary nodes and hands them a frozen snapshot. Measured when it did —
    // every fixture regressed at once, fx-table's pixel diff 1.83 → 11.39 and
    // fx-card's drift 0.00 → 20.88px. The wrapper's signature is exact; the
    // absence of a map entry is not evidence of anything.
    if (nodeMap.get(el) && !stranded.has(el)) continue
    if (el.getAttribute && el.getAttribute('data-snapdom-pseudo') === FIRST_LETTER) continue
    const key = styleMap.get(el)
    if (!key) continue
    // Keyed on a per-node attribute rather than the shared `cN` class: one key
    // can be shared by an invented node and a real one, and the real one must
    // keep the cascade it already lays out correctly under.
    el.setAttribute(SYNTH, String(n))
    // `all:initial` first, and it is load-bearing rather than tidiness. snapdom
    // builds a style key by dropping every property whose value equals the CSS
    // INITIAL value (`getDefaultStyleForTag` measures a bare tag with
    // `style.all = 'initial'`), because inside its own SVG the key is paired with
    // a generated base reset that neutralises the UA stylesheet. Without that
    // reset the key is only half a style: measured on a scrolled container, a
    // `<p>` whose author rule sets `margin-top:0` had no `margin-top` in its key
    // at all, kept the UA's `1em`, and pushed the whole subtree 14px down.
    css += `[${MARK}="clone-host"] [${SYNTH}="${n}"]{all:initial;${key}}`
    n++
  }
  return css
}

/**
 * @typedef {object} CloneDrift
 * @property {number} pairs   clone elements that had a live counterpart in `nodeMap`
 *   AND take part in layout on at least one side — the nodes the numbers below are
 *   computed over. A zero across 3 pairs is not the same promise as a zero across 300.
 * @property {number} skipped mapped pairs left out because neither side generates a
 *   box (see `laysOut`). Reported so the reader can tell a small denominator from a
 *   filtered one.
 * @property {number|null} median  px, over `pairs`; `null` only when `pairs` is 0
 * @property {number|null} p95     px
 * @property {number|null} max     px
 * @property {{delta: number, tag: string, id: string, cls: string, clone: string,
 *   live: string, missing?: 'clone'|'live'}[]} worst
 *   the worst offenders, biggest first, so the number comes with somewhere to look.
 *   `missing` names the side that has no box at all, when only one of them does.
 */

/**
 * Does this element take part in layout at all?
 *
 * The nodes that do not are not drift and never were: `<stop>`, `<clipPath>`,
 * `<defs>`, `<linearGradient>` and everything under them describe paint, not
 * boxes, and an `<option>` is drawn by the platform's popup rather than by the
 * document. All of them return the all-zero rect, and subtracting a root origin
 * from a zero rect measures the OFFSCREEN OFFSET of the host instead of any
 * disagreement — which is exactly the 100451.00px that `fx-svg` and `fx-form`
 * used to report, i.e. `HOST_CSS`'s -99999px plus wherever the fixture sat.
 *
 * The test is the client-rect LIST, not a list of tag names that would rot the
 * next time SVG grows an element, and not `display`/`checkVisibility` either.
 * Measured on `fx-svg`, over the 22 mapped nodes that have no box on either
 * side: `getComputedStyle(el).display` is `inline` for **all 22** (Chromium's
 * SVG UA sheet does not use `display:none` for them) and
 * `el.checkVisibility({contentVisibilityAuto: true})` is `true` for 15 of them —
 * only the 7 `<stop>`s come out false (`fx-form`'s 3 `<option>`s do too, which is
 * the whole of what the two agree on). An element that generates no box
 * has an EMPTY rect list, and that is true for `display:none`, for a
 * `content-visibility` subtree the browser skipped, and for the SVG paint-server
 * elements all at once.
 *
 * `rect` is the caller's already-taken bounding rect, so the rect list is only
 * consulted for the degenerate case that could mean either "no box" or "a real
 * empty box at the viewport origin".
 *
 * @param {Element} el
 * @param {DOMRect} rect  `el.getBoundingClientRect()`, already measured
 * @returns {boolean}
 */
function laysOut (el, rect) {
  if (rect.width || rect.height || rect.left || rect.top) return true
  if (!el.getClientRects) return true
  return el.getClientRects().length > 0
}

/**
 * @typedef {object} CloneHandoff  what one `beforeRender` hook state is worth
 * @property {Element} element     the LIVE capture root
 * @property {Element} clone       snapdom's resolved clone, still detached
 * @property {Map<Node, Node>} nodeMap  clone node -> source node
 * @property {Map<Node, string>} styleMap  clone node -> style key
 * @property {string} fontsCSS     `@font-face` rules snapdom embedded, '' when none
 * @property {string} classCSS     every rule snapdom generated for this capture
 */

/**
 * @typedef {object} CloneCapture
 * @property {Element} clone        snapdom's resolved clone, MOUNTED and laid out
 * @property {Map<Node, Node>} nodeMap  clone node -> source node
 * @property {() => void} unmount  idempotent; removes the host and the injected <style>
 * @property {CloneDrift} drift    the mounted clone measured against its live source
 * @property {boolean} classPrefixExact  false when `classPrefixCSS` could not be cut
 *   out of `classCSS` and the mount ran on the suppressor alone. See `classPrefixFrom`.
 * @property {number} defusedShadowHosts  custom elements the browser upgraded on
 *   mount and whose new shadow root was emptied again. See `defuseUpgradedShadowRoots`.
 */

/**
 * How far the mounted clone's boxes are from the live boxes they came from.
 *
 * Both sides are measured relative to their OWN root, so the offscreen offset
 * cancels and what is left is real disagreement. This is the safety net for the
 * whole clone architecture: if it is not ~0, every coordinate the engine emits
 * is measured against a layout the user never saw.
 *
 * The offset only cancels for nodes that HAVE a box, which is why `laysOut`
 * filters first: a node with no box on either side is not a node that agrees or
 * disagrees, it is a node with nothing to compare, and running it through the
 * subtraction anyway turned the host's own -99999px into a drift reading. Those
 * are counted in `skipped` rather than dropped in silence — a number computed
 * over a filtered population has to say how much it filtered, or the filter is
 * just a nicer-looking version of the same lie.
 *
 * A node that lays out on ONE side is the opposite case and stays in: it is an
 * element the export either invented or lost, which is the loudest thing this
 * measurement can find. Its delta is the size of the box that does exist, since
 * two origins cannot be subtracted when one of them is not a position.
 *
 * @param {Element} clone   mounted clone root
 * @param {Element} element live capture root
 * @param {Map<Node, Node>} nodeMap
 * @returns {CloneDrift}
 */
function measureDrift (clone, element, nodeMap) {
  const rows = []
  let skipped = 0
  if (nodeMap && typeof nodeMap.get === 'function') {
    const cloneRoot = clone.getBoundingClientRect()
    const liveRoot = element.getBoundingClientRect()
    const all = [clone]
    for (const el of clone.querySelectorAll('*')) all.push(el)
    for (const el of all) {
      const src = nodeMap.get(el)
      // A clone node with no live counterpart is not drift: pseudo-element spans,
      // scroll wrappers and synthesized backdrops have nothing to be compared to.
      if (!src || src.nodeType !== 1 || src.isConnected === false) continue
      const a = el.getBoundingClientRect()
      const b = src.getBoundingClientRect()
      const inClone = laysOut(el, a)
      const inLive = laysOut(src, b)
      if (!inClone && !inLive) { skipped++; continue }
      const missing = inClone ? (inLive ? null : 'live') : 'clone'
      rows.push({
        delta: missing
          ? Math.max(a.width, a.height, b.width, b.height)
          : Math.max(
            Math.abs((a.left - cloneRoot.left) - (b.left - liveRoot.left)),
            Math.abs((a.top - cloneRoot.top) - (b.top - liveRoot.top)),
            Math.abs(a.width - b.width),
            Math.abs(a.height - b.height),
          ),
        missing,
        el,
        src,
        a,
        b,
      })
    }
  }
  // No pair means NOT MEASURED, and that is a different answer from "zero drift".
  // Reporting 0 here would hand the orchestrator a clean bill of health for a
  // mount nobody checked, which is the one failure this number exists to catch.
  // `skipped` travels even then: "nothing to measure" and "nothing measurABLE"
  // are read the same way by a human and are not the same fault.
  if (!rows.length) return { pairs: 0, skipped, median: null, p95: null, max: null, worst: [] }

  rows.sort((x, y) => x.delta - y.delta)
  const q = (p) => rows[Math.min(rows.length - 1, Math.floor(rows.length * p))].delta
  return {
    pairs: rows.length,
    skipped,
    median: q(0.5),
    p95: q(0.95),
    max: rows[rows.length - 1].delta,
    // A number without a culprit is a shrug. The worst few nodes, named, are the
    // difference between "the clone is off by 628px somewhere" and a selector to
    // go and look at — and the outlier case is exactly where the median is useless.
    worst: rows.slice(-WORST_KEPT).reverse().filter((r) => r.delta > 0).map(describe),
  }
}

/** How many named offenders `drift.worst` keeps. Enough to see a pattern, not a dump. */
const WORST_KEPT = 6

/**
 * @param {{delta: number, missing: 'clone'|'live'|null, el: Element, src: Element,
 *   a: DOMRect, b: DOMRect}} row
 * @returns {{delta: number, tag: string, id: string, cls: string, clone: string,
 *   live: string, missing?: 'clone'|'live'}}
 */
function describe (row) {
  const { el, a, b } = row
  // `no box` rather than `0×0 @ 0,0`: the all-zero rect of an element that does
  // not lay out reads like a measurement, and it is the absence of one.
  const box = (r, gone) => gone ? 'no box' : `${round(r.width)}×${round(r.height)} @ ${round(r.left)},${round(r.top)}`
  const out = {
    delta: row.delta,
    tag: el.tagName ? el.tagName.toLowerCase() : '?',
    id: el.id || '',
    cls: (el.getAttribute && el.getAttribute('class')) || '',
    clone: box(a, row.missing === 'clone'),
    live: box(b, row.missing === 'live'),
  }
  if (row.missing) out.missing = row.missing
  return out
}

function round (v) { return Math.round(v * 100) / 100 }

/** Distinguishes one mounted clone's radio groups from the next one's. */
let radioEpoch = 0

/**
 * Renames the clone's radio groups before the clone is CONNECTED.
 *
 * A radio button's group is every radio with the same `name` under the same form
 * owner, and a radio with no form owner belongs to the whole DOCUMENT. Mounting the
 * clone in `document.body` therefore drops copies of the page's radios into the page's
 * own groups, and the browser enforces "one checked per group" at insertion time: the
 * clone's checked radio wins and **the live one is unchecked**. Measured on
 * `demo/challenges.html` → `fx-form`: `fo-scale=on:1` before a capture and
 * `fo-scale=on:0` after it. Capturing a page must not change the page, and this is the
 * worst way to break that rule — the damage is to the user's own state, it survives the
 * capture, and nothing says it happened. The suite's leak check (#9) cannot see it
 * either: `checked` is IDL state, and the signature it compares is attributes.
 *
 * Renaming cannot change how the clone paints. snapdom gives every clone node a
 * generated class carrying the element's COMPUTED style (`prepare.js`,
 * `applyStyleClass`), so a page rule like `input[name="x"]{…}` has already been
 * resolved into that snapshot; losing the selector match loses nothing that is not
 * already baked in.
 *
 * @param {Element} clone the clone, still detached
 * @returns {number} how many radios were renamed
 */
function isolateRadioGroups (clone) {
  const prefix = `snapdom-vector-clone-${++radioEpoch}-`
  let n = 0
  const rename = (el) => {
    if (!el || el.tagName !== 'INPUT' || el.type !== 'radio') return
    const name = el.getAttribute('name')
    if (!name) return
    el.setAttribute('name', prefix + name)
    n++
  }
  try {
    rename(clone)
    // `input` and not `input[type=radio]`: `type` can be an IDL-only value on a node
    // built by script, and the property is what the browser groups by.
    for (const el of clone.querySelectorAll ? clone.querySelectorAll('input') : []) rename(el)
  } catch { /* a clone we cannot walk is one we cannot damage the page with either */ }
  return n
}

/**
 * Puts the capture root's own outer paint back on the clone.
 *
 * snapdom strips four properties from the CLONE ROOT and only from it —
 * `box-shadow`, `text-shadow`, `outline` and any `drop-shadow()` in `filter`
 * (`snapdom/src/utils/capture.helpers.js`, `stripRootShadows`). For a raster
 * capture that is right: the bleed would fall outside the bitmap and snapdom
 * would either clip it or grow the image. For a VECTOR export it is a hole. The
 * properties are written as inline style on the clone root, so nothing in this
 * engine can see them at all — `collect/box.js` reads a computed style that says
 * `none`, finds no effects, and files no diagnostic, because from where it
 * stands nothing was lost. Measured on `demo/challenges.html`: every one of the
 * ten fixtures is a card with its own `box-shadow`, and all ten arrived with
 * `effects: []` on the root and not one word about it.
 *
 * They are restored from the LIVE element's computed style, which is the only
 * place they still exist. What a backend then does with a shadow that paints
 * outside the frame is the backend's decision to declare — Figma draws it, a
 * standalone SVG clips it to the viewport — and that is a decision it can only
 * make if the shadow is in the document.
 *
 * @param {Element} element  the live capture root
 * @param {Element} clone    the clone root
 * @returns {string[]} the properties put back, for the caller to declare
 */
function restoreRootPaint (element, clone) {
  const restored = []
  if (!clone || !clone.style) return restored
  let cs
  try { cs = getComputedStyle(element) } catch { return restored }
  if (!cs) return restored
  // The clone's own values are read ONCE, before a single write. Interleaving
  // read and write here is a forced style recalc per property on a tree that was
  // mounted milliseconds ago: measured, five of them took `demo/figma.html`'s
  // fx-card capture from 4ms to 14ms.
  let cloneCs
  try { cloneCs = getComputedStyle(clone) } catch { return restored }
  // `outline` is compared through its longhands: the shorthand serialises in a
  // different order on each side, so comparing the strings would always disagree
  // and report a restore that put back what was already there.
  const outlineOf = (s) => `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`
  const before = {
    boxShadow: cloneCs.boxShadow || '',
    textShadow: cloneCs.textShadow || '',
    outline: outlineOf(cloneCs),
    outlineOffset: cloneCs.outlineOffset || '',
    filter: cloneCs.filter || '',
  }
  const put = (prop, value) => {
    if (!value || value === 'none' || value === '0px none rgb(0, 0, 0)') return
    // Only where the clone has actually been emptied: a value that already
    // matches must not be touched, and neither must one the page still cascades.
    if (before[prop] === value) return
    try { clone.style[prop] = value } catch { return }
    restored.push(prop)
  }
  put('boxShadow', cs.boxShadow)
  put('textShadow', cs.textShadow)
  // An outline that paints nothing must not be "restored": the serialisation of
  // no-outline carries the element's own `color`, so comparing the strings
  // reported a restore on every root that had no outline at all.
  if (cs.outlineStyle && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) {
    put('outline', outlineOf(cs))
    if (cs.outlineOffset && cs.outlineOffset !== '0px') put('outlineOffset', cs.outlineOffset)
  }
  // `filter` is only half-stripped: `stripRootShadows` removes the
  // `drop-shadow()` functions and keeps the rest, so putting the live value back
  // restores the shadows without disturbing a `blur()` that survived.
  if (/drop-shadow\(/i.test(cs.filter || '')) put('filter', cs.filter)
  return restored
}

/**
 * One `beforeRender` hook state, reduced to the six things this engine needs.
 *
 * **This is the only function in the package that knows the shape of snapdom's
 * pipeline state.** It runs inside the capture, does no work beyond reading, and
 * hands back a plain object the export can keep — see the module comment for
 * where each field comes from and why the hook is `beforeRender`.
 *
 * @param {{element: Element, clone: Element, nodeMap: Map, classCSS: string,
 *   fontsCSS: string, options: object}} state
 * @returns {CloneHandoff}
 */
export function handoffFrom (state) {
  const session = state && state.options && state.options.__session
  return {
    element: state.element,
    clone: state.clone,
    nodeMap: state.nodeMap,
    // Not on the hook state itself: `prepareClone` returns it on the session's
    // own map (`snapdom/src/core/prepare.js:33-37`), which is where it stays.
    styleMap: session ? session.styleMap : undefined,
    fontsCSS: state.fontsCSS || '',
    classCSS: state.classCSS || '',
  }
}

/**
 * Mount the clone a capture handed over, lay it out, and measure it against the
 * live element it came from.
 *
 * The caller OWNS `unmount()` and must call it — from a `finally`, not from the
 * happy path. Every export that does not leaves a full copy of the user's
 * subtree in their document.
 *
 * Three snapdom options change what arrives here, and NONE of them can be forced
 * from a plugin — `dpr` is resolved in `createContext` and `outerTransforms` is
 * read at `captureDOM`'s line 74, both before the first hook runs, and `burst`
 * decides whether `captureDOM` runs at all. That is not a loss of control, it is
 * where the control actually lives now: the caller writes the `snapdom()` call.
 * What each one does if the caller changes it:
 *
 *  - `outerTransforms:false` strips the root's own transform from the clone, so
 *    it lays out unlike the element it copies — `drift` measures exactly that and
 *    `declareDrift` files it;
 *  - `burst` left unset cannot bite: a plugin with render hooks that has not
 *    declared `pure: true` suspends auto-burst by construction
 *    (`snapdom/src/core/plugins.js:184`, `hasImpureRenderPlugins`) — MEASURED,
 *    five consecutive captures of one element all ran the pipeline, where the
 *    old loose API had to pass `burst: false` to survive the third. Explicit
 *    `burst: true` is the caller taking that back; four in a row still re-entered
 *    `captureDOM` when measured, so a memo serve is a defended case and not an
 *    observed one — if one is ever served the hook does not fire, and the export
 *    throws instead of walking a clone from some other capture;
 *  - `dpr` scales the inlined raster assets, not the layout: every measurement
 *    here is a CSS-pixel `getBoundingClientRect` on the mounted clone.
 *
 * @param {CloneHandoff} handoff
 * @returns {CloneCapture}
 * @throws when the hand-off carries no clone, or when the mounted clone cannot
 *   be measured — the engine has no second way to get a clone and will not
 *   quietly fall back to walking the live DOM, which is a different and worse
 *   capture.
 */
export function mountClone (handoff) {
  const { element, clone, nodeMap, styleMap, fontsCSS, classCSS } = handoff || {}
  if (!element || element.nodeType !== 1) {
    throw new Error('mountClone: the hand-off carries no live element')
  }
  if (!clone || clone.nodeType !== 1) {
    throw new Error(
      'mountClone: the capture handed over no clone. The `beforeRender` hook never ran, so the ' +
      'capture did not go through captureDOM — leave `burst` unset (the plugin suspends it) so a ' +
      'memoized URL is not served instead of a capture.'
    )
  }

  const prefix = classPrefixFrom(classCSS)
  const synthCSS = synthRulesFrom(clone, nodeMap, styleMap)

  // `fontsCSS` first: it is `@font-face` and has to be parsed before anything
  // that uses the families. All three go in ONE <style> so unmounting is one
  // removal, and the synthesized-node rules go last because nothing else in the
  // document says anything about those nodes.
  const style = document.createElement('style')
  style.setAttribute(MARK, 'clone-css')
  style.textContent = (fontsCSS || '') + prefix.css + synthCSS
  document.head.appendChild(style)

  const host = document.createElement('div')
  host.setAttribute(MARK, 'clone-host')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = HOST_CSS
  sizeHost(host, element)
  host.appendChild(clone)
  const isolatedRadios = isolateRadioGroups(clone)
  document.body.appendChild(host)

  let unmounted = false
  const unmount = () => {
    if (unmounted) return
    unmounted = true
    host.remove()
    style.remove()
  }

  // After mounting and before measuring: connecting the clone is what upgrades
  // its custom elements, and drift measured over their doubled boxes would be
  // measuring our own damage.
  let defused = []
  try {
    defused = defuseUpgradedShadowRoots(clone)
  } catch { /* leave them; paint.js files B4.unresolved-shadow-root on each */ }

  const restoredRootPaint = restoreRootPaint(element, clone)

  let drift
  try {
    drift = measureDrift(clone, element, nodeMap)
  } catch (error) {
    unmount()
    throw new Error(`mountClone: the mounted clone could not be measured: ${error && error.message}`)
  }

  return {
    clone,
    nodeMap,
    unmount,
    drift,
    classPrefixExact: prefix.exact,
    defusedShadowHosts: defused.length,
    restoredRootPaint,
    isolatedRadios,
  }
}

export default mountClone
