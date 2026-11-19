/**
 * What cloneNode cannot produce: shadow CSS flattened to a host-scoped, zero-specificity
 * <style> with slotted subtrees marked so a parent scope cannot pierce a child's (#488);
 * the <img> responsive choice frozen into `src`; same-origin <iframe> bitmaps; range,
 * checkbox and radio inputs as inline SVG (Firefox paints none in a foreignObject); blob:
 * URLs resolved to data: before the page can revoke them.
 * @module utils/clone.helpers
 */

import { debugWarn, getStyle } from './index.js'
import { cache, EvictingMap } from '../core/cache.js'
import { snapFetch } from '../modules/snapFetch.js'
import { colorToRgba, inlineAllStyles, invalidateSnapshotsUnder } from '../modules/styles.js'
import { splitTopLevel } from '../modules/styleScan.js'
import { findRealUrlForPicture, pickSrcsetCandidate, findLazySrcAttr, isPlaceholderSrc } from '../modules/pictureResolver.js'
import { markInternalNode } from './ownership.js'
import { isFirefox, isSafari } from './browser.js'

/** Add the current scope's slotted exclusion at the rightmost compound. */
function addNotSlottedRightmost(sel, scopeId) {
  sel = sel.trim()
  if (!sel) return sel
  const marker = scopeId ? `[data-sd-slotted~="${scopeId}"]` : '[data-sd-slotted]'
  if (sel.endsWith(':not([data-sd-slotted])') || sel.endsWith(`:not(${marker})`)) return sel
  return `${sel}:not(${marker})`
}

// A trailing pseudo-element (double-colon, or the four legacy single-colon ones). A colon
// escaped with a backslash is part of a class name (Tailwind's `.md\:after`), not a pseudo.
// The caller checks the backslash, since a lookbehind does not parse before Safari 16.4 (#567).
// Pinned by __tests__/module.styleScan.test.js.
const TRAILING_PSEUDO_RE = /::[a-zA-Z-]+(?:\([^)]*\))?$|:(?:before|after|first-letter|first-line)$/
// The pseudo pass inlines these as spans from the live element's computed style; a native
// copy in the scoped CSS would paint them twice.
const SPAN_PSEUDO_RE = /^::?(?:before|after|first-letter)$/

/**
 * Wrap a selector list in :where(scope ...) for zero specificity. A pseudo-element stays
 * OUTSIDE the wrapper, or the selector is invalid and the rule dropped. ::before, ::after
 * and ::first-letter belong to the pseudo pass, so their rule never matches.
 */
function wrapWithScope(selectorList, scopeSelector, excludeSlotted = true, scopeId) {
  // #503: commas inside :is/:not (or attribute strings) belong to one selector.
  // Splitting them can drop a closing ')' with an inlined pseudo-element and make
  // the browser consume every following rule, including all generated style classes.
  return splitTopLevel(selectorList, ',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      // Already rewritten by THIS rewriter (it carries the scope attr): leave it alone.
      // An author's own :where() DOES need scoping; without this it leaked into the light DOM.
      if (s.startsWith(':where(') && s.includes('data-sd')) return s

      let m = s.match(TRAILING_PSEUDO_RE)
      if (m && m[0][1] !== ':' && s[m.index - 1] === '\\') m = null
      if (m && SPAN_PSEUDO_RE.test(m[0])) return ':not(*)'
      const base = m ? s.slice(0, m.index).trim() : s
      const body = excludeSlotted ? addNotSlottedRightmost(base, scopeId) : base
      // Zero specificity for the whole selector:
      return `:where(${scopeSelector} ${body})${m ? m[0] : ''}`
    })
    .join(', ')
}

/**
 * Rewrite a shadow root's CSS to a flat, host-scoped form with specificity 0.
 * - :host(.foo)        => :where([data-sd="sN"]:is(.foo))
 * - :host              => :where([data-sd="sN"])
 * - :host-context(Y)   => :where(:where(Y) [data-sd="sN"])     (an approximation)
 * - ::slotted(X)       => :where([data-sd="sN"] X)              (slotted nodes not excluded)
 * - anything else      => :where([data-sd="sN"] .x:not([data-sd-slotted~="sN"]))
 * @param {string} cssText
 * @param {string} scopeSelector - e.g. [data-sd="s3"]
 * @param {string} scopeId - e.g. s3
 * @returns {string}
 */
export function rewriteShadowCSS(cssText, scopeSelector, scopeId) {
  if (!cssText) return ''

  // 1) :host-context(Y) before :host: `\b` sits between the `t` and the `-`, so the bare
  //    :host pass used to eat its head and leave `-context(Y)`, a selector the parser drops.
  cssText = cssText.replace(/:host-context\(([^)]+)\)/g, (_, sel) => {
    return `:where(:where(${sel.trim()}) ${scopeSelector})`
  })

  // 2) :host(.foo) and :host. `[^)]+` stops at the first `)` of `:host(:not(:first-child))`,
  //    and the leftover one closes the `:is(` it opened, so the output stays balanced.
  cssText = cssText.replace(/:host\(([^)]+)\)/g, (_, sel) => {
    return `:where(${scopeSelector}:is(${sel.trim()}))`
  })
  cssText = cssText.replace(/:host\b/g, `:where(${scopeSelector})`)

  // 3) ::slotted(X) becomes a descendant inside the scope, without excluding slotted nodes
  cssText = cssText.replace(/::slotted\(([^)]+)\)/g, (_, sel) => {
    return `:where(${scopeSelector} ${sel.trim()})`
  })

  // 4) For every "loose" selector block, wrap it in :where(scope …) and exclude only the
  //    slotted nodes of THIS scope on the rightmost compound.
  cssText = cssText.replace(/(^|})(\s*)([^@}{]+){/g, (_, brace, ws, selectorList) => {
    const wrapped = wrapWithScope(selectorList, scopeSelector, /*excludeSlotted*/ true, scopeId)
    return `${brace}${ws}${wrapped}{`
  })

  // 5) The first rule of a group (@supports, @container, @layer, @scope, a raw @media)
  //    follows a `{`, where step 4 never starts: unscoped, a shadow `p{…}` painted every light
  //    DOM <p>. A `;` stops it, since a nested group can open with declarations.
  //    Pinned by __tests__/regression.shadowHostStructural.test.js.
  cssText = cssText.replace(/(^|})(\s*@(?:supports|container|layer|scope|media)\b[^{};]*{\s*)([^@}{;]+){/g, (_, brace, head, selectorList) => {
    return `${brace}${head}${wrapWithScope(selectorList, scopeSelector, /*excludeSlotted*/ true, scopeId)}{`
  })

  return cssText
}

