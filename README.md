<p align="center">
  <a href="https://snapdom.dev">
    <img src="https://raw.githubusercontent.com/zumerlab/snapdom/main/docs/assets/newhero.png" width="80%">
  </a>
</p>

<p align="center">
 <a href="https://snapdom.dev">
    <img alt="Website" src="https://img.shields.io/badge/Website-snapdom.dev-2ea44f?style=flat-square">
  </a>
  <a href="https://www.npmjs.com/package/@zumer/snapdom">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@zumer/snapdom?style=flat-square&label=Version">
  </a>
  <a href="https://www.npmjs.com/package/@zumer/snapdom">
    <img alt="NPM weekly downloads" src="https://img.shields.io/npm/dw/@zumer/snapdom?style=flat-square&label=Downloads">
  </a>
  <a href="https://github.com/zumerlab/snapdom/graphs/contributors">
    <img alt="GitHub contributors" src="https://img.shields.io/github/contributors/zumerlab/snapdom?style=flat-square&label=Contributors">
  </a>
  <a href="https://github.com/zumerlab/snapdom/stargazers">
    <img alt="GitHub stars" src="https://img.shields.io/github/stars/zumerlab/snapdom?style=flat-square&label=Stars">
  </a>
  <a href="https://github.com/zumerlab/snapdom/network/members">
    <img alt="GitHub forks" src="https://img.shields.io/github/forks/zumerlab/snapdom?style=flat-square&label=Forks">
  </a>
  <a href="https://github.com/sponsors/tinchox5">
    <img alt="Sponsor tinchox5" src="https://img.shields.io/github/sponsors/tinchox5?style=flat-square&label=Sponsor">
  </a>

  <a href="https://github.com/zumerlab/snapdom/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/zumerlab/snapdom?style=flat-square">
  </a>
</p>

<p align="center">English | <a href="README_CN.md">简体中文</a></p>

# SnapDOM

SnapDOM is a browser capture engine for web interfaces. It captures rendered DOM state as a reusable result, with styles, fonts and images included.

Export images and canvas with the core. Use plugins for self-contained HTML, page context, maps for visual agents, PDF and recordings. Captures can also feed WebGL textures, visual regression tests and UI transitions. Everything runs in the page, using standard Web APIs, with no core dependencies.

