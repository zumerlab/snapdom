# Internal build contract — snapdom vector v0

**This file is normative for every module in `packages/svd`, `packages/vector` and
`packages/figma-plugin` — which, since 2026-08-28, is everything in this
repository.** The PDF product and the LVGL one left for repositories of their own;
what remains here is one product line: the format, the plugin that produces it, and
the plugin that reads it. Signatures here are fixed. If a module needs something
this contract does not provide, that is a contract bug — say so in your output
rather than inventing a second way to get it.

**And the reverse duty, which is what this paragraph is for: a contract that
lies is worse than no contract.** When this file described a shape the code no
longer had, three consumers each invented their own probe list for the gradient
`unit` keys (`from || start || p0`); two were right by accident and the Figma
plugin was wrong, which flattened every linear gradient to top-to-bottom. The
same failure repeated with `decoration`, read as an object when it had become an
array — every underline in the document came out as NONE. Change the code and
this file in the same pass, or the next reader builds on the older of the two.
Last reconciled against the source: 2026-08-05 (text emitters, effect vocabulary,
`emit/*` signatures).

## Scope: the engine walks snapdom's CLONE, not the live DOM

This is the founding decision and it is not an implementation detail.

The engine is a **snapdom plugin**. The caller writes the `snapdom()` call and
registers us on it; our `beforeRender` hook takes the clone off the hook state, and
the `toVector()` / `toVectorSvg()` exports we publish through `defineExports()` mount
that clone offscreen and walk **that**.

```js
import { snapdom } from '@zumer/snapdom'          // v3, local repo
import { vector, svdToSvg } from '@zumer/snapdom-vector'

const result = await snapdom(el, { plugins: [vector({ mode: 'design' })] })
const doc = await result.toVector()               // SVD document
const svg = await result.toVectorSvg()            // ...or straight to markup
```

There is no `toVector(element)`, and there must not be one again — see
[Why a plugin, and not a hook in the core](#why-a-plugin-and-not-a-hook-in-the-core)
below. `svdToSvg` / `svdToFigma` stay module-level functions because they are
document→format, not capture APIs: give them a document and they need no DOM.

The clone is where snapdom has already done the ugly
half of the job: pseudo-elements materialised into real `<span>`s, shadow DOM
flattened with its CSS rewritten, icon fonts resolved to `<img>`, backgrounds and
images inlined past CORS, `backdrop-filter` pre-composed, scroll applied as a
translate. Membership in the tree is *solved*; only geometry and paint are ours.

**Measured, not assumed** (`test/_clonemetrics.mjs`, nine fixtures across two demo
pages plus `test/fixtures/scrolldrift.html`): the mount reproduces the live layout
with a delta of **0.00px** — median, p95 and max, across every mapped node. There is
no accuracy argument for preferring the live DOM, and the clone additionally carries
boxes for nodes the live DOM does not have at all.

That number is the *output* of four repairs, not a property of mounting. Borrowing
the page's cascade is what makes the clone faithful, and every way it fails comes
from the same place — the page's selectors were not written for a tree that sits
somewhere else, gained nodes, and connects custom elements on arrival. Each repair
lives in `adapters/snapdom.js` with the drift it removed:

| what breaks | repair | was |
|---|---|---|
| host has no width; a `width:auto` root shrink-wraps | `sizeHost` | 628px |
| nothing styles a node snapdom invented (`::before` at 0×0) | `synthRulesFrom` | 18px |
| a scroll wrapper breaks every `>` chain crossing it, whole subtree | `synthRulesFrom` | 268px |
| connecting the clone upgrades custom elements, re-attaching shadow roots | `defuseUpgradedShadowRoots` | 37.72px |

The snapshot rules go **only** to nodes the page cannot reach. Applying snapdom's
whole `classCSS` on top of the page's cascade is worse than applying none of it:
measured, fx-table's pixel diff went 1.83 → 10.25 and a paragraph re-wrapped.

Mount in the LIGHT dom, never a shadow root: Chromium ignores `@font-face` inside
one, and a clone laid out with substituted fonts measures nothing useful.

`nodeMap` (clone → source) stays available and is what a harness uses to assert the
clone has not drifted. It is a check, not the data path.

## Why a plugin, and not a hook in the core

This section exists so nobody re-derives the hook. It has been invented twice.

The history: an early revision had the engine walking the **live DOM**, because
snapdom's internal hand-off (`__retain`, which burst's differential recapture uses to
keep a clone alive) was not reachable from outside — `createContext` is an allowlist
and silently drops any callback a caller passes. The fix at the time was to widen the
allowlist: a public `retain` option, committed to snapdom v3 as `2c9d22c`.

**That commit is reverted.** The access it added already existed. `snapdom(el, {
plugins: [...] })` runs render hooks, and a render hook is handed the clone — the same
clone, one line earlier in the same function. `retain` bought nothing a plugin could
not already do, and it charged for it in public surface: once `retain` is in the
allowlist it is a documented capability the core owes every caller forever, and the
private `__retain` channel it shadowed is an implementation detail of burst that
should stay private. So the core is untouched, and the engine is a plugin.

Four things that decision fixes on the way past, each of which the loose API had to
work around by hand:

- **`burst` no longer has to be forced off.** The old API passed `burst: false` on
  every call, because burst's memo and differential paths answer with a URL without
  re-entering `captureDOM`, so there would be no clone. A plugin with render hooks
  that does not declare `pure: true` suspends auto-burst by construction
  (`snapdom/src/core/plugins.js`, `hasImpureRenderPlugins`). Measured: five
  back-to-back captures of one element all ran the pipeline; the loose API broke at
  the third. **Omitting `pure` is therefore load-bearing, not an oversight.**
- **One capture, not two.** The loose API made its own `snapdom()` call, so a caller
  who wanted a PNG *and* an SVD paid for two full captures. Now both come off one.
- **`toVector`, not `toSvg`.** `buildResult` derives the helper name from the export
  key, and plugin exports override core exports by name (`{...coreExports,
  ...provided}`). Publishing `svg` would have silently replaced `result.toSvg()` for
  every caller of that capture. Hence `vector` / `vectorSvg` → `result.toVector()` /
  `result.toVectorSvg()`.