/**
 * Resolve @media at capture time: the SVG is its own tiny viewport, where a condition would
 * test the IMAGE size. Matching blocks inline unwrapped, recursively; the rest drop.
 * @supports keeps its wrapper; @container, @keyframes, @font-face and the rest pass verbatim.
 * Match @supports by TYPE: @container shares its conditionText.
 * @param {CSSRuleList} rules
 * @returns {string}
 */
export function resolveMediaQueries(rules) {
  let out = ''
  for (const rule of rules) {
    if (rule.media && rule.cssRules) { // CSSMediaRule
      let matches = false
      try { matches = window.matchMedia(rule.conditionText || rule.media.mediaText).matches } catch { }
      if (matches) out += resolveMediaQueries(rule.cssRules)
    } else if (rule.constructor?.name === 'CSSSupportsRule') {
      // constructor.name instead of instanceof: a rule from an iframe document belongs to
      // that window's CSSSupportsRule, so the parent realm's constructor never claims it.
      out += `@supports ${rule.conditionText}{${resolveMediaQueries(rule.cssRules)}}`
    } else if (rule.cssRules && rule.cssRules.length && /@media/i.test(rule.cssText)) {
      // Any other rule that can NEST (a nested style rule, @scope, @container): rebuild it so
      // an inner @media goes through this same resolution instead of into the SVG.
      const head = rule.cssText.slice(0, rule.cssText.indexOf('{') + 1)
      out += head + (rule.style ? rule.style.cssText : '') + resolveMediaQueries(rule.cssRules) + '}'
    } else {
      out += rule.cssText + '\n'
    }
  }
  return out
}

/**
 * Extract CSS text from a ShadowRoot: inline <style> plus adoptedStyleSheets (if readable),
 * with @media resolved against the live viewport. Each adopted sheet is read once per capture:
 * sixteen roots on one 5,000-rule sheet went from 60 ms to 9 ms (#558).
 * @param {ShadowRoot} sr
 * @param {WeakMap<CSSStyleSheet, string>} sheetText per-capture text of each adopted sheet
 * @returns {string}
 */
