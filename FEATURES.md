# SnapDOM features

SnapDOM captures rendered interface state in the browser. The core produces reusable image and canvas exports; plugins add HTML, structured context, element maps, PDF and recordings.

This is the technical feature reference for v3. For setup and examples, see the [README](README.md) and [API documentation](https://snapdom.dev/docs/). [简体中文](FEATURES_CN.md).

## Capture & clone

The core clones the selected subtree, snapshots computed styles and embeds its resources. `snapdom.fromString()` can also capture an HTML string mounted offscreen; the markup is activated like page markup, so inline handlers such as `<img onerror>` run in the caller's origin. Sanitize untrusted HTML first.

| Content | Capture behavior |
| --- | --- |
| Open Shadow DOM | Flattens shadow roots, scopes styles and resolves assigned slots |
| Same-origin iframes | Captures the frame with resources and fonts from its own document |
| Cross-origin iframes | Uses a sized placeholder, or an invisible spacer with `placeholders: false` |
| Canvas | Captures its current bitmap with intrinsic and CSS dimensions |
| Video | Captures the current frame where readable; falls back to the poster |
| Audio controls | Uses a drawn player representation |
| Form controls | Preserves current values, checked/indeterminate state, selection and state-dependent styles |
| Images and pictures | Freezes the selected responsive source and rendered dimensions, including `object-fit` and `object-position` |
| Inline SVG | Preserves paint styles and inlines referenced external definitions and symbols |
| Scrolled containers | Preserves scroll position, clipping and positioned descendants |

Core masks passwords. Other visible input values remain visible unless a plugin or exclusion removes them. Firefox checkboxes and radios use drawn replacements.

Non-rendered nodes such as scripts and templates are skipped. The clone's root margins are neutralized and offscreen `content-visibility` content is made available for capture.

## Styles

- Computed styles are copied and deduplicated into generated classes. Author `!important` rules and inline priorities are preserved.
- Pseudo-elements, text decorations, text stroke, font variations and OpenType settings are captured.
- CSS counters in pseudo-element content support resets, increments, nesting and counter styles.
- Line clamping and ellipsis are converted into captured text where SVG rendering needs it.
- Root transforms include individual `translate`, `rotate` and `scale`, with origin-aware bounds. Root translation is normalized; `outerTransforms: false` also removes rotation while preserving `scale` and `skew`.
- `outerShadows: false` removes root shadows, outlines and `drop-shadow()` while keeping blur. `true` includes root effects; `'subtree'` also includes descendant shadow ink. Explicit clip edges never expand.
- Backgrounds, masks, border images, clip paths and blend modes preserve their captured styles.
- Custom scrollbar styles are included where the capture path supports them; scrolled content is captured without the custom scrollbar.

`reconcile: true` measures the styled clone against the source and corrects diverging boxes. It can fix text wrapping or layout differences, at the cost of another measurement pass. `excludeStyleProps` omits properties selected by a RegExp or predicate.

## Images & backgrounds

Images, SVG image references, CSS background layers, masks and border images are embedded. Multi-layer backgrounds retain positioning, sizing, repetition and blend settings. `image-set()` candidates follow the page's device pixel ratio.

Responsive images use the selected source rather than a fallback `src`. Common lazy-loading attributes are also resolved. Image fetching shares in-flight work and caches resources. `useProxy` supports a proxy URL or template; `fallbackURL` provides a replacement for failed images.

Inlined raster images are downsampled to the resolution the capture needs, preserving the source codec when possible. The smaller image is used only if it saves bytes. Larger exports can restore the captured original; they do not reread a later version of the live image.

Canvas dimensions are bounded by the browser's safe limits. Oversized exports may be downscaled with a warning.

## Fonts & icon fonts

`embedFonts: 'auto'` embeds web fonts used by the captured subtree. The font pass matches families, weights, styles, stretch and used Unicode ranges; system-font captures skip embedding. `true` and `false` explicitly enable or omit web-font embedding.

| Option | Purpose |
| --- | --- |
| `localFonts` | Supply font descriptors with a family and source, plus optional weight/style/stretch |
| `excludeFonts` | Exclude font families, domains or subsets |
| `fontStylesheetDomains` | Add domains to the cross-origin stylesheet scan |
| `iconFonts` | Extend icon-font detection with family names or patterns |

Recognized icon fonts are rendered as images, including ligature icons. Resource access still depends on browser permissions and CORS. Fonts created only through JavaScript may need an explicit `localFonts` source.

## Export formats

A capture result can be exported several times without cloning the live element again.

| Method | Returns |
| --- | --- |
| `toRaw()` / `url` | SVG data URL |
| `toSvg()` | SVG-backed `HTMLImageElement` |
| `toCanvas()` | `HTMLCanvasElement` |
| `toBlob()` | SVG `Blob` unless capture or export explicitly selects a format |
| `toPng()` | PNG `HTMLImageElement` |
| `toJpg()` / `toJpeg()` | JPEG `HTMLImageElement` |
| `toWebp()` | WebP `HTMLImageElement`, or PNG if the browser cannot encode WebP |
| `download()` | Downloads the requested format |
| `to(name, options?)` | Calls a core or plugin exporter |

Static shortcuts include `snapdom.toPng(element)`, `snapdom.toCanvas(element)` and `snapdom.download(element)`. `toImg()` is retained for compatibility; use `toSvg()` for an SVG image. JPEG and WebP default to a white background. On iOS, downloads can use the Web Share API.

SVG captures contain HTML inside `<foreignObject>`; non-browser SVG viewers may not render them. `result.meta` exposes frozen capture geometry for overlays and image placement. `result.warnings` reports capture diagnostics.

## Options

Every public option is documented in the [options reference](https://snapdom.dev/docs/options/). The [API reference](https://snapdom.dev/docs/api/) covers per-export options.

- Size: `width`/`height` take precedence over `scale`; `dpr` multiplies pixel dimensions.
- Content: `filter` / `filterMode` and `exclude` / `excludeMode` can be used together with independent modes; `clip` and `captureSelection` further control what is captured.
- Rendering: `backgroundColor`, `quality`, `outerTransforms`, `outerShadows` and `reconcile` control the output.
- Resources: font options, `useProxy`, `fallbackURL` and `placeholders` control embedding and fallbacks.
- Reuse: `canvas` accepts an existing render target, and `invalidate` refreshes after unobservable changes.

## Plugin system

Plugins can modify a clone, resolve a source node or define an exporter. They register globally with `snapdom.plugins(...)` or locally through the `plugins` option. Local plugins run first and override global plugins by name.

| Official plugin | Output or effect |
| --- | --- |
| `html-export` | Captured HTML with embedded styles and fonts |
| `context-export` | Text outline or JSON page context |
| `agent-map` | Image and element map with roles, names, state and bounding boxes |
| `pdf-image` | Downloadable PDF containing a JPEG capture |
| `gif-export` / `video-export` | Recordings of the live element over time |
| `ascii-export` | Text representation of the image |
| `filter` / `color-tint` / `timestamp-overlay` | Visual changes to the captured clone |
| `replace-text` / `redact-inputs` | Text replacement and form-value masking |

A per-capture plugin can declare `needs: 'clone'` to skip rendering. Core image exports are then unavailable, while the plugin can still return its own data. The deepest stage requested by any attached plugin wins. Global registration rejects clone-only plugins.

Capture-affecting hooks disable automatic memoization unless the plugin declares `pure: true`. Export-only plugins retain it. Export calls are serialized per result; `afterSnap` fires once after the first successful export.

See the [official plugin reference](packages/plugins/README.md), [hook contract](PLUGIN_SPEC.md) and [contribution guide](CONTRIBUTING_PLUGINS.md).

## Caching & memoization

Eligible unchanged elements reuse a result from their first capture. Safe localized changes can rebuild affected subtrees; uncertain changes use the full pipeline. Canvas, video, iframes and recognized animations are captured fresh.

Function-valued `filter`, `exclude`, `excludeStyleProps` and `fallbackURL` also require fresh captures. Applicable callback decisions, including style and fallback decisions, are reevaluated on each new capture. A changed closure needs no `invalidate`; an already returned result retains its original captured state.

DOM mutations, interaction state, scrolling, resizing and resource events invalidate the relevant caches. Programmatic CSSOM edits such as `sheet.insertRule()` have no mutation signal; pass `invalidate: true` for the next capture.

Resource/style caching is separate from result memoization. `cache: 'soft'` is the default; legacy `'auto'` and `'full'` values map to it. `cache: 'disabled'` or `false` clears and bypasses persistent caches for debugging.

`snapdom.preCapture()` prepares captures on intent. It learns an eligible capture started during a control's press/click event, then repeats it on later pointer-enter or focus events. It takes no arguments and does not poll the page.

## Cross-browser handling

Safari's SVG image path waits for embedded images and fonts to paint before returning a raster result. Firefox form controls use replacements where native SVG rendering differs. Encoding and canvas-size limits remain browser-dependent.

SnapDOM has two rendering engines. SVG is the default. The second, `html-in-canvas`, paints the same finished clone through the browser's native canvas API; select it with `engine: 'html-in-canvas'`.

The second engine is experimental and still requires a compatible browser with its canvas drawing flag enabled. Include it in the build with `SNAPDOM_CANVAS_ENGINE=1`; the default build includes SVG only. Unsupported captures fall back to SVG.

The export table above describes SVG captures. Successful native captures produce a bitmap: `url` and `toRaw()` return PNG data URLs, `toSvg()` and `toImg()` return PNG-backed images, and `toBlob()` defaults to PNG. An explicit SVG Blob request fails because this engine does not serialize SVG.

## Node-level control attributes

| Attribute | Effect |
| --- | --- |
| `data-capture="exclude"` | Exclude the node using the selected `excludeMode` |
| `data-capture="placeholder"` | Replace it with a placeholder |
| `data-placeholder-text` | Set the placeholder text |

SnapDOM's own capture scaffolding is always excluded.