- **The caller owns the capture options.** `dpr`, `outerTransforms` and `burst` are
  all read before the first hook runs and **cannot** be forced from a plugin. That is
  not a loss of control — it is where the control belongs now. `outerTransforms:false`
  shows up as measured drift and gets filed, rather than being silently prevented.

Two prices, both paid deliberately:

- `report.timings.snapdomMs` is gone. It was only ever measurable while the engine
  made the `snapdom()` call itself. The caller makes it now, so the caller is what can
  hold a stopwatch — `demo/vector.html` times both halves and still shows the split.
- `classPrefixCSS` is the one capture value no hook sees. It is recovered inside the
  plugin by `classPrefixFrom` (`adapters/snapdom.js`), which cuts it out of `classCSS`
  anchored on the exact suppressor literal plus the `[data-sd-pN]::marker` grammar —
  verified byte-identical to snapdom's own on 14/14 fixtures. If the anchor ever moves
  it falls back to the literal and files `capture.clone-css-partial` rather than
  guessing.

## Module signatures

All modules are ESM, `.js`, no TypeScript, no build step. JSDoc for types.
Files under `src/css/` MUST be importable from Node with no DOM access.

### `packages/svd/src/schema.js`

```js
/** @returns {{ok: boolean, errors: string[]}} */
export function validate (doc)
/** @returns {string[]} errors, empty if valid */
export function validateNode (node, id)
```

Strict: reject, never repair. Checks structural invariants (every `children` id
exists in `nodes`, `root` resolves, every node has `frame` and `abs` and
`fidelity.grade`, every non-`E` grade has a matching `diagnostics` entry, colors
are 4-float arrays in 0..1, `paint.z` is an integer).

**The effect vocabulary is closed and lives here**, because "what can an effect
be" is the question every backend answers differently:

```
dropShadow | innerShadow   {color, offset:[x,y], blur, spread, behind}
layerBlur  | backgroundBlur {blur}
colorMatrix                {values: 20 floats, srcCss: string, backdrop: boolean}
```

`colorMatrix` is the one that is not a blur and does not carry one: it is the
4x5 of `feColorMatrix type="matrix"`, row-major, composing the run of colour
functions (`saturate`, `hue-rotate`, `grayscale`, `sepia`, `invert`, `contrast`,
`brightness`) that `collect/box.js` (`colorMatrixOf`) folded together. `srcCss`
is REQUIRED and is that CSS chain verbatim — a backend that cannot paint the
matrix can still name what it dropped, and a diagnostic that cannot name the
function is not much of a diagnostic. `backdrop` distinguishes `filter` from
`backdrop-filter`: the two recolour different pixels.

### `packages/vector/src/css/color.js`

```js
/** Any CSS color string -> [r,g,b,a] floats 0..1 sRGB. Null if unparseable. */
export function parseColor (css)            // => {rgba: [r,g,b,a], srcCss: string} | null
/** [r,g,b,a] -> "#rrggbb" / "rgba(...)" for SVG output. */
export function toCssString (rgba)
export function isTransparent (rgba)        // => boolean (a === 0)
```
Must handle: hex 3/4/6/8, `rgb()`/`rgba()` legacy and space-separated, `hsl()`/`hsla()`,
named colors, `transparent`, `currentColor` (caller passes resolved value),
and `oklch()`/`lab()`/`color()` by round-tripping through a canvas 2D context when a
DOM is present, falling back to a documented approximation when not. Gamut-map by
chroma reduction, never per-channel clipping.

### `packages/vector/src/css/gradient.js`

```js
/**
 * @param {string} css   one background-image layer, e.g. "linear-gradient(...)"
 * @param {{w:number,h:number}} box  the painting box in px
 * @returns {Paint|null}  null when the layer is not a gradient
 */
export function parseGradient (css, box)
```
Emits `{type:'linear'|'radial'|'angular', unit:{...}, transform:[a,b,c,d,e,f], stops:[...], notes:[]}`.

**`unit` keys are normative — do not guess them downstream.** Leaving them
undefined already cost us: three consumers each invented their own probe list
(`from||start||p0`), two were right by accident and the Figma plugin was wrong,
which silently flattened every linear gradient to top-to-bottom.

```js
linear:  { p0: [x, y], p1: [x, y] }          // unit square, gradient line endpoints
radial:  { center: [x, y], radius: [rx, ry] | r, shape: 'circle'|'ellipse' }
angular: { center: [x, y], startAngle: deg } // CW from 12 o'clock
```

`radius` is a PAIR or a single number. `css/gradient.js` normalizes anisotropy
into `transform` and so writes the scalar; `svd/src/schema.js` accepts both and
every emitter reads a bare `r` as `[r, r]`, which is what it means. This is the
contract, not a divergence from it — do not "fix" one side without the other.

A stop is `{ t, color: [r,g,b,a], srcCss }` with `t` in 0..1, monotonic.
`transform` is the SVG-order 2x3 `[a,b,c,d,e,f]` taking unit space to painted px.

`angular` is the one asymmetry: a conic's angles are real screen angles, so its
matrix must stay a uniform similarity and the rotation lives in `unit.startAngle`.
The emitter composes it; the matrix never carries it.
Geometry normalized to the unit square; anisotropic ellipses absorbed into the matrix.
Color-stop hints resampled to 8–16 stops. `transparent` replaced by `rgba(R,G,B,0)`
of the neighbouring stop (this fixes premultiplication artifacts). `repeating-*`
unrolled up to K=64. Record every approximation in `notes`.

### `packages/vector/src/css/shadow.js`

```js
/**
 * @param {string} css
 * @param {{inset?: boolean, currentColor?: string}} [options]
 * @returns {{shadows: Effect[], warnings: string[]}}
 */
export function parseShadows (css, { inset = true, currentColor } = {})
```
`{type:'dropShadow'|'innerShadow', color:[r,g,b,a], offset:[x,y], blur, spread, behind:false}`.
Multiple comma-separated shadows, in CSS order. `blur` is the CSS radius verbatim.
`warnings` is a RETURNED array, never a property hung off the list: a caller that
destructures the shadows must not be able to drop the reasons by accident. A
shadow that names no color *is* `currentColor`, and only the caller knows it —
pass `cs.color` or the shadow comes out declared-black.