export function extractShadowCSS(sr, sheetText) {
  let css = ''
  try {
    sr.querySelectorAll('style').forEach(s => {
      let rules = null
      try { rules = s.sheet && s.sheet.cssRules } catch { /* unreadable */ }
      css += (rules ? resolveMediaQueries(rules) : (s.textContent || '')) + '\n'
    })
    // adoptedStyleSheets (may throw cross-origin; guard)
    const sheets = sr.adoptedStyleSheets || []
    for (const sh of sheets) {
      try {
        let text = sheetText.get(sh)
        if (text === undefined) sheetText.set(sh, text = sh.cssRules ? resolveMediaQueries(sh.cssRules) : '')
        css += text
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return css
}

/**
 * Inject a <style> as the first child of `hostClone` with rewritten CSS. Its `data-sd` holds
 * the host's shadow depth, the order prepare.js emits the blocks in (#558).
 * @param {Element} hostClone
 * @param {string} cssText
 * @param {number} depth shadow hosts above this one
 */
export function injectScopedStyle(hostClone, cssText, depth) {
  if (!cssText) return
  const style = document.createElement('style')
  style.setAttribute('data-sd', depth)
  style.textContent = cssText
  // prepend to ensure it wins over later subtree
  hostClone.insertBefore(style, hostClone.firstChild || null)
}

/**
 * Freeze the responsive choice of an <img> into `src` and drop `srcset`/`sizes`. Inside a
 * <picture>, ask pictureResolver: Chromium sets currentSrc after this point, not before.
 * The write-once rule below is pinned by __tests__/modules.images.dataUrlPassthrough.test.js.
 * @param {HTMLImageElement} original - Image in the live DOM.
 * @param {HTMLImageElement} cloned - Just-created cloned <img>.
 * @param {{resolvePicturePlaceholders?: boolean}} [options]
 */
export function freezeImgSrcset(original, cloned, options = {}) {
  try {
    // Element-level `content: url(...)` replaces the <img>'s rendered image and out-ranks
    // src/srcset in the browser's own resolution. The style snapshot neutralizes non-data
    // content URLs, so freeze the replacement image as the clone's src here.
    let contentUrl = null
    const rawContent = getStyle(original).content
    if (rawContent && rawContent.includes('url(')) {
      const m = rawContent.match(/url\(["']?([^"')]+)["']?\)/)
      if (m) contentUrl = m[1]
    }
    const picture = original.closest?.('picture')
    // A data: src without responsive candidates needs no resolution, and the
    // currentSrc/src GETTERS would re-serialize its megabytes. With srcset, though,
    // that attribute is only the fallback: freeze the image the browser selected.
    const rawSrc = original.getAttribute('src') || ''
    const srcset = original.getAttribute('srcset') || ''
    let chosen = contentUrl ||
      (picture ? findRealUrlForPicture(original, picture)
        : !srcset.trim() && rawSrc.startsWith('data:') ? rawSrc : original.currentSrc) ||
      // Chromium/Firefox leave currentSrc empty until the selected candidate has loaded,
      // so resolve candidates before falling back to src, even when src is present.
      pickSrcsetCandidate(srcset, original) || original.src || ''
    // Lazy-load placeholders (tiny data:/blob src, the real URL in data-src…) resolve on the
    // CLONE: swapping the live element flickered.
    if ((!chosen || isPlaceholderSrc(chosen)) && options.resolvePicturePlaceholders !== false) {
      const lazy = findLazySrcAttr(original)
      if (lazy) chosen = lazy
    }
    if (!chosen) return
    // Every src write re-parses the URL and starts a load, a full base64 decode for data:
    // (26 MB of gallery sources: ~40 ms for a value cloneNode already copied). Write on change.
    if (cloned.getAttribute('src') !== chosen) cloned.setAttribute('src', chosen)
    cloned.removeAttribute('srcset')
    cloned.removeAttribute('sizes')
    // Hint deterministic decode/load for capture
    cloned.loading = 'eager'
    cloned.decoding = 'sync'
  } catch { }
}

/**
 * Collect all custom properties referenced via var(--foo) in a CSS string.
 * @param {string} cssText
 * @returns {Set<string>} e.g. new Set(['--o-fill','--o-gray-light'])
 */
export function collectCustomPropsFromCSS(cssText) {
  const out = new Set()
  if (!cssText) return out
  const re = /var\(\s*(--[A-Za-z0-9_-]+)\b/g
  let m
  while ((m = re.exec(cssText))) out.add(m[1])
  return out
}

/**
 * Build a seed rule that initializes given custom props on the scope.
 * Placed before the rewritten shadow CSS so later rules (e.g. :hover) can override.
 * @param {Element} hostEl
 * @param {Iterable<string>} names
 * @param {string} scopeSelector e.g. [data-sd="s3"]
 * @returns {string} CSS rule text (or "" if nothing to seed)
 */
export function buildSeedCustomPropsRule(hostEl, names, scopeSelector) {
  const decls = []
  for (const name of names) {
    // The host's cascaded value, else the document root's.
    let val = ''
    try {
      val = getComputedStyle(hostEl).getPropertyValue(name).trim() ||
        getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    } catch { }
    if (val) decls.push(`${name}: ${val};`)
  }
  if (!decls.length) return ''
  return `${scopeSelector}{${decls.join('')}}\n`
}

/**
 * Mark a flattened slotted subtree with this shadow scope's token. Tokens compose when
 * nested slots are flattened, so parent CSS cannot pierce a child shadow tree while the
 * child's own CSS still applies to its internals (#488).
 * @param {Node} root
 * @param {string} [scopeId]
 */
export function markSlottedSubtree(root, scopeId) {
  if (!root) return
  const mark = (el) => {
    const value = el.getAttribute('data-sd-slotted') || ''
    if (!scopeId) {
      el.setAttribute('data-sd-slotted', value)
    } else if (!(` ${value} `).includes(` ${scopeId} `)) {
      el.setAttribute('data-sd-slotted', value ? `${value} ${scopeId}` : scopeId)
    }
  }
  if (root.nodeType === Node.ELEMENT_NODE) mark(root)
  root.querySelectorAll?.('*').forEach(mark)
}

const positive = (v) => (v = parseFloat(v)) > 0 ? v : 0

/**
 * Layout size before any ancestor transform: offsetWidth/Height first, then computed
 * width/height, then the width/height attributes, then naturalWidth/Height for images.
 * getBoundingClientRect returns the transformed box, and a replacement sized from it was
 * scaled a second time by the inherited transform (#321).
 * @param {Element} el
 * @returns {{width: number, height: number}} CSS px
 */
export function getUnscaledDimensions(el) {
  let width = el.offsetWidth > 0 ? el.offsetWidth : 0
  let height = el.offsetHeight > 0 ? el.offsetHeight : 0
  if (!width || !height) {
    const cs = getComputedStyle(el)
    width ||= positive(cs.width) || positive(el.getAttribute('width')) || positive(el.naturalWidth)
    height ||= positive(cs.height) || positive(el.getAttribute('height')) || positive(el.naturalHeight)
  }
  return { width, height }
}

/** Pin sheet per frame document, reused so its identity in `adoptedStyleSheets` is stable. */
const pinSheets = new WeakMap()

/**
 * Pin the iframe's internal viewport to (w, h) CSS px; returns the undo. The scroll state is
 * restored after, since `overflow: hidden` clamps it to 0 (#393). Body margin folds into its
 * padding, keeping the content inset while body carries the background (#448).
 * @param {Document} doc
 * @param {number} w
 * @param {number} h
 * @returns {() => void}
 */
export function pinIframeViewport(doc, w, h) {
  const win = doc.defaultView
  const sx = win ? win.scrollX : 0
  const sy = win ? win.scrollY : 0
  const bsl = doc.body ? doc.body.scrollLeft : 0
  const bst = doc.body ? doc.body.scrollTop : 0
  const hsl = doc.documentElement ? doc.documentElement.scrollLeft : 0
  const hst = doc.documentElement ? doc.documentElement.scrollTop : 0

  // Fold body margin into padding so content keeps its live inset while body fills the box.
  let pt = 0, pr = 0, pb = 0, pl = 0
  try {
    const cs = win && doc.body ? win.getComputedStyle(doc.body) : null
    if (cs) {
      pt = (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.paddingTop) || 0)
      pr = (parseFloat(cs.marginRight) || 0) + (parseFloat(cs.paddingRight) || 0)
      pb = (parseFloat(cs.marginBottom) || 0) + (parseFloat(cs.paddingBottom) || 0)
      pl = (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.paddingLeft) || 0)
    }
  } catch { }

  const css = `html {margin: 0 !important;padding: 0 !important;width: ${w}px !important;height: ${h}px !important;min-width: ${w}px !important;min-height: ${h}px !important;box-sizing: border-box !important;overflow: hidden !important;background-clip: border-box !important;}` +
    `body {margin: 0 !important;padding: ${pt}px ${pr}px ${pb}px ${pl}px !important;width: ${w}px !important;height: ${h}px !important;min-width: ${w}px !important;min-height: ${h}px !important;box-sizing: border-box !important;overflow: hidden !important;background-clip: border-box !important;}`
  // Adopted, so a frame CSP of `style-src 'self'` cannot refuse it. One sheet per document
  // keeps burst.js renderStateOf stable. Pinned by __tests__/snapdom.csp.test.js.
  let unmount
  try {
    let sheet = pinSheets.get(doc)
    if (!sheet) pinSheets.set(doc, sheet = new win.CSSStyleSheet())
    sheet.replaceSync(css)
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
    unmount = () => { doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(s => s !== sheet) }
  } catch {
    // Owned, or its mutation bumps the shared epoch and dirties the OUTER burst memo. The flag
    // is the `__pinned` option, never an attribute on <html>: a record there invalidates every
    // snapshot in every document. Pinned by __tests__/core.burst.nestedIframe.test.js.
    const style = doc.createElement('style')
    style.setAttribute('data-sd-iframe-pin', '')
    markInternalNode(style)
    style.textContent = css;
    (doc.head || doc.documentElement).appendChild(style)
    unmount = () => style.remove()
  }
  // The pin is deliberately invisible to the global style epoch, but it still changes used
  // values inside this document (notably percentages). Clear only this frame's snapshots so
  // a fresh nested capture cannot reuse geometry from the previous iframe size.
  invalidateSnapshotsUnder(doc.documentElement)

  // overflow:hidden resets the scroll offset, and a scrolled frame came out from its top. Put
  // the offset back on whichever box scrolls now; the nested capture compensates from there.
  if (sx || sy) {
    try {
      if (doc.body) { doc.body.scrollLeft = sx; doc.body.scrollTop = sy }
      if (doc.documentElement) {
        if (!doc.documentElement.scrollLeft) doc.documentElement.scrollLeft = sx
        if (!doc.documentElement.scrollTop) doc.documentElement.scrollTop = sy
      }
    } catch { }
  }

  return () => {
    try { unmount() } catch { }
    try {
      if (win && typeof win.scrollTo === 'function') win.scrollTo(sx, sy)
      if (doc.body) { doc.body.scrollLeft = bsl; doc.body.scrollTop = bst }
      if (doc.documentElement) { doc.documentElement.scrollLeft = hsl; doc.documentElement.scrollTop = hst }
    } catch { }
    // Do not leave snapshots computed under the temporary viewport pin available to a later
    // direct capture of this document.
    invalidateSnapshotsUnder(doc.documentElement)
  }
}

/**
 * The same-origin document a frame holds, or null. An <embed> exposes none, yet its browsing
 * context is one of the window's frames: a text/html embed captured as an empty box.
 * @param {Element} frame - an <iframe>, <object> or <embed>
 * @returns {Document|null}
 */
export function frameDocument(frame) {
  try {
    if (frame.localName !== 'embed') return frame.contentDocument || frame.contentWindow?.document || null
  } catch { return null }
  const win = frame.ownerDocument.defaultView
  for (let i = 0; win && i < win.length; i++) {
    try { if (win[i].frameElement === frame) return win[i].document } catch { /* cross-origin */ }
  }
  return null
}

/**
 * Rasterize a same-origin iframe at its content-box size: a toPng of its documentElement at
 * the iframe viewport (not the content height), in a wrapper styled like the <iframe> box.
 * Pinned by __tests__/utils.clone.iframe.test.js.
 * @param {HTMLIFrameElement} iframe
 * @param {object} sessionCache
 * @param {object} options
 * @returns {Promise<HTMLElement>}
 */
export async function rasterizeIframe(iframe, sessionCache, options) {
  let doc = frameDocument(iframe)
  for (let i = 0; i < 3 && !doc?.documentElement; i++) {
    await new Promise(r => setTimeout(r, 0))
    doc = frameDocument(iframe)
  }
  if (!doc?.documentElement) throw new Error('The iframe document isn\'t ready.')

  // The content box: the client rect minus the borders.
  const rect = iframe.getBoundingClientRect()
  const frame = getComputedStyle(iframe)
  const border = (side) => parseFloat(frame[`border${side}Width`]) || 0
  const contentWidth = Math.max(0, Math.round(rect.width - (border('Left') + border('Right'))))
  const contentHeight = Math.max(0, Math.round(rect.height - (border('Top') + border('Bottom'))))

  // main() threads the capture entrypoints as context.snap. Direct captureDOM/deepClone
  // callers must pass it.
  const snap = options?.snap
  if (!snap || typeof snap.toPng !== 'function') {
    throw new Error('Iframes are only captured through snapdom(el).')
  }

  // The parent decides the scale. No clip: 'viewport' would resolve against the frame's window.
  // `__pinned` captures at the pinned viewport, not scrollHeight (#449). `__styleShare` passes
  // the parent's verdict down.
  const nested = { ...options, scale: 1, clip: null, __pinned: true, __styleShare: sessionCache.styleShare }

  // Pin the viewport so the body background fills the content box (400x110 became 400x150).
  const unpin = pinIframeViewport(doc, contentWidth, contentHeight)
  // Every capture owns its session from its first synchronous tick (snapdom.capture), so the
  // nested one cannot disturb this one's maps. No save/restore.
  let imgEl
  try {
    imgEl = await snap.toPng(doc.documentElement, nested)
  } finally {
    unpin()
  }

  // Build <img> (bitmap) sized to content box
  imgEl.style.display = 'block'
  imgEl.style.width = `${contentWidth}px`
  imgEl.style.height = `${contentHeight}px`

  // Wrapper that preserves the iframe box (border, radius...) and clips
  const wrapper = document.createElement('div')
  sessionCache.nodeMap.set(wrapper, iframe)
  inlineAllStyles(iframe, wrapper, sessionCache, options)
  wrapper.style.overflow = 'hidden'
  // A frame is inline by default and stays in its line: as a block, the second of two frames
  // side by side dropped below the first. Any other display is the class's.
  if (getStyle(iframe).display === 'inline') wrapper.style.display = 'inline-block'
  // The computed size, in the box-sizing the wrapper's class holds. The border-box rectangle
  // written here made a bordered iframe wider and taller by its borders: as the capture root it
  // lost its right and bottom border, inside a page it pushed what follows.
  // Pinned by __tests__/utils.clone.iframe.box.test.js.
  const cs = getStyle(iframe)
  if (!wrapper.style.width) wrapper.style.width = cs.width
  if (!wrapper.style.height) wrapper.style.height = cs.height

  wrapper.appendChild(imgEl)
  return wrapper
}

// Checkbox/radio replacement (Firefox fix)

/**
 * What `accent-color: auto` paints with: the system colours (#560). On a dark page Chromium
 * paints #99c8ff under a Field mark while AccentColor stays #0075ff, and cannot take
 * light-dark() here, so the scheme is settled in JS. The blue comes first: Chromium 140, the
 * suite's, has no AccentColorText. Without the keywords, a blue every desktop UA ships.
 * @param {boolean} dark whether the control is in the dark colour scheme
 * @returns {{ fill: string, mark: string }}
 */
function resolveSystemAccent(dark) {
  if (dark && !isFirefox() && !isSafari()) return { fill: '#99c8ff', mark: 'Field' }
  if (!isColor('AccentColor') || !isColor('AccentColorText')) return { fill: '#0a6ed1', mark: 'white' }
  return { fill: 'AccentColor', mark: 'AccentColorText' }
}

/**
 * The tick or dot that reads on an authored accent: white, or black on a light one. Firefox
 * 160 switches where white's contrast with the accent falls under 2.4: a grey of 167 keeps
 * the white tick and 168 gets a dark one.
 * @param {string} accent a computed colour
 * @returns {string}
 */
function markOn(accent) {
  try {
    const linear = (channel) => {
      const c = channel / 255
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }
    const [r, g, b] = colorToRgba(accent)
    const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    return 1.05 / (luminance + 0.05) < 2.4 ? 'black' : 'white'
  } catch { return 'white' } // no canvas
}

/**
 * Whether the control is in the dark colour scheme: its color-scheme, or the page's
 * `<meta name="color-scheme">` when it has none, with the user's preference choosing between
 * `light dark`.
 * @param {CSSStyleDeclaration | undefined} cs computed style of the control
 * @returns {boolean}
 */
function usesDarkScheme(cs) {
  try {
    let scheme = (cs && cs.colorScheme) || ''
    if (!scheme || scheme === 'normal') scheme = document.querySelector('meta[name="color-scheme"]')?.content || ''
    if (!/\bdark\b/.test(scheme)) return false
    return !/\blight\b/.test(scheme) || matchMedia('(prefers-color-scheme: dark)').matches
  } catch { return false } // detached or cross-realm
}

/**
 * The control's colour scheme, as a declaration for the stand-in's own svg. The capture's base
 * rule for the tag resets color-scheme on every `<svg>`, the stand-in's included, and the system
 * colours it is painted in then resolve as on a light page: on a dark one an unchecked box
 * filled with Field came out white (Firefox 160).
 * @param {CSSStyleDeclaration | undefined} cs computed style of the control
 * @returns {string}
 */
function schemeOf(cs) {
  return `;color-scheme:${usesDarkScheme(cs) ? 'dark' : 'light'}`
}

/** Whether the engine takes `color` as a colour: an older one lacks some system colours. */
function isColor(color) {
  try { return CSS.supports('color', color) } catch { return false }
}

/**
 * The paints of a drawn control: `fill` when on, `mark` for the tick, dash or ring, `rim` for
 * the outline when off, `text` for the disabled grey. The rim is ButtonBorder in Firefox
 * only: Chromium's is black, so elsewhere it is the text colour.
 * @param {CSSStyleDeclaration | undefined} cs computed style of the control
 * @returns {{ fill: string, mark: string, rim: string, text: string }}
 */
function resolveAccent(cs) {
  let accent = ''
  let text = ''
  try {
    accent = (cs && cs.accentColor) || ''
    text = (cs && cs.color) || ''
  } catch { /* detached or cross-realm */ }
  const authored = accent && accent !== 'auto' && accent !== 'none'
  const { fill, mark } = authored ? { fill: accent, mark: markOn(accent) } : resolveSystemAccent(usesDarkScheme(cs))
  const rim = isFirefox() && isColor('ButtonBorder') ? 'ButtonBorder' : text || fill
  return { fill, mark, rim, text: text || fill }
}

/**
 * Draw a range input as inline SVG: track, filled run and thumb in the accent colour. Firefox
 * paints no native control in a foreignObject (0 accent-coloured pixels on a cloned slider).
 * Imported from @frostin/snapdom (element-mirror).
 * @param {HTMLInputElement} node - Source input
 * @returns {{ el: HTMLDivElement, applyVisual: () => void }}
 */
export function createRangeReplacement(node) {
  const { width: unscaledW, height: unscaledH } = getUnscaledDimensions(node)
  const rect = node.getBoundingClientRect()
  let cs
  try { cs = window.getComputedStyle(node) } catch { }
  const parsedW = cs ? parseFloat(cs.width) : NaN
  const parsedH = cs ? parseFloat(cs.height) : NaN
  const w = Number.isFinite(parsedW) && parsedW > 0
    ? parsedW
    : (unscaledW || rect.width || 128)
  const h = Number.isFinite(parsedH) && parsedH > 0
    ? parsedH
    : (unscaledH || rect.height || 16)

  // Where the value sits between min and max, from the live properties: a
  // dragged slider updates node.value and nothing in the DOM at all.
  const min = Number.parseFloat(node.min) || 0
  const max = Number.isFinite(Number.parseFloat(node.max)) ? Number.parseFloat(node.max) : 100
  const value = Number.parseFloat(node.value)
  const span = max - min
  const fraction = span > 0 && Number.isFinite(value)
    ? Math.min(1, Math.max(0, (value - min) / span))
    : 0.5

  // #311: preserve original vertical-align so the replacement doesn't shift inline layout
  let vAlign = 'middle'
  try { if (cs && cs.verticalAlign) vAlign = cs.verticalAlign } catch { }

  const box = document.createElement('div')
  box.setAttribute('data-snapdom-input-replacement', 'range')
  box.style.cssText = `display:inline-block;width:${w}px;height:${h}px;vertical-align:${vAlign};flex-shrink:0;line-height:0;`
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(w))
  svg.setAttribute('height', String(h))
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  // The thumb is thumb-sized however small the author made the control's box
  // (a styled slider is often a 4px-tall input), overflowing it the way the
  // native one does.
  svg.style.cssText = `width:${w}px;height:${h}px;overflow:visible${schemeOf(cs)}` // #516, as in the checkbox below
  box.appendChild(svg)

  function applyVisual() {
    const accent = resolveAccent(cs).fill
    const disabled = !!node.disabled
    const trackH = Math.max(2, Math.min(4, h))
    const trackY = (h - trackH) / 2
    const thumbD = Math.max(10, Math.min(14, Math.max(h, 10)))
    const r = thumbD / 2
    // The thumb's centre travels between the track's rounded ends, as the
    // native one keeps the thumb inside the control at either extreme.
    const cx = r + fraction * Math.max(0, w - thumbD)

    svg.innerHTML = ''
    const part = (x, width, fill, opacity) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      el.setAttribute('x', String(x))
      el.setAttribute('y', String(trackY))
      el.setAttribute('width', String(Math.max(0, width)))
      el.setAttribute('height', String(trackH))
      el.setAttribute('rx', String(trackH / 2))
      el.setAttribute('fill', fill)
      if (opacity) el.setAttribute('fill-opacity', opacity)
      svg.appendChild(el)
    }
    // Unfilled track first, in a translucent grey that reads on light and
    // dark alike, then the filled run laid over its left side.
    part(0, w, '#808080', '0.4')
    part(0, cx, accent)
    const thumb = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    thumb.setAttribute('cx', String(cx))
    thumb.setAttribute('cy', String(h / 2))
    // Firefox's thumb is grey inside a white rim, whatever the accent and the colour scheme
    // (Firefox 160). Only the run takes the accent.
    const firefox = isFirefox()
    thumb.setAttribute('r', String(firefox ? r - 1 : r))
    thumb.setAttribute('fill', firefox ? '#676774' : accent)
    if (firefox) {
      thumb.setAttribute('stroke', 'white')
      thumb.setAttribute('stroke-width', '2')
    }
    svg.appendChild(thumb)
    if (disabled) svg.setAttribute('opacity', '0.5')

    // Force dimensions (inlineAllStyles may copy width:0 from native input)
    box.style.setProperty('width', `${w}px`, 'important')
    box.style.setProperty('height', `${h}px`, 'important')
    box.style.setProperty('min-width', `${w}px`, 'important')
    box.style.setProperty('min-height', `${h}px`, 'important')
  }
  applyVisual()
  return { el: box, applyVisual }
}