[Documentation and demos](https://snapdom.dev/) · [Technical features](FEATURES.md) · [Official plugins](packages/plugins/README.md) · [简体中文](README_CN.md)

This checkout documents **v3, currently a prerelease**. The npm and CDN commands below install the published release. Check its version before using the v3 migration guide; a v3 npm tag is not yet available.

## What you can build

| Use | Output | Provided by |
| --- | --- | --- |
| Share a card, chart, invoice or dashboard | SVG, PNG, JPG, WebP, canvas or Blob | Core |
| Reuse a capture in a texture, overlay or transition | Canvas plus capture geometry | Core |
| Save a page fragment for later display | HTML with captured styles and fonts | `html-export` plugin |
| Give an agent or a log a view of page content | Text/JSON context, or an image with an element map | `context-export` / `agent-map` plugins |
| Download a document or record changing content | Image-based PDF, animated GIF or browser-encoded video | `pdf-image` / `gif-export` / `video-export` plugins |

Image, HTML and context exports use the captured state. GIF and video plugins record the live element over time.

## Quick start

```js
import { snapdom } from '@zumer/snapdom';

const card = document.querySelector('#card');
const image = await snapdom.toPng(card);
document.body.appendChild(image);
```

Capture once when you need several outputs:

```js
const result = await snapdom(card);

const image = await result.toPng();
const canvas = await result.toCanvas();
const blob = await result.toBlob({ format: 'png' });
await result.download({ format: 'jpg', filename: 'card' });
```

The result keeps that capture even if the source element later changes. Call `snapdom(card)` again to capture its new state.

## Installation

For the published release:

```sh
npm i @zumer/snapdom
```

Or load it in a browser:

```html
<script src="https://unpkg.com/@zumer/snapdom/dist/snapdom.js"></script>
<script>
  snapdom.toPng(document.querySelector('#card')).then(image => {
    document.body.appendChild(image);
  });
</script>
```

For v3 before publication, work from this checkout:

```sh
npm install
npm run compile
npm run site
```

The local site runs the local build. The public site's demos load the published package. Pin package versions in production.

### Build outputs

| File | Use |
| --- | --- |
| `dist/snapdom.mjs` | ES module for imports and bundlers |
| `dist/snapdom.js` | Script tag exposing `window.snapdom` |
| `types/snapdom.d.ts` | TypeScript declarations |

There is no CommonJS build. `@zumer/snapdom/plugins` and the package root share the same runtime and plugin registry.

## Usage

### Choose an output

| Result method | Returns |
| --- | --- |
| `toPng()`, `toJpg()`, `toWebp()` | An `HTMLImageElement` |
| `toSvg()` | An SVG-backed `HTMLImageElement` |
| `toCanvas()` | An `HTMLCanvasElement` |
| `toBlob()` | An SVG `Blob` unless a format was explicitly set on the capture or export |
| `toRaw()` / `url` | The capture's SVG data URL |
| `download()` | Downloads the chosen format |
| `to(name, options?)` | Runs a core or plugin exporter by name |

One-step shortcuts such as `snapdom.toPng(element, options)` capture and export in one call. Results also have `toJpeg()` as an alias for `toJpg()`. `toImg()` remains available; prefer `toSvg()` for an SVG image.

### Set size and content

```js
const result = await snapdom(card, {
  width: 800,
  dpr: 1,
  backgroundColor: '#ffffff',
  exclude: '.capture-ignore',
  excludeMode: 'remove'
});
```

`width` and `height` define output size. If only one is set, the aspect ratio is preserved. `scale` applies when neither is set, and `dpr` multiplies the pixel dimensions.

| Common option | Default | Purpose |
| --- | --- | --- |
| `scale` / `dpr` | `1` / device pixel ratio | Output resolution |
| `width` / `height` | Unset | Output dimensions |
| `embedFonts` | `'auto'` | Embed the web fonts the capture uses |
| `backgroundColor` | Transparent; white for JPG/WebP | Output background |
| `exclude` | None | Selectors or predicates; `true` means exclude |
| `excludeMode` | `'hide'` | Keep an invisible spacer, or use `'remove'` |
| `filter` | None | Predicate; `true` keeps a node and `false` filters it out |
| `filterMode` | `'hide'` | Independent layout mode for nodes rejected by `filter` |
| `clip` | Unset | Capture the viewport or a page-coordinate rectangle |
| `captureSelection` | `false` | Include the user's text selection |
| `canvas` | Unset | Reuse an existing canvas |
| `invalidate` | `false` | Refresh after changes such as programmatic CSSOM edits |

[All options](https://snapdom.dev/docs/options/) include shadows, transforms, fonts, CORS, fallbacks and layout reconciliation.

### Export HTML or structured context

Official plugins are distributed separately as `@zumer/snapdom-plugins`. Use the version that matches your core; this checkout includes the v3 plugin sources.

```js
import { htmlExport, contextExport } from '@zumer/snapdom-plugins';

const result = await snapdom(card, {
  plugins: [htmlExport(), contextExport({ format: 'json' })]
});

const html = await result.toHtml();
const context = await result.toContext();
```

The same plugin system supports overlays, redaction and custom exporters. Local plugins override global plugins by name. See the [official plugin reference](packages/plugins/README.md) and [plugin specification](PLUGIN_SPEC.md).

### Capture HTML strings

```js
const result = await snapdom.fromString('<article>Hello</article>');
const image = await result.toPng();
```

`fromString()` mounts the markup offscreen and removes it after capture. Pass trusted or sanitized HTML.

### Feed a WebGL texture

```js
const canvas = document.createElement('canvas');
const texture = new THREE.CanvasTexture(canvas);
texture.colorSpace = THREE.SRGBColorSpace;

async function refresh(element) {
  await snapdom.toCanvas(element, { canvas, scale: 1, dpr: 1 });
  texture.needsUpdate = true;
}
```

`result.meta` contains the capture geometry needed to place an exported image over the source interface. The [labs](https://snapdom.dev/labs.html) show textures, mirrors and transitions.

## What's new in v3

- Eligible unchanged captures reuse the first result. Safe local changes rebuild only affected subtrees; other changes use a full capture.
- Web fonts embed automatically when used. System-font captures skip that work.
- The style pass avoids redundant reads, and per-capture state is isolated for concurrent captures.
- Safari image decoding and drawing retain their browser-specific handling.
- `snapdom.preCapture()` can prepare captures on user intent. It learns a control when a capture starts during its press/click event, then prepares that capture on later hover or focus.

```js
snapdom.preCapture();
button.onclick = () => snapdom.toPng(card);
```

Image compression and resource caching remain automatic. They do not make rasterization or image encoding free. See [performance measurements](BENCHMARKS.md) and the [cache guide](https://snapdom.dev/docs/cache/).

SnapDOM has two rendering engines: **SVG**, the default, and **html-in-canvas**, which paints the same captured clone through the browser's native canvas API. Select the second with `engine: 'html-in-canvas'`.

The second engine is experimental: it still needs a compatible browser with its canvas drawing flag enabled, plus a build compiled with `SNAPDOM_CANVAS_ENGINE=1`. The default build includes SVG only. Unsupported captures fall back to SVG. A successful native capture produces a bitmap, so its URL and `toRaw()` return PNG, not serialized SVG. See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

## Migrating from v2

The main capture pattern remains `snapdom(element, options)`. Review these changes before upgrading:

| In v2 | In v3 | What to change |
| --- | --- | --- |
| Web fonts were opt-in | `embedFonts: 'auto'` | Usually nothing; use `false` only if you want to omit them |
| Raster width/height could be multiplied by `scale` | Width/height win over scale | Pass the final size: `width: 400` instead of `width: 200, scale: 2` |
| Repeat memoization was opt-in | Eligible captures memoize automatically | Use `invalidate: true` after unobservable changes such as `sheet.insertRule()` |
| `preCache` prepared resources | Removed; `preCapture()` learns capture intent | Remove `preCache`; `preCapture()` is not a drop-in rename |
| `fast` selected an optimization path | Removed | Delete the option |
| `filter` / `filterMode` and `exclude` / `excludeMode` could be used together | Both controls and their independent modes remain supported; `exclude` also accepts predicates | Keep existing rules and modes; use the additional predicate form only when useful |
| `cache: 'auto'` or `'full'` | Both map to `'soft'` | Usually omit it; `'disabled'` / `false` is for debugging |
| Some visible input values were redacted | Core masks passwords only | Add `redactInputs()` for other fields |
| `afterExport` returns became the next hook's payload, not the caller's result | Returns are ignored; hooks receive the same export payload | Stop chaining through return values; use `defineExports` to produce a different output |
| TypeScript exported `PluginExportFacade` | The named type is removed; `ctx.exports` still provides core exporters | Infer it in `defineExports`, or use `NonNullable<CaptureContext['exports']>` |

### Use filter and exclude together

`filter` and `exclude` are independent controls, as in v2. `filter(node)` returns true to keep a node and false to filter it out; `filterMode` controls how a filtered node affects layout. `exclude` specifies additional omissions using selectors or predicates; an exclusion predicate returns true to omit the node. `excludeMode` controls those omissions. You can keep both controls and different modes in the same capture:

```js
// Works in v2 and v3: hide private fields, remove the toolbar.
await snapdom(card, {
  filter: node => !node.matches('[data-private]'),
  filterMode: 'hide',
  exclude: ['.toolbar'],
  excludeMode: 'remove'
});
```

`'hide'` keeps an invisible spacer; `'remove'` drops the node and allows reflow. Both omit its content. V3 additionally lets `exclude` mix selectors and predicates, such as `exclude: ['.toolbar', node => node.dataset.export === 'omit']`; any matching rule excludes the node. This is optional and does not replace `filter` or merge the two modes. The separate CSS-effect plugin named `filter` is also available.

Both modes default to `'hide'`. Per node, `data-capture="exclude"` is checked first, then `exclude`, then `filter`. The first omission decides the mode and stops evaluation for that node: if it matches `exclude`, `excludeMode` wins even when `filter` would reject it with a different mode. `filter` uses the v2 truthiness rule: any falsy return filters the node out.

### Callbacks that read changing application state

Captures with function-valued `filter`, `exclude`, `excludeStyleProps` or `fallbackURL` run fresh so applicable callbacks can read current application state on each new capture. They do not reuse an unchanged capture or an earlier callback's style/fallback decision. You do not need `invalidate` just because a callback's closure changed:

```js
let privateMode = false;
const options = {
  exclude: node => privateMode && node.matches('[data-private]'),
  excludeMode: 'remove'
};
const before = await snapdom(card, options);
privateMode = true;
const after = await snapdom(card, options); // evaluates the current policy
```

`before` still contains its original captured state; exporting it again does not apply a new policy. Use a new capture such as `after`. Keep exclusion and style predicates synchronous and boolean-returning. `invalidate: true` remains necessary after unobservable changes such as direct CSSOM edits.

Capture-affecting plugins suspend memoization unless they declare `pure: true`. Declare it only for deterministic hooks; timestamps and callbacks reading external state must run again. See the [v3 plugin contract](PLUGIN_SPEC.md).

## Limitations

- SnapDOM needs a browser DOM. A server-side Node.js process needs a browser environment to run it.
- Cross-origin images, fonts and stylesheets need readable resources or an appropriate proxy. `crossorigin` does not grant access unless the server also allows it. Cross-origin iframes use placeholders.
- SVG output includes HTML inside `<foreignObject>`. It is suitable for browsers; support varies in other SVG viewers and document tools.
- Output depends on browser rendering and canvas limits. Safari may fall back to PNG when WebP encoding is unavailable.
- Canvas, video and other changing surfaces are captured fresh. JavaScript CSSOM edits are not observable automatically; use `invalidate: true` after them.
- Core captures visible input values. Semantic plugins redact sensitive field values in their text/map output, but their attached image needs `redactInputs` or `exclude` if you want those pixels hidden too.

[Technical features and browser behavior](FEATURES.md) covers the details.

## Performance benchmarks

[Recorded measurements](BENCHMARKS.md) separate first captures, repeat captures and image-heavy scenes. The [live comparison](https://snapdom.dev/compare/live/) runs in your browser and identifies the package version it loads.

For a useful comparison, use the same scene, output format, scale and DPR. Compare the images as well as the times.

## Documentation

- [API](https://snapdom.dev/docs/api/) and [options](https://snapdom.dev/docs/options/)
- [Framework guides](https://snapdom.dev/guides/) and [how-to examples](https://snapdom.dev/how-to/)
- [Official plugins](packages/plugins/README.md), [plugin specification](PLUGIN_SPEC.md) and [contributing plugins](CONTRIBUTING_PLUGINS.md)
- [Architecture](ARCHITECTURE.md) and [technical features](FEATURES.md)

## Development

From this checkout:

```sh
npm install
npx playwright install
npm run compile
npm run lint
npm run test:types
npm run test:bundle
BROWSER=all npx vitest run __tests__ --browser.headless
npm run test:pack
```

`npm run site` serves the docs with the local build. `npm test` checks lint without changing files; use `npm run lint:fix` to apply fixes. See [ARCHITECTURE.md](ARCHITECTURE.md) for implementation notes.

## Contributors

<!-- CONTRIBUTORS:START -->
<p>
<a href="https://github.com/tinchox5" title="tinchox5"><img src="https://avatars.githubusercontent.com/u/11557901?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="tinchox5"/></a>
<a href="https://github.com/pdufour" title="pdufour"><img src="https://avatars.githubusercontent.com/u/1239145?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="pdufour"/></a>
<a href="https://github.com/FlavioLimaMindera" title="FlavioLimaMindera"><img src="https://avatars.githubusercontent.com/u/96424442?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="FlavioLimaMindera"/></a>
<a href="https://github.com/Jarvis2018" title="Jarvis2018"><img src="https://avatars.githubusercontent.com/u/36788851?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="Jarvis2018"/></a>
<a href="https://github.com/tarwin" title="tarwin"><img src="https://avatars.githubusercontent.com/u/646149?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="tarwin"/></a>
<a href="https://github.com/Amyuan23" title="Amyuan23"><img src="https://avatars.githubusercontent.com/u/25892910?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="Amyuan23"/></a>
<a href="https://github.com/kohaiy" title="kohaiy"><img src="https://avatars.githubusercontent.com/u/15622127?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="kohaiy"/></a>
<a href="https://github.com/airamhr9" title="airamhr9"><img src="https://avatars.githubusercontent.com/u/57371081?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="airamhr9"/></a>
<a href="https://github.com/jswhisperer" title="jswhisperer"><img src="https://avatars.githubusercontent.com/u/1177690?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="jswhisperer"/></a>
<a href="https://github.com/K1ender" title="K1ender"><img src="https://avatars.githubusercontent.com/u/146767945?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="K1ender"/></a>
<a href="https://github.com/mosuzi" title="mosuzi"><img src="https://avatars.githubusercontent.com/u/43341701?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="mosuzi"/></a>
<a href="https://github.com/17biubiu" title="17biubiu"><img src="https://avatars.githubusercontent.com/u/13295895?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="17biubiu"/></a>
<a href="https://github.com/av01d" title="av01d"><img src="https://avatars.githubusercontent.com/u/6247646?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="av01d"/></a>
<a href="https://github.com/CHOYSEN" title="CHOYSEN"><img src="https://avatars.githubusercontent.com/u/25995358?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="CHOYSEN"/></a>
<a href="https://github.com/pedrocateexte" title="pedrocateexte"><img src="https://avatars.githubusercontent.com/u/207524750?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="pedrocateexte"/></a>
<a href="https://github.com/claude" title="claude"><img src="https://avatars.githubusercontent.com/u/81847?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="claude"/></a>
<a href="https://github.com/domialex" title="domialex"><img src="https://avatars.githubusercontent.com/u/4694217?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="domialex"/></a>
<a href="https://github.com/stypr" title="stypr"><img src="https://avatars.githubusercontent.com/u/6625978?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="stypr"/></a>
<a href="https://github.com/mon-jai" title="mon-jai"><img src="https://avatars.githubusercontent.com/u/91261297?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="mon-jai"/></a>
<a href="https://github.com/puneetdixit200" title="puneetdixit200"><img src="https://avatars.githubusercontent.com/u/236133619?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="puneetdixit200"/></a>
<a href="https://github.com/RexSkz" title="RexSkz"><img src="https://avatars.githubusercontent.com/u/27483702?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="RexSkz"/></a>
<a href="https://github.com/RinZ27" title="RinZ27"><img src="https://avatars.githubusercontent.com/u/222222878?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="RinZ27"/></a>
<a href="https://github.com/sharuzzaman" title="sharuzzaman"><img src="https://avatars.githubusercontent.com/u/7421941?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="sharuzzaman"/></a>
<a href="https://github.com/simon1uo" title="simon1uo"><img src="https://avatars.githubusercontent.com/u/60037549?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="simon1uo"/></a>
<a href="https://github.com/titoBouzout" title="titoBouzout"><img src="https://avatars.githubusercontent.com/u/64156?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="titoBouzout"/></a>
<a href="https://github.com/ZiuChen" title="ZiuChen"><img src="https://avatars.githubusercontent.com/u/64892985?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="ZiuChen"/></a>
<a href="https://github.com/adajoy" title="adajoy"><img src="https://avatars.githubusercontent.com/u/26210079?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="adajoy"/></a>
<a href="https://github.com/hjl12345" title="hjl12345"><img src="https://avatars.githubusercontent.com/u/170017602?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="hjl12345"/></a>
</p>
<!-- CONTRIBUTORS:END -->

## Sponsors

Special thanks to [@megaphonecolin](https://github.com/megaphonecolin), [@sdraper69](https://github.com/sdraper69), [@reynaldichernando](https://github.com/reynaldichernando), [@gamma-app](https://github.com/gamma-app), [@jrjohnson](https://github.com/jrjohnson), and [@ryanander](https://github.com/ryanander) for supporting this project!

If you'd like to support this project too, you can [become a sponsor](https://github.com/sponsors/tinchox5).

## Show your support

If SnapDOM saved you time, a star on GitHub helps other developers find it.

Shipping something built with SnapDOM? Add the badge to your README:

[![Built with SnapDOM](https://img.shields.io/badge/built%20with-SnapDOM-blue)](https://snapdom.dev)

```md
[![Built with SnapDOM](https://img.shields.io/badge/built%20with-SnapDOM-blue)](https://snapdom.dev)
```

### Projects using SnapDOM

Projects using SnapDOM include:

- [LobeHub](https://github.com/lobehub/lobehub) — platform for operating AI agents
- [Hugging Face Chat UI](https://github.com/huggingface/chat-ui) — HuggingChat interface with artifact preview captures
- [Sealos](https://github.com/labring/sealos) — AI-native cloud operating system
- [Tencent tmagic-editor](https://github.com/Tencent/tmagic-editor) — low-code page editor
- [Playroom](https://github.com/seek-oss/playroom) — JSX design tool by SEEK
- [GPT-Vis](https://github.com/antvis/GPT-Vis) — AI-friendly data viz by Ant Group's AntV
- [Rabby Wallet](https://github.com/RabbyHub/Rabby) — browser wallet for EVM chains
- [uMap](https://github.com/umap-project/umap) — OpenStreetMap map builder
- [ListenBrainz](https://github.com/metabrainz/listenbrainz-server) — music tracker by MetaBrainz
- [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) — mind-map core; recommends SnapDOM for image export
- [Kong UI Components](https://github.com/Kong/public-ui-components) — Kong's dashboard renderer exports PDFs with SnapDOM
- [SnapDIFF](https://zumerlab.com/snapdiff/) — in-browser visual regression testing *(by Zumerlab)*

See the full gallery at **[snapdom.dev/made-with](https://snapdom.dev/made-with/)**. Shipping SnapDOM? [Open a PR](https://github.com/zumerlab/snapdom/pulls) to add your project — real, verifiable projects only.

## License

MIT © Zumerlab