### `packages/vector/src/css/radius.js`

```js
/** @returns {[[number,number],[number,number],[number,number],[number,number]]} tl,tr,br,bl as [rx,ry] */
export function parseRadii (cs, w, h)
```
Percentages resolved against the box. **Apply the CSS overlap scale factor `f`**
(CSS Backgrounds §5.5) when adjacent radii exceed a side.

### `packages/vector/src/css/matrix.js`

```js
/** @returns {{m:[a,b,c,d,e,f], decomposed:{tx,ty,rot,sx,sy,skewX}}|null} */
export function parseTransform (cssTransform, cssOrigin, w, h)
export function multiply (m1, m2)
export function applyToPoint (m, x, y)
```
`rot` in degrees clamped to -180..180. `null` for `none`. 3D transforms return the
flattened 2D projection and the caller emits a diagnostic.

### `packages/vector/src/collect/box.js`

```js
/**
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs   already-computed style for `el`
 * @param {CollectCtx} [ctx]
 * @returns {{fills:Paint[], strokes:Stroke[], effects:Effect[], textEffects:Effect[],
 *            clip:Clip|null, mask:object|null, radii, opacity:number, blend:string,
 *            warnings:Array<string|{code,grade,severity,message}>}}
 */
export function collectBox (el, cs, ctx = {})
/** A background layer's painted rect, given its placement and the asset's intrinsic size. */
export function resolveLayerRect (placement, intrinsic = null)
```
`textEffects` is `text-shadow`: it paints the GLYPHS, so it cannot ride in
`effects` (which filters the box) and the caller hands it to the block's text
node. `mask` is the collected `mask-image` layers — a paint, not a node, and the
schema's `mask` is a reference to a node, so `wireMasks` in `index.js` builds
that node and writes `node.mask = {node, type}`. Both are inert until such a
caller exists and both say so in `warnings`.

Background layers -> `fills` in **reverse CSS order** (CSS paints last layer first).
Coalesce: N background layers sharing a `clipBox` become N entries in one node's
`fills` array, not N nodes. Uniform borders -> one stroke with per-side weights.
Per-side differing colors -> `warnings` + caller composes.

### `packages/vector/src/collect/text.js`

```js
/**
 * @param {Element} blockEl  an element with a text-carrying inline formatting context
 * @param {CollectCtx} ctx
 * @returns {{characters:string, lines:Line[], runs:Run[], pitch:number,
 *            align:string, direction:string, styles:Record<string,TextStyle>,
 *            sourceText:string,
 *            warnings:Array<string|{code,grade,severity,message}>}|null}
 */
export function collectText (blockEl, ctx)
```

**This is the hard one. The rules are not negotiable:**

- `TreeWalker(SHOW_TEXT)` per block. **Never** `selectNodeContents` on a container
  with inline children — it returns duplicate rects (12 for 7 runs). **Never**
  per-character: measured 95ms/35k chars vs 4.1ms for 5600 nodes.
- `Range.getClientRects()` returns the font's ascent+descent box, **not** the CSS
  line box. Baseline is `rect.top + ctx.measureText('Hxg').fontBoundingBoxAscent`.
- **Group rects into lines by baseline** (0.5px tolerance), **never by `top`** — a
  larger-`font-size` span shares a baseline but not a top.
- `pitch` is **measured** between consecutive baselines. Never read from CSS
  `line-height`.
- Never scale metrics between sizes: Chromium rounds `fontBoundingBox*` to integers
  per size.
- Whitespace collapsing means DOM offsets != rendered offsets. Build the run map on
  the **rendered** string. NBSP does not collapse.
- `characters` joins visual lines with ` ` (LSEP). **Never `\n`** — that creates
  a paragraph and triggers `paragraphSpacing` in Figma.
- `sourceText` holds the pre-`text-transform` original, the SAME LENGTH as
  `characters` and indexed identically — a transform that changed the length is
  refused and reported instead.
- **Every number in `lines` is in the block's OWN units**: an axis-aligned scale
  between the block and the capture root is divided out, because the node these
  lines land on carries that transform and would apply it again. The known gap:
  under a ROTATION the lines are measured on the block's AABB, which is the
  bounding box of a quad and cannot be undone from here. `emit/svg-flat.js`
  inverts it exactly (`unbbox`, `emit.svg.text-unbboxed`); a backend that does not
  must not compensate twice.
- `Line = {i, start, end, x, w, baseline, asc, desc, frags?, spans?, words?, hyphen?}`.
  `w` is the sum of the painted glyph advances, **not** the bbox:
  - `frags:[{x,w,start,end}]` — present only when something that is not a
    character (an inline image, a float) splits the line into two or more painted
    stretches. They tessellate `[start, end)` left to right and are the only place
    the hole is visible. A consumer that ignores `frags` and stretches the line to
    `w` squeezes the glyphs.
  - `words:[{x,w,start,end}]` (2026-08-13) — measured anchor per word, written
    only for `text-align: justify` blocks (every line of one, last included) and
    only where trustworthy: axis-aligned chain, no RTL, two or more words. Unlike
    `frags` they do NOT tessellate — the gaps between them are the space
    characters, which belong to no word — and justification is the reason they
    exist: the slack goes into the word gaps, so no advance arithmetic can place
    a word. One Range measurement per word, paid only on justified blocks. A
    consumer that anchors each word at its `x` reproduces the justification
    exactly; one that ignores `words` falls back to the `textLength` tier below.
  - `spans:[{start,end,x,w}]` — the painted extent of each STYLE stretch on the
    line, one entry per contiguous piece, in logical order. A `Run` is character
    offsets and nothing else, so this is the ONLY place a backend can find where
    the run that carries a wavy underline starts and stops. Without it a
    decoration over `characters 23..41` had no extent and fell back to a straight
    line.
  - `hyphen: string` — the glyph the browser painted at a hyphenation break
    (`hyphens: auto`) and the document does not contain. **It is deliberately not
    in `characters`**: every offset in `lines`, `runs`, `frags` and `spans` indexes
    that string and `sourceText` matches it character for character, so inserting
    it would move all four at once. Its advance is ALREADY inside `w`, `spans` and
    `frags` — the browser reports it as ink of this line — so a backend paints the
    line as `characters.slice(start, end) + hyphen` and nothing else moves.
    Which character it is, is MEASURED (U+2010 vs U+002D vs a declared
    `hyphenate-character`), never assumed.