/**
 * Creates a visual replacement for checkbox/radio inputs using inline SVG.
 * Firefox does not render native form controls inside SVG foreignObject; SVG-based
 * representation avoids CSS class conflicts and renders consistently.
 * @param {HTMLInputElement} node - Source input
 * @returns {{ el: HTMLDivElement, applyVisual: () => void }}
 */
export function createCheckboxRadioReplacement(node) {
  const { width: unscaledW, height: unscaledH } = getUnscaledDimensions(node)
  const rect = node.getBoundingClientRect()
  let cs
  try { cs = window.getComputedStyle(node) } catch { }
  const parsedW = cs ? parseFloat(cs.width) : NaN
  const parsedH = cs ? parseFloat(cs.height) : NaN
  const rw = Math.round(unscaledW || rect.width || 0)
  const rh = Math.round(unscaledH || rect.height || 0)
  let w = Number.isFinite(parsedW) && parsedW > 0 ? Math.round(parsedW) : Math.max(12, rw || 16)
  let h = Number.isFinite(parsedH) && parsedH > 0 ? Math.round(parsedH) : Math.max(12, rh || 16)
  const isCheckbox = (node.type || 'text').toLowerCase() === 'checkbox'
  // An indeterminate checkbox shows the dash whether or not it is checked as well.
  const indeterminate = isCheckbox && !!node.indeterminate
  const checked = !!node.checked && !indeterminate

  const size = Math.max(Math.min(w, h), 12)
  const s = size
  // #516: a flex column or a grid stretches the control across its track, and the engine
  // paints the glyph centered in that box; shrunk to the glyph, the box sat at the start
  // edge (93px left of the live control in a 200px column). The svg fills the box, and the
  // viewBox's default xMidYMid meet centers the glyph in it at scale 1.
  const bw = Math.max(w, s)
  const bh = Math.max(h, s)

  // #311: preserve original vertical-align so the replacement doesn't shift inline layout
  let vAlign = 'middle'
  try { if (cs && cs.verticalAlign) vAlign = cs.verticalAlign } catch { }

  const box = document.createElement('div')
  box.setAttribute('data-snapdom-input-replacement', node.type || 'checkbox')
  box.style.cssText = `display:inline-block;width:${bw}px;height:${bh}px;vertical-align:${vAlign};flex-shrink:0;line-height:0;`
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(bw))
  svg.setAttribute('height', String(bh))
  svg.setAttribute('viewBox', `0 0 ${s} ${s}`)
  // #516: sized by its attributes alone, Firefox painted it at twice the box under the
  // engine's layoutZoom (DPR 2: a 14px checkbox drew 28px over its label); CSS lengths zoom once.
  svg.style.cssText = `width:${bw}px;height:${bh}px${schemeOf(cs)}`
  box.appendChild(svg)

  function applyVisual() {
    const accent = resolveAccent(cs)
    // A disabled control drops its accent: the UA paints it in the grey it gives the control's
    // text. Dimmed like the slider above. :disabled matches inside a disabled fieldset too.
    const disabled = node.matches(':disabled')
    const color = disabled ? accent.text : accent.fill
    const mark = disabled ? 'white' : accent.mark
    const draw = (name, attrs) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', name)
      for (const key in attrs) el.setAttribute(key, String(attrs[key]))
      svg.appendChild(el)
    }
    // On, the accent fills the control to its edge. Off, a hairline runs around the field colour.
    const on = checked || indeterminate
    const inset = on ? 0 : 0.5
    const face = on
      ? { fill: color }
      : { fill: isColor('Field') ? 'Field' : 'none', stroke: accent.rim, 'stroke-width': 1 }
    svg.innerHTML = ''
    if (isCheckbox) {
      draw('rect', { x: inset, y: inset, width: s - inset * 2, height: s - inset * 2, rx: 2, ry: 2, ...face })
      if (checked) {
        // The tick grows with the box, as the UA's does: about an eighth of it thick.
        draw('path', {
          d: `M ${s * 0.2} ${s * 0.53} L ${s * 0.4} ${s * 0.72} L ${s * 0.78} ${s * 0.3}`,
          stroke: mark, 'stroke-width': Math.max(1.5, s * 0.12), fill: 'none',
          'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        })
      } else if (indeterminate) {
        // Firefox's dash is long and thin, Chromium's short and thick (Firefox 160, Chrome 157).
        const dw = s * (isFirefox() ? 0.82 : 0.6)
        const dh = isFirefox() ? Math.max(1, s / 16) : Math.max(2, s / 8)
        draw('rect', { x: (s - dw) / 2, y: (s - dh) / 2, width: dw, height: dh, fill: mark })
      }
    } else {
      draw('circle', { cx: s / 2, cy: s / 2, r: s / 2 - inset, ...face })
      // Firefox's checked radio: the accent to the edge, with a 2px ring of the mark colour
      // set 1px in. Neither grows with the control.
      if (checked) draw('circle', { cx: s / 2, cy: s / 2, r: s / 2 - 2, fill: 'none', stroke: mark, 'stroke-width': 2 })
    }
    if (disabled) svg.setAttribute('opacity', '0.5')
    // Force dimensions (inlineAllStyles may copy width:0 from native input)
    box.style.setProperty('width', `${bw}px`, 'important')
    box.style.setProperty('height', `${bh}px`, 'important')
    box.style.setProperty('min-width', `${bw}px`, 'important')
    box.style.setProperty('min-height', `${bh}px`, 'important')
  }
  applyVisual()
  return { el: box, applyVisual }
}

// Blob URL helpers

/** blob: URL to data URL, or the read still in flight. 80 entries, FIFO. */
var _blobToDataUrlCache = new EvictingMap(80)

/**
 * Read a blob: URL as a data URL, once per URL.
 * Two memos: cache.resource, shared with the other modules, and a local map that also holds
 * the in-flight promise so concurrent callers share one read. A failed read is dropped from
 * the local map so the next call can retry.
 * @param {string} blobUrl
 * @returns {Promise<string>} data URL
 */
export async function blobUrlToDataUrl(blobUrl) {
  // 1) shared cache
  if (cache.resource?.has(blobUrl)) return cache.resource.get(blobUrl)

  // 2) local memo (a promise or the resolved string)
  if (_blobToDataUrlCache.has(blobUrl)) return _blobToDataUrlCache.get(blobUrl)

  // 3) start the read and park the promise for dedupe
  const p = (async () => {
    const r = await snapFetch(blobUrl, { as: 'dataURL' })
    if (!r.ok || typeof r.data !== 'string') {
      throw new Error(`Couldn't read ${blobUrl}`)
    }
    cache.resource?.set(blobUrl, r.data)   // shared cache
    return r.data
  })()

  _blobToDataUrlCache.set(blobUrl, p)
  try {
    const data = await p
    // Swap the promise for the resolved string: less to retain
    _blobToDataUrlCache.set(blobUrl, data)
    return data
  } catch (e) {
    // Drop the failure so a later call can retry
    _blobToDataUrlCache.delete(blobUrl)
    throw e
  }
}