- `Run = {start, end, style, href, dy}`. `dy` is the MEASURED offset of a raised
  or lowered run (superscript, subscript, `vertical-align`) from its line's
  baseline, positive downwards. The fold that put the run on this line already took
  the offset out of the baseline, so a consumer that drops `dy` renders H₂O as H2O.
- A warning may be prose or `{code, grade, severity, message}`. A collector that
  knows what it lost states the grade; the orchestrator's regex is the last resort.

**TextStyle**, as the collector returns it and as `index.js` (`registerTextStyle`)
rewrites it into `doc.styles.text[ts_N]`. The rewrite is the one place the
orchestrator translates rather than forwards, and both spellings are normative
for the side that sees them:

| collector | SVD | notes |
|---|---|---|
| `fontSize` | `size` | the only renamed key |
| `fontFamily` / `family` | `stack` / `family` | `family` is the first entry of the stack, unquoted |
| `fontWeight`, `fontStyle`, `fontStretch` | `weight`, `fontStyle`, `stretch` | plus `italic: boolean` |
| `fontVariant` (+ `fontVariantCaps` merged in) | `variant` | see below |
| `fontFeatureSettings`, `fontVariationSettings` | `features`, `variations` | computed CSS strings |
| `letterSpacing`, `wordSpacing`, `lineHeight` | same | resolved to px numbers, never `'normal'` |
| `textTransform` | `case` | `characters` is ALREADY transformed; this says what was applied |
| `color`/`colorCss` | `fills:[{type:'solid', color, srcCss}]` | |
| `decorations` (array) | `decoration` (array \| **null**) | |
| `strokeWidth`, `strokeColor` | same | |
| `ascent`, `descent`, `fontCss` | same | measured metrics for the face that actually painted |

- **`decoration` is an ARRAY, or null — never a single object.** `text-decoration`
  does not inherit, it PROPAGATES: an `<a>` and a `<span>` inside it can each
  contribute one, and `underline line-through` is one declaration and two lines.
  Order is innermost first (`[0]` is the decoration nearest the glyphs). An entry
  is `{line, style, color, colorCss, thickness, offset, offsetCss}`; `thickness`
  and `offset` are `null` for `auto`, which is the honest answer — the value is
  then the font's, and the font's underline position is not in this document.
  Reading `decoration.line` off the array returns `undefined`, which is how a
  consumer silently emitted NONE for every underline in the document.
- **`variant` is the whole `font-variant` shorthand with `font-variant-caps`
  merged in.** Chromium drops `small-caps` from the shorthand's serialization as
  soon as another longhand is set, so both are read and joined. It therefore
  carries two unrelated things at once — the caps half (`small-caps`,
  `all-small-caps`, …), which repaints letters, and the OpenType half
  (`tabular-nums`, `lining-nums`, `slashed-zero`, …), which selects figures and
  ligatures. Backends split it themselves (`emit/pdf.js` `splitSmallCaps`,
  `emit/figma-json.js` `variantOf`); there is no second field, so nobody has two
  places to look.
- **`strokeWidth` / `strokeColor` are `-webkit-text-stroke`**, resolved
  (`strokeColor` falls back to `color`, and is `null` when the width is 0). It is
  centred on the glyph outline and painted over the fill — in CSS, in SVG and in
  Figma alike — so a backend that has a stroke primitive can carry the number
  across unchanged.

### `packages/vector/src/collect/image.js`