var BLOB_URL_RE = /\bblob:[^)"'\s]+/g

function isBlobUrl(u) {
  return typeof u === 'string' && u.startsWith('blob:')
}

function parseSrcset(srcset) {
  return (srcset || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const m = item.match(/^(\S+)(\s+.+)?$/)
      return m ? { url: m[1], desc: m[2] || '' } : null
    })
    .filter(Boolean)
}

function stringifySrcset(parts) {
  return parts.map((p) => (p.desc ? `${p.url} ${p.desc.trim()}` : p.url)).join(', ')
}

/**
 * querySelectorAll plus the root itself: `snapdom(imgEl)` on a blob: src was left to the
 * later passes, which lose to a caller that revokes the URL right after the call (#461 is the
 * same shape in images.js).
 * @param {Element} root
 * @param {string} selector
 * @returns {Element[]}
 */
function selfAndDescendants(root, selector) {
  const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll(selector)) : []
  if (root.matches?.(selector)) nodes.unshift(root)
  return nodes
}

/**
 * Replace every blob: URL in the clone with a data URL: <img> src and srcset, SVG <image>
 * href, inline styles, <style> text and <video> poster. Runs in prepareClone, ahead of the
 * asset passes, because a caller that revokes right after calling snapdom would beat them.
 * A URL that fails to read is logged under `debug` and left as it is.
 * @param {Element} root - the clone
 * @param {object|null} [sessionCache] - read for `options.debug`
 * @returns {Promise<void>}
 */
export async function resolveBlobUrlsInTree(root, sessionCache = null) {
  if (!root) return
  // Collect UNIQUE URLs first, then read with four readers: overlapped, without decoding a
  // whole gallery at once. blobUrlToDataUrl dedupes in-flight reads across callers.
  const urls = new Set()
  const writes = []
  const resolved = new Map()
  const queueAttribute = (node, name, url, after) => {
    urls.add(url)
    writes.push(() => {
      if (!resolved.has(url)) return
      node.setAttribute(name, resolved.get(url))
      after?.()
    })
  }
  const queueCSS = (css, apply) => {
    if (!css || !css.includes('blob:')) return
    const matches = css.match(BLOB_URL_RE) || []
    if (!matches.length) return
    for (const url of matches) urls.add(url)
    writes.push(() => {
      // Replace complete tokens, not split/join prefixes: blob:x and blob:x-long can
      // coexist and must never rewrite part of each other's URLs.
      const out = css.replace(BLOB_URL_RE, url => resolved.get(url) || url)
      if (out !== css) apply(out)
    })
  }

  for (const img of selfAndDescendants(root, 'img')) {
    const effective = img.getAttribute('src') || img.currentSrc || ''
    if (isBlobUrl(effective)) queueAttribute(img, 'src', effective)
    const srcset = img.getAttribute('srcset')
    if (srcset && srcset.includes('blob:')) {
      const parts = parseSrcset(srcset)
      for (const p of parts) {
        if (isBlobUrl(p.url)) urls.add(p.url)
      }
      writes.push(() => {
        let changed = false
        for (const p of parts) {
          if (!resolved.has(p.url)) continue
          p.url = resolved.get(p.url)
          changed = true
        }
        if (changed) img.setAttribute('srcset', stringifySrcset(parts))
      })
    }
  }

  const XLINK_NS = 'http://www.w3.org/1999/xlink'
  for (const node of selfAndDescendants(root, 'image')) {
    const href = node.getAttribute('href') || node.getAttributeNS?.(XLINK_NS, 'href')
    if (isBlobUrl(href)) queueAttribute(node, 'href', href, () => node.removeAttributeNS?.(XLINK_NS, 'href'))
  }
  for (const el of selfAndDescendants(root, "[style*='blob:']")) {
    queueCSS(el.getAttribute('style'), replaced => el.setAttribute('style', replaced))
  }
  for (const s of selfAndDescendants(root, 'style')) {
    queueCSS(s.textContent || '', replaced => { s.textContent = replaced })
  }
  for (const n of selfAndDescendants(root, "[poster^='blob:']")) queueAttribute(n, 'poster', n.getAttribute('poster'))
  if (!urls.size) return
  const pending = [...urls]
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (next < pending.length) {
      const url = pending[next++]
      try { resolved.set(url, await blobUrlToDataUrl(url)) } catch (e) {
        debugWarn(sessionCache, 'Couldn\'t read a blob: URL; kept it as is.', e)
      }
    }
  }))
  for (const write of writes) write()
}

// Font inflation (Firefox for Android)

/** The computed properties that decide a word's advance, copied onto the probe. */
const INFLATION_FONT_PROPS = ['font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-variant', 'font-feature-settings', 'font-variation-settings', 'font-kerning', 'letter-spacing', 'text-transform']
/** Inputs that paint their value as text. A password paints bullets instead. */
const VALUE_FIELDS = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'submit', 'reset', 'button'])
/** A field word to measure between character centers: two or more characters, none of them
 *  half a surrogate pair. */
const FIELD_WORD = /[^\s\uD800-\uDFFF]{2,}/