```js
/** @returns {Promise<{asset:Asset, fill:Paint, warnings:string[]}|null>} */
export async function collectImage (el, cs, ctx = {})
```
Read `currentSrc` (not `src`) and `naturalWidth/Height`. **If `currentSrc` is an SVG,
inline and vectorize it — do not rasterize.** Honour `object-fit`/`object-position`
as a crop plus matrix: the returned `fill` carries `crop` (the visible region in
the asset's OWN source pixels) and `transform` (a 2x3 mapping the unit square of
that crop onto the node's border box in px), and between them those express all
five `object-fit` values. `null` only when the element carries no replaced content
at all — the one case with nothing to report, because nothing was lost.

**Passthrough markup carries no active content.** `<script>` elements and `on*`
attributes are removed before serialization (`stripActiveContent`) and reported as
`collect.image.active-content-stripped`, grade `E` — nothing visual is lost. This is
not hygiene theatre: on 2026-08-08 a dev server injecting a live-reload snippet into
every `.svg` it served put three of them inside one capture, and the exported file
stopped parsing at the first `// <![CDATA[`. The engine copies what the page gave it;
it does not have to copy that.

`asset.kind === 'vector'` means the caller must emit a `vector` node and put the
markup on **`node.svg`**, with the placement on `node.svgPlacement`. Both emitters
read `node.svg`; while nobody wrote it, every inline `<svg>` exported as an empty
group with an `emit.svg.image-no-data` per icon.

### `packages/vector/src/collect/mathml.js`

```js
/** @returns {Promise<{asset:Asset, fill:Paint, warnings:Array, fontStyles:Array}|null>} */
export async function collectMathML (el, cs, ctx = {})
```

Native MathML stays opaque to the HTML paint walk and is kept as a `vector`
node. The collector reads the mounted clone's mathematical layout and produces
native SVG text and geometry for presentation math. Its asset and placement use
the same interface as `collectImage`; it adds neither raster content nor
`foreignObject`. Root CSS paint and transforms remain the orchestrator/emitter's
responsibility. Excluded, phantom and annotation content must not become visible
text. Unsupported paint and approximated glyph geometry carry diagnostics.

`fontStyles` contains collector `TextStyle` objects plus `characters`, the actual
code points emitted in that style (including MathML `math-auto` substitutions).
The orchestrator registers them in `doc.styles.text` and keeps transient
`st.markupTextUses = [{nodeId, style, characters}]`. These uses join font coverage,
embedding and missing-font diagnostics; they do not create phantom SVD text
nodes. MathML behavior follows [MathML Core](https://www.w3.org/TR/mathml-core/).

### `packages/vector/src/collect/font.js`

```js
/** Mutates doc.assets and styles.text[*].font; every non-embed is a diagnostic. */
export async function collectFonts (st, report)
```

The asynchronous other half of `collect/text.js`'s family resolution (2026-08-13),
run by `assemble` inside the mount, after every text style exists and before
`declareFonts`. For each style the resolution marked `webfont: true` it finds the
`@font-face` rule the browser matched — same ordering as `pickFace`/`nameTableFor`,
whose helpers (`weightRange`, `parseUnicodeRange`, `parseFontNames`, `dataUriBytes`)
it imports rather than re-deriving — fetches the first loadable `src` with
`force-cache`, and writes an asset `{kind: 'font', data, mime, cssFamily,
weight | weightRange, italic, nameTable?, subset: false}` with `style.font`
pointing at it. That is the key `fontFaceRules` and `measuredFontTravels` (emit)
and `fontOf` (figma-json, reads `nameTable`) have always looked for.

What it refuses, each with its own `assets.*` code: a family whose rule no
readable stylesheet declares (`font-rule-missing`; cross-origin CSS is re-read
over HTTP first, `font-css-unreadable` when that fails too), a family served in
unicode-range subsets none of which alone covers every painted code point
(`font-uncovered` — embedding one subset would pin `textLength` to a file
missing characters), and a failed fetch (`font-fetch-failed`). It does not
subset (the file travels whole; size stated per face in `font-embedded`), and
`embedFonts: false` skips it entirely. System and locally-installed faces have
no bytes a page can hand over and stay `declareFonts`' story. The fixture is
`demo/vector.html` -> `fx-font`, whose family name exists nowhere installed and
whose baseline was measured on a render page with no stylesheets at all.

### `packages/vector/src/paint.js`

```js
/**
 * Pure given a snapshot: builds the containment tree, assigns paint order, prunes.
 * @returns {{nodes:Record<string,SVDNode>, rootId:string, diagnostics:Diagnostic[]}}
 */
export function buildPaintTree (rootEl, ctx = {})
export function isStackingContext (el, cs, parentCs)  // pure, testable from Node with a fake cs
export function paintOrder (siblings)        // CSS 2.1 Appendix E -> integer z per sibling
```

`parentCs` is optional and is what decides the flex/grid-item rule (`z-index` on
a flex item creates a stacking context whatever its `position`); without it that
one rule falls back to `getComputedStyle`, and with no DOM it is skipped.
`buildPaintTree` **refuses a detached root**: the engine walks snapdom's mounted
clone, and an unmounted clone computes to nothing and would prune to one empty
node that looks like a page with nothing on it.

**The tree is DOM containment. Paint order is an index, not a hierarchy.** A node is
promoted out of its DOM parent only when *both* hold: (a) the correct paint order is
not expressible by reordering siblings within the parent (negative `z-index` behind
the parent background, `position:fixed`, top layer), **and** (b) the divergence is
geometrically observable — the node's box overlaps some box whose relative order
would change. Every promotion emits a `diagnostics` entry with `from`, `to`, `reason`.

Pruning: an element emits a node only if it has a fill, stroke, effect, clip, mask,
transform, `opacity < 1`, is text, or is replaced. Everything else is pass-through and
is flattened when it has <= 1 child. **`opacity < 1` always forces a `group`**, even
with a single child.

### `packages/vector/src/emit/svg-flat.js`

```js
/**
 * @param {SVDDocument} doc
 * @param {object} [options]
 * @param {boolean} [options.debugPaint=false]
 * @param {'auto'|'always'|'never'} [options.textPerLine='auto']
 * @param {boolean} [options.exactShadows=false]
 * @returns {{svg: string, diagnostics: Diagnostic[]}} standalone SVG markup plus
 *   what the SVG backend itself could not represent. The result also behaves as
 *   the markup string (`toString`, `length`, `valueOf`) for callers written
 *   against the older signature.
 */
export function svdToSvg (doc, { debugPaint = false, textPerLine = 'auto', exactShadows = false } = {})
```
Pure. No DOM. **No `foreignObject` anywhere** — that is the entire point. SVG blur
sigma is `blur / 2`. `debugPaint` tints nodes by stacking-context depth and gives
each a `<title>` naming its id, grade and paint order.
The returned `diagnostics` carry `{code, grade, severity, message, node?}` and are
meant to be concatenated onto `doc.diagnostics` — an approximation the emitter made
is a loss like any other, and `toSvg` merges them and degrades the nodes they name.
The same notes also go into an XML comment under the `<svg>` tag, so the file is
self-describing on its own.

**The text shape is NOT one `<text>` with a `<tspan>` per line, and has not been
since the Figma findings.** An earlier revision of this file said it was; three
consumers built on that sentence. What the emitter does:

- **One `<text>` per positioned piece** — per visual line, and per `frag` within a
  line — each at its own measured baseline, whenever the block occupies more than
  one piece. A block that fits on ONE line stays a single `<text>`, which is the
  more editable object and has nothing to reflow. `textPerLine` moves that line:
  `'auto'` (the default, as described), `'always'` (split even a single line),
  `'never'` (the SVG-native shape, one element per block — and the lines stack on
  top of each other in Figma). **Why**: Figma discards the `x`/`y` of an interior
  `<tspan>` and reflows with its own leading.
- **`textLength` + `lengthAdjust="spacingAndGlyphs"` ONLY when the font binary
  travels in the file** (`fontFaceRules` / `measuredFontTravels`). Pinning a line
  to a width measured with the page's font, in a viewer that substituted the
  family, does not degrade gracefully: it squeezes the glyphs into a width they
  were never going to produce. Without a binary the width is the viewer's to
  decide and `emit.svg.text-length-viewer-width` says so. **Justified lines are
  the exception (2026-08-13), in two tiers.** Where the collector measured
  per-word anchors (`line.words`), every anchored word becomes a `<tspan x="…">`
  at the x the browser painted and `textLength` is OMITTED — absolute anchors
  and a whole-piece length would fight over the same glyphs
  (`emit.svg.text-justified-words`, grade E: exact, whatever font renders;
  measured on `challenges/fx-type` -> `.ty-just`, diffMean 6.25 -> 3.61, and on
  `vector/fx-font`, 8.62 -> 4.43). Where it could not (skewed chain, RTL,
  one-word lines), a justified non-last line is pinned even without a binary,
  with `lengthAdjust="spacing"` (glyphs unstretched) and
  `emit.svg.text-justified-length`, grade A — unpinned, the justification is
  simply gone and every word lands left of where the page painted it.
- **The `<text>` carries the typography of its dominant run**
  (`inheritedTextAttrs` / `dominantStyle`) and the `<tspan>`s carry only what
  differs, with explicit resets (`stroke="none"`, `font-variant="normal"`) where a
  run does not inherit. Figma builds its TextNode from the `<text>` element and
  does not look inside it for the real values.
- **A run raised or lowered off the baseline becomes its own positioned piece**
  (`pushRange`), never a relative `dy` inside its line: `dy` is cumulative, and an
  importer that carries part of the chain drifts everything after it.
- **`line.hyphen` is painted**, appended INSIDE the last `<tspan>` of the piece
  that ends the line (`emitText`) — not after it, where a bare text node between
  tspans is a separate character an importer can misplace. Its advance was already
  inside the measured width, so nothing moves. `emit/figma-json.js` deliberately
  does not paint it — see below.
- **`-webkit-text-stroke` is `stroke` + `stroke-width`** on the text (exact: both
  are centred on the outline and SVG's paint order is WebKit's).
  `background-clip: text` becomes the `<text>`'s own fill, never a glyph mask.
  `text-decoration-style: wavy` becomes a `<path>` at Chromium's measured
  wavelength and amplitude, ending where the run does, with no `<clipPath>`.
- **A `<pattern>` wrapper is emitted only when the layer genuinely tiles inside
  the painted box.** Figma does not resolve `fill="url(#pattern)"` — the node does
  not degrade, it disappears — and a single tile covering its own box never needed
  the wrapper.
- **`box-shadow` is `feDropShadow` by default**, not the exact
  `feMorphology → feGaussianBlur → feOffset → feFlood → feComposite → feMerge`
  chain: Figma runs part of that chain and paints a black rectangle. `spread` has
  no `feDropShadow` parameter and is folded into the blur, loudly
  (`emit.svg.shadow-spread-in-blur`). `{exactShadows: true}` asks for the exact
  chain back — exact in a browser, unimportable. **This is a measured pixel
  regression accepted as a product decision**, recorded in
  `test/vector-baselines.json` under `_acceptedRegressions`.

### `packages/vector/src/emit/figma-json.js`

```js
/** @param {SVDDocument} doc @returns {FigmaPayload} */
export function svdToFigma (doc)
```

**`svdToFigma` is the single canonical translator and `figma-plugin/code.js`
consumes its output verbatim.** There must not be a second SVD-reading path
inside the plugin. The plugin validates `payload.version`, then builds; if it
finds itself deriving Figma properties from raw SVD fields, that logic belongs
in `svdToFigma` where it can be tested in Node without the Figma sandbox.

```js
FigmaPayload = {
  version: 1,
  fonts: [{ key, family, style, weight, italic, stack,
            nodes, chars, nodeIds, canOutline, canRaster }],  // for the preflight UI
  root: 'n_0',
  nodes: { [id]: FigmaNodeSpec },
  diagnostics: [...],                 // ONLY what the translation itself lost
  document: {                         // everything the plugin cannot re-derive
    assets,                           // asset bytes, addressed by id from image fills
    capture,                          // the capture header
    report,
    diagnostics,                      // what the ENGINE lost, kept apart so the
  },                                  //   two lists never double-count
}
```
The plugin is handed this object and nothing else — it never sees the SVD — so
`document` is not optional decoration: without it there are no image bytes and no
provenance. Every node also carries `provenance` (for `setPluginData`), and text
nodes carry `outlineAsset`/`rasterAsset`.
`FigmaNodeSpec` uses Figma's own vocabulary: `type` in caps, `x`/`y`/`width`/`height`
(never `frame`), `fills`/`strokes`/`effects` in Figma paint shape, and text ranges
as serialized `setRange*` instructions. Gradient geometry arrives as a finished
`gradientTransform` — the plugin never sees `unit`.
Pure. Produces the payload the Figma plugin consumes — **plain data, no Figma API
calls** (those live in the plugin sandbox). Gradient geometry converted to
`gradientTransform`. Per-side stroke weights only on rect-like nodes. Colors stay
0..1 floats (Figma's native form).

A composed shape (a per-side border, an outline, an image that does not fill its
box) becomes a node of its own with `composed: <kind>` and an id `<owner>__cN`;
`root.siblings` holds the ones the capture root could not adopt, which the plugin
must append NEXT to the root. `degrade: {action:'OUTLINE'|'RASTER', reason, asset}`
marks a node the Figma model cannot hold at all (a skew, `text.emit.mode`).

**A TEXT node's own vocabulary**, since it is the one place the payload is richer
than a naive read of the SVD suggests:

```js
{ characters, fontName:{family,style}, fontSize, fills, lineHeight:{unit,value},
  letterSpacing:{unit,value}, paragraphSpacing, textCase:'ORIGINAL',
  textAutoResize:'NONE', textAlignHorizontal, textAlignVertical,
  strokes, strokeWeight, strokeAlign:'CENTER',    // -webkit-text-stroke, node-level
  setRange: [{ start, end, fontName, fontSize, fills, hyperlink,
               textDecoration, textDecorationStyle?, textDecorationColor?,
               textDecorationThickness?,
               letterSpacing?,      // per run — the Plugin API HAS setRangeLetterSpacing
               textCase?,           // SMALL_CAPS / SMALL_CAPS_FORCED, from `variant`
               baselineShift? }],   // measured `run.dy`; no Figma setter, carried anyway
  textLayout: { pitch, lineCount, baselines, lineWidths, lineX,
                firstBaselineFromTop, trailingSpacingComp, widthSlackPx,
                hyphenLines, svgPasteWidthDelta } }
```

`textLayout` is consumed by no setter: it is the measured browser layout, kept so
the plugin can check its result against it and so the export carries a record of
what the browser saw.

**The two routes into Figma do not lose the same things.** This is
counter-intuitive and it is the source of repeated rediscovery, so it is
normative here: `letter-spacing`, `-webkit-text-stroke` and small caps ARE in the
Plugin API (`setRangeLetterSpacing`, `TextNode.strokes`, `setRangeTextCase`) and
this payload carries all three; **Figma's SVG importer discards all three**, which
is measured in FIGMA_FINDINGS.md §5 (a 22px/700 line arriving 19% wide, +50px of
it ignored letter-spacing). The hyphen goes the other way: `emit/svg-flat.js`
paints `line.hyphen` and this file deliberately does not — a Figma TextNode
reflows to its own box with its own substituted font, so the break moves and a
hyphen written into `characters` would land inside a word
(`figma.text-hyphen-dropped`; the lines it happened on are in
`textLayout.hyphenLines`).

**What has no Figma equivalent at all, and is therefore declared, never dropped
quietly:** the `colorMatrix` effect (Figma's effect list is DROP_SHADOW,
INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR — there is no colour-matrix effect, no
colour-matrix paint and no blend mode that stands in for one, so
`figma.effect-colormatrix-dropped` names the CSS function from `srcCss` and says
whether it was `filter` or `backdrop-filter`); the OpenType half of `variant`
(`tabular-nums` and friends — the Plugin API exposes no feature control, same wall
as `font-feature-settings`); `-webkit-text-stroke` when the runs of a block
disagree, because a Figma stroke is per-NODE and applying it would contour glyphs
the page does not contour; and per-range baseline shift.

### `packages/vector/src/emit/pdf.js`

```js
/**
 * @param {SVDDocument} doc
 * @param {object} [options]  {compress, background, shadowLayers, quality,
 *                             onDiagnostic, onWarn, pages, links}
 * @returns {Promise<Uint8Array>}  the bytes, with a non-enumerable `diagnostics`
 */
export async function svdToPdf (doc, options = {})
```
The third backend, and the one with the smallest primitive set: PDF has no blur,
so every blurred shadow is `shadowLayers` concentric copies, and it has no
colour-matrix either. `pages` is finished page geometry from a caller that owns
the pagination — this emitter paginates nothing on its own. The diagnostics ride
on the returned array AND are written into the file as an uncompressed object off
the catalog, so `strings out.pdf` finds them: an approximation that only reaches a
stream nobody opens is a silent degradation.

### `packages/vector/src/index.js`

```js
/**
 * @param {object} [options]  {mode, maxNodes, maxDepth, exclude, fetchTimeout,
 *                             maxAssetBytes, silent, debugPaint}
 * @returns {object} snapdom plugin — {name, beforeRender, defineExports}
 */
export function vector (options = {})
export { svdToSvg, svdToFigma }
export default vector
```

`beforeRender(state)` does one thing: `state.options.__vectorHandoff = handoffFrom(state)`.
Everything else is in the exports it declares —

```js
defineExports () {
  return {
    vector:    (ctx, opts) => buildDocument(ctx, {...options, ...opts}),   // result.toVector()
    vectorSvg: (ctx, opts) => svgFrom(await buildDocument(ctx, ...), ...), // result.toVectorSvg()
  }
}
```

— which mount the clone, walk it, validate the document and `unmount()` in a
`finally`. Per-capture options may be passed to the factory or to the export; the
export's win.

There is **no** `toVector(element)` and **no** `options.snapdom`: the caller writes
the `snapdom()` call, so every capture option is already theirs to set. `dpr`,
`outerTransforms` and `burst` are read before the first hook and cannot be forced
from here in any case.

Orchestrator only: builds ctx, calls `buildPaintTree`, collects per node, assembles
the document, fills `report`, runs `validate` and **throws on invalid output**.
Every collector returns `{...data, warnings: []}`; the orchestrator prints them with
the `[snapdom-vector]` prefix and folds them into `diagnostics`.

It also owns the two wiring steps a collector cannot do from where it stands, and
both were silent holes until they existed: `wireMasks` turns `collectBox`'s mask
layers into the node `node.mask` references, and `applyImage` writes `node.svg` +
`node.svgPlacement` for a vector asset.

## Shared node shape

```js
{
  type: 'frame',                                  // NodeType
  name: '#plan-card',                             // human-readable, from tag/id/class/text
  frame: { x, y, w, h },                          // relative to emitted parent
  abs:   { x, y, w, h },                          // relative to capture root
  paint: { z: 0, stackingContext: false },
  transform: null,                                // {m, decomposed} | null
  opacity: 1,
  blend: 'normal',
  clip: null,                                     // {mode:'rect'|'path', box:'padding', radii, d?} | null
  fills: [], strokes: [], effects: [],
  text: null,                                     // only on type:'text'
  fidelity: { grade: 'E', notes: [] },
  source: { tag, path, css: {} },
  children: [],
}
```

Optional, and read by both emitters when present:

```js
  radii: [[rx,ry] × 4],       // tl, tr, br, bl — CSS §5.5 overlap factor already applied
  isolate: true,              // the node isolates its children's blending
  mask: { node: 'n_7', type: 'alpha'|'luminance' },   // a REFERENCE, never a paint
  svg: '<svg …>',             // passthrough markup for an inline/vector asset
  svgPlacement: { crop, transform, clipBox },         // where that markup lands
  control: { kind, … },       // a native form widget, described — see below
```

### `node.control` — the one thing on a node that is not paint

```js
  control: {
    kind: 'checkbox'|'radio'|'range'|'select'|'text'|'email'|…,  // what the UA draws
    checked: false, indeterminate: false,   // checkbox/radio
    fraction: 0.62, value: '62', min: 0, max: 100,   // range/progress/meter
    accent: [r,g,b,a], accentSource: 'accent-color'|'ua-default',
    ink: [r,g,b,a],                          // tick/thumb colour, by luminance over accent
    border: [r,g,b,a], track: [r,g,b,a], surface: [r,g,b,a],
    direction: 'ltr'|'rtl', disabled: false,
  }
```

**Why it exists and why it is not fills.** A native control is the one thing on a page
that `getComputedStyle` cannot describe: Chromium paints the tick, the thumb, the track
and the chevron itself, from the element's TYPE and STATE, and no CSS property in the
cascade mentions any of them (`collect/box.js` files `collect.box.form-control` saying
so). So the collector records the semantics — what kind of control, in what state, with
which accent — and a backend reconstructs the picture from it at Chromium's measured
proportions, or declines to and says nothing was drawn. It is deliberately NOT a fill
list: fills would freeze one platform's drawing into the document, and a consumer that
knows better (Figma, which has real components) could never recognise the widget again.

`describeWidget` (`paint.js`) returns `null` — and the field is absent — when
`appearance: none` says the author replaced the widget with their own CSS, which the
ordinary collectors already read. Two checkboxes in one box is worse than none.

**Who reads it.** `emit/svg-flat.js` draws it (`emit.svg.control-reconstructed`, grade
A, one per control: a reconstruction is not a capture). `emit/figma-json.js` and
`emit/pdf.js` ignore it, so the widget is missing there and `B4.form-control` remains
the whole story on those two paths.

## What the Figma importer does — read `FIGMA_FINDINGS.md` before changing an emitter

**The default flow into Figma is the universal SVG (product call, Martin,
2026-08-13):** in practice it pastes better into today's Figma than the h2d
clipboard channel lands, so recommend `toVectorSvg()` → paste first, with the
importer's losses below as the accepted cost. h2d stays as the channel for when
the editable text layer outweighs paste fidelity. Do not bend the universal
emitter toward this importer — that is what `target: 'figma'` and h2d are for.

Five behaviours of Figma's SVG importer are the reason the emitters look the way
they do. Every one was **isolated by changing a single thing in the SVG and
pasting into Figma again** — none is deduced from documentation, and each has its
artefact in `out/vector/_clone-*.svg`. They are summarised here only so nobody
rediscovers them the hard way; the measurements, the controls and the ideas
already tried and rejected are in `FIGMA_FINDINGS.md`, which is normative for
this subject.

1. **The `<text>` element must carry its own typography** (§1). Figma builds its
   TextNode from `<text>` and does not look inside for a `<tspan>` with the real
   values: a bare `<text>` lands at the importer's default size and weight.
2. **Interior `<tspan>` `x`/`y` are discarded and the block is reflowed with
   Figma's own leading** (§2). Hence one `<text>` per visual line.
3. **`fill="url(#pattern)"` is not resolved and the whole node disappears** (§3)
   — it does not degrade, it vanishes. Hence: no `<pattern>` wrapper for a layer
   that does not actually tile.
4. **A filter chain is only partly executed** (§4). Figma keeps the `feFlood` and
   the blur and loses the `feComposite` that cuts the colour to the silhouette, so
   the exact shadow chain arrives as a black rectangle. Hence `feDropShadow`, at
   the cost of `spread`.
5. **`letter-spacing` is ignored on paste, and font STACKS are not resolved**
   (§5, the one with no workaround). Measured: 376.8px of text arriving at 449px,
   +50px from the ignored spacing and +23px from falling back to Inter. Four ways
   of forcing the width through the SVG were tried and all four failed — do not
   retry them. Consequence: anything anchored to the end of a line drifts, which
   is one cause behind three symptoms (the floating wavy underline, the short
   justified line, the misplaced hyphen).

The corollary that keeps being got backwards: **the SVG-paste route is not the
lossless one.** For text metrics the Plugin API payload is strictly richer —
`letter-spacing`, per-range small caps and a text stroke all survive it and none
of them survives a paste. See the TEXT block under `emit/figma-json.js`.

## The two paid plugins are separate products, and now separate repositories

`@zumer/snapdom-pdf` and `@zumer/snapdom-vector` are bought separately, and **neither
may import the other.** This is a licence boundary before it is an architectural one:
a vector customer who receives a slice of the PDF plugin has been shipped something
nobody sold them.

The history is worth keeping because it is the reason for the shape. Until 2026-08-08
`emit/pdf.js` imported the byte-level writer through `../../../pdf/src/pdf-writer.js`
— a relative path into the other product, undeclared in `package.json`, and visible to
users as `[snapdom-pdf]` warnings coming out of a vector capture. It was then lifted
into a shared private package, `@zumer/pdf-writer`, that both plugins depended on by
name and each build inlined. On 2026-08-28 the PDF product moved to a repository of
its own, and the shared package went with the split: **each product now owns its copy
of the writer as source** — `packages/vector/src/writer/` here, `src/writer/` there.

That trade is deliberate and it is not free. Nothing can leak between the two any
more, and nothing can be fixed in both at once either: a correction here does not
reach the PDF product, and the two will drift. That is the cost of the boundary being
a repository rather than a rule.

Three rules follow, and the first two are unchanged:

- **Nothing in `src/writer/` may name a product or know what it is drawing.** The
  warning prefix is injected by whoever loaded it (`setWarnPrefix`).
- **A module only this product needs belongs to this product.** There is no shared
  package left to put it in, and reaching into the other repository is not available.
- **The build enforces this, not review.** `packages/vector/build.mjs` fails if the
  bundle names the other product, imports it, or leaves behind an import the buyer
  cannot resolve. A rule with no test is a rule that gets re-broken by the next
  person who needs one function.

## House rules

- Match the surrounding code: ESM, 2-space indent, no semicolon-free style changes,
  JSDoc on exported functions, comments only where the *why* is not obvious.
- Every approximation produces a `warnings` entry. **Nothing degrades silently** —
  this is the product's differentiator, not a nicety.
- Pure modules (`css/*`, `emit/*`, `paint.js` predicates) must run in Node without a
  DOM so the harness can fuzz them.
- No `new Function`, no `eval` — they detonate under a page's CSP. snapStudio already
  has this bug at `content/index.js:236`; do not repeat it.