/**
 * Write the font size Firefox for Android's font inflation paints onto the clones (#516).
 * getComputedStyle reports the authored size and the foreignObject never inflates, so the
 * size is measured against a probe under a zero-width box, where inflation is off. A field
 * with no value, a <select> or off screen keeps the authored size: nothing can read it.
 * Pinned by __tests__/snapdom.issue516.test.js.
 * @param {Map<Node, Node>} nodeMap - clone to source, from deepClone
 * @param {Document} [doc]
 */
export function freezeInflatedFontSizes(nodeMap, doc = document) {
  const view = doc.defaultView || window
  if (!isFirefox() || !doc.body ||
    !(view.visualViewport?.scale < 1 || view.screen.width < doc.documentElement.clientWidth)) return
  /* c8 ignore start -- Firefox font inflation only; coverage runs on chromium */
  // Owned, so mounting it does not bump the style epoch the snapshot memo is keyed on.
  const probe = markInternalNode(doc.createElement('div'))
  probe.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden'
  const jobs = []
  for (const [clone, src] of nodeMap) {
    if (clone.nodeType !== 1 || src.nodeType !== 1) continue
    const cs = view.getComputedStyle(src)
    const found = src.localName === 'textarea' || (src.localName === 'input' && VALUE_FIELDS.has(src.type))
      ? fieldWord(src, cs, doc)
      : textWord(src, cs.textAlign === 'justify' || cs.textAlignLast === 'justify')
    if (!found) continue
    // An ancestor transform scales the live distance and not the probe's.
    const box = src.getBoundingClientRect()
    const scale = src.offsetWidth && box.width ? box.width / src.offsetWidth : 1
    const span = doc.createElement('span')
    span.style.whiteSpace = 'pre'
    for (const p of INFLATION_FONT_PROPS) span.style.setProperty(p, cs.getPropertyValue(p))
    span.textContent = found.word
    probe.appendChild(span)
    jobs.push({ clone, cs, span, live: found.distance / scale, centers: found.centers, height: found.height })
  }
  if (!jobs.length) return
  doc.body.appendChild(probe)
  try {
    for (const { clone, cs, span, live, centers, height } of jobs) {
      const text = span.firstChild
      // letter-spacing is not inflated: it follows every character, the last one included.
      const spacing = (parseFloat(cs.letterSpacing) || 0) * (centers ? text.length - 1 : text.length)
      const range = height ? doc.createRange() : null
      if (range) range.selectNodeContents(span)
      const ref = height ? range.getBoundingClientRect().height : centers
        ? Math.abs(centerOf(text, text.length - 1) - centerOf(text, 0))
        : span.getBoundingClientRect().width
      let ratio = (live - (height ? 0 : spacing)) / (ref - (height ? 0 : spacing))
      if (!(ratio > 1.005 && Number.isFinite(ratio))) continue
      if (height) {
        // Justification expands Range widths, not glyph heights. Firefox rounds glyph
        // heights to pixels, so find the middle of the matching font-size interval
        // instead of amplifying that rounding through a height ratio.
        const bounds = []
        for (const strict of [false, true]) {
          let lo = parseFloat(cs.fontSize), hi = lo * (ratio + 1)
          for (let i = 0; i < 10; i++) {
            const mid = (lo + hi) / 2
            span.style.fontSize = `${mid}px`
            const h = range.getBoundingClientRect().height
            if (strict ? h > live : h >= live) hi = mid
            else lo = mid
          }
          bounds.push((lo + hi) / 2)
        }
        ratio = (bounds[0] + bounds[1]) / 2 / parseFloat(cs.fontSize)
      }
      clone.style.setProperty('font-size', `${parseFloat(cs.fontSize) * ratio}px`)
      if (cs.lineHeight !== 'normal') clone.style.setProperty('line-height', `${parseFloat(cs.lineHeight) * ratio}px`)
    }
  } finally {
    probe.remove()
  }
  /* c8 ignore stop */
}

/* c8 ignore start -- helpers of freezeInflatedFontSizes, Firefox only */
/** Horizontal center of character `i` of a text node, in page pixels. */
function centerOf(text, i) {
  const range = text.ownerDocument.createRange()
  range.setStart(text, i)
  range.setEnd(text, i + 1)
  const r = range.getBoundingClientRect()
  return r.left + r.width / 2
}

/**
 * The first word of `el`'s own text and its live width (height for justified text).
 * @param {Element} el
 * @param {boolean} [height]
 * @returns {{word: string, distance: number, centers: boolean, height: boolean}|null}
 */
function textWord(el, height = false) {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 3) continue
    const m = /\S+/.exec(n.data)
    if (!m) continue
    const range = el.ownerDocument.createRange()
    range.setStart(n, m.index)
    range.setEnd(n, m.index + m[0].length)
    const rects = range.getClientRects()
    // A word broken across lines (overflow-wrap) has no single width to compare.
    return rects.length === 1 ? { word: m[0], distance: height ? rects[0].height : rects[0].width, centers: false, height } : null
  }
  return null
}

/**
 * The same for the first line of a field's value, read through caret hit-testing: Firefox
 * paints the value in content no Range reaches. The caret passes offset i + 1 at the center of
 * character i. Null when the field is scrolled or not hit-testable where it sits.
 * @param {HTMLInputElement|HTMLTextAreaElement} el
 * @param {CSSStyleDeclaration} cs
 * @param {Document} doc
 * @returns {{word: string, distance: number, centers: boolean}|null}
 */
function fieldWord(el, cs, doc) {
  const m = FIELD_WORD.exec(el.value.split('\n')[0])
  if (!m || el.scrollLeft || el.scrollTop || !doc.caretPositionFromPoint) return null
  const r = el.getBoundingClientRect()
  const y = el.localName === 'textarea'
    ? r.top + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0) + 3
    : r.top + r.height / 2
  const at = (x) => {
    const p = doc.caretPositionFromPoint(x, y)
    return p && p.offsetNode === el ? p.offset : -1
  }
  // Coarse steps find a bracket (the offset only grows along the line), halving narrows it.
  const step = r.width / 16
  const edge = (k) => {
    let hi = r.left
    while (hi <= r.right && at(hi) < k) hi += step
    if (hi > r.right) return NaN
    let lo = hi - step
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2
      if (at(mid) >= k) hi = mid
      else lo = mid
    }
    return hi
  }
  const distance = Math.abs(edge(m.index + m[0].length) - edge(m.index + 1))
  return Number.isFinite(distance) ? { word: m[0], distance, centers: true } : null
}
/* c8 ignore stop */
