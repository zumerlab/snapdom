### Changelog

All notable changes to this project will be documented in this file. 

#### Unreleased

Release notes for `@zumer/snapdom` and `@zumer/snapdom-plugins` v3.x.x. Read the
[migration guide](README.md#migrating-from-v2) before upgrading from **v2.x.x**.
The [v2 source](https://github.com/zumerlab/snapdom/tree/v2) and
[v2 documentation](https://snapdom.dev/v2/) remain available.

- Reuse eligible unchanged captures automatically and recapture safe local mutations by
  rebuilding affected subtrees. Per-capture sessions isolate concurrent work.
- Embed used web fonts automatically, capture HTML strings with `fromString()`, and prepare
  learned captures on hover or focus with `preCapture()`.
- Align core and official plugins on v3.x.x for HTML, context, element maps, PDF,
  image effects and GIF/video recording. The SVG engine remains the default; the native
  html-in-canvas engine remains experimental and requires a custom build.
- Carry over v2.x.x fixes for italic icon glyphs
  ([#496](https://github.com/zumerlab/snapdom/pull/496)), non-generated pseudo-elements and
  animation suppression ([#497](https://github.com/zumerlab/snapdom/pull/497)), and layout
  alignment ([#498](https://github.com/zumerlab/snapdom/issues/498)).
- Breaking changes include width/height taking precedence over scale, automatic font
  embedding, removal of `preCache` and obsolete capture options, password-only core
  redaction, and export hooks that observe results without chaining return values. See
  the migration guide and beta notes below for the complete changes.

#### [v3.0.0-beta.1](https://github.com/zumerlab/snapdom/compare/v3.0.0-beta.0...v3.0.0-beta.1)

> 10 September 2026

- fix: three layout misalignments in pseudo boxes, scroll containers and images [`#498`](https://github.com/zumerlab/snapdom/issues/498)
- fix: reuse canvas targets from iframe documents [`7befc15`](https://github.com/zumerlab/snapdom/commit/7befc150c28b70f1fb8b66cf215fdbf998fcc25c)
- test: accept Gecko's serialization of the fractional image width (#498) [`6050325`](https://github.com/zumerlab/snapdom/commit/60503257d197526a7cb9f8e537c43aa92b70c4c5)

#### v3.0.0-beta.0

> 8 September 2026

The first v3 beta. **Breaking**: read the migration table in the README before upgrading.

💥 breaking
- `width` / `height` now win over `scale`. v2 multiplied them; v3 treats `width`/`height` as the
  absolute output size and applies `scale` only when neither is set.
- The `needs: 'dom'` plugin stage is gone. A capture that takes no clone does no capturing.
- `cache` collapsed to `'soft'` (default) and `'disabled'`; `'auto'`/`'full'` map to `'soft'`.
- `fast` removed — its behaviour is unconditional now.
- `burst`, `compress`, `resolvePicturePlaceholders` and `pictureResolver` are no longer
  documented or supported options. Capture reuse, image downsampling and responsive/lazy
  image resolution remain engine behavior. Remove these settings; custom image
  loading/timeouts belong in the application before capture. The engine still reads
  `burst`, `compress` and `resolvePicturePlaceholders` for internal use; do not rely on them.
- The named TypeScript interface `PluginExportFacade` is removed, but the `ctx.exports`
  facade remains. Infer it in `defineExports` or use `NonNullable<CaptureContext['exports']>`.
- `afterExport` return values are ignored. In v2.24.16 they only became the next hook's
  payload; they never replaced the caller's export result. Use `defineExports` for custom output.
- Core masks `type="password"` only. Everything the browser paints in the clear is captured as
  is; use the `redactInputs` plugin for the old behaviour.
- `embedFonts` defaults to `'auto'`.
- `preCache` is removed, along with the `/preCache` subpath and `window.preCache`. Eligible
  static elements are memoized from their first capture, so the capture is its own warm-up;
  `snapdom.preCapture()` can take it before the click.
- No CommonJS build, by decision, and no `require` condition in `exports`. Up to 2.24.1
  `require()` pointed at the IIFE and returned `{}`, so nothing that worked is lost. On Node
  20.19+ / 22.12+ `require()` loads the ESM build; older Node throws `ERR_REQUIRE_ESM`.
- The `@zumer/snapdom-plugins/html-in-canvas` subpath of plugins 2.2.2 is gone. Use the
  core's `engine: 'html-in-canvas'` instead (experimental, not in the shipped bundle).

⚡ perf
- Per-capture sessions replace the module-level mutable session; the whole `#463` bug class is
  now structurally unrepresentable.
- Automatic memoization from the first eligible static capture (at most 64 live memos, least
  recently used evicted): an unchanged repeat is served from memory; a local mutation uses
  differential recapture only when byte-faithful splicing can be proved, otherwise it falls
  back to a full capture (mutating poll 563ms → 16ms).
- One author-style scan yields the property universe and per-pseudo selector gates, replacing
  three `getComputedStyle` resolutions per node with one `matches()`.

✨ features
- `snapdom.fromString(html, options)` captures a markup string with no mount wiring.
  **Trusted HTML only** — it goes through `innerHTML` into the real document.
- Plugin stages (`needs`), `defineExports` for custom export formats, and an official plugin
  package: `@zumer/snapdom-plugins`.
- `snapdom.preCapture()`: link prefetch for captures. Intent on a control (pointer enter, focus,
  press) captures the eligible element that control asked for previously, with the same options.
  Attribution is limited to the triggering event task; unrelated later timers are not learned.

🛠 fix
- Restore the v2 `filter` / `filterMode` contract alongside `exclude` / `excludeMode`.
  Both can operate in the same capture with independent hide/remove modes. A pre-release
  checkout briefly removed `filter`; it is restored, with both controls and modes independent.
  Predicate support in `exclude` remains an optional addition.
- Hidden block spacers retain precise CSS dimensions, including fractional sizes and
  padding/borders. Safari page zoom can round integer layout measurements upward;
  those rounded values no longer shift content after filtered or excluded blocks.
- Function-valued `filter`, `exclude`, `excludeStyleProps` and `fallbackURL` cause new captures to
  evaluate current callback state instead of reusing an earlier capture/style/fallback
  decision. Changing a closure does not require `invalidate`; exporting an existing result
  still uses its original captured state.
- The `/plugins` subpath maps to the same file as the root instead of being a separate bundle
  with its own module state; registering through the subpath now reaches `snapdom()`. Its
  `types` condition points at the root declarations, so consumers with `skipLibCheck: false`
  typecheck.
- `dist/snapdom.js` is a real IIFE. It was emitting bare top-level statements, publishing 442
  minified bindings as globals to every `<script>` tag user.
- `prepack` compiles before packing: publishing from a clean checkout produced a tarball whose
  package.json pointed at files that were not in it.
- The line-clamp bake no longer reverts a text update the page made while the capture ran.
- Burst no longer commits a memo torn by an event that carries no mutation record (typing,
  scrolling, focus) mid-capture.
- Automatic memoization now covers observable hover/focus/active, media, stylesheet, nested
  scroll and programmatic form-state changes, including open shadow roots; selection and
  opaque/frame-driven sources always capture fresh.
- Same-element captures are serialized, option-baseline changes are committed inside that
  queue, failed diff exports stay dirty, and LRU eviction cannot resurrect disposed state.
- Simultaneous local and outside mutations force a full capture; memo keys use the plugins
  attached to the capture, even if the global registry changes during asynchronous preparation.
- Differential recapture falls back for geometry/top-layer/backdrop/plugin cases whose output
  cannot be spliced byte-faithfully.
- Video alpha detection scans the whole frame before choosing JPEG, so transparency away from
  a small probe is not flattened.
- Internal helper ownership is private instead of attribute-based: author nodes that happen to
  use `data-snapdom-internal` are preserved and never mistaken for SnapDOM scaffolding.
- The experimental html-in-canvas backend paints the finished clone, preserves fractional and
  scaled geometry, and exposes coherent canvas/image/blob exports without retaining clone state.
  Transformed or zoomed ancestors fall back to SVG to preserve the local capture box.
- Captures inside a same-origin iframe read form controls' live values and see stylesheet edits
  made in that document.
- A stalled `@import` stylesheet can no longer hang a capture forever.
- `htmlExport` keeps its markup per capture instead of on the plugin instance, so concurrent and
  reused captures no longer export each other's HTML.

Includes every fix shipped on the v2 line through 2.24.16 (#483 to #494).

#### [v2.24.18](https://github.com/zumerlab/snapdom/compare/v2.24.17...v2.24.18)

> 10 September 2026

- fix: three layout misalignments in pseudo boxes, scroll containers and images [`#498`](https://github.com/zumerlab/snapdom/issues/498)
- fix(pseudo): skip non-generated pseudo-elements [`#497`](https://github.com/zumerlab/snapdom/pull/497)
- fix(pseudo): preserve font style for icon glyphs [`#496`](https://github.com/zumerlab/snapdom/pull/496)


#### [v2.24.17](https://github.com/zumerlab/snapdom/compare/v2.24.16...v2.24.17)

> 9 September 2026

- fix: make DOM type checks realm-agnostic (ref #494) [`84359e5`](https://github.com/zumerlab/snapdom/commit/84359e557b369e1706e283119e53c4c163c3116a)
- fix(color-tint): accept clone roots from another realm (ref #494) [`ed8c31a`](https://github.com/zumerlab/snapdom/commit/ed8c31ad114b1f425722f25e6e04924c56dad2fe)
- chore(plugins): bump to 2.2.2 [`93a8e60`](https://github.com/zumerlab/snapdom/commit/93a8e60b67447da7ffd4524eadca02cd210a94e4)

#### [v2.24.16](https://github.com/zumerlab/snapdom/compare/v2.24.15...v2.24.16)

> 8 September 2026

- exposed internal visual demos for SnapDOM  testing and add new tests [`5766151`](https://github.com/zumerlab/snapdom/commit/5766151f8867eb2e64a6321a0af6f01fe25d65f0)
- fix: stop discarding a whole stylesheet when one family looks like an icon font [`a154f18`](https://github.com/zumerlab/snapdom/commit/a154f18a7acd24e511f2a8abdefab5a765b5ec51)
- docs: acknowledge open-source program support [`5b30335`](https://github.com/zumerlab/snapdom/commit/5b3033597e8218a33a2465e7c8bf31c5527ad663)


#### [v2.24.15](https://github.com/zumerlab/snapdom/compare/v2.24.12...v2.24.15)

> 30 August 2026

- fix: fractional with. Ref #491 [`cffd222`](https://github.com/zumerlab/snapdom/commit/cffd222a1c125bb3b57ea5a23e1d862efa31e381)
- fix: update network gate logic to manage lane budget and improve test reliability [`8ae2371`](https://github.com/zumerlab/snapdom/commit/8ae237176e7cc4af32add41f54eb58811fd846ca)
- fix(clone): drop light DOM that no slot accepted [`b75e88b`](https://github.com/zumerlab/snapdom/commit/b75e88b27480f111ab19983b27d8e79ca1e559d8)


#### [v2.24.12](https://github.com/zumerlab/snapdom/compare/v2.24.10...v2.24.12)

> 28 August 2026

- Split visual demo suite into 6 shards and gate network-bound demos [`56b1e01`](https://github.com/zumerlab/snapdom/commit/56b1e013e843e528b8256baacea12b22090e599a)
- Fix legacy bundle global leakage. Ref #490 [`80fe19d`](https://github.com/zumerlab/snapdom/commit/80fe19d5edc5a38fae9ca53291a2e8261c4575fe)

#### [v2.24.10](https://github.com/zumerlab/snapdom/compare/v2.24.7...v2.24.10)

> 25 August 2026

- fix: transformed reconciliation. Ref #489 [`9b28ab4`](https://github.com/zumerlab/snapdom/commit/9b28ab4d28b7ac56f324e2677ae47b3c22ba55ba)
- fix: offscreen captures. Ref #488 [`460b75e`](https://github.com/zumerlab/snapdom/commit/460b75ec0108436c874bf623d3d3c5f1adea134c)
- fix(iframe): stop suggesting an option that is already on [`98de375`](https://github.com/zumerlab/snapdom/commit/98de37594af6e3891173d091695bf021240482ff)
- add funding [`e839ec0`](https://github.com/zumerlab/snapdom/commit/e839ec0475a6f950927e146f18c041d9bc9a160b)


#### [v2.24.7](https://github.com/zumerlab/snapdom/compare/v2.24.3...v2.24.7)

> 21 August 2026

- fix: measure text truncation without replacing live text nodes (Ref #485) [`418d18f`](https://github.com/zumerlab/snapdom/commit/418d18fcbd3336d1ba1546797f398db893d62d5e)
- fix: bound the canvas frame wait, warn on an empty canvas (Ref #486) [`de521b8`](https://github.com/zumerlab/snapdom/commit/de521b819afad1586bfdb91677d8e6b0a6b2639d)
- fix: let &lt;use&gt; icons inherit fill from the use site (Ref #487) [`1b6cd96`](https://github.com/zumerlab/snapdom/commit/1b6cd968d5ecce1bc125619eda6baf38bb18c105)

#### [v2.24.3](https://github.com/zumerlab/snapdom/compare/v2.24.0...v2.24.3)

> 18 August 2026

- fix: keep an author-specified width on blockified spans (Ref #484) [`f3c75d3`](https://github.com/zumerlab/snapdom/commit/f3c75d3afd64e3bda751c952295b97994d634dd9)
- fix: neutralize CSS zoom on the capture root (Ref #483) [`14b2047`](https://github.com/zumerlab/snapdom/commit/14b204701483d66ffa6dfa0866dcdb906fa9bcc8)

#### [v2.24.0](https://github.com/zumerlab/snapdom/compare/v2.23.2...v2.24.0)

> 10 August 2026

- fix: stripe height [`df94e3e`](https://github.com/zumerlab/snapdom/commit/df94e3ee361679c83224c4e989529dfb761ec93e)
- feat(plugins): expose capture geometry, exact export options and canvas cropping [`7abb29a`](https://github.com/zumerlab/snapdom/commit/7abb29a40ebb2b8159cc539dfb94254e675fac46)
- fix(styles): reproduce visibility and content-visibility the way browsers do [`21251f7`](https://github.com/zumerlab/snapdom/commit/21251f70ea6153b73541fcf6eed20d766d283c0c)
- update [`1c8e12f`](https://github.com/zumerlab/snapdom/commit/1c8e12fce6028060b74836bbc0794a154acd3934)
- fix(fonts): emit only the @font-face descriptors the source declared [`8d0345a`](https://github.com/zumerlab/snapdom/commit/8d0345a4843dd255e293f67f45a5ad13ba0c6ed2)
- fix(clone): keep the pre-toDataURL frame for WebGL canvases [`1c44d1d`](https://github.com/zumerlab/snapdom/commit/1c44d1d468f8fb40a44a4fbaa7fad1fbeb9fad91)
- test: pin devicePixelRatio in DPR-dependent tests [`fb7311a`](https://github.com/zumerlab/snapdom/commit/fb7311ab34de7db28fb29abf352ee03d73a36d7a)
- fix(clone): clone slotted light DOM only once [`f4b1859`](https://github.com/zumerlab/snapdom/commit/f4b18590445a2bb1eff980f0b27948dbdf637abb)
- chore: bump version to 2.24.0 [`4a2ced5`](https://github.com/zumerlab/snapdom/commit/4a2ced52a60a93b3ed912b18a71ff771709ded0d)

#### [v2.23.2](https://github.com/zumerlab/snapdom/compare/v2.23.1...v2.23.2)

> 4 August 2026

- fix(fonts): keep a custom @font-face when the page asks for a far weight/stretch [`#478`](https://github.com/zumerlab/snapdom/issues/478)


#### [v2.23.1](https://github.com/zumerlab/snapdom/compare/v2.23.0...v2.23.1)

> 27 July 2026

- perf: probe ink first in Safari's waitForImgPaint instead of a blind two-frame wait [`50ea4eb`](https://github.com/zumerlab/snapdom/commit/50ea4ebb5012d3528f1f0d5d3580b4b923b71c98)
- fix: rAF timeout fallback so Safari captures don't hang in occluded windows [`104cb06`](https://github.com/zumerlab/snapdom/commit/104cb0663c661304ec59a3f9e6023b56b346b89e)


#### 3.0.0-beta.0

- fix(fonts): keep a custom @font-face when the page asks for a far weight/stretch [`#478`](https://github.com/zumerlab/snapdom/issues/478)
- fix(styles): disable animations on clones so entry keyframes don't blank the capture [`#476`](https://github.com/zumerlab/snapdom/pull/476)
- fix: parse final font-face declarations without semicolons [`#475`](https://github.com/zumerlab/snapdom/pull/475)
- fix: I freeze nowrap box widths and isolate measure mounts in shadow DOM [`#474`](https://github.com/zumerlab/snapdom/issues/474)
- Verified locally: regression tests fail on main / pass with this fix (691/1 skipped), lint clean. Measured actual output size impact for a 42-tag/12-evicted-tag capture: +70 bytes out of 110KB total (~0.06%) — negligible. [`#470`](https://github.com/zumerlab/snapdom/pull/470)
- Verified locally: regression tests fail on main / pass with this fix (693/1 skipped), lint clean, negative control confirmed still stripping genuinely transparent wrappers. [`#469`](https://github.com/zumerlab/snapdom/pull/469)
- Verified locally, including reproducing the race independently outside the test suite (a standalone demo with 6 concurrent same-origin iframes deterministically shows 0/3 backgrounds inlined on main, 3/3 with this fix across repeated runs). Full suite green (685/1 skipped), lint clean. Threading the nodeMap reference through is the right call over the narrower re-entrancy-guard alternative — it removes the bug class instead of patching one trigger into it. [`#466`](https://github.com/zumerlab/snapdom/pull/466)
- Verified locally: regression tests fail on main / pass with this fix, full suite green (685/1 skipped), lint clean. The &lt;audio&gt;/&lt;video&gt; &lt;source&gt; guard test confirms the check is scoped correctly. [`#465`](https://github.com/zumerlab/snapdom/pull/465)
- Verified locally: regression tests fail on main / pass with this fix, full suite green (685/1 skipped), lint clean. [`#464`](https://github.com/zumerlab/snapdom/pull/464)
- feat: emulate backdrop-filter at capture time [`#457`](https://github.com/zumerlab/snapdom/issues/457)
- FEATURES_CN.md: '按设计跳过' → '有意跳过'. The phrasing fix was independently [`#453`](https://github.com/zumerlab/snapdom/pull/453)
- fix(capture): drop *-prefixed attributes to keep XMLSerializer output well-formed [`#445`](https://github.com/zumerlab/snapdom/pull/445)
- fix(fonts): scan the capture element's ownerDocument so iframe fonts embed (#441) [`#442`](https://github.com/zumerlab/snapdom/pull/442)
- fix(fonts): scan the capture element's ownerDocument for fonts [`#441`](https://github.com/zumerlab/snapdom/issues/441)
- fix: use nodeMap for source/clone child alignment in inlineBackgroundImages [`#440`](https://github.com/zumerlab/snapdom/pull/440)
- fix: root margin-collapse clipping (#426) and oversized-raster decode failure [`#425`](https://github.com/zumerlab/snapdom/issues/425)
- fix(pseudo): render bordered + layout-spacer pseudo-elements (#418, #419) [`#423`](https://github.com/zumerlab/snapdom/pull/423)
- fix(pseudo): keep empty box-generating pseudos used as layout spacers [`#418`](https://github.com/zumerlab/snapdom/issues/418)
- fix(pseudo): render pseudo-elements with a single-side border [`#419`](https://github.com/zumerlab/snapdom/issues/419)
- fix: correctness, fidelity, perf & dead-code fixes from multi-agent audit [`#422`](https://github.com/zumerlab/snapdom/pull/422)
- Fix for placeholder colors not being copied over on webkit browsers [`#420`](https://github.com/zumerlab/snapdom/pull/420)
- Improve robustness of icon font detection [`#397`](https://github.com/zumerlab/snapdom/pull/397)
- fix: CSS vars perf, scrollbar styles, SVG image inline, nested line-clamp, iframe pseudos & isolation, Tailwind border (#334 #341 #348 #362 #371 #372 #386) [`#387`](https://github.com/zumerlab/snapdom/pull/387)
- fix: enable image download on iOS via Web Share API [`#384`](https://github.com/zumerlab/snapdom/pull/384)
- fix(background): inline background-image inside shadow DOM hosts [`#379`](https://github.com/zumerlab/snapdom/pull/379)
- Update URL handling to use location.origin in fonts.js [`#380`](https://github.com/zumerlab/snapdom/pull/380)
- fix: use nodeMap for source-clone alignment in inlinePseudoElements [`#381`](https://github.com/zumerlab/snapdom/pull/381)
- V2 release!! [`#319`](https://github.com/zumerlab/snapdom/pull/319)
- Preparing main branch for V2 [`#300`](https://github.com/zumerlab/snapdom/pull/300)
- Prepare 1.9.13 release by merging dev branch [`#256`](https://github.com/zumerlab/snapdom/pull/256)
- Adding 'exclusionMode' option [`#228`](https://github.com/zumerlab/snapdom/pull/228)
- Merge dev branch  [`#225`](https://github.com/zumerlab/snapdom/pull/225)
- fix(types): update `preCache` [`#166`](https://github.com/zumerlab/snapdom/pull/166)
- Update README.md [`#150`](https://github.com/zumerlab/snapdom/pull/150)
- Fix: add type def for `SnapOptions`  [`#111`](https://github.com/zumerlab/snapdom/pull/111)
- copy `checkbox.indeterminate` [`#104`](https://github.com/zumerlab/snapdom/pull/104)
- Related #84 [`#100`](https://github.com/zumerlab/snapdom/pull/100)
- Missing `width` and `height` in types [`#94`](https://github.com/zumerlab/snapdom/pull/94)
- Revert "Missing `width` and `height` in types" [`#98`](https://github.com/zumerlab/snapdom/pull/98)
- fix: del ths type check, the element in iframe can not work! [`#77`](https://github.com/zumerlab/snapdom/pull/77)
- fix: encode same uri multiple times [`#65`](https://github.com/zumerlab/snapdom/pull/65)
- Add Lucide to icon font detection [`#50`](https://github.com/zumerlab/snapdom/pull/50)
- Improve inlineBackgroundImages to support multiple background-image values.  [`#46`](https://github.com/zumerlab/snapdom/pull/46)
- fix: double scaled images [`#38`](https://github.com/zumerlab/snapdom/pull/38)
- Update Dev branch [`#11`](https://github.com/zumerlab/snapdom/pull/11)
- This PR dramatically improves the speed and accuracy of snapDOM. It increases the result size and may produce some long tasks, but it provides a solid foundation to address these side effects in the future. [`#6`](https://github.com/zumerlab/snapdom/pull/6)
- test(visual): commit the demo corpus the visual suite runs on [`9e083a3`](https://github.com/zumerlab/snapdom/commit/9e083a36b0ae611f7ad49352b2ec61a1f5ea76fd)
- Refresh v3 docs and examples [`6f90ea4`](https://github.com/zumerlab/snapdom/commit/6f90ea465bd8e32c17d2f91e5e98a0fdff18b188)
- build: commit the lockfile and pin playwright exactly [`66bbf37`](https://github.com/zumerlab/snapdom/commit/66bbf3739716c07b1ec03b759b34b7d901e95f74)
- Fix capture and plugin behavior [`9a854a5`](https://github.com/zumerlab/snapdom/commit/9a854a53e3c617122b37abaf4d64a476ebcffbd9)
- Fix capture fidelity [`67aa004`](https://github.com/zumerlab/snapdom/commit/67aa00438c73f11ff72a79f8d9a37c2a639abe9f)
- update site with lab experiments [`a8119fe`](https://github.com/zumerlab/snapdom/commit/a8119fe4d38373d4f60abc2a4957d5e72378e89f)
- docs: every file in src explains itself; CLAUDE.md points at the code [`c12cdd6`](https://github.com/zumerlab/snapdom/commit/c12cdd6bee4f740835e4fa39df9930977a46d93f)
- feat!: memoize from the first capture, snapdom.preCapture(), and no more preCache [`c84db57`](https://github.com/zumerlab/snapdom/commit/c84db57fa5052f70b9e925459b22cebfb0d8b932)
- docs: plain restyle, npm run site local-dist server, clearer burst demo [`13f8662`](https://github.com/zumerlab/snapdom/commit/13f8662fbec07f8aba8d48312fc369c412bbfc49)
- chore: keep development notes out of the repo [`c54b2e0`](https://github.com/zumerlab/snapdom/commit/c54b2e0485c5fe9e1e00447df392e9a99baa9cb1)
- Extend redact plugin with block and attribute privacy rules [`927df7f`](https://github.com/zumerlab/snapdom/commit/927df7f210ac33c43fc910a324577a8ec0c01154)
- test(visual): split the demo suite into six shards, gated on the connection [`0a5955a`](https://github.com/zumerlab/snapdom/commit/0a5955ae8d4b7fae92364de09b5812cc8db4fd55)
- feat: clip option + snapdom.viewport() — region capture with offscreen culling [`328226b`](https://github.com/zumerlab/snapdom/commit/328226b629143cd5d11fd07a8ac97ede32b4d037)
- feat(docs): live comparison lab, sharing one harness with the benchmarks [`032d5a0`](https://github.com/zumerlab/snapdom/commit/032d5a085c50215f37504606e57396c4908666d2)
- update website [`8603d70`](https://github.com/zumerlab/snapdom/commit/8603d70b410a954e37d2d6639a93b461c2be11f9)
- refactor(engines): move the SVG render out of core into engines/svg.js [`c2c92f2`](https://github.com/zumerlab/snapdom/commit/c2c92f20df32a16ac10fcc806979d09239d120d5)
- fix: correctness bugs found in the v3 pre-release review [`bb9fadc`](https://github.com/zumerlab/snapdom/commit/bb9fadc3ab6012c12d50057279a369cc745a1758)
- Align v3 documentation [`f319443`](https://github.com/zumerlab/snapdom/commit/f3194439f6d608c206dc98e1aceb4e8bae33831a)
- update website [`efe7905`](https://github.com/zumerlab/snapdom/commit/efe7905512a35293bd5f3ec8175672cecb86a29c)
- chore: add release checklist, evidence collector and packed-consumer smoke [`8198b27`](https://github.com/zumerlab/snapdom/commit/8198b276f96bf20bf6998ea40b5fd801c9769904)
- feat(capture): captureSelection renders the user's live text selection [`dfd7b9b`](https://github.com/zumerlab/snapdom/commit/dfd7b9b9f0ac1c6cd89c80d298cbe7e79dd2882d)
- feat(plugins): restore the capture geometry contract, and use one context for hooks [`ec7bbb3`](https://github.com/zumerlab/snapdom/commit/ec7bbb3285abb8a5495c39c7b2a11c0c2c2b84e0)
- feat(core): plugins declare how far the capture has to run [`1c8749f`](https://github.com/zumerlab/snapdom/commit/1c8749f11c8c9f55d0844d3abfde266ae00ecca4)
- test: add regression tests for stripHeightForWrappers behavior with stylesheet heights [`991bbe2`](https://github.com/zumerlab/snapdom/commit/991bbe2dc60ff3f20cd2c28ec9534017c6432d60)
- feat: differential recapture — dirty subtrees rebuild in place of full pipeline reruns [`e827723`](https://github.com/zumerlab/snapdom/commit/e827723c7061f37679835336e2502eba857e5e99)
- update tests [`35b4492`](https://github.com/zumerlab/snapdom/commit/35b449261ca0f963c8a2cfb80b18afd513aabd60)
- refactor: retire the idle() call-through — the ceremony outlived the scheduler [`2cd7780`](https://github.com/zumerlab/snapdom/commit/2cd7780cf095b72ee5643729c2b595fd1a530203)
- feat: add burst:true capture memoization, replacing session() [`c3f0a56`](https://github.com/zumerlab/snapdom/commit/c3f0a56dd0b02401ef078a411e3e7033e3fcdc10)
- fix: close the six audit defects (five open + shadow ::after) [`cabda0e`](https://github.com/zumerlab/snapdom/commit/cabda0e090249fff4ccb29703f258b7753fb6ca2)
- docs: align the site, README and changelog with v3 [`a8fbd79`](https://github.com/zumerlab/snapdom/commit/a8fbd79cfe7642407caa112e140926f41e996c9d)
- Add capture architecture and tiled rasterization articles [`574dbed`](https://github.com/zumerlab/snapdom/commit/574dbed43b9891770573964fbb14e1792eb9793d)
- Prepare public docs and demos while keeping Pro previews local [`807d654`](https://github.com/zumerlab/snapdom/commit/807d654868266e9294ed77f4365e26d6dd2a2eb9)
- test: suite review against the v3 API — 27 files updated, 1 deleted [`6ebcc46`](https://github.com/zumerlab/snapdom/commit/6ebcc46c49cbe3cba53e356a815d8ec6792049f0)
- test: port the d488, d489 and d491 demos and log visual retries [`a78f704`](https://github.com/zumerlab/snapdom/commit/a78f7047f9b1f0a57adf1bfbcce86bf32a9e967a)
- fix: transformed reconciliation. Ref #489 [`92c0770`](https://github.com/zumerlab/snapdom/commit/92c0770a21d99aaceef6568b8a65c6e57109f829)
- docs: English comments across the source, and drop stale markers [`f96ae3c`](https://github.com/zumerlab/snapdom/commit/f96ae3c4750b30870c4f973645ee178673710394)
- fix: offscreen captures. Ref #488 [`4ad601d`](https://github.com/zumerlab/snapdom/commit/4ad601d26586fd0fb27f182d999862f74ebe4c5b)
- bench: six real-world scenarios — where the next optimizations live [`096caa4`](https://github.com/zumerlab/snapdom/commit/096caa40428503242180e65389e3d6e24dd2b29a)
- fix(plugins): freeze semantic exports at the captured instant, and share one exclusion policy [`ce72bdc`](https://github.com/zumerlab/snapdom/commit/ce72bdc7cbc1b76b23be9b97d4654fe315abb2c2)
- refactor: delete pictureResolver's dead live-mutation machinery and its option surface [`a95a08d`](https://github.com/zumerlab/snapdom/commit/a95a08df43a697e791e473d9bf306fae0f3c7819)
- fix(styles): reproduce visibility and content-visibility the way browsers do [`b12d72c`](https://github.com/zumerlab/snapdom/commit/b12d72cc17a3958fbd66c12d2f79dbc543dc2734)
- fix: restore filter and filterMode alongside exclude [`e08f7ad`](https://github.com/zumerlab/snapdom/commit/e08f7adf09b79edbbe8f9dbc24cf24fac75c6b97)
- add ecosystem section [`bc93264`](https://github.com/zumerlab/snapdom/commit/bc93264b3400bade68673f5ce80dbf7b6ed5c1fe)
- Strengthen beta release validation and record the final review [`6351335`](https://github.com/zumerlab/snapdom/commit/6351335e68cf90a423c614bef6984cc1a96a1e01)
- refactor(engines): the canvas engine consumes the clone instead of skipping it [`7fa4e66`](https://github.com/zumerlab/snapdom/commit/7fa4e66a7618d14d51672978e400b8b9e2ba7bfe)
- test(bench): one output stage, the same pixels, and options the library actually reads [`a7f8eaa`](https://github.com/zumerlab/snapdom/commit/a7f8eaabaed9c3e27ae648b86ecc3f80d43164a5)
- feat(plugins): move input redaction out of core, keeping only the free mask [`a591670`](https://github.com/zumerlab/snapdom/commit/a591670b8436edf3eb828305e6a3fe4e2129bfec)
- perf(export): decode each capture's data URL in a throwaway frame [`6b5df15`](https://github.com/zumerlab/snapdom/commit/6b5df15b8c18f837d16e247dfdb9994a213cdf08)
- docs: benchmark tables that survive being checked [`5cd4288`](https://github.com/zumerlab/snapdom/commit/5cd4288e07b1c0faabe7844558a8feaddd3f5bad)
- add blog section [`8b3d462`](https://github.com/zumerlab/snapdom/commit/8b3d4627d999ce4b29c9cc11b339ac5411946910)
- perf(styles): ask whether a splitting selector matches under the root, not whether the document has one [`6e41f8f`](https://github.com/zumerlab/snapdom/commit/6e41f8fbf49fc693fceac34cf0d67e66cac6618e)
- chore(plugins): ship license and type declarations, require v3 [`3fb4549`](https://github.com/zumerlab/snapdom/commit/3fb4549ded431dff5504a5180698179a0d812928)
- feat(capture): outerShadows 'subtree' keeps the ink descendants paint outside [`fcf0a5a`](https://github.com/zumerlab/snapdom/commit/fcf0a5ae3ccfcf339aea5694769b6f4b93e98cfb)
- perf(styles): a mutation invalidates what it can restyle, not the document [`b9de6bf`](https://github.com/zumerlab/snapdom/commit/b9de6bf6e4a8b3306157890f19b39197dafe9f88)
- feat: experimental html-in-canvas engine, quarantined in src/engines behind engine:'canvas' [`5f73ed9`](https://github.com/zumerlab/snapdom/commit/5f73ed997da5c8ff356fd9ea9df55acfe53be175)
- perf(styles): share style snapshots across structurally identical siblings [`a55fb8c`](https://github.com/zumerlab/snapdom/commit/a55fb8c3e411fe6c66c82c36bbeb42b2d8931b26)
- refactor(plugins): one word for how far a capture runs [`021ef32`](https://github.com/zumerlab/snapdom/commit/021ef326b44b72a163a31181e11cd14a30d40bd3)
- test(category): make the capability matrix runnable, and readable [`9e0bdc1`](https://github.com/zumerlab/snapdom/commit/9e0bdc10122447973013c33002a439ea480a6cbf)
- feat(agents): toContext() — the read-the-UI half of the agent story, plus the documented verification contract [`1c266b1`](https://github.com/zumerlab/snapdom/commit/1c266b1d9cad84193c2c20651f8f3d718a984598)
- Fix capture state restoration and image-set parsing [`e37c3bb`](https://github.com/zumerlab/snapdom/commit/e37c3bbf1a0f839d36e80f275c0b6574c5bd14bf)
- build: make the published package self-sufficient and correctly typed [`e24a055`](https://github.com/zumerlab/snapdom/commit/e24a055970e8c12a8478c7059995bf49189cc952)
- feat(inputs): render the controls no engine paints in a foreignObject [`40258fb`](https://github.com/zumerlab/snapdom/commit/40258fbe21dc0d4fa9da390a4c7a64b2d31f2956)
- fix(burst): publish memo state only after a capture succeeds [`0e83fb5`](https://github.com/zumerlab/snapdom/commit/0e83fb588da53db6f4a079d926d0526f357972c0)
- fix(pseudo,fonts,clone): smaller fidelity defects found by the audit [`e5c275d`](https://github.com/zumerlab/snapdom/commit/e5c275d538070cc26e9fa2c1a2f0de56a4755e03)
- fix: keep an author-specified width on blockified spans (Ref #484) [`658402d`](https://github.com/zumerlab/snapdom/commit/658402d13bc7c3f48573a52a62c4cb9da0269d15)
- Fix resource isolation and inherited rendering fidelity [`0f79859`](https://github.com/zumerlab/snapdom/commit/0f798590807966f8472d3c020c9f9463b38054c6)
- docs: preCapture replaces preCache in README, FEATURES, CHANGELOG, the site and the llms files [`1dbfbde`](https://github.com/zumerlab/snapdom/commit/1dbfbde12336413c5591d70fa0ebe6380dbcb85b)
- docs: a photo gallery scene and the comparison on a real page [`54d7117`](https://github.com/zumerlab/snapdom/commit/54d7117bf4d4d53c05aa76cfa85ba8f4ced73e21)
- refactor: delete the cache.session global — sessions are per-capture by construction, full stop [`e5498d6`](https://github.com/zumerlab/snapdom/commit/e5498d66bb7c53bb6403c9ce5041a61be6aa7b2d)
- fix(cache): bound the error cache, and stop the compression worker from leaking or hanging [`b10767b`](https://github.com/zumerlab/snapdom/commit/b10767bf3cb8b0d1a0e8625a0fc69a5eb528899a)
- docs: record the hardening pass, what was refuted, and how it was measured [`b8c9b33`](https://github.com/zumerlab/snapdom/commit/b8c9b335d969c842e3812fefc280aecf49a42be3)
- perf(pseudo): 150 → 24 µs per inlined ::before [`8e65565`](https://github.com/zumerlab/snapdom/commit/8e65565f97e3ebeaa6199bf063fcc29d93b07abe)
- fix(iconFonts): compile the per-capture matchers instead of keeping them at module scope [`8ca1df7`](https://github.com/zumerlab/snapdom/commit/8ca1df72b7adbd50e23d1c89a5d54f8886a367a2)
- perf: stylesheet-scan property universe — snapshot only props the page can touch [`aeefbaa`](https://github.com/zumerlab/snapdom/commit/aeefbaae46313315eb5f5ba547fd6ed9150e07dc)
- feat: collapse cache policies to structural default + disabled; default embedFonts to 'auto' [`a92cd98`](https://github.com/zumerlab/snapdom/commit/a92cd98ae1ba853637e449169c286050c752d6ca)
- perf: replace Safari's 3x pre-capture warmup with a verified draw at raster time [`6ee4680`](https://github.com/zumerlab/snapdom/commit/6ee468081a96eb1731b0580aad18d454f2ce5b5c)
- fix: capture roots that are themselves the target element were skipped [`23a3611`](https://github.com/zumerlab/snapdom/commit/23a36110eb15a85944a7c0fffd3296fd634d49c2)
- revert(styles): key the scanned universe on the DOM epoch again [`710f50d`](https://github.com/zumerlab/snapdom/commit/710f50dbad8d246238419d02c2f858d1196ee505)
- fix: freeze the image the browser actually shows (srcset descriptors, type filters, content:url) [`6ac87ef`](https://github.com/zumerlab/snapdom/commit/6ac87efadbcc9ac9e8ded5af7f1f8d4b58a6c32d)
- fix: re-evaluate capture callbacks on every new capture [`c9f2c81`](https://github.com/zumerlab/snapdom/commit/c9f2c8186e52e4e0c082378f29fd979d033a384c)
- fix(geometry): bbox, clip and output-size corrections [`32c4fb0`](https://github.com/zumerlab/snapdom/commit/32c4fb01ebb9c16d450ea49a957b189f58238936)
- fix: fractional width. Ref #491 [`bbca5df`](https://github.com/zumerlab/snapdom/commit/bbca5df8882babb67a1a6690963150105b1ad111)
- fix: stop concurrent captures from sharing session maps and counter state [`d1379a6`](https://github.com/zumerlab/snapdom/commit/d1379a6cca502ccb75001e83982585ec18394f4b)
- fix(plugins,types): make the plugin surface behave the way it is documented [`a6aea12`](https://github.com/zumerlab/snapdom/commit/a6aea12ba077ceee4d185b8b0e03b42f15a54910)
- fix(styles): re-read every used-value property on identity twins [`723f665`](https://github.com/zumerlab/snapdom/commit/723f665d32b523e66702afa32aca8c25b08dc18d)
- fix(styles): stop every host-page mutation re-scanning the author stylesheets [`5e1212a`](https://github.com/zumerlab/snapdom/commit/5e1212a6fe8f90244dc68336912210077067a7d4)
- fix(pseudo): nested CSS, @import, masks and useProxy reach pseudo-elements [`fa6822a`](https://github.com/zumerlab/snapdom/commit/fa6822a708660804fbe5182c7bc9a69a3a1b8bd4)
- perf: selector-gated pseudo probe — styleScan collects ::before/::after/::first-letter selectors, one matches() replaces 3 per-node style resolutions [`6fbbbe4`](https://github.com/zumerlab/snapdom/commit/6fbbbe4a236daf1bf760c0a70e907cb72e65f217)
- perf(css): stop restating every box in its logical form [`d1ec1e4`](https://github.com/zumerlab/snapdom/commit/d1ec1e4f525224dfa9bed3a38dee0512d81bc388)
- docs: benchmark tables re-measured with the share gate and the banded raster; snapdom's arm ends where everyone else's does [`59f2ddc`](https://github.com/zumerlab/snapdom/commit/59f2ddc1211c517ed71f69ba2e34295424dbdec5)
- test: gate visual captures on readiness instead of a fixed delay [`61aa6ac`](https://github.com/zumerlab/snapdom/commit/61aa6ac5fd227a16713967aa3216d4084b2f69ff)
- perf(preCache): an element target seeds the burst memo with a real capture [`d8a4ba9`](https://github.com/zumerlab/snapdom/commit/d8a4ba98236c73605576be80a7c30e387f251d42)
- test(visual): cross-engine pixel coverage for the demo corpus blind spots [`2d2d30e`](https://github.com/zumerlab/snapdom/commit/2d2d30e28511c0fa09fa907329fc70addb412a09)
- fix(security): typed secrets never reach any output — mask at transfer time, exclude from semantic exports [`b04684a`](https://github.com/zumerlab/snapdom/commit/b04684ace3b633f0b7474496e8268de267b6cfa6)
- test(visual): fidelity comparison — domlens vs snapdom over the real demo corpus [`cb02e70`](https://github.com/zumerlab/snapdom/commit/cb02e70ebcc86e40dfba4be2e186610886b26f39)
- feat: auto-enable burst on repeated captures (canvas-bearing elements excluded) [`88e079d`](https://github.com/zumerlab/snapdom/commit/88e079de59baa71c95a4d47cffad89f7fef44618)
- fix: make DOM type checks realm-agnostic (ref #494) [`1c37692`](https://github.com/zumerlab/snapdom/commit/1c37692ba299724487d6fb51b0dd0ebb88ba8d2d)
- bench: make every comparison honest — and correct the standings it inflated [`fbdd92b`](https://github.com/zumerlab/snapdom/commit/fbdd92b9dacd02b50b5081bd32fbb439ce095618)
- fix(capture): three defects that corrupt, abort or leak out of a capture [`54df455`](https://github.com/zumerlab/snapdom/commit/54df455a2fec63462687d5cc3c0c05e40b235fdd)
- fix(fonts): never emit a remote url() when the font payload was evicted [`bed439e`](https://github.com/zumerlab/snapdom/commit/bed439ea695f73ca6c006eefeff8616f3c7c339a)
- fix(burst,styles): stop serving stale frames [`48b3f82`](https://github.com/zumerlab/snapdom/commit/48b3f823d9c0e91a17dffd3f72897e090446fb0b)
- fix(burst): auto-burst stops serving stale frames [`3980a17`](https://github.com/zumerlab/snapdom/commit/3980a17632f1d68c9090219e20ad72a757fa0ccc)
- fix: shadow fidelity in WebKit's SVG rasterization [`b7e9af2`](https://github.com/zumerlab/snapdom/commit/b7e9af2eb6671921e496697aa0789e6aeb99d91c)
- refactor(stages): drop the 'dom' stage, the clone is the floor [`90af231`](https://github.com/zumerlab/snapdom/commit/90af2311925885af83a9529e578cc87f11a914e0)
- refactor(exclude): one door for node exclusion, not two [`bd0e586`](https://github.com/zumerlab/snapdom/commit/bd0e5868121494405cc0e65e568e6ec2e37b5c29)
- perf: one sanitize walk instead of three, and no per-node control-char strip in deepClone [`d9e9457`](https://github.com/zumerlab/snapdom/commit/d9e94578e1980d2baf3079d7efc478df726cd04b)
- refactor(plugins): drop the duplicate html-in-canvas plugin [`2dbd751`](https://github.com/zumerlab/snapdom/commit/2dbd7516eb3836d27af4c768e180ba344c079ae8)
- docs(labs): add a live burst capture demo with a real Pikachu card [`3706d62`](https://github.com/zumerlab/snapdom/commit/3706d62301c0da964d248d1942744fac96a0ea08)
- test(category): survive a dead CDN link instead of aborting collection [`75e08d7`](https://github.com/zumerlab/snapdom/commit/75e08d769f65945cf1baf8207549566b63c79d65)
- fix(fonts): emit only the @font-face descriptors the source declared [`f97ab02`](https://github.com/zumerlab/snapdom/commit/f97ab022c0b0f96b38cc77ef138800ad7ff39382)
- fix(firefox): gradient text no longer captures as nothing [`a67d5c2`](https://github.com/zumerlab/snapdom/commit/a67d5c22f58701392b2fd2c0c36b83a42d645530)
- fix(diff): the geometry reconcile stops firing on every fractional box [`d0a20cf`](https://github.com/zumerlab/snapdom/commit/d0a20cf6b4250984bec0c18ff60be53b97be7cbe)
- perf(engine): hand the painted bitmap to pixel exports, mint the data URL lazily [`6e4bb61`](https://github.com/zumerlab/snapdom/commit/6e4bb611556feb9daa0c72281e7e4e379bf2edd8)
- docs: benchmark tables re-measured after the three optimizations [`6538a85`](https://github.com/zumerlab/snapdom/commit/6538a85074bba134f7b1c115ffc13bc78723473b)
- perf(svg): intern repeated inline style attributes at serialize time [`ea48ef2`](https://github.com/zumerlab/snapdom/commit/ea48ef28a8b047f5b6e34c1e4b94b2dcad22db53)
- docs: v3 install notes, migration rows and changelog history [`a8abf30`](https://github.com/zumerlab/snapdom/commit/a8abf301941902c59c30f2e55c285e27d9781272)
- Fix export privacy, text retention, and small image sizing [`1ed86fd`](https://github.com/zumerlab/snapdom/commit/1ed86fd2bdcf0aed4654e58e89ed3ce92be6a283)
- perf(raster): draw large captures as horizontal bands from one decoded image [`962a073`](https://github.com/zumerlab/snapdom/commit/962a07391dc0ae867524c794f48d411664dc0d87)
- docs: correct the v3 option reference and add a v2 migration guide [`60fb121`](https://github.com/zumerlab/snapdom/commit/60fb12188d9415ad4c0d6f5d6f2ab19b3beef7e4)
- fix(fidelity): background-attachment:fixed freezes the viewport slice the user was seeing [`7efaf97`](https://github.com/zumerlab/snapdom/commit/7efaf97d954bbc107b539ca0d6007a78bf9f3a36)
- test(visual): diff each capture against a live screenshot, not a recorded baseline [`6d7e97e`](https://github.com/zumerlab/snapdom/commit/6d7e97e6987ec439a996782297e4f2bc3b899028)
- update [`7beb85e`](https://github.com/zumerlab/snapdom/commit/7beb85e8e65b4e99290248300cd15546b4b1f967)
- refactor(html-export): consume the clone instead of re-parsing our own SVG [`2183a14`](https://github.com/zumerlab/snapdom/commit/2183a149fb3c21fa13f87e622402e06d90e9e89e)
- fix(clone): honour the show-poster flag when capturing &lt;video&gt; [`22b9a3b`](https://github.com/zumerlab/snapdom/commit/22b9a3bc57238f5b8422e09fb794b04c73d9c67b)
- fix: measure text truncation without replacing live text nodes (Ref #485) [`06b1860`](https://github.com/zumerlab/snapdom/commit/06b1860ce9ff1000730fea9ef2c8e6cf008b8c7d)
- fix: align the type declarations with the runtime [`62f5506`](https://github.com/zumerlab/snapdom/commit/62f5506fd965baedb0812affd3945a0fcb4ae1dc)
- fix: bound the canvas frame wait, warn on an empty canvas (Ref #486) [`a0b6e6e`](https://github.com/zumerlab/snapdom/commit/a0b6e6e3e78d8c4f4872c5fe78c864420a875205)
- perf(css): factor the shared half of the base reset [`c0e27b3`](https://github.com/zumerlab/snapdom/commit/c0e27b33144184f0740b5bbf7dd5c1152d4499dd)
- docs: ARCHITECTURE.md — the durable half of the branch notes, tracked at last [`ada9f5c`](https://github.com/zumerlab/snapdom/commit/ada9f5c934540e959827771310603da454f66e1d)
- chore: wave 0 guardrails — auto-recompile stale dist before tests, track CLAUDE.md, document real-Safari verification [`40dd96e`](https://github.com/zumerlab/snapdom/commit/40dd96e58d7ce05792fe704b651f1d71b7818595)
- fix: stop discarding a whole stylesheet when one family looks like an icon font. Ref #493 [`707d7e1`](https://github.com/zumerlab/snapdom/commit/707d7e1a4c408c986d92c32ec08c3a1780ce0074)
- fix: neutralize CSS zoom on the capture root (Ref #483) [`5508550`](https://github.com/zumerlab/snapdom/commit/5508550471f8a2a2201ec46e1115805d5a767ce5)
- perf(clone): an opaque video frame goes out as JPEG, and preCache encodes no frame [`eca3285`](https://github.com/zumerlab/snapdom/commit/eca3285a38b5b965c79bd8de44501636472ad323)
- build: two dist files, ESM and the script-tag IIFE, and nothing else [`19ac2d4`](https://github.com/zumerlab/snapdom/commit/19ac2d454de5f6104bf38b6893f2159edcc96377)
- fix: prefetch mask and border-image URLs in preCache, drop the dead warm call [`423acd5`](https://github.com/zumerlab/snapdom/commit/423acd52c447377da095091344df01d1ea472ed4)
- fix: resolve image-set()/-webkit-image-set() by device pixel ratio [`f1e1cc2`](https://github.com/zumerlab/snapdom/commit/f1e1cc2ab186e557f4077277554e92103e930f8f)
- Make the test suite pass on Firefox and WebKit [`74de348`](https://github.com/zumerlab/snapdom/commit/74de348e6eeb99dfb8a7acf2cafb68d8c537dddf)
- refactor(network): improve network lane management and timeout handling [`d8d4b65`](https://github.com/zumerlab/snapdom/commit/d8d4b6517338a3a9076bd78a140f27c9b575fe3e)
- chore: add cross-engine visual report (npm run report:cross) [`5b6e8cd`](https://github.com/zumerlab/snapdom/commit/5b6e8cd983a651829ba35c5efecc10dcc7258d95)
- fix(fidelity): @media in shadow CSS and kept &lt;style&gt; clones is frozen to the live viewport [`758c19c`](https://github.com/zumerlab/snapdom/commit/758c19c08d829e4a22c152832fb0bdfbf07c9364)
- test: cover the compress fallback and the bbox strip; mark unreachable paths [`8ed62a0`](https://github.com/zumerlab/snapdom/commit/8ed62a07c83e3558c07f84403ce74ec5cac4cb7f)
- docs: refresh made-with gallery — 14 new verified projects, drop fantastic-admin [`459baf8`](https://github.com/zumerlab/snapdom/commit/459baf81e7806b52c7c7d513f2e4afd720eb48f4)
- fix: preserve auto margins after partial shadow layout [`ae3e028`](https://github.com/zumerlab/snapdom/commit/ae3e02845ddae7a7c1aac76149af096223e3a715)
- fix: size hide spacers from used CSS values [`1d14665`](https://github.com/zumerlab/snapdom/commit/1d146651f4554ec0a53afc705769dd73330836fb)
- test: add type-checking for types/snapdom.d.ts to the test pipeline [`a06a71a`](https://github.com/zumerlab/snapdom/commit/a06a71a1cc901355af80332655a74644110ce774)
- feat: compress and burst become engine behavior, fast is gone — API surface shrinks again [`b13c3d9`](https://github.com/zumerlab/snapdom/commit/b13c3d9837db2bee0a2be8c878209d2dc735029c)
- perf(pseudo): ask whether the subtree can match, not whether the document mentions a pseudo [`8108126`](https://github.com/zumerlab/snapdom/commit/8108126f823403fda24726d9af5536cb00fd126c)
- fix(clone): never bind a rendering context to the page's own canvas [`195c8b0`](https://github.com/zumerlab/snapdom/commit/195c8b0f872eee0fe30131590eb1139cd766db80)
- fix(fidelity): authored ::marker and ::first-line survive capture as scoped rules [`d7156de`](https://github.com/zumerlab/snapdom/commit/d7156de65361e8b76401cac4ba618ad9977d2174)
- Refresh projects using SnapDOM [`acd64ae`](https://github.com/zumerlab/snapdom/commit/acd64ae73f7bdb7271b0617b7528731c204e3000)
- bench: three-way capture bench on liquidGL's home (NaughtyDOM / v2 / v3) [`fafd79e`](https://github.com/zumerlab/snapdom/commit/fafd79e73879a81d3d247433545e0e1a6fc9e1d8)
- fix(svgDefs): inline the defs an HTML element references through CSS [`b3a027c`](https://github.com/zumerlab/snapdom/commit/b3a027cb14de3187c38b46b9a21fcef52ca6a5b8)
- fix(clip): force content-visibility inside the clip window — no more blank bands [`0288d81`](https://github.com/zumerlab/snapdom/commit/0288d8177a6a62c25c7c85e2e6b2c49c0057e4f5)
- feat: snapdom.fromString + drift-free video recording [`3c512ad`](https://github.com/zumerlab/snapdom/commit/3c512adf9c63ed9915cd8570f594eb4e2a8aea13)
- fix(clone): capture an indeterminate checkbox as indeterminate [`63c72ab`](https://github.com/zumerlab/snapdom/commit/63c72ab7043f00cc86505052db7dcaf35fff78b8)
- fix(burst): compare nested options and callbacks in the memo signature [`ee176bf`](https://github.com/zumerlab/snapdom/commit/ee176bf81c10b3d9ee5281045ad553060630cd17)
- fix(exclude): redaction preserves layout and reaches the semantic export [`305f691`](https://github.com/zumerlab/snapdom/commit/305f691ba753318423f69a005aa3f785f5d1a347)
- Fix rotated-root captures clipped at edges (d31) [`64c5a8f`](https://github.com/zumerlab/snapdom/commit/64c5a8fb9de9c1a269767a0fb315cb2726bbb817)
- fix: keep Safari toSvg/toImg vector at scale instead of rasterizing to PNG [`dbbff09`](https://github.com/zumerlab/snapdom/commit/dbbff09433847fd1819cfcb900579ef9638f58d4)
- perf(raster): choose the PNG encode route by output size [`37e3b28`](https://github.com/zumerlab/snapdom/commit/37e3b2846229d7199fbc801f96ad72bfbc176ac2)
- perf(styles): narrow the layout re-read on identity-share twins [`e6cd93d`](https://github.com/zumerlab/snapdom/commit/e6cd93d2c25a16800930dd5c8747d3787f8e5818)
- feat(export): toCanvas draws into a caller-supplied canvas [`b952af8`](https://github.com/zumerlab/snapdom/commit/b952af8d11f9419fdd6d51c4f3df1c87a145ca00)
- test: exercise plugins against v3 and refuse silent visual runs [`090d394`](https://github.com/zumerlab/snapdom/commit/090d39425487c83d6310fef23f8fe86f73f36170)
- fix(build): one runtime for plugins and preCache, and a require() that works [`ee5028e`](https://github.com/zumerlab/snapdom/commit/ee5028ea8dc6381c3c8607a94fa8b69ba049f984)
- fix(capture): sanitize attribute names on the capture root, not only descendants [`0434bca`](https://github.com/zumerlab/snapdom/commit/0434bca1eaafea7f29eb41e97c0245a891e0b4ec)
- fix(fidelity): resolve nested @media; a scrolled iframe keeps its offset [`87eb239`](https://github.com/zumerlab/snapdom/commit/87eb2398fed95cc039e13724a89c07bb5d35e725)
- fix: style shadow hosts and slotted nodes from their own sheet [`c0bfbc5`](https://github.com/zumerlab/snapdom/commit/c0bfbc5d739d94827a0260a01bca8c08578857de)
- perf: drop resolveCSSVars' per-node baseline fallback — the style snapshot already carries class-driven values [`fb9dfe8`](https://github.com/zumerlab/snapdom/commit/fb9dfe8d263d9e071427db08e1058ac774e0f6e0)
- fix(clone): keep the pre-toDataURL frame for WebGL canvases [`13b9b2d`](https://github.com/zumerlab/snapdom/commit/13b9b2d7cf3aee85d55ee4fb12e701ed7bafb208)
- Separate internal competitor benchmarks from the public comparison [`3447795`](https://github.com/zumerlab/snapdom/commit/3447795f74f3928abb52f46795145f13b8475ea3)
- test(visual): make the competitor comparison generic [`8dabc13`](https://github.com/zumerlab/snapdom/commit/8dabc13bb2fb9e82d44aadf895c3f23f8259b8e4)
- perf: cut per-node promise/allocation churn — sync inlineAllStyles, one ctx per capture, unwrapped child cloning [`933ca2a`](https://github.com/zumerlab/snapdom/commit/933ca2a9dc296c2ef590a20f61089742ac32a980)
- update [`800d6e1`](https://github.com/zumerlab/snapdom/commit/800d6e1946f6b241614f636e6a83ab0aaa6d3e6a)
- perf(compress): settle the no-gain case before decoding or hopping threads [`259c665`](https://github.com/zumerlab/snapdom/commit/259c665184e2fe9792390c285dfd864ee0931c7b)
- fix(compress): only downsample layers the box actually scales, and stop hanging [`25e9b80`](https://github.com/zumerlab/snapdom/commit/25e9b80519ca65872025f6e71182dae648f5b542)
- feat(api): unified exclude — selectors and predicates in one option, filter stays a keep-polarity alias [`2bd1c70`](https://github.com/zumerlab/snapdom/commit/2bd1c70aae714db3406144002913230de4aec263)
- test: pin devicePixelRatio in DPR-dependent tests [`b442799`](https://github.com/zumerlab/snapdom/commit/b442799fe867ffdb2e25351a71160e1bbd192d79)
- test: split burst benchmark into isolated static/mutating files [`72bbe81`](https://github.com/zumerlab/snapdom/commit/72bbe8130a9336070a778982e4cafef43b7cb111)
- perf(compress): a lazy worker pool, and the fetched Blob instead of its base64 string [`8d3f47f`](https://github.com/zumerlab/snapdom/commit/8d3f47f20fe4cd395fd648d7c6fb877bf3981303)
- test(visual): persist what each library captured in the domlens compare [`6b5a17d`](https://github.com/zumerlab/snapdom/commit/6b5a17d38d0fbf0034f5a98f326b472cc1228c49)
- fix(fidelity): open modal dialogs/popovers keep top-layer paint order and get a synthesized ::backdrop [`c9c5851`](https://github.com/zumerlab/snapdom/commit/c9c585133d87905064216a13b2ad0c54d0b2fe7a)
- refactor: formal per-capture session object; pin benchmarks to the cold pipeline [`cc88a5e`](https://github.com/zumerlab/snapdom/commit/cc88a5eb89d57ef6e4b4759f69e8e93de19504f9)
- fix: let &lt;use&gt; icons inherit fill from the use site (Ref #487) [`90d4d2f`](https://github.com/zumerlab/snapdom/commit/90d4d2fea5df9737286e402a31805b13e2d0ba25)
- feat(api): one format option and one sizing rule across every exporter (v3) [`c3e96df`](https://github.com/zumerlab/snapdom/commit/c3e96dfad91753e4326b4a3b8d53179d91197fde)
- test(visual): size the visual suite for the run it is actually in [`a231a05`](https://github.com/zumerlab/snapdom/commit/a231a0515135f2fa617ebd7bb459e4e0ce02ceea)
- feat(api): result.warnings — a programmatic answer to 'did this capture degrade?' [`0659f7b`](https://github.com/zumerlab/snapdom/commit/0659f7ba72b1982954e8894ff5877370e3cedc23)
- refactor: preCache is a network prefetch, not a cache-policy knob — v3 surface [`87bdd74`](https://github.com/zumerlab/snapdom/commit/87bdd7449feed5918f03ca604ac1cf61a13b466b)
- bench: snapdom.benchmark and snapdom.complex.benchmark measure this checkout only [`8ea1595`](https://github.com/zumerlab/snapdom/commit/8ea1595ad122c61e859b94d2899b35dec713e495)
- perf: offload compress downsampling to an OffscreenCanvas worker (sync fallback kept) [`0b24908`](https://github.com/zumerlab/snapdom/commit/0b249086e2a822c294c78f52abd13e77390b445a)
- test(clone): pin the textarea value ordering that stops the duplicate [`573c850`](https://github.com/zumerlab/snapdom/commit/573c850ade7c6277912303087e75e083e6044932)
- fix(fidelity): &lt;object&gt;/&lt;embed&gt; stop rendering blank — image embeds become inlined &lt;img&gt;, same-origin documents rasterize [`f5cb997`](https://github.com/zumerlab/snapdom/commit/f5cb997ddda69140e58f869f479be3b2a53b11ba)
- test(bench): make the three unreliable benchmarks tell the truth [`aef9e42`](https://github.com/zumerlab/snapdom/commit/aef9e42560f5ac4accc0925ee9b58d3e26b9a4a8)
- fix(plugins): auto-burst and diff respect the plugin contract — render hooks are never silently skipped [`98eee9d`](https://github.com/zumerlab/snapdom/commit/98eee9d7d2126be53956d309c35bbf92e99efa6e)
- perf(images): write an inlined data: URL to the clone once, and never scan its megabytes [`0f99003`](https://github.com/zumerlab/snapdom/commit/0f99003703a745d977540c5da6bfbacb45b86039)
- fix(counter): whitespace grammar, and the latin counter styles [`b95940a`](https://github.com/zumerlab/snapdom/commit/b95940aed35b98792373fd5cf14850fb869ee87e)
- feat(session): close the MutationObserver-only staleness gap [`b15b418`](https://github.com/zumerlab/snapdom/commit/b15b418e744f732afb17f06159e01d55bc875127)
- fix: size hide spacers with the scrollbar gutter [`ff7b186`](https://github.com/zumerlab/snapdom/commit/ff7b186b9424a04d885556ba6f2c25b92d52e3e5)
- fix(fidelity): resolve open-quote/close-quote keywords — they painted as literal text [`e245fa5`](https://github.com/zumerlab/snapdom/commit/e245fa5fc4062f1800a9cf51378599bd245ac907)
- fix(burst): a capture with a nested iframe can hit the memo [`26b42e8`](https://github.com/zumerlab/snapdom/commit/26b42e8d3da21785d14e8024d561c9ce24ce6853)
- feat(burst): animated subtrees become diff frames — the recording workload stops paying the full pipeline [`d83175f`](https://github.com/zumerlab/snapdom/commit/d83175f7209b50e86e90498caab9f3930d5ff8ab)
- fix(api): iconFonts stops mutating a permanent global — matchers are replaced per capture [`f2b096c`](https://github.com/zumerlab/snapdom/commit/f2b096ce50486da526fab6d11d30b0c99ae5ce1a)
- perf: defer buildCounterContext's document walk until actually needed [`8020750`](https://github.com/zumerlab/snapdom/commit/8020750260924115da501dec7cf211375040781c)
- fix(clone): clone slotted light DOM only once [`f54fcfe`](https://github.com/zumerlab/snapdom/commit/f54fcfe008665b99b394b9cecae10b44db541ce9)
- feat: diff geometry-reconcile — layout-rippling mutations stay on the diff path, byte-equal [`bbf049e`](https://github.com/zumerlab/snapdom/commit/bbf049eac60ccde57f479e740b7a0a9a0c1f5724)
- fix: adaptive burst baseline so the memo re-engages after option changes [`d43b6ab`](https://github.com/zumerlab/snapdom/commit/d43b6ab5eddd0f4bc4ea4c2130b07a1556c9a252)
- feat(preCache): warm the style snapshots when given an element [`e6d566a`](https://github.com/zumerlab/snapdom/commit/e6d566abe66587b482deb99d160a299e50bcc804)
- docs(plugins): install notes, headers and homepage [`a2962e7`](https://github.com/zumerlab/snapdom/commit/a2962e7f420aad769d09fff76e18ea85c79a1d5c)
- feat(engine): follow the html-in-canvas origin-trial contract (drawElementImage) [`ebdacca`](https://github.com/zumerlab/snapdom/commit/ebdaccaaf92258237c394dcff46800d69300cd80)
- fix: realm-safe element guards — pseudos and per-node handlers now survive iframe-content captures [`5e9d8e1`](https://github.com/zumerlab/snapdom/commit/5e9d8e1dfbe0804d0b2c0eac98be0e859a992d33)
- perf(export): keep the bands off when embedded resources outweigh the markup [`d76f51f`](https://github.com/zumerlab/snapdom/commit/d76f51f21780a464c460134d8b629e1801f7da2f)
- docs: CLAUDE.md catches up with the branch and the new repo layout [`de670ed`](https://github.com/zumerlab/snapdom/commit/de670edcc81a9542fcbd27c6f4be36b004a04244)
- docs(api): sync the v3 surface — types v3, one format/exclude/sizing story, warnings declared [`a18ee2f`](https://github.com/zumerlab/snapdom/commit/a18ee2ff0eb326a1ba9d9a3ab9c1373bd96bd071)
- perf(styles): compose the twin signature per identity instead of re-hashing [`2bde330`](https://github.com/zumerlab/snapdom/commit/2bde33030dd2f4b6a566a6841de29496281179bb)
- feat: warn once when width-softened text risks re-wrap without reconcile:true [`1b882d6`](https://github.com/zumerlab/snapdom/commit/1b882d69efd07357abfdacc97469b48b6713b278)
- fix(styles): purge the epoch-scoped style caches on invalidate [`9c35586`](https://github.com/zumerlab/snapdom/commit/9c355864e07c67a92e63fc7fc61576430c818996)
- refactor: collapse the fast option — the idle-sliced path only added latency [`9a0a220`](https://github.com/zumerlab/snapdom/commit/9a0a220544acec57fef6541f9c27b0eb2088185f)
- docs: notes on what can graduate from next to main [`5ef35cf`](https://github.com/zumerlab/snapdom/commit/5ef35cf3f49d9901a8fad9f6763bea75345515ad)
- docs: replace JetBrains Mono with Arial for labels, system mono for code [`aa27710`](https://github.com/zumerlab/snapdom/commit/aa27710783b0d663ae4ac4e2de275a5ce0c3b0f1)
- test(bench): price what the page's own stylesheet costs a capture [`aaeaa52`](https://github.com/zumerlab/snapdom/commit/aaeaa52b5785446d90d7dd03c537d48fb29c82fe)
- feat(plugins): export ctx carries the render artifacts + lazy svgString; PLUGIN_SPEC v2 [`680ce03`](https://github.com/zumerlab/snapdom/commit/680ce03d86582151d116be96e619384efc631850)
- fix: key the embedded-fonts cache by document identity [`05ef9a9`](https://github.com/zumerlab/snapdom/commit/05ef9a9b047087059d07166d7c77b82bf2a0ad01)
- test(styles): pin #328, and bound the optimization it hides [`7c9daac`](https://github.com/zumerlab/snapdom/commit/7c9daacf91ecb997dd90a852bb4c53af66a79654)
- chore: drop CI, verification is local [`ee84804`](https://github.com/zumerlab/snapdom/commit/ee84804369603a15e219298660a78a8fa1818687)
- fix(clip): husks preserve collapsed-through margins — deep-scroll windows no longer drift [`f11c83c`](https://github.com/zumerlab/snapdom/commit/f11c83c924707a50eff1b67c676c580e4d3ade75)
- Fix standalone plugin template setup and verify packed installation [`08043c1`](https://github.com/zumerlab/snapdom/commit/08043c1d9a9765655628f4bf4c0584453a52d5b2)
- test(bench): drop the "cache soft" arms — there is no such mode [`b0b6a73`](https://github.com/zumerlab/snapdom/commit/b0b6a7346e570c1426387f7c2ed09b1ed1ac428b)
- docs(bench): the deep tree carries a ::before stripe on every leaf [`bda4457`](https://github.com/zumerlab/snapdom/commit/bda4457d7aa1a943e1376c9fe7076c11ba658b13)
- fix: image and font loads invalidate the burst memo (no DOM mutation involved) [`6620d4a`](https://github.com/zumerlab/snapdom/commit/6620d4a0ebca4a9264b9e7c3c302c9bd635010e0)
- update [`1ef7054`](https://github.com/zumerlab/snapdom/commit/1ef70544937489a7bf9e4a36f60005bf1495df7a)
- fix: engine detection and dead state that documenting the source exposed [`ac8d870`](https://github.com/zumerlab/snapdom/commit/ac8d870e3290e9d357bb60ff05d8592f5ad024b9)
- perf: NO_DEFAULTS_TAGS skip the full style snapshot — their class key was always discarded [`2cf2811`](https://github.com/zumerlab/snapdom/commit/2cf28111363e31579888936be28085717757e95e)
- fix: reuse snapFetch in pictureResolver instead of a hand-rolled fetch pipeline [`a737419`](https://github.com/zumerlab/snapdom/commit/a737419a60657f6665ded760b71af14d0a049e1c)
- bench: this checkout always runs against the published npm latest [`441fd64`](https://github.com/zumerlab/snapdom/commit/441fd64f1d1509092034a8b8f083eca68a56efe7)
- perf(styles): stop re-resolving inline declarations the clone already carries [`30b7b0e`](https://github.com/zumerlab/snapdom/commit/30b7b0e06950bcff5be5e4481d08ead2a062d97b)
- perf(background): read the layout props from the style snapshot [`363d0f0`](https://github.com/zumerlab/snapdom/commit/363d0f010a9677cb1ff2719c154706b597caf033)
- fix(inputs): the accent-color keyword `auto` is not a paint [`3f5bd45`](https://github.com/zumerlab/snapdom/commit/3f5bd457487ba28637041b33ab2b749438afb042)
- docs: snapdom-v3 is its own clone now, not a worktree of the public repo [`5653dc0`](https://github.com/zumerlab/snapdom/commit/5653dc0dbb764d1fe2821e162bf9979fa1c33581)
- perf: memoize isInSvgTemplate per style epoch — the ancestor walk ran 3x per SVG element, O(depth) each [`ee8d3c5`](https://github.com/zumerlab/snapdom/commit/ee8d3c50c90012e27c34676671801fde4d41078a)
- refactor: one shared style-environment epoch (head+fonts) replaces burst's duplicate observers [`2b9ae03`](https://github.com/zumerlab/snapdom/commit/2b9ae031a1da2c1da4424f06f567c4840b615dba)
- test(styles): pin the three contracts of the inline-style normalization [`cf3cccb`](https://github.com/zumerlab/snapdom/commit/cf3cccb63510585c1445cb9e1b3293a8614eee25)
- fix: align margin-collapse neutralization by nodeMap, not child index [`9fa7d89`](https://github.com/zumerlab/snapdom/commit/9fa7d89bf145305eb216d930395d2c737abcc9b9)
- test: use importOriginal in vi.mock factories (fixes flaky WebKit runs) [`91c1e2f`](https://github.com/zumerlab/snapdom/commit/91c1e2fe1dc569cf690dd6cfe48f1b5431c95918)
- fix(api): a capture-time format reaches toBlob; plugins get ctx.element [`3b1e877`](https://github.com/zumerlab/snapdom/commit/3b1e8773d191c4f50f0cd0fd3f96afcf2e8aa248)
- docs: record the defects the audit left open, and why [`df48d1f`](https://github.com/zumerlab/snapdom/commit/df48d1fbcaeb74e37646b3359e99b0a1b720499f)
- fix(styles): interaction state invalidates cached style snapshots [`04bc827`](https://github.com/zumerlab/snapdom/commit/04bc827512f0e5e32783c53071b27a77ef905a48)
- fix(clone): skip snapdom's own scaffolding below the root [`5868a69`](https://github.com/zumerlab/snapdom/commit/5868a69c3fba1cb5ab2aa8ee7272a61ea3cd093c)
- fix(clone): drop light DOM that no slot accepted [`aaf5b13`](https://github.com/zumerlab/snapdom/commit/aaf5b13bd70dc37b8228b9079a296b096ca78f6f)
- fix: running animations disable the burst memo — every animated capture is a fresh frame [`acc4309`](https://github.com/zumerlab/snapdom/commit/acc4309468d05fed0117a018d64ec21564d15769)
- fix: resolve &lt;picture&gt; srcset via media-query matching, not currentSrc [`b94f652`](https://github.com/zumerlab/snapdom/commit/b94f6522c67b5fbfb738820e7233ca08d6500350)
- docs: README for v3 — announcement and complete options reference [`e72b4c6`](https://github.com/zumerlab/snapdom/commit/e72b4c66e30eafc2b57e2b5e2f3db6ae32066e4c)
- docs: document reconcile, burst, invalidate, and image-set() resolution [`5d9d74f`](https://github.com/zumerlab/snapdom/commit/5d9d74fa0024414b3fdead4daab4591e24249431)
- fix: serialize session.capture() calls to stop races on shared cache.session [`9f3cb23`](https://github.com/zumerlab/snapdom/commit/9f3cb238e9fac4cac904f4375d7db955c9f1f144)
- fix: guard content-sized boxes against sub-pixel width truncation (text re-wrap) [`4b92392`](https://github.com/zumerlab/snapdom/commit/4b923926421d50c05b8cf0195cb2de6e2ecdfc4e)
- docs: migration notes for internal options and the plugin export facade [`d960351`](https://github.com/zumerlab/snapdom/commit/d96035138696000d3f7e8e608a1dd902991f115f)
- fix(text): an emoji split by the ellipsis bake no longer rejects the capture [`d9f6040`](https://github.com/zumerlab/snapdom/commit/d9f604057c0aef3a7650fe95072764b1f14207d8)
- refactor: delete the duplicate isIconFont and share one image-MIME regex [`a9afcf0`](https://github.com/zumerlab/snapdom/commit/a9afcf0f95b2a75428e1a1838a6c7568f4893c8e)
- refactor: dissolve the live-DOM picture resolver — lazy placeholders resolve on the clone [`1c5e3e8`](https://github.com/zumerlab/snapdom/commit/1c5e3e890e340d739f27360ad3a099cc86856299)
- fix: dedup extendIconFonts entries instead of growing list unboundedly [`56cbe26`](https://github.com/zumerlab/snapdom/commit/56cbe26c724612910aa6c54f74ca2f537bf2c268)
- fix: keep root filter blur() and always expand bbox for its bleed [`3f6e6e7`](https://github.com/zumerlab/snapdom/commit/3f6e6e74bc31b075abcf84d5243eff8f163bf758)
- fix: derive missing export dimension from post-bleed viewBox, not pre-bleed box [`4173c93`](https://github.com/zumerlab/snapdom/commit/4173c9361a783d617e38e759b275645b96ee95a2)
- docs(site): plugin notes and v3 wording [`5768129`](https://github.com/zumerlab/snapdom/commit/576812972434035fb8b2e6997cdb0e2985f4568c)
- fix(raster): size the decode and canvas clamp per engine [`a63f013`](https://github.com/zumerlab/snapdom/commit/a63f013c8d0b505f7d7bf7d83783dcd444d3c21e)
- docs: wave 5 lab notes [`fa1b3f2`](https://github.com/zumerlab/snapdom/commit/fa1b3f27ab79f8960d68380cb94b158980d10968)
- fix: collect svg defs referenced from the root svg's own attributes [`441e3cf`](https://github.com/zumerlab/snapdom/commit/441e3cf62d431dfbebf482a683716b3fe63f79bf)
- fix: keep password values out of the memo signature [`1d8f370`](https://github.com/zumerlab/snapdom/commit/1d8f3706f1bb48d99fb69241918dcf2271049f40)
- docs: surface the texture-loop features the WebGL audience is looking for [`7e5ac73`](https://github.com/zumerlab/snapdom/commit/7e5ac736604ab78b348ed6eb7e0dadc75151ddd9)
- fix(compress): target the visible resolution exactly, never below it [`564120c`](https://github.com/zumerlab/snapdom/commit/564120c28ab9dd8e21ebbfc790084092312efdd8)
- docs: record the obsolescence sweep decisions [`d1988c8`](https://github.com/zumerlab/snapdom/commit/d1988c8bc793b97f8db954181a357d56657b41b1)
- fix: scroll events invalidate the burst memo (scroll produces no mutation records) [`cc773ec`](https://github.com/zumerlab/snapdom/commit/cc773eca23c592f78a17a2a35dd1878fb505afc6)
- fix(fonts): the embed cache key accounts for the codepoints used [`ee262c1`](https://github.com/zumerlab/snapdom/commit/ee262c15a497b7aec1fd7403dff92f8336cd0dd8)
- docs: size Safari's raw-SVG iframe from the capture itself, not the live rect [`c390280`](https://github.com/zumerlab/snapdom/commit/c3902806d5e44206a0c90caa65855b1d0afc8775)
- feat(engine)!: rename the option value to engine: 'html-in-canvas' [`6434741`](https://github.com/zumerlab/snapdom/commit/6434741fe03923af4fb9482001d9ab129504d465)
- docs: wave 1 lab notes — six hot-path findings landed, measured, Safari-verified [`5ffbb40`](https://github.com/zumerlab/snapdom/commit/5ffbb407ad8f1ce4462384e3e97fdb7e0f1d41c6)
- upate [`b2e9565`](https://github.com/zumerlab/snapdom/commit/b2e9565de5e3ca33a3736c711a765745a3726912)
- docs(lab): label the SnapDOM row with the version it loaded [`c502654`](https://github.com/zumerlab/snapdom/commit/c5026547dc564581f9608af45ca2a57496b9b9b8)
- types: declare the plugin-facing context surface [`d73937a`](https://github.com/zumerlab/snapdom/commit/d73937a2bdfc4bf539238e79a262dc86e9e36a52)
- docs: wave 3 lab notes [`d5ec52e`](https://github.com/zumerlab/snapdom/commit/d5ec52e98a7e74d87267537032ee27995c040419)
- docs: purge deleted machinery from shipped docs — safariWarmupAttempts, opt-in burst, fast, checkBurstAdvice [`c480f82`](https://github.com/zumerlab/snapdom/commit/c480f82bdd3198ef5a5b00cdd8b9b84ee3648651)
- build: resolve @zumer/snapdom to this checkout, not the published v2 [`09dc235`](https://github.com/zumerlab/snapdom/commit/09dc235a6f53d354821430a1ee428c54c41422d8)
- fix(leaks): release what the raster and icon paths were holding [`19614db`](https://github.com/zumerlab/snapdom/commit/19614db4c8b73628df4ad36b3ae32660838d668c)
- refactor: production code never reads the cache.session global (test-surface only) [`76b6770`](https://github.com/zumerlab/snapdom/commit/76b6770e1c3ce0ca98d2e44f729106b8f586542d)
- fix: realm-safe checks for the canvas option and @supports rules [`a7fbcae`](https://github.com/zumerlab/snapdom/commit/a7fbcae182064de5337ecceb0d7cb9aa4b69a3e6)
- update tests [`5813b3c`](https://github.com/zumerlab/snapdom/commit/5813b3cd55ed28c35ddb29cd530d1183a76b1cd3)
- chore: bring the npm scripts in line with v2's [`40d8932`](https://github.com/zumerlab/snapdom/commit/40d8932f93390b13cf72ecdd2c5322ec60f4eec4)
- docs: wave 4 lab notes [`fae6677`](https://github.com/zumerlab/snapdom/commit/fae667757ccfb41aa2637532e4d3614ffe041944)
- docs: comparative benchmark 2.23.1 vs next vs experimental [`410b189`](https://github.com/zumerlab/snapdom/commit/410b1892e585d7c7c2a8120be06af5cf2fcce876)
- Add cross-browser test runs (BROWSER=firefox|webkit|all) with per-engine visual baselines [`f2b72d8`](https://github.com/zumerlab/snapdom/commit/f2b72d8d063bd5ab92fd596aae00ed1abc424cd2)
- fix(plugins): apply the filter string when the preset is unknown [`1730bfc`](https://github.com/zumerlab/snapdom/commit/1730bfc04e520dece2687fa5410bc057c24b9929)
- fix(docs): block the scroll input, don't correct it afterwards [`ae97f88`](https://github.com/zumerlab/snapdom/commit/ae97f88ad60ddf6bb38416e888ade2ef311bc45d)
- docs: record the v3 branch layout after promoting it to main [`ce9ff4d`](https://github.com/zumerlab/snapdom/commit/ce9ff4db9853e4ef8d1a78af3f96f9778843913a)
- docs: wave 2 lab notes [`62737e4`](https://github.com/zumerlab/snapdom/commit/62737e4f09615762bf12bb7e4297bc6eb583badf)
- docs: record differential recapture design, guarantees and bail conditions [`0b13a42`](https://github.com/zumerlab/snapdom/commit/0b13a42e529132222cf3445eb5c28679bc8e9627)
- fix: stop a failed export from poisoning every later export on the same result [`e69f51b`](https://github.com/zumerlab/snapdom/commit/e69f51bff1b018bee909dc8fc8fdd9dcaca18ea9)
- fix: stop compensating the root's stripped translation in the viewBox bbox [`3241481`](https://github.com/zumerlab/snapdom/commit/32414811fa99c63a8bfc786080a752807f486c70)
- fix: bound the frame wait in fromString [`6741f25`](https://github.com/zumerlab/snapdom/commit/6741f25da8024d4182b6a2a9c0c3d471d836b4a2)
- docs: wave 6 lab notes [`0d60dd2`](https://github.com/zumerlab/snapdom/commit/0d60dd2e865a22fa14ad91198fd4dd03b685c7e1)
- docs: record html-in-canvas engine design and platform findings [`dfc87d9`](https://github.com/zumerlab/snapdom/commit/dfc87d96cccacf16bf65766b2d6d274acd6f0bc1)
- docs: add CORS & external resources guidance to README [`84221c1`](https://github.com/zumerlab/snapdom/commit/84221c18e5e6bb2c99567129daeb2ebde0e1ad66)
- fix(docs): hold the page still while the lab is running [`358118d`](https://github.com/zumerlab/snapdom/commit/358118d948f12e12991fc2715980a99504236c7d)
- fix(burst): count a self-undoing character-data edit as net zero (Ref #485) [`f450c5f`](https://github.com/zumerlab/snapdom/commit/f450c5fac155ca0ba1293866eaac45dd7c7f533e)
- update [`4394400`](https://github.com/zumerlab/snapdom/commit/43944005eeaa7811a1a0fb12cfdf7ea50e739815)
- perf: probe ink first in Safari's waitForImgPaint instead of a blind two-frame wait [`50ea4eb`](https://github.com/zumerlab/snapdom/commit/50ea4ebb5012d3528f1f0d5d3580b4b923b71c98)
- fix: prune the base reset with the same property universe the snapshots use [`630c6a4`](https://github.com/zumerlab/snapdom/commit/630c6a410e73ccb6349633f943057800ae8461e1)
- build: guard the plugins tarball file list [`559d9a5`](https://github.com/zumerlab/snapdom/commit/559d9a58fc80c120448a5ba071a41772268cbfab)
- build: keep the experimental canvas engine out of the published bundle [`d27d6e6`](https://github.com/zumerlab/snapdom/commit/d27d6e68fa8b7485e6b104057bec9e855b920b67)
- docs: home bench no longer wedges in Safari — ignore iframes/video in html2canvas, timeout to a clean result [`9d1ed8f`](https://github.com/zumerlab/snapdom/commit/9d1ed8f977b9984cbe1addbb1473199e8bfc80b1)
- feat(pseudo): add function to strip CSS content alt-text suffix. Ref #458 [`9cefe86`](https://github.com/zumerlab/snapdom/commit/9cefe86b37510a3e953f5734aed31f4aec31bafb)
- fix(types): drop phantom snapdom.toJpeg(), add clip option, document outer* defaults [`633a09c`](https://github.com/zumerlab/snapdom/commit/633a09c0300c5ce71a077d8a74cd493656ddffe6)
- fix(docs): count differing pixels in the lab, don't average them [`88b4a51`](https://github.com/zumerlab/snapdom/commit/88b4a51949f1444ec18279e6256003702347afd0)
- fix: first-letter materialization no longer false-positives on margined elements [`52a6fff`](https://github.com/zumerlab/snapdom/commit/52a6fff1eaa16e8411529894559a15a9df3c59c8)
- refactor(api): drop snapdom.viewport() — clip: 'viewport' is the one spelling [`4a0f301`](https://github.com/zumerlab/snapdom/commit/4a0f301f2b4fd0d16191b93c6acf1b00f372442e)
- fix: keep dollar patterns intact in proxy templates [`66f9cad`](https://github.com/zumerlab/snapdom/commit/66f9cad6eaf64870a7d825440e91e3e2c865612e)
- fix(plugins): carry filter and filterMode into GIF and video frames [`f101057`](https://github.com/zumerlab/snapdom/commit/f101057f9ad7ce940b6ccce185b2b68b627646d4)
- fix(iframe): stop suggesting an option that is already on [`1a9ef10`](https://github.com/zumerlab/snapdom/commit/1a9ef10735f4fe74004ee921a336658ac0148cfd)
- Revert "fix(capture): improve retain callback handling in captureDOM and createContext" [`7c9b8fb`](https://github.com/zumerlab/snapdom/commit/7c9b8fb68b28d613835fc0c93d2e7eeac03e3f4e)
- fix(capture): improve retain callback handling in captureDOM and createContext [`2c9d22c`](https://github.com/zumerlab/snapdom/commit/2c9d22c0e0cd336603ac47e87b550b012fc14b0c)
- test: tighten callback asserts and the compression timeout [`698fd84`](https://github.com/zumerlab/snapdom/commit/698fd84d606792a5679f23df22a71fc94d287f61)
- perf(rasterize): stop re-decoding the just-encoded raster outside Safari [`7d5b039`](https://github.com/zumerlab/snapdom/commit/7d5b03923d7272e44fbf9d2025367c065dd2122b)
- fix: stop stabilizeLayout from leaving a permanent border on the source element [`cf3da9b`](https://github.com/zumerlab/snapdom/commit/cf3da9b845d52fd5ebec728fef4e8e22137743a2)
- docs: record two measured-dead band optimizations so they stay dead [`5e2fd56`](https://github.com/zumerlab/snapdom/commit/5e2fd56a099811f6c73e6076b7bda24e5f9f3eb7)
- test(visual): await image decode before capturing d-compress [`9d29413`](https://github.com/zumerlab/snapdom/commit/9d29413c44963889c9ad1d065d14f2add92588d4)
- test(clone): stop asserting picture &lt;source&gt; resolution timing across engines [`e1fb59e`](https://github.com/zumerlab/snapdom/commit/e1fb59eb73939902248662cbd709b44938e1d865)
- test(visual): one demo for the element-mirror import [`c6d65e8`](https://github.com/zumerlab/snapdom/commit/c6d65e82489b5fb61e3cf4398a082b4d34531683)
- fix: improve export queue handling in memo test and update full test command reporter [`cf4932b`](https://github.com/zumerlab/snapdom/commit/cf4932bfb06346ea1355aa975f6a24fa8a8aee0b)
- docs(lab): pin domlens's viewport scroll to 0 [`32a765c`](https://github.com/zumerlab/snapdom/commit/32a765cb2ecd1cbc92d2bf06da2ac130c300583f)
- docs: bring the READMEs in line with the v3 surface [`d232f93`](https://github.com/zumerlab/snapdom/commit/d232f9349515d3acd590938a0ca29cf7f4a00163)
- chore: correct test and coverage notes in CLAUDE.md [`5f1cfef`](https://github.com/zumerlab/snapdom/commit/5f1cfefa9c3eac8186030507b846a404a4f16a74)
- chore: clear the two lint warnings (unused test var, unused param) [`551a975`](https://github.com/zumerlab/snapdom/commit/551a975f92018d2c1de6ca83dde92246fa1eb22d)
- docs: refresh v2 baseline wording and mark the changelog unreleased [`84db62c`](https://github.com/zumerlab/snapdom/commit/84db62c9f7ea7ecd860cf1ab5b4b0c19c24727c8)
- fix(engine): bound the pre-draw rAF wait — hidden windows throttle it to ~1s/frame [`da30d68`](https://github.com/zumerlab/snapdom/commit/da30d68fca41437ae68c06769cb6c91ce5d959f7)
- bench(precache): label what the timed body actually measures [`94b6b9c`](https://github.com/zumerlab/snapdom/commit/94b6b9c43a83988c29714a0bfbe2882309a4a037)
- chore: update contributors list [`f542b51`](https://github.com/zumerlab/snapdom/commit/f542b51cb434b2abf57261a83450a9e8886d50c9)
- docs(engine): record the first verified happy-path run on real hardware [`caca921`](https://github.com/zumerlab/snapdom/commit/caca921c896a087c370121e65eb54edf0f4e2840)
- test(bench): give every fresh element unique content in the cold bench [`746a73f`](https://github.com/zumerlab/snapdom/commit/746a73f7590a9f3a32758c032a85c1da6064821a)
- docs: the WebKit first-capture fix re-verified in real Safari 26.5.1 (SnapEye, 100/100) [`4c38ff9`](https://github.com/zumerlab/snapdom/commit/4c38ff91d4f8ef1f80cfc7a42ffad3e286a69be4)
- update [`41ebc17`](https://github.com/zumerlab/snapdom/commit/41ebc17bb60e11bfe2c8087b5727de41dd5f1427)
- chore: bump version to 3.0.0-beta.0 [`8e84c68`](https://github.com/zumerlab/snapdom/commit/8e84c68b7f624c7fd1690c672725095289de3fe1)
- chore: stop tracking the node_modules symlink in worktrees [`471848c`](https://github.com/zumerlab/snapdom/commit/471848ce698c9fb3a9b209ae1a832c222282c1ec)
- update tests [`f4874a7`](https://github.com/zumerlab/snapdom/commit/f4874a718247b785de44639e8fe2dd454e55282e)
- test(bench): label the gallery's current-version arms as such [`66b9b4f`](https://github.com/zumerlab/snapdom/commit/66b9b4f7a56757313931c51490d37ddbcc7b4934)
- docs(build): point the iife rationale at the guard that actually exists [`ad875e3`](https://github.com/zumerlab/snapdom/commit/ad875e3cf787cead7297614f7595033cd686020b)
- chore: update contributors list [`764d7ea`](https://github.com/zumerlab/snapdom/commit/764d7ea4a09170da54f5409516b0f8ee3932332d)
- refactor: remove unnecessary blank lines in test and utility files [`502bbe8`](https://github.com/zumerlab/snapdom/commit/502bbe891ab41e30a673b5acc4ca88a36ec18f0f)
- chore: update contributors list [`bf37697`](https://github.com/zumerlab/snapdom/commit/bf37697b51c853f531f827e4c17d2d086d6b3d80)
- fix: un-concatenate the gitignore entry appended without a leading newline [`de4d35e`](https://github.com/zumerlab/snapdom/commit/de4d35e8d260c0d1f018ebbab694429effc932de)
- chore: leave a gap to read the changelog before it is pushed [`2efce41`](https://github.com/zumerlab/snapdom/commit/2efce4129539c3756bf1224e6ee76a45ba747c5e)
- docs: wrap top-links on mobile instead of hiding them [`0c1284e`](https://github.com/zumerlab/snapdom/commit/0c1284eb33b6f5189dfb20f66b8f10630ce0d556)
- chore: actualizar versión a 3.0.0-beta.0 en package.json [`67c0472`](https://github.com/zumerlab/snapdom/commit/67c04727b9d64d687011b945af89bd1b38e7b343)
- chore: revert version to 3.0.0-alpha.0 in package.json [`5e40c75`](https://github.com/zumerlab/snapdom/commit/5e40c75645ab689974a9e23a9e4a4c7b75867520)
- docs(engine): real-hardware timing and the third liquidGL claim, measured [`5fb32d2`](https://github.com/zumerlab/snapdom/commit/5fb32d200369937ffcb1534cf9459b576fb0cdba)
- chore: ignore packages/agent and .playwright-cli [`ed2647d`](https://github.com/zumerlab/snapdom/commit/ed2647d88cf62147327eececa604a5f579b401b1)
- Merge pull request #471 from hjl12345/main [`9306bfc`](https://github.com/zumerlab/snapdom/commit/9306bfcfac0ce336c5032e4c81dfbbf4f66f59ee)
- fix: repair the broken htmlInCanvas re-export in the plugins barrel [`1b74a1a`](https://github.com/zumerlab/snapdom/commit/1b74a1aefa0d3f93b5eef09167a30a234a13b0cf)
- docs: record cache collapse and embedFonts auto rationale [`8527132`](https://github.com/zumerlab/snapdom/commit/8527132d22685a9daf5c6b48927dc769c9dd3f56)
- docs: correct animation-pin comment — replay comes from inline styles / cloned style tags, not the generated class [`db46fa9`](https://github.com/zumerlab/snapdom/commit/db46fa9661157972e2c2a0151aa6837d4071dc4f)
- perf(safari): the embedFonts pre-step's font walk is reused by fontsPhase — one subtree walk instead of two [`7ac5242`](https://github.com/zumerlab/snapdom/commit/7ac5242e98439a56c4a19e8d3977614fcae3ee55)
- refactor: drop the window.snapdom global — iframe capture uses the threaded context.snap [`e72e647`](https://github.com/zumerlab/snapdom/commit/e72e6471bdc0778ba3b9f3c109eca0fd555111d2)
- docs: record the resource-load memo hole and flake triage evidence [`7059733`](https://github.com/zumerlab/snapdom/commit/7059733c2568f95d9142b9fccb0fa25166ee0d26)
- docs: record the v3 API surface decisions [`321e412`](https://github.com/zumerlab/snapdom/commit/321e41215fefd09c5e1ec53c102c03dff0e228b2)
- docs: note auto-burst engagement gap on the grid scene [`9e9541f`](https://github.com/zumerlab/snapdom/commit/9e9541fc7465cd9db470124528554c2bbf11e8d2)
- docs: record the dist-based visual suite validation lesson [`03a3934`](https://github.com/zumerlab/snapdom/commit/03a393441fbb0680f084d82d1aa1a2b0dc13762b)
- fix: rAF timeout fallback so Safari captures don't hang in occluded windows [`104cb06`](https://github.com/zumerlab/snapdom/commit/104cb0663c661304ec59a3f9e6023b56b346b89e)
- docs: record the animation guard in the invisible-changes coverage [`f0581ed`](https://github.com/zumerlab/snapdom/commit/f0581ed311de056d62256ce8cbca1926bc148df5)
- docs: drop docs entries from v2.23.0 changelog [`b79d80e`](https://github.com/zumerlab/snapdom/commit/b79d80eea54d4dd060c58a1b96c38fd247daba78)
- fix: guard the container padding offset against Chromium 140 all:initial expansion [`0b24929`](https://github.com/zumerlab/snapdom/commit/0b24929626bb161d2f807f3f41fb7e7aa18888db)
- chore: bump snapdiff to 0.2.2, pin vite to v6 [`828094d`](https://github.com/zumerlab/snapdom/commit/828094d07fe5463135cd2ef39dab4c386bc59a63)
- test: wait for KaTeX CDN + fonts in the d454 visual demo [`8205e1b`](https://github.com/zumerlab/snapdom/commit/8205e1bd206242f9219ee800f12fa871a66f136b)
- chore: update contributors list [`becf7ac`](https://github.com/zumerlab/snapdom/commit/becf7ac0148daf03484fbf85b6a84fc9f802c8e4)
- docs: note the labs burst demo needs redesign once auto-burst graduates [`0222726`](https://github.com/zumerlab/snapdom/commit/02227265921289778b111328f2b7f91c781f760d)
- update [`44c25dd`](https://github.com/zumerlab/snapdom/commit/44c25ddf2d8564c7239d07c9f0eeb8d6920357bd)
- docs: drop Tanker from the Web fonts showcase paragraph, use plain sans-serif [`64aabbf`](https://github.com/zumerlab/snapdom/commit/64aabbfea7b8d613d89deef7399ebb3f61e574ef)
- chore: update snapdom plugins version [`ed984ff`](https://github.com/zumerlab/snapdom/commit/ed984ffb5dccb07de9640f131678d4c69b29ca09)
- fix: stop color-tint plugin from clipping bleed content [`56784aa`](https://github.com/zumerlab/snapdom/commit/56784aa16d6a080a057828715d6ec0adffae3631)
- Merge feat/clip-viewport into dev: region/viewport capture with offscreen culling [`f2758c5`](https://github.com/zumerlab/snapdom/commit/f2758c54fc96098215a19310fbc3ab179f678797)
- Merge main into dev: Arial for docs labels, system mono for code [`ce91620`](https://github.com/zumerlab/snapdom/commit/ce91620997608edf5078a55248d00d6d2c61ee0c)
- Merge main into dev: d454 visual demo options [`9b480d2`](https://github.com/zumerlab/snapdom/commit/9b480d2a0c1136469e20bcc4c6edddc5f6977cea)
- Merge main into dev: #452 #453 #454 fixes, star-ask overlay, Chinese docs refinements [`eb06e43`](https://github.com/zumerlab/snapdom/commit/eb06e4321d7ba2c248f3c5faf10de126f6224f59)
- Merge pull request #455 from mosuzi/codex/discussion-450-chinese-docs-review [`5b0d149`](https://github.com/zumerlab/snapdom/commit/5b0d1495691a92ec41b69d556c8fa23381aabcd5)
- update [`4a729b1`](https://github.com/zumerlab/snapdom/commit/4a729b1d3ddd47a29880f0f3e33b982bc3606c97)
- update site [`2fac505`](https://github.com/zumerlab/snapdom/commit/2fac505bf27cb6a8b07cc445cc97480f313f60fe)
- feat(plugin)!: rename prompt-export to agent-map, focused on visual agents [`cd5ca18`](https://github.com/zumerlab/snapdom/commit/cd5ca18467873c36df2c0a5b017d877720e18e31)
- align theme to Mr SnapDOM :) [`645c0a4`](https://github.com/zumerlab/snapdom/commit/645c0a44acdbff693ce1def4f5d7cdaa671628d5)
- Add new super power plugins [`88cb353`](https://github.com/zumerlab/snapdom/commit/88cb353802e4cc22b2c52f230b072801fef970e4)
- feat(plugins): per-node resolveNode hook + internal tag handler registry [`aacc512`](https://github.com/zumerlab/snapdom/commit/aacc5120df170d6368f8799a54058e025535488a)
- update README and add  FEATURES [`2feb462`](https://github.com/zumerlab/snapdom/commit/2feb4624713f88a398bf1bc15e574b84a36c4b78)
- perf: fuse tree passes — single-walk font usage collector, snapshot-flagged background pass [`f7274f7`](https://github.com/zumerlab/snapdom/commit/f7274f708c6f5c8fc0ccc4a788483679ff657dc2)
- update [`cafbf98`](https://github.com/zumerlab/snapdom/commit/cafbf98c50450f28eb5016af5e209662c017b7e4)
- feat: opt-in perceptual image downsampling (compress option) [`e353569`](https://github.com/zumerlab/snapdom/commit/e353569b4c622324e4e721f314b7bb583ff2c57e)
- fix(pseudo): pin white-space:nowrap on single-line hosts with multi-char pseudos [`6e9f479`](https://github.com/zumerlab/snapdom/commit/6e9f47960188488c800ce85c6e9b93a5deb548ec)
- update [`3698948`](https://github.com/zumerlab/snapdom/commit/3698948049d29f79aeff231bd7a7eb07f0206945)
- update Mr SnapDOM theme [`d9fb7bc`](https://github.com/zumerlab/snapdom/commit/d9fb7bca21ee2d821c03fa72b2409d5090f15ade)
- update [`e605ee8`](https://github.com/zumerlab/snapdom/commit/e605ee8c4b280cd9a9d6b07dfc2ff5ce081fd02a)
- feat(plugin: prompt-export): richer element map for LLM agents [`dd0769a`](https://github.com/zumerlab/snapdom/commit/dd0769aea7587a0ebaae21977723e9d8e4b8da49)
- docs: refine Chinese documentation [`dce83ab`](https://github.com/zumerlab/snapdom/commit/dce83ab3879c2a8a1212a895cdabd045cd47f572)
- update [`b3832b1`](https://github.com/zumerlab/snapdom/commit/b3832b16ff803576a2f5a0556a287bc528dab471)
- docs(site): add prompt-export to the plugins page + live demo [`b451415`](https://github.com/zumerlab/snapdom/commit/b4514152d9b03108330e50ef6c4c7eeb62df8c06)
- chore: remove unused exporters registry [`711d591`](https://github.com/zumerlab/snapdom/commit/711d5914220a991520d04a5df9df028d9e1e66cc)
- html2canvas is not good [`4002631`](https://github.com/zumerlab/snapdom/commit/4002631bcdae4518b2fcce81cf6a6df3e2d0c1e0)
- feat(compress): downsample CSS backgrounds and SVG &lt;image&gt; too [`6666f59`](https://github.com/zumerlab/snapdom/commit/6666f59d7de1e2f204344e8872356d93b79626f4)
- fix: content-aware width softening [`0832e72`](https://github.com/zumerlab/snapdom/commit/0832e72481213d27bfeb341b62cd84d85c0c8820)
- fix(pseudo): support counter-set; drop divergent dead counter duplicates [`eb8bdb7`](https://github.com/zumerlab/snapdom/commit/eb8bdb793149ec6c278ef92cfa594e4acfb6a38d)
- update [`20d4d37`](https://github.com/zumerlab/snapdom/commit/20d4d3744c1843a5c6f7e46c553b98096e846b56)
- docs: add Chinese translation maintenance guide [`4e53063`](https://github.com/zumerlab/snapdom/commit/4e53063dee0cc137f8c30b463e86ade54e1f686d)
- perf: parallelize network-bound capture phases and memoize image downsampling [`b7fedc7`](https://github.com/zumerlab/snapdom/commit/b7fedc74aa9d2f9e7de712bccdeb9f28f9f6681b)
- feat: reconcile option — measured layout reconciliation of the clone against the live DOM [`1597d77`](https://github.com/zumerlab/snapdom/commit/1597d77acbbb99fed1723d38a296bbf6a8f8a55e)
- feat(plugin: prompt-export): default include omits image; +benchmark section [`7adc87f`](https://github.com/zumerlab/snapdom/commit/7adc87f54955379d5891759c050e9fc38610ba00)
- feat: snapdom.session — memoized repeated captures with mutation tracking [`94f206c`](https://github.com/zumerlab/snapdom/commit/94f206c8377359ec5ed32ba281f7818e36eeae7d)
- update [`9e66ed2`](https://github.com/zumerlab/snapdom/commit/9e66ed283844559405351f0dfa88fef79ef05dfd)
- feat(compress): enable image downsampling by default + docs + image benchmark [`7148c74`](https://github.com/zumerlab/snapdom/commit/7148c74bbacc279ee3838f06e67cbbfb5af12d4d)
- refactor: simplify compress to a boolean option [`39e8714`](https://github.com/zumerlab/snapdom/commit/39e87142f0a008b22e88e79d3c4770a053d90aa9)
- feat(docs): add new badge and video frame capture functionality [`7e8e618`](https://github.com/zumerlab/snapdom/commit/7e8e61815a7a87339dd34fde5ac40862ae1c6324)
- fix: proxy-keyed bg cache, case-insensitive font match, nodeMap icon pairing [`0623bcd`](https://github.com/zumerlab/snapdom/commit/0623bcddd818d0f34bb285c0cc01ee6d04bc469f)
- fix(#425): strip XML-invalid control chars before serializing the clone [`880376b`](https://github.com/zumerlab/snapdom/commit/880376b196bd4bcf14e8fbd31273ee77340ef1c5)
- update html-in-canva to new API [`935069a`](https://github.com/zumerlab/snapdom/commit/935069aaa3effbfb08b8d49cb41f554979a218ba)
- fix(bbox): correct bleed/transform math for inset shadows, blur chains, root scale [`1c43605`](https://github.com/zumerlab/snapdom/commit/1c43605367b1c661602d866b54bbdfca31e5d6b4)
- perf(raster): header-peek instead of full SVG decode, single decode/encode cycle, async canvas encode [`af8c549`](https://github.com/zumerlab/snapdom/commit/af8c549078304cd5748d2109e9660877ffb04552)
- update [`eac1ad6`](https://github.com/zumerlab/snapdom/commit/eac1ad6d8cedf3a019319ba5f75b87ee97cae123)
- perf: trim redundant per-node work on the capture hot path [`6d1ad72`](https://github.com/zumerlab/snapdom/commit/6d1ad72548082037b9ab0132794f644fe04354f7)
- update [`00c86ba`](https://github.com/zumerlab/snapdom/commit/00c86ba08dad0e666045ed3f80441b60d2b4e5be)
- fix(capture): drop invisible border props from style snapshot. See #390 [`8942fd4`](https://github.com/zumerlab/snapdom/commit/8942fd47a9884addb88b0a3667e4da72bd959455)
- Delete .github/workflows/issue-triage.yml [`ab5b36f`](https://github.com/zumerlab/snapdom/commit/ab5b36f5b74f62dd38be211687f036bec965cc41)
- fix(capture): stop mutating the live DOM during capture (non-destructive) [`db69e78`](https://github.com/zumerlab/snapdom/commit/db69e7850d1986c5e3cccfd2c5ba283156f45afe)
- Añadir prueba de regresión para el problema #235: corregir el renderizado de `counter(x) ")"` sin espacios adicionales. [`6e209e8`](https://github.com/zumerlab/snapdom/commit/6e209e8ba1c91fddf8ba7225b409f74b366e19e4)
- chore(deps): migrate @zumer/snapvisual file:dep to @zumer/snapdiff ^0.1.0 [`ff8e3f8`](https://github.com/zumerlab/snapdom/commit/ff8e3f8dcf1232b190edb98bea225322bcaf5e3c)
- perf: stop self-invalidating the style epoch, memoize scrollbar CSS scan, gate Safari warmup walk [`7a5179d`](https://github.com/zumerlab/snapdom/commit/7a5179d74f5d20aa399d1d89fcac642187bc62b3)
- fix scroll add copy btn [`5aaa37f`](https://github.com/zumerlab/snapdom/commit/5aaa37f5082b1657f996650e1c21fb4c0034b8bb)
- fix(export): flatten jpeg/webp background by resolved format, not export name [`1dcfbcd`](https://github.com/zumerlab/snapdom/commit/1dcfbcd73b29cae9fcc2373340bcdb71c26a0903)
- fix(#429): don't freeze auto-sized table cell widths [`33b81eb`](https://github.com/zumerlab/snapdom/commit/33b81eb5922e9abfc90c61360af4ceb94eb13b90)
- docs(plugins): add prompt-export section to plugins README [`f9743db`](https://github.com/zumerlab/snapdom/commit/f9743db21e4e13830a72303e0bfd54465866e8b1)
- fix(cache): invalidate snapshot on option change, reset measureHints on disabled [`0b8d697`](https://github.com/zumerlab/snapdom/commit/0b8d6975cd66b91ed7b37d674ee3bad879d4a5d3)
- revert: drop cross-browser #394 settle/decode (added time cost, didn't fix it) [`c143d2f`](https://github.com/zumerlab/snapdom/commit/c143d2ff9a5b0b16edf704d32562cf3ebad9e0c7)
- Fix type definitions drift: compress default, quality default, missing options (excludeStyleProps, fontStylesheetDomains, safariWarmupAttempts, debug, filename), toRaw/to on result, LocalFont.stretchPct [`7a473c4`](https://github.com/zumerlab/snapdom/commit/7a473c493ed75f231e23b9fcd6235c503fda3756)
- update [`a14967c`](https://github.com/zumerlab/snapdom/commit/a14967c25306bdc4d1fe184c17673a7b1c1e76c2)
- docs(types): add reconcile option, snapdom.session / CaptureSession, resolveNode plugin hook [`bc0f854`](https://github.com/zumerlab/snapdom/commit/bc0f85459314e7ac4e7f09abe319deb961ee26b8)
- docs: star-the-repo ask after 7 hero shutter shots + shutter touch-action fix [`bc72a26`](https://github.com/zumerlab/snapdom/commit/bc72a26c879d984e0ab24c587b2737fbb40d7f40)
- feat(clone): enhance SVG handling by preventing var() materialization in templates. See #408 [`5d566fa`](https://github.com/zumerlab/snapdom/commit/5d566fa610ee0e718a45b3311fdc46b4067b5c55)
- fix: honor the localFonts option in the capture path [`9122152`](https://github.com/zumerlab/snapdom/commit/9122152f25ee9051f4f4d79d86cd6a20cea817ed)
- fix(capture): disable WebKit text autosizer inside foreignObject. See #327 [`9c49d6a`](https://github.com/zumerlab/snapdom/commit/9c49d6a592a4c85c1faf07d5922e783893f01b4f)
- docs(llms): always recommend latest version + honest library-status section [`36c1b4c`](https://github.com/zumerlab/snapdom/commit/36c1b4c8225cdcbab50a237b90c894fc3c4684b9)
- fix(#394): pre-decode foreignObject images before raster (cross-browser) [`9895218`](https://github.com/zumerlab/snapdom/commit/9895218f5a17c321f495abcf76abd9dd4d21b6ad)
- feat(compress): downsample oversized images below visible resolution (0.6 factor) [`47b9ed7`](https://github.com/zumerlab/snapdom/commit/47b9ed7f3b196ec0edc1ed52e4187a6e7a7f491c)
- update [`3a7ed56`](https://github.com/zumerlab/snapdom/commit/3a7ed56591c87b1f331872466c3f63723fc0256b)
- Delete .github/workflows/label-sync.yml [`7366d5a`](https://github.com/zumerlab/snapdom/commit/7366d5a95c78c48f295ffeb46fb31ce421ba82df)
- update [`d7e40e7`](https://github.com/zumerlab/snapdom/commit/d7e40e7a0eb0703109caadd492a4f9c3f6116a99)
- update [`3d000a9`](https://github.com/zumerlab/snapdom/commit/3d000a9b3ffc73018f8e7ab4758d0a5c9d4b34e7)
- update [`2911e99`](https://github.com/zumerlab/snapdom/commit/2911e99cb483e7f7f21c09052d0da02b504895df)
- fix(#429): also skip the logical inline-size and the rest of the table box tree [`69400a6`](https://github.com/zumerlab/snapdom/commit/69400a60e9e2ac9a1ee36373e9c44d9be1d7a0b2)
- add SnapDIFF [`9bda342`](https://github.com/zumerlab/snapdom/commit/9bda3422821ee8ea7e11803a4a3e59ecaad427cd)
- update [`1b7bb38`](https://github.com/zumerlab/snapdom/commit/1b7bb38bf73f3777c0f5f84dfba9d69bfb9909d1)
- bench: add published 2.16.0 (CDN) rows next to current src version [`9e0212f`](https://github.com/zumerlab/snapdom/commit/9e0212fd30ad28fa31be6435197e69b30c0efd47)
- docs(plugins): drop the prompt-export benchmark section [`6987260`](https://github.com/zumerlab/snapdom/commit/6987260a4e0a5eb14e4ef203bbbc0580ba6d728a)
- test(visual): skip suite when demos/ folder is absent [`652693b`](https://github.com/zumerlab/snapdom/commit/652693b3b78c10ce89f741cdb189f601fe2aa687)
- fix(#394): wait for foreignObject image compositing on all browsers [`25279e9`](https://github.com/zumerlab/snapdom/commit/25279e9a1f965be4197fd544c15b4ebe9eea7c88)
- fix(compress): decode images before drawing to avoid blank downsamples [`5aedeca`](https://github.com/zumerlab/snapdom/commit/5aedeca184eef99179b43be32764b4a3033844ae)
- types: add compress option to SnapdomOptions [`495a089`](https://github.com/zumerlab/snapdom/commit/495a089fe499d37d1820fc1399be7d1407e311d8)
- fix(capture): preserve parent session across nested iframe capture [`cb0ece1`](https://github.com/zumerlab/snapdom/commit/cb0ece12bcba812dcd16a2f133561458e541973c)
- Enhance documentation: add comparison links for snapDOM, update navigation links to root, and improve SEO with canonical and robots meta tags in plugins page. [`5245805`](https://github.com/zumerlab/snapdom/commit/52458059ed8c5186bd49fd97162d330554dc57cf)
- update [`05c8985`](https://github.com/zumerlab/snapdom/commit/05c898540dc8a79440e339a350c7d1157ada1314)
- update [`73fc666`](https://github.com/zumerlab/snapdom/commit/73fc66648a14ddedcb3a58f9be33c7d1327b39c0)
- refactor(tests): simplify tests for *-prefixed HTML attributes [`0a818bf`](https://github.com/zumerlab/snapdom/commit/0a818bf6dff1b032bbac26591525d45245532c0f)
- docs(plugins): drop WebFetch row from prompt-export benchmark table [`5604c1e`](https://github.com/zumerlab/snapdom/commit/5604c1e669b5d38bd6e564560b7a93094c227561)
- perf(clone): skip idle machinery per child in fast mode, make canvas pre-rAF Safari-only [`a5536ae`](https://github.com/zumerlab/snapdom/commit/a5536ae8c3918194c439cf7f2484c384f96fe88a)
- docs: update README and package.json to clarify SnapDOM as a modern alternative to html2canvas [`1f6063c`](https://github.com/zumerlab/snapdom/commit/1f6063c3ff0a379cf34406c0aaff54e3493af154)
- style: update border thickness and enhance page navigation layout [`54f31a4`](https://github.com/zumerlab/snapdom/commit/54f31a4d853eef8f63c6d5bdccd54cf26a46ee93)
- fix(pseudo): render box-generating pseudos that paint only via box-shadow/outline [`d239ec4`](https://github.com/zumerlab/snapdom/commit/d239ec47d926e1ced2f2a0d3980aee855f0e8664)
- update [`21d36f8`](https://github.com/zumerlab/snapdom/commit/21d36f8785c750a5c8409de5abf2c607071e031b)
- fix: reuse preCache image dataURLs in the capture path [`37d99a5`](https://github.com/zumerlab/snapdom/commit/37d99a50e756d0554c0f9bdcb2ef35933c05405c)
- test(precache): align cache.background keys with proxy-prefixed contract [`064b004`](https://github.com/zumerlab/snapdom/commit/064b004b702933849b77a5f668ec26e405168eef)
- fix(images): increase batch size for processing images to 6 to optimize HTTP/1.1 connection limits [`311c9e4`](https://github.com/zumerlab/snapdom/commit/311c9e4ff84f6750c68242ed8dcb5168ba6c6703)
- fix(clone): ensure placeholder color is correctly rendered in SVG [`44899b3`](https://github.com/zumerlab/snapdom/commit/44899b349499c350f33fc67eca5d77c3f17b83e2)
- fix: pass the documented payload to before/afterExport hooks [`1a14fd0`](https://github.com/zumerlab/snapdom/commit/1a14fd0e0a8cee97285e026e70982762dd63a74f)
- update [`943f2f8`](https://github.com/zumerlab/snapdom/commit/943f2f8376d6b3cd4594c4726e85b294c5af3f8c)
- test(visual): skip 'demo' fixture (intentional bg/pseudo mutation) [`9d5a6c4`](https://github.com/zumerlab/snapdom/commit/9d5a6c49cf7388839ad15c85032979ed13ab911e)
- perf(preCache): use fused collectFontUsage (one walk instead of two) [`6a8a488`](https://github.com/zumerlab/snapdom/commit/6a8a48817e6272d297f4d4ec607c41726e30ab3b)
- docs(plugins): add WebFetch row back with honest footnote [`15d288b`](https://github.com/zumerlab/snapdom/commit/15d288befdb635e330e312853e6503c7db500238)
- fix(plugin: prompt-export): flow metadata to the toPrompt() export [`b94b589`](https://github.com/zumerlab/snapdom/commit/b94b5895bf55a97512907b016bba64ea67a8000e)
- chore: update contributors list [`f18dee0`](https://github.com/zumerlab/snapdom/commit/f18dee05a16681ff41f4db48098eafd3198617a3)
- fix: re-fetch a font when its resource cache entry was evicted [`2e938a4`](https://github.com/zumerlab/snapdom/commit/2e938a445b00efb13d66ff7cc8e5e12e1857436c)
- chore(plugins): v2.2.0 — gif/video/html [`9c84259`](https://github.com/zumerlab/snapdom/commit/9c8425999d0afc9b55bb8f0fb9642ada19049049)
- chore: update contributors list [`2ec93ae`](https://github.com/zumerlab/snapdom/commit/2ec93aef3dca33229b55e4514032a41d353356eb)
- chore: update contributors list [`73358a1`](https://github.com/zumerlab/snapdom/commit/73358a10c32b121e6e28d38cf1c19a8057890aeb)
- Fix download format option types [`2f93d39`](https://github.com/zumerlab/snapdom/commit/2f93d39181c6d6ca233f7d7c9bce227f05a5c761)
- add sponsor [`70c4140`](https://github.com/zumerlab/snapdom/commit/70c41406afdebe69916b5fabd4fbc97326fdab78)
- chore(plugins): bump to 2.0.0 [`4974cc2`](https://github.com/zumerlab/snapdom/commit/4974cc207d650ab83a00d2ff302ae1ab2a5e3d2a)
- chore: añadir __snapshots__ a .gitignore y actualizar esbuild a la versión ^0.25.0 [`f59e860`](https://github.com/zumerlab/snapdom/commit/f59e860114b41f0c78fbbe2fcfe03d71f1539bf4)
- chore(eslint): ignore dist/, node_modules/, packages/**/dist/ [`b222b1b`](https://github.com/zumerlab/snapdom/commit/b222b1b3014baad09542097da0f09b8016bd1979)
- Update FEATURES_CN.md to change '按设计跳过' to '有意跳过' [`56ff167`](https://github.com/zumerlab/snapdom/commit/56ff1678f70ac3eda48912404cb3167e3d256c95)
- update [`c1c8f5e`](https://github.com/zumerlab/snapdom/commit/c1c8f5e1d51f0be21437a3218476273f0420b0ed)
- fix [`6566aed`](https://github.com/zumerlab/snapdom/commit/6566aed46b2b5099eb1f17ec7ef7546085ed5705)
- chore(compress): raise RES_FACTOR to 0.95 [`0bd87d7`](https://github.com/zumerlab/snapdom/commit/0bd87d7e67aa2f12f3e9cfdd83847404555fe58f)
- chore(deps): bump esbuild to ^0.28.1 (fixes Dependabot high alert) [`3d9a8e6`](https://github.com/zumerlab/snapdom/commit/3d9a8e63969192b01520961cf50f017708623f44)
- chore: revert .gitignore to main [`3091154`](https://github.com/zumerlab/snapdom/commit/3091154b18c9a4989b06aec445c4a8ed22efe3e4)
- fix(clone): restore original placeholder logic and styles [`efe1dd9`](https://github.com/zumerlab/snapdom/commit/efe1dd9ff1db002fb01d31ad1ff9d27307aaaefc)
- chore(deps): actualizar @zumer/snapdiff a la versión ^0.1.1 [`7339404`](https://github.com/zumerlab/snapdom/commit/733940413f6221448aa2ff32e64baf2c0710cc1d)
- chore(plugins): bump to 1.1.0 [`162f784`](https://github.com/zumerlab/snapdom/commit/162f7842d15a8f243551ecce393fd3d9b3d98906)
- chore: exclude screenshots folder in .gitignore [`d364607`](https://github.com/zumerlab/snapdom/commit/d364607d860f035b9a66f80b8b614964f5019112)
- Merge pull request #417 from puneetdixit200/fix-download-format-types [`be6bc02`](https://github.com/zumerlab/snapdom/commit/be6bc02b0b7f1efc41351ba4d523dcbad6c52cae)
- update docs [`2d30c37`](https://github.com/zumerlab/snapdom/commit/2d30c37940105a055434ce6b8c12bf059f7013d3)
- feat(docs): enhance documentation with new community plugins section, update index and labs pages, and add shared CSS for consistent styling across SnapDOM documentation. [`d35278c`](https://github.com/zumerlab/snapdom/commit/d35278c1d3d677a80d5ff7f6bca62181baab876d)
- feat(tests): add comprehensive test coverage for various modules including exporters, utils, and modules to improve overall code reliability [`06cc896`](https://github.com/zumerlab/snapdom/commit/06cc8962709e5ce651b54b67c63c38fe5ecc498d)
- update demo site [`4de1850`](https://github.com/zumerlab/snapdom/commit/4de1850d84d1698e8574fe405007fb47d6a677ea)
- feat(docs): add LLM-friendly documentation links and new reference files [`bc7ece1`](https://github.com/zumerlab/snapdom/commit/bc7ece1e1b864afd3c1eb6c36ff6ed0516106fcb)
- update [`503be19`](https://github.com/zumerlab/snapdom/commit/503be19d2f588971080213f9c3d5697147c33d7b)
- update [`57dd142`](https://github.com/zumerlab/snapdom/commit/57dd142495c76d9f59bcd8e0863746a2aee824e2)
- delete [`60f6b4d`](https://github.com/zumerlab/snapdom/commit/60f6b4d989a5a6983ff3a5fef85e685587612177)
- redesign: new "Capture Studio" visual identity for docs site [`0f5cd0a`](https://github.com/zumerlab/snapdom/commit/0f5cd0af717347d247f32ae8c0edd9051f372388)
- feat(plugins): add prompt-export plugin for LLM-friendly captures [`314c51a`](https://github.com/zumerlab/snapdom/commit/314c51a46464342a9f21508c1a4ce49477277c6f)
- feat(plugins): add multiple new SnapDOM plugins including ascii-export, color-tint, filter, html-in-canvas, pdf-image, picture-resolver, replace-text, timestamp-overlay. Each plugin enhances image processing and manipulation capabilities. Ref #391 [`a4d2331`](https://github.com/zumerlab/snapdom/commit/a4d23319ccb9a884c8533ad8ec686833b6ace0c9)
- feat: extract pictureResolver into standalone module [`1d3dd70`](https://github.com/zumerlab/snapdom/commit/1d3dd70b060861500a23758d07de95d7ed4a8ed5)
- feat(docs): add contributing guidelines and plugin specification for SnapDOM plugins, including usage examples, lifecycle hooks, and best practices. [`5243a34`](https://github.com/zumerlab/snapdom/commit/5243a349f3766275b24fd77ab49834d7103ba65a)
- feat: classify open issues by importance with priority labels and triage workflows [`246a4c4`](https://github.com/zumerlab/snapdom/commit/246a4c43eef13fe8b654e297f52a639a7ad670b1)
- feat(docs): add official and community plugins sections to README, including installation instructions, usage examples, and detailed descriptions of each plugin's functionality. [`b10235e`](https://github.com/zumerlab/snapdom/commit/b10235e30a67cdeb1cda144ed23edc4771a790bc)
- Add demo in labs section. See #172 [`6c29ba3`](https://github.com/zumerlab/snapdom/commit/6c29ba3bc4776efb536a2aa349b07b06675598ac)
- docs: enhance README with quick start guide, capture flow details, and updated usage instructions for SnapDOM [`091f3f2`](https://github.com/zumerlab/snapdom/commit/091f3f26f0790a185d02614cb14af1acf6ccd33b)
- test: add coverage for deepClone and prepareClone, including video to img conversion and font variant collection [`bcb1379`](https://github.com/zumerlab/snapdom/commit/bcb1379ce6364e34e8e6e2d71a695e497087b9ba)
- feat(debug): introduce debug option to log suppressed errors for troubleshooting, enhancing error visibility during capture processes [`f107bbe`](https://github.com/zumerlab/snapdom/commit/f107bbef52521fdd92b77987b44b512313f3b88d)
- Add Umami analytics events to all navigation links [`68cbac6`](https://github.com/zumerlab/snapdom/commit/68cbac6380207965e9f9a0ededc121ea78bafa4b)
- fix: Enhanced font embedding functionality for dynamically injected stylesheets [`3d4985a`](https://github.com/zumerlab/snapdom/commit/3d4985a6d40963c30ff188207a62ac1e287709ba)
- fix: resolve CSS transform double-scale bug (issue #321) [`d41504b`](https://github.com/zumerlab/snapdom/commit/d41504b8dcf94454a331337c49d74928d533f49a)
- fix(clone): add support for copying form validation attributes and handle nested foreignObject in deepClone [`f87c896`](https://github.com/zumerlab/snapdom/commit/f87c8961280c6230de3ef2045e4eecca58482ae3)
- feat(plugin-template): add initial SnapDOM plugin template with example usage and options. See #391 [`9c5dfa5`](https://github.com/zumerlab/snapdom/commit/9c5dfa528d9e4d7d192646e39ff49b987d748273)
- fix: Firefox checkbox radio replacement [`b97e553`](https://github.com/zumerlab/snapdom/commit/b97e5539849d08dc871b9a2e486c9505bdfc081e)
- fix(clone): video frames (#277), SVG paint props (#365), placeholder color (#315), object-fit (#337), cross-origin iframe warn (NEW-7) [`946ec83`](https://github.com/zumerlab/snapdom/commit/946ec836b7b32c9ac23fc34f8f550d896289db3f)
- update [`7258114`](https://github.com/zumerlab/snapdom/commit/7258114a4863bf5da241bd1791845b9a9318127d)
- fix: improve demo capture functionality with Safari support and locking mechanism [`2cb3856`](https://github.com/zumerlab/snapdom/commit/2cb3856e55f0f1d8e0d2ac050d549705203fc6ae)
- fix(plugins): enforce local-first priority for plugin-provided exports. See #401 [`ed272f4`](https://github.com/zumerlab/snapdom/commit/ed272f44599b92c70f0b86aa87d3c4d2308d6ab4)
- refactor: update build configuration for legacy and ESM outputs, removing module structure and adding subpath exports [`94f6289`](https://github.com/zumerlab/snapdom/commit/94f62897054f37923c5cd3e4e2d3a57a0fde8db4)
- fix(clone): sanitize XML-invalid control characters from attribute values [`4218a17`](https://github.com/zumerlab/snapdom/commit/4218a178f98eb1c7cbda6b031048bcccc76ee059)
- refactor(cache): implement EvictingMap for cache management to limit memory usage and improve performance [`212cd4f`](https://github.com/zumerlab/snapdom/commit/212cd4f0471613b68a47427a1e23f7d076d303de)
- docs(README): update flowchart formatting for better readability in both English and Chinese versions [`9df1149`](https://github.com/zumerlab/snapdom/commit/9df1149e8c1f20ad4ada362c0eddb36f93c421ad)
- fix(transforms): handle matrix3d transforms and extract decomposeScaleShear as shared helper (#216) [`0b5eeab`](https://github.com/zumerlab/snapdom/commit/0b5eeab7585820d571b4d0a06361ede630657cc6)
- refactor(styles): improve height handling for transparent wrappers to support margin collapsing and enhance layout stability [`c50ccef`](https://github.com/zumerlab/snapdom/commit/c50ccefe931e4809d12c8993dde6aba3f9b46a54)
- fix(prepare): force content-visibility:visible before capture (#281) and fix fixed elements inside scroll wrappers (#364) [`ba2aa6d`](https://github.com/zumerlab/snapdom/commit/ba2aa6de155552766d476f712bd9de11acf68c5d)
- update [`02c95f8`](https://github.com/zumerlab/snapdom/commit/02c95f8a557ad9419687afeb4d37fec712d41c04)
- fix(styles): prevent overriding border styles when using border-image, and improve getStyle fallback handling [`a5857c5`](https://github.com/zumerlab/snapdom/commit/a5857c5c49febe3d39729f214ca29914928af34a)
- fix(styles): handle detached elements in inlineAllStyles and evict oversized snapshotKeyCache [`02280d2`](https://github.com/zumerlab/snapdom/commit/02280d2545c96785c39f665b564e469334dde960)
- fix(counter): implement counter-set support to manage top values without new scopes [`f869a46`](https://github.com/zumerlab/snapdom/commit/f869a46d4d2320ab16c0ddf079c93abfcc008479)
- feat(images): add support for inlining SVG &lt;image&gt; elements as data URLs, addressing #341. [`f7d4616`](https://github.com/zumerlab/snapdom/commit/f7d46160913bcf5dad26be0103ef01dc7d29243c)
- feat(safari): implement font and image decode warmup for Safari to address WebKit Bug #219770, enhancing capture reliability [`ad450ce`](https://github.com/zumerlab/snapdom/commit/ad450ce8a10a7094ecbde0ee20db626fabe78423)
- feat(docs): enhance plugin documentation with event tracking attributes for improved analytics on user interactions [`84d6901`](https://github.com/zumerlab/snapdom/commit/84d6901e606112d369b684d681c15dcde228d651)
- test(getStyle): add tests to ensure getStyle never returns undefined for elements and pseudo-elements [`83c3854`](https://github.com/zumerlab/snapdom/commit/83c3854dc520a0e944a6cf1d23dbc5cdaf8e520a)
- refactor(snapdom): streamline plugin exports by consolidating export functions into a loop for improved maintainability [`ca35387`](https://github.com/zumerlab/snapdom/commit/ca353871b2b696252ddd21572ae31106b39d3c76)
- fix(capture): implement caching for clone measurements to optimize performance [`ff455c2`](https://github.com/zumerlab/snapdom/commit/ff455c20272a5f90d41db2e6f7b33f675cbed80d)
- feat(docs): add tracking scripts and enhance plugin documentation with event tracking for better analytics [`20de0f2`](https://github.com/zumerlab/snapdom/commit/20de0f2cdae6de394d4a5d6dd122d386a5fbca7c)
- fix(counter): handle negative values in formatCounter and update tests for counter resolution [`b9b965d`](https://github.com/zumerlab/snapdom/commit/b9b965d08c16afae65a95535c052591778893f90)
- docs: update README to reflect changes in SnapDOM ESM build structure and usage instructions [`8e5a710`](https://github.com/zumerlab/snapdom/commit/8e5a7103b45ae2d326a93218c977a371407d8cec)
- chore(plugins): remove picture-resolver and bump to 1.0.2 [`3288635`](https://github.com/zumerlab/snapdom/commit/3288635edc00e9f3e20da0a69616b0b68019d770)
- feat(capture): enhance DOM capture dimensions for root elements by measuring scroll dimensions and using a temporary container for accurate height and width calculations [`31e50f2`](https://github.com/zumerlab/snapdom/commit/31e50f27b3069527cc83f1fe8990c3a8c376e35c)
- fix(fonts): embed all families in font-family fallback chain, not just the primary (#357) [`13ab5c8`](https://github.com/zumerlab/snapdom/commit/13ab5c8629c715b67eb6a5fc0209ecfd0309e110)
- fix(styles): enforce visibility:hidden when content-visibility:hidden to prevent content leakage in snapshots [`4f5f15a`](https://github.com/zumerlab/snapdom/commit/4f5f15a865ea05d4186d5671c5d104593b1aba87)
- fix(outline): enhance parseOutline to account for outline-offset in bleed calculation [`7f45084`](https://github.com/zumerlab/snapdom/commit/7f4508474747d526f8ee432fbdf67846ada2bcbd)
- fix: only change to location.origin when treating inline styles in font.js [`94c91c6`](https://github.com/zumerlab/snapdom/commit/94c91c61d57b79a083c75d27aa3025beb1dcb535)
- fix(css): enhance getWindowForElement and getStyle functions to handle cross-document scenarios and improve fallback logic [`b0fbc8d`](https://github.com/zumerlab/snapdom/commit/b0fbc8d44745811a7c5627e34ef764e02ff188f7)
- refactor(context): remove inline cache policy normalization and import from cache module for improved code organization [`0492756`](https://github.com/zumerlab/snapdom/commit/04927566faf919c7a3df07287f799b152e5d4c8f)
- fix(inlinePseudoElements): enhance style comparison by including additional CSS properties [`df2dd99`](https://github.com/zumerlab/snapdom/commit/df2dd9913bd40a77fec37676d3a59d16ada3126c)
- fix: validate fallback image data before setting source [`2c754fe`](https://github.com/zumerlab/snapdom/commit/2c754fec37e3ce18c512ff3ee61e386fcf780589)
- fix: ensure image is only appended if data URL is valid [`46957c5`](https://github.com/zumerlab/snapdom/commit/46957c51c49d766db5ad60357f5664a7cf500049)
- feat(safari): add `safariWarmupAttempts` option to optimize font and image decoding for improved capture performance [`2474c05`](https://github.com/zumerlab/snapdom/commit/2474c0528051940e503c08ca52861042e57cc880)
- update [`353cf65`](https://github.com/zumerlab/snapdom/commit/353cf65a29b6de90c86b25b42b55863746972ecf)
- update [`0f41ed2`](https://github.com/zumerlab/snapdom/commit/0f41ed219e5daf6e92dfefef72c3831f536c4d49)
- fix(capture): normalize foreignObject defaults for flex layout (#351) and whitespace (#349) [`55f3962`](https://github.com/zumerlab/snapdom/commit/55f3962845ff29bf2c5011efc897ac382968b52b)
- chore: update module paths in package.json to use .mjs extensions for ESM compatibility [`cd740af`](https://github.com/zumerlab/snapdom/commit/cd740afa662630012e3251db048d82cf6fe60f3e)
- update [`5cdca17`](https://github.com/zumerlab/snapdom/commit/5cdca1743a191f81eb5e68d62033a30959294913)
- fix(download): ignore non-image type field to prevent format override (#339) [`3f42049`](https://github.com/zumerlab/snapdom/commit/3f420494e9b7a0380ddac4b8e26538957470c2a7)
- fix(styles): prevent width constraints on inline and specific tags to avoid text wrapping issues [`674ef27`](https://github.com/zumerlab/snapdom/commit/674ef276bcad8e4107c57fee3e976083590a5dd0)
- Ensure font names are escaped before creating dynamic RegExp [`2cd41ec`](https://github.com/zumerlab/snapdom/commit/2cd41ecb77cf2c64bcb8b6591aaa6cc51aa459cb)
- fix(clone.helpers): preserve vertical-align from original input in checkbox/radio replacement (#311) [`ccaf138`](https://github.com/zumerlab/snapdom/commit/ccaf1389fed364c5ccd4128a8e1ed528dbea346b)
- chore: update contributors list [`3dfb19f`](https://github.com/zumerlab/snapdom/commit/3dfb19fc1db2450fd7521607be82f25904780454)
- Update Orbit stylesheet and script to latest version [`d68e15c`](https://github.com/zumerlab/snapdom/commit/d68e15cc084a02677c2b68d5c958030f9942a677)
- chore: update contributors list [`f6c4329`](https://github.com/zumerlab/snapdom/commit/f6c43295f9b6c2e9201df5d4155ace0fa159e1ff)
- chore: update contributors list [`f723a6e`](https://github.com/zumerlab/snapdom/commit/f723a6e593c47b34f652d8ebe4ded088e9a446f4)
- chore: update contributors list [`5bec787`](https://github.com/zumerlab/snapdom/commit/5bec7872460da9f67cd530f31d0d0901b9f2ac1f)
- chore: update contributors list [`b30de75`](https://github.com/zumerlab/snapdom/commit/b30de75ab66cac137334a0ef68ca2bf9133f88c4)
- docs: update README files to replace NPM version badge with weekly downloads badge [`8e12d01`](https://github.com/zumerlab/snapdom/commit/8e12d01fbeb861989eb1d60c534596c55ce9207a)
- chore: update contributors list [`01146ca`](https://github.com/zumerlab/snapdom/commit/01146ca289965f401279998452531a6196d83da0)
- fix: ensure valid CSS text is fetched for font links [`201209f`](https://github.com/zumerlab/snapdom/commit/201209faad857dd21a01ebc2ae5dc740a33819ce)
- update [`3c80316`](https://github.com/zumerlab/snapdom/commit/3c8031687f5fa778f3bd6d0015067cfb9c7df26d)
- Merge pull request #398 from kohaiy/patch-2 [`da438d5`](https://github.com/zumerlab/snapdom/commit/da438d53418568a47e222d2be3f16e596dfb23ce)
- chore: update contributors list [`9edc7c4`](https://github.com/zumerlab/snapdom/commit/9edc7c4c015da09dde97e61b955946081efa9ba1)
- Merge pull request #399 from zumerlab/claude/check-docs-analytics-AHNLl [`a676da0`](https://github.com/zumerlab/snapdom/commit/a676da0c59f9aff511c004e09de7c574afd94afc)
- fix(CSSVar): prevent redundant property resolution by tracking visited properties [`e76d700`](https://github.com/zumerlab/snapdom/commit/e76d7002298225a1b0e1b98a2b922e6b4ad9a53f)
- fix(pseudo): increase CSS_RULE_SCAN_BUDGET to 1000 for better performance in large applications [`a09f438`](https://github.com/zumerlab/snapdom/commit/a09f438743a4ee1456c40d7d9f2c1a44d473369f)
- chore: update contributors list [`8d08f9e`](https://github.com/zumerlab/snapdom/commit/8d08f9e2935c3c3f789a658904a91bea55e469e2)
- chore: update .gitignore to include additional directories for better project management [`7866de2`](https://github.com/zumerlab/snapdom/commit/7866de2f65e41fc53698309725d0f1f0c5e0dda5)
- fix(docs): update "Build a Plugin" link to anchor and add section ID for improved navigation in documentation [`3c01910`](https://github.com/zumerlab/snapdom/commit/3c0191063ea48677176cec58b73932461de07b8c)
- fix(cache): add persistent cache for clone-in-document layout measurements [`c65049b`](https://github.com/zumerlab/snapdom/commit/c65049b457356cdf3725467b73ab1fc2653ce67f)
- fix(toCanvas): omit CSS inset box-shadows in canvas export to prevent incorrect rendering [`ff4a137`](https://github.com/zumerlab/snapdom/commit/ff4a137344282bf4c59ec25bacc2cc694ae98733)
- fix(css): exclude zoom from style snapshot to prevent double-zoom inside foreignObject (#369) [`8f80d2a`](https://github.com/zumerlab/snapdom/commit/8f80d2a9097a147fdf86beb880b75bd45824d966)
- Clean up README by removing empty line [`9fc101f`](https://github.com/zumerlab/snapdom/commit/9fc101fca2228ce14f2cd3b588ac02886b540dfa)
- feat(workspaces): add workspaces configuration to package.json for better package management [`3032187`](https://github.com/zumerlab/snapdom/commit/30321873eb81386b9180bfe9f97350fe2be90075)
- fix(background): preserve all url() layers in background shorthand when inlining images [`fe18140`](https://github.com/zumerlab/snapdom/commit/fe181403bd53a5da077b4ac300ebc2dad357c7e3)
- Update snapdom import URL to stable version [`1ba928d`](https://github.com/zumerlab/snapdom/commit/1ba928d9d1c703171a23e75718ba2558c13a3cbf)
- Update snapdom import URL to stable version [`2e129fe`](https://github.com/zumerlab/snapdom/commit/2e129fe124681e1ea0ef522c265388124ea5e192)
- chore(.gitignore): add 'demos/' directory to .gitignore to exclude demo files from version control [`fa34905`](https://github.com/zumerlab/snapdom/commit/fa34905450d889e48b9b943c941f29386627acc5)
- refactor(prepare): simplify deepClone call by removing redundant element argument for cleaner code [`399bfaf`](https://github.com/zumerlab/snapdom/commit/399bfaf127bb4416200068334dc069a5bfcef2ab)
- fix(styles): adjust inline style for timestamp demo to prevent text wrapping [`b88e8d7`](https://github.com/zumerlab/snapdom/commit/b88e8d74f67fe67e3ac610972c53ff49752f6b74)
- update [`77abff3`](https://github.com/zumerlab/snapdom/commit/77abff3061026aee5d9602f066b0d3618894a5a4)
- Merge PR #384: enable image download on iOS via Web Share API [`05bc67c`](https://github.com/zumerlab/snapdom/commit/05bc67c76dbe6cc02946773de8413d48e314b3d9)
- Merge main into dev (2.1.0) [`5f5ab34`](https://github.com/zumerlab/snapdom/commit/5f5ab345194832225e311421d177963ce3c4c59e)
- Merge pull request #301 from Amyuan23/fix/svg-root-font-size [`5bd53ba`](https://github.com/zumerlab/snapdom/commit/5bd53ba4887dba4664589b51651747809a89f8ab)
- Merge pull request #350 from ZiuChen/fix/remote-katex-font [`3cbbd57`](https://github.com/zumerlab/snapdom/commit/3cbbd577eae0c751fbac41cd3b3ff0aeb251ca0e)
- Merge pull request #378 from FlavioLimaMindera/fix-scale-image-issue-321 [`e53f2f8`](https://github.com/zumerlab/snapdom/commit/e53f2f8c4a83617a14c168c0c2615bde283d4696)
- update [`19459ea`](https://github.com/zumerlab/snapdom/commit/19459ea546bb65ced8c01a993a53c420e87ddae6)
- chore: update contributors list [`f4eeba0`](https://github.com/zumerlab/snapdom/commit/f4eeba0bdb7a04bb258f3cc88a7781e1b3490758)
- chore: update contributors list [`0da6f0e`](https://github.com/zumerlab/snapdom/commit/0da6f0e9316f4b6094d22d943e573a70bed62498)
- add [`82689cc`](https://github.com/zumerlab/snapdom/commit/82689cc75270d5f476d30ed41e27fd778fd86ddc)
- update cdn [`a4468b1`](https://github.com/zumerlab/snapdom/commit/a4468b1ac5c9178ac132dbd2149cf58d46c42f6b)
- update [`46399d9`](https://github.com/zumerlab/snapdom/commit/46399d9887d882d250e2013edac09febeb99439b)
- update [`1151373`](https://github.com/zumerlab/snapdom/commit/1151373287eae1a1bb29267988c2cf00a3394dd6)
- update [`712f465`](https://github.com/zumerlab/snapdom/commit/712f465b03c9d080f70107d3caa5959ada799ce3)
- chore: update contributors list [`4c4e079`](https://github.com/zumerlab/snapdom/commit/4c4e0792a1ae2b08556b7eaa87ffb20ffe3b99ca)
- update [`24d4fae`](https://github.com/zumerlab/snapdom/commit/24d4fae7cf45d7bfb7c54a0f9035602869713c4d)
- Merge pull request #382 from zumerlab/copilot/classify-open-issues-by-importance [`70f07eb`](https://github.com/zumerlab/snapdom/commit/70f07ebdc37aa6e9cd6cdbfa7aa97a4383c0f3ff)
- Initial plan [`46b302e`](https://github.com/zumerlab/snapdom/commit/46b302e7d195bbd76a766040a94ecf1abf2adacf)
- Merge pull request #374 from kohaiy/patch-1 [`0b21142`](https://github.com/zumerlab/snapdom/commit/0b21142b87d1874aaaa88bc7fc9630eb506ab958)
- Reorganice helper functions [`d1fd982`](https://github.com/zumerlab/snapdom/commit/d1fd98240459f07897311a42e09c1ad3e3a48c62)
- Update p [`d48e067`](https://github.com/zumerlab/snapdom/commit/d48e067c5288509391cfef557199bb33263a4773)
- Document plugin system [`d87ac01`](https://github.com/zumerlab/snapdom/commit/d87ac01fcf0beb8779afbe2be709aa1b35cf7113)
- Feature enable tree-shakeable code [`ebb7b6a`](https://github.com/zumerlab/snapdom/commit/ebb7b6add3b47c75a450e0264d628837303def5d)
- Use v2 beta with plugins [`365723c`](https://github.com/zumerlab/snapdom/commit/365723c7be6e2dc21988b91145d0d908cc21e0fe)
- Update plugin system [`4e21b47`](https://github.com/zumerlab/snapdom/commit/4e21b475fdc42c6eade9cb4dada5bb5ffeb71978)
- Perf improvement [`daf0eca`](https://github.com/zumerlab/snapdom/commit/daf0eca47c0d11828e1a702b6d64d8ab7450581d)
- Adjust final dimensions when excludeMode: remove. See #294 [`a860827`](https://github.com/zumerlab/snapdom/commit/a8608271ffd9b891ec815fa7e3130c0e1be45307)
- Improve material icon / symbols. See #304 [`526c4c8`](https://github.com/zumerlab/snapdom/commit/526c4c8e6874b2dab6110c8ac3361a29b1dc91de)
- Replace straighten with outerTransforms, and noShadows with outerShadows [`902f032`](https://github.com/zumerlab/snapdom/commit/902f032a43ed4919701765d89818c7782902b403)
- Refactor HTML meta tags and scripts for clarity [`4e90b4f`](https://github.com/zumerlab/snapdom/commit/4e90b4f8aa808583e0247a0e33915f137023fe35)
- Update docs [`f7e4e71`](https://github.com/zumerlab/snapdom/commit/f7e4e714143ed671c6e2a5dff41234c3a92d67fd)
- add test [`22ed79a`](https://github.com/zumerlab/snapdom/commit/22ed79a50ffd933a0ab620ba735464b1d841b4c6)
- ok [`52d99d4`](https://github.com/zumerlab/snapdom/commit/52d99d4f1a6b42bef137940dd1c4c0263c420502)
- Fix regression to process MathJax [`7ef116c`](https://github.com/zumerlab/snapdom/commit/7ef116cdbbfcba0793cd918b2ba8ad94e063f74f)
- Add XHTML sanitize. See #282 [`0039301`](https://github.com/zumerlab/snapdom/commit/003930196ed6e11c5dd54fce75d814046a36637d)
- Fix bug See #316 [`7efbede`](https://github.com/zumerlab/snapdom/commit/7efbede5970ed09982c06f8cfa3fe45d990d8fdf)
- Modify contributor update script for multiple README files [`c39a077`](https://github.com/zumerlab/snapdom/commit/c39a077f8a6362a022ab6b14f37627c5c536bdfc)
- Fix placeholder dimensions when image loading fails [`e44b9d9`](https://github.com/zumerlab/snapdom/commit/e44b9d947efaf28fec8976dc13b398788d461d52)
- Update index.html [`5ce73e6`](https://github.com/zumerlab/snapdom/commit/5ce73e6853281b870dc8027a1db335fbaa0795ca)
- Add detection to Baidu on iOS. Also detect other apps/browsers on iOS. See #295 [`97e6dff`](https://github.com/zumerlab/snapdom/commit/97e6dffa34440d157b0b2b1afc5267d7b15c1d7b)
- Enhance styles for demo sections and output [`0001dab`](https://github.com/zumerlab/snapdom/commit/0001dabbef6a2912ce979bc34288947a30c73745)
- add support for text-underline-offset. See #303 [`fb603bc`](https://github.com/zumerlab/snapdom/commit/fb603bca971a10577215c436b73ba5468a4255ae)
- Fix translation [`792faef`](https://github.com/zumerlab/snapdom/commit/792faefe7bbed852a9fc2877e9039c8a54c88802)
- Merge pull request #308 from Amyuan23/fix/image-fallback-dimensions [`ae99fd7`](https://github.com/zumerlab/snapdom/commit/ae99fd7acf35659c8e949c10209d3340dfee9a2f)
- revert [`5b8a97a`](https://github.com/zumerlab/snapdom/commit/5b8a97ae6ae8c54605721229f78e73b7e2c5ad0e)
- revert [`7b8c149`](https://github.com/zumerlab/snapdom/commit/7b8c1497c848aade0d9db40da30e5c3251674342)
- update [`b4f4a27`](https://github.com/zumerlab/snapdom/commit/b4f4a2788d57f46ba9e991d3731b4ab511be10cb)
- update [`7366500`](https://github.com/zumerlab/snapdom/commit/7366500ef1d7fc7274c6a2f03f9026106ee4dc84)
- update demos with plugins [`50e6c4f`](https://github.com/zumerlab/snapdom/commit/50e6c4f85d74bb769fcd7f753f92a3c5be4536c6)
- update [`6005d99`](https://github.com/zumerlab/snapdom/commit/6005d99ba523c69d2527964248867375a29bfdd5)
- update plugins demos [`d9a1408`](https://github.com/zumerlab/snapdom/commit/d9a14084fda992f9d441eaa93cca32d060d024e1)
- fix local register [`9c4508e`](https://github.com/zumerlab/snapdom/commit/9c4508e0cdeb445b76babd71483fe154e0e2ee3e)
- Enable use built-in exporters in custom exporter [`5c6fe36`](https://github.com/zumerlab/snapdom/commit/5c6fe367101d8dfec710372d2b0a7362da3597a3)
- add support for text-underline-offset. See#303 [`0b93c0d`](https://github.com/zumerlab/snapdom/commit/0b93c0de7a720a7c6708a50a153de86ba6f2684e)
- Fix straighten regression [`60c6569`](https://github.com/zumerlab/snapdom/commit/60c6569ebcfbc9ea562c9bddfe9f01c6ea4136db)
- Modify update-contributors workflow for dual README [`973b30b`](https://github.com/zumerlab/snapdom/commit/973b30b23bad50ea651fdf447ef1ea26b64d9c45)
- update [`20dccf1`](https://github.com/zumerlab/snapdom/commit/20dccf1ce95225f3464aae755dceb4ef91e8f5eb)
- Modify error handling in updateReadmes function [`44e3cc5`](https://github.com/zumerlab/snapdom/commit/44e3cc5096e76f6cf430308a60a483fc93f8c25e)
- update lint [`54340aa`](https://github.com/zumerlab/snapdom/commit/54340aad797f3e5e881a5febf840efc9df5944ec)
- update lint [`6f2e2b3`](https://github.com/zumerlab/snapdom/commit/6f2e2b38100e34f0769dd41a536c578cc4aa5116)
- chore: update contributors list [`0aa2e11`](https://github.com/zumerlab/snapdom/commit/0aa2e11484c42c307938f0a7205b4b3f7bb7bb6a)
- Modify README example to use overlayFilterPlugin [`ea331f6`](https://github.com/zumerlab/snapdom/commit/ea331f673d7f0a5f223c79516ccb19bafdaaf355)
- fix: improve CSS src property parsing in font faces [`dbe52a1`](https://github.com/zumerlab/snapdom/commit/dbe52a121a7d68441570c02ae32c607907e188dc)
- Fix typo in the website [`0a8827f`](https://github.com/zumerlab/snapdom/commit/0a8827f83cab6efd7c860e3f8ffb95cac66caa7c)
- update [`c65a314`](https://github.com/zumerlab/snapdom/commit/c65a3141a20463fe8ef541057c65815386f9046e)
- update roadmap [`dff59b9`](https://github.com/zumerlab/snapdom/commit/dff59b9ea62fed09a9146fd1e9d897dace30a37b)
- Fix: Inherit root font-size in SVG output [`3bdf300`](https://github.com/zumerlab/snapdom/commit/3bdf300ce417d56b928ea3c1b7258103a35f2445)
- chore: update contributors list [`00b7909`](https://github.com/zumerlab/snapdom/commit/00b7909708ffbc570c6de02218c848d19967c132)
- update [`535d913`](https://github.com/zumerlab/snapdom/commit/535d913deadae81e1b63d6fc5d1d8a18eb010403)
- update docs [`5b95010`](https://github.com/zumerlab/snapdom/commit/5b95010861311e22f0db6583d182ecfe2a1d5b48)
- update [`a4599be`](https://github.com/zumerlab/snapdom/commit/a4599beb18eb36ac601f36626fdd687d0e62c015)
- Fix link to Chinese README file [`6c9b854`](https://github.com/zumerlab/snapdom/commit/6c9b854ea3d3f8b6a1cae4d4fa4af82bbd19bc3e)
- Update readme_cn.md [`61f48f4`](https://github.com/zumerlab/snapdom/commit/61f48f4bb4d52b8f6ca22a45460dbf00a36f6b4e)
- Fix local plugin registration [`0997618`](https://github.com/zumerlab/snapdom/commit/0997618fb2e716ead23bfbe4824bb8365987ccd4)
- update [`718da83`](https://github.com/zumerlab/snapdom/commit/718da83a5393a111ee04c053f20e42e9d5a79b55)
- chore: update contributors list [`7cac15f`](https://github.com/zumerlab/snapdom/commit/7cac15f36fe44311c4ce14cada863bedd107e4af)
- Rename readme_cn.md to README_CN.md [`3818056`](https://github.com/zumerlab/snapdom/commit/3818056405ca6a8486225a25628ace4c2ec79e42)
- Merge pull request #299 from harshasiddartha/translate-readme-chinese [`d92c779`](https://github.com/zumerlab/snapdom/commit/d92c7797f9623316ddefef1a2988900f7c7adbdb)
- chore: update contributors list [`e9bcf56`](https://github.com/zumerlab/snapdom/commit/e9bcf568c8fd29d1424bc1c3a70a34e82b216104)
- Merge pull request #296 from jswhisperer/patch-1 [`74f011e`](https://github.com/zumerlab/snapdom/commit/74f011e7c43b692d339d5d8c5c2015b955f9cf4b)
- Merge pull request #293 from Amyuan23/fix/font-src-parsing-regex [`4459231`](https://github.com/zumerlab/snapdom/commit/44592311eedb90efa7400786837e835caea9983c)
- Merge pull request #280 from mon-jai/patch-1 [`f1a9e15`](https://github.com/zumerlab/snapdom/commit/f1a9e155a80ed4f632e9631eb7d697bfe31a427b)
- eslint code [`c754981`](https://github.com/zumerlab/snapdom/commit/c7549812a018d28809e0e2b314c973abe0cd542c)
- lint tests [`ee974ed`](https://github.com/zumerlab/snapdom/commit/ee974ede694f324f674b688aa7cce16f7ec30a90)
- remove test [`881c366`](https://github.com/zumerlab/snapdom/commit/881c36612bb28bd743ce146b452706450e5ec755)
- test [`1460793`](https://github.com/zumerlab/snapdom/commit/1460793d2077a7e1263d7ade7553e7c405377f3e)
- add cors demo [`885900f`](https://github.com/zumerlab/snapdom/commit/885900f34b8036f16b1fdc966e8450f7b8e0772d)
- Enhance web fonts detection on deph relative paths. See #253 [`e2a8c45`](https://github.com/zumerlab/snapdom/commit/e2a8c454fbab7590f39f77da544193f8e5af13ab)
- Captures CSS shadows [`050365f`](https://github.com/zumerlab/snapdom/commit/050365f8ab2087a912c71c468b4b1c234b21dd6a)
- First plugin and exporter draft [`5da0948`](https://github.com/zumerlab/snapdom/commit/5da09483b82e18ca0fc6873393b9d6830632fcfc)
- update [`244ea64`](https://github.com/zumerlab/snapdom/commit/244ea644a40dad56ee7bd7d9333dafbc00a5b7b6)
- Modularize counters [`024a7f9`](https://github.com/zumerlab/snapdom/commit/024a7f9b2d1b4805c7b12b5cbb62f0200295cc8f)
- Fix subpixel bug. See #261 [`465950b`](https://github.com/zumerlab/snapdom/commit/465950b18e68ce0faf94b229bd65511128cd18a7)
- Improve counter simulation [`4c9e21d`](https://github.com/zumerlab/snapdom/commit/4c9e21d6bc0135614b882e1940ce31b64c5e40b2)
- Add two new options to control transforms and shadows on root element [`8c9a75f`](https://github.com/zumerlab/snapdom/commit/8c9a75f77940221107a6005e458514cca981b2eb)
- Enhance external SVG defs. See #262 [`cd4a7fb`](https://github.com/zumerlab/snapdom/commit/cd4a7fbf0e2d9fc1651c06d5c5f5a3a8f0f54329)
- First plugin system draft [`9c6b91b`](https://github.com/zumerlab/snapdom/commit/9c6b91bc4352de3d323c0746a4e3040058dad519)
- Improve CSS counter() and counters() handling. See #120, see #235 [`8fb0385`](https://github.com/zumerlab/snapdom/commit/8fb03859301075ea9b096197ec5b4dbca4223a95)
- Add basic support to sticky elements. See #232 [`02893e6`](https://github.com/zumerlab/snapdom/commit/02893e60e7f3244c1274d64232e7dbf338a283ec)
- add toSvg() [`122317e`](https://github.com/zumerlab/snapdom/commit/122317eb0301f8375cc23ea8f3fd2361d1b759a4)
- update [`194e2d3`](https://github.com/zumerlab/snapdom/commit/194e2d3cf41e9aac375aedbac221ee5fb39149ec)
- Fix complex canvas render on Safari. See #263 [`2697207`](https://github.com/zumerlab/snapdom/commit/2697207c98373867bcbb91d4afb73d3820c878d3)
- Enhance CSS vars detection. See #262 [`6655303`](https://github.com/zumerlab/snapdom/commit/665530377bceff05ff9c1570301019bd95370a9c)
- Fix counter CSS reset and bug when exist background-image. See #265 [`3c29997`](https://github.com/zumerlab/snapdom/commit/3c299978e2a4cd4c2daf07d64de5772b28e880b8)
- Fix margin collapsing in some cases. See #243 [`7fe0a3f`](https://github.com/zumerlab/snapdom/commit/7fe0a3ffe6e9827b276f0c0337c60c8c02c4129c)
- Add feature, lineClamp. See #241 [`4082cd6`](https://github.com/zumerlab/snapdom/commit/4082cd6c39ff43bcb842a81768e11b858c5e8559)
- Fix scale, width, height options [`8ef48cb`](https://github.com/zumerlab/snapdom/commit/8ef48cb2e038c286eea9b7ce2baafac30c062a5e)
- change optionsnames [`b36a1db`](https://github.com/zumerlab/snapdom/commit/b36a1dba490abd09ac0c82c357ae4d1aa086122e)
- update [`fb8b932`](https://github.com/zumerlab/snapdom/commit/fb8b932cec14d467a7a4f0d5c2ff0b75921f8002)
- FIx excludeFonts defs. See #260 [`84b1770`](https://github.com/zumerlab/snapdom/commit/84b1770dd2e6e487e22afcd04c2d34cd0490528c)
- Update types [`19317e6`](https://github.com/zumerlab/snapdom/commit/19317e6ff34599028e627f891ae5a2d28036bac1)
- update installation [`5214091`](https://github.com/zumerlab/snapdom/commit/5214091ac65023c94a9106eb9604c2b43c8128a3)
- fix formating [`58ca761`](https://github.com/zumerlab/snapdom/commit/58ca7616e3e82ec81122804264466f33d79c45c2)
- Fix width/height options [`7cd2111`](https://github.com/zumerlab/snapdom/commit/7cd21114d1337e48b5d743cb94989feb1a1a0d20)
- update demo [`d2dc2f5`](https://github.com/zumerlab/snapdom/commit/d2dc2f5c23d473ddf0eb07cd7fa3f8190653fd61)
- update [`500333d`](https://github.com/zumerlab/snapdom/commit/500333dbeec531d2583d427df477bbc1e8eaeec2)
- update favico [`c56d5dd`](https://github.com/zumerlab/snapdom/commit/c56d5ddb1a932c35983a8bb2954eb4c827f5d56c)
- Fix bug that hangs snapDOM on some browsers. See #236 [`bc3c400`](https://github.com/zumerlab/snapdom/commit/bc3c400356a6f32f8d1d8a986c9a427e6dd13c7f)
- just run safariWarmup if it is needed [`a32846d`](https://github.com/zumerlab/snapdom/commit/a32846d6f48ab8c583b1f26c41d19f3cff67ab55)
- Safari, in case of scale, width or height options use png to ensure fidelity [`0711a77`](https://github.com/zumerlab/snapdom/commit/0711a7774f6f545cd05e0cce86f3354fe377b02d)
- FIx bug that overrides options.width/heigth. See #241 [`49fbb63`](https://github.com/zumerlab/snapdom/commit/49fbb63ac6c28a66a8e6d9076618bee7b6beab62)
- Add toSvg() in replacement of toImg() [`10e2043`](https://github.com/zumerlab/snapdom/commit/10e2043182672b42dfbda4268fb17f75bc3b561a)
- Fix background-repeat. See #259 [`0ad5fa4`](https://github.com/zumerlab/snapdom/commit/0ad5fa4ee56e417016ce495ea299cf4a3c586f6a)
- Enhance browser detection. See #251 [`cfe753c`](https://github.com/zumerlab/snapdom/commit/cfe753c280ab0c0cda8aca88978a550257caf23f)
- Fix pseudo capture. See #252 [`e85678e`](https://github.com/zumerlab/snapdom/commit/e85678e54fac6736c3dac8a0eaac8f1607dcbb6a)
- update [`8ebd650`](https://github.com/zumerlab/snapdom/commit/8ebd650e3ba770fb2aff9ebd9ac8a7b2e4120796)
- Tidy code [`373ffb6`](https://github.com/zumerlab/snapdom/commit/373ffb62228e33e2e07268d558e76b80f49db09f)
- Improve relative path detection. See #253 [`34158e0`](https://github.com/zumerlab/snapdom/commit/34158e0f5cf8f797cd49416f090d06d2d233542d)
- Feat. detect wechat browser. See #223 [`e7c4723`](https://github.com/zumerlab/snapdom/commit/e7c4723a24ad3a9c52da5a2e021c115b354bcf66)
- update [`21243a6`](https://github.com/zumerlab/snapdom/commit/21243a6ff2894b372a524733eb62a2bd8ba6dfdd)
- update [`f711d7a`](https://github.com/zumerlab/snapdom/commit/f711d7a7b7fd16d3cdf8d4238527fbe8e0492150)
- Update issue templates [`0ce0f5a`](https://github.com/zumerlab/snapdom/commit/0ce0f5a49027d16bc765441da5789f8cc8580f82)
- Fix export name format jpg -&gt; jpeg [`47d532a`](https://github.com/zumerlab/snapdom/commit/47d532a98be096829b592295527c1a6428d6a5d8)
- sanitize container [`a6ba396`](https://github.com/zumerlab/snapdom/commit/a6ba396c52406bf9c5dd0ffd27f9460cd34b028e)
- fix compile args [`061ee33`](https://github.com/zumerlab/snapdom/commit/061ee33147338a507a850175caf9d1b28320ec87)
- Fix Safari Image Issue. See #330 [`ba80b6f`](https://github.com/zumerlab/snapdom/commit/ba80b6f66393886298cdb2fc7ce134d1824184f7)
- Minify mjs version [`9155d4f`](https://github.com/zumerlab/snapdom/commit/9155d4fa2e2fc4bb6a0e3d7a991fc75818644084)
- update [`ea7075c`](https://github.com/zumerlab/snapdom/commit/ea7075c32c1d802f0de9d8519de7c0d7d776dc1c)
- Recompile builds [`fca9e00`](https://github.com/zumerlab/snapdom/commit/fca9e00d49bb675d6b6103ba2de3f898c85c5578)
- Chore re compile [`1a4f39b`](https://github.com/zumerlab/snapdom/commit/1a4f39b973d7ac471de39e44ead6f1956a021114)
- Merge  branch 'main' of https://github.com/zumerlab/snapdom into main [`7f49642`](https://github.com/zumerlab/snapdom/commit/7f49642fc8b3be92069e49eb4a803169dfa5963e)
- update sponsors! [`61ff4b0`](https://github.com/zumerlab/snapdom/commit/61ff4b057a2ead81f2b417b63a612f4a5e763288)
- add lint [`e9159a5`](https://github.com/zumerlab/snapdom/commit/e9159a544278398fbecd2d0009aca5a1d62fbf29)
- fix(snapdom): remove redundant safariWarmup reset to improve iteration logic [`72d3fb7`](https://github.com/zumerlab/snapdom/commit/72d3fb72968d136f1c71d234d57272ce0f3fb6e1)
- Fix formatting in README_CN.md [`9430707`](https://github.com/zumerlab/snapdom/commit/9430707b634b05f69f6a590e03b152c0e5162956)
- Add a re-export for preCache. See #332 [`acc5b79`](https://github.com/zumerlab/snapdom/commit/acc5b79a0c8d38de9f6dea5b98bf1179b54ef671)
- Fix formatting in readme_cn.md [`66e19d7`](https://github.com/zumerlab/snapdom/commit/66e19d78f4db78d017c3da16d38812e756eea230)
- chore: update contributors list [`5f88cbb`](https://github.com/zumerlab/snapdom/commit/5f88cbbdc332aa894fee58e7b7135af4e0bd10bc)
- Create CNAME [`0685b19`](https://github.com/zumerlab/snapdom/commit/0685b193f091a504ae362f005649c4ae6cdcc984)
- add iframe support [`ec59e4b`](https://github.com/zumerlab/snapdom/commit/ec59e4bad3dbb639cde37aed929dccb42b54e6b5)
- update hero [`ae9d76d`](https://github.com/zumerlab/snapdom/commit/ae9d76d0396a69c8ae0a37342ac480e144ca8ca5)
- Merge pull request #249 from K1ender/dev [`e497bba`](https://github.com/zumerlab/snapdom/commit/e497bbae30e2c539c53715f9dd0bed585d10cf9a)
- Code refactor, cache improve, options centralized [`3bd7182`](https://github.com/zumerlab/snapdom/commit/3bd71822cf72614b3bb5993039482fdb05833ceb)
- update tests [`e958433`](https://github.com/zumerlab/snapdom/commit/e958433ec34ec571e8e506172c9e281caabe5bf2)
- update tests [`a24bdab`](https://github.com/zumerlab/snapdom/commit/a24bdab20c92b7b316dc376ac38c80b1720befd5)
- update demo [`27f30e3`](https://github.com/zumerlab/snapdom/commit/27f30e3387a460a9a872498580ce5c8d34478e19)
- Improve performance and cache [`8882025`](https://github.com/zumerlab/snapdom/commit/88820259d4000fd36dbf4f59bb4940a6e12e6611)
- Strip dev comments [`e02066b`](https://github.com/zumerlab/snapdom/commit/e02066b6ef8e6c2b1d50b86096500f914ac025af)
- update test [`271ace7`](https://github.com/zumerlab/snapdom/commit/271ace7bfee7ef7cba2ecfaeee04b424a64c28a3)
- increase test coverage [`0c59fa0`](https://github.com/zumerlab/snapdom/commit/0c59fa0d276b7899cf2b721d32e7934e701df76b)
- Enhance font handling [`cb1e04a`](https://github.com/zumerlab/snapdom/commit/cb1e04af0551f097b44eeb84ba64a97e869b6f60)
- update test [`3a9f25d`](https://github.com/zumerlab/snapdom/commit/3a9f25da39f0370796d1a203ceedd1c9440af18d)
- Improve capture fidelity [`e05f027`](https://github.com/zumerlab/snapdom/commit/e05f027b8eb3b5b90e22a9d8ce7a7279f7b1614b)
- update [`5c21213`](https://github.com/zumerlab/snapdom/commit/5c212137ff06fc0f9fb763491db93ecec7ee71ee)
- fix font fetching [`70dd092`](https://github.com/zumerlab/snapdom/commit/70dd092adb14899031f0596d83ec354c9ab023b9)
- Set compress as default [`7e5ab00`](https://github.com/zumerlab/snapdom/commit/7e5ab007f653f995b09ecbbf7711d69937fdef4a)
- Fix speed regression [`542ed00`](https://github.com/zumerlab/snapdom/commit/542ed003e3f35c19bd51fd5317f5572c12ba1ac8)
- Add extra margin when element has transform [`6688eee`](https://github.com/zumerlab/snapdom/commit/6688eee661de2d91249f9db28948629f421b14b4)
- Update tests [`d2bc332`](https://github.com/zumerlab/snapdom/commit/d2bc33213196aed56b65e530a5c0171377e373fe)
- Handles Blob scr [`fe27239`](https://github.com/zumerlab/snapdom/commit/fe27239ac3efef9a0e9e7f0feeb223dd74fd9086)
- Feat. handkles css trasnforms and scale rotate new props. Ref #216 [`d151da1`](https://github.com/zumerlab/snapdom/commit/d151da1993f1374d2bae16ed1a076a05f9ff8d45)
- update test [`56c244a`](https://github.com/zumerlab/snapdom/commit/56c244ad40e0e5c9fbb8d6fd921edcf3dde86d70)
- optimice code [`df52437`](https://github.com/zumerlab/snapdom/commit/df524379288fcb08dd19b8957d627a24b898685e)
- Core update: increase X3 speed capture compared 1.9.9 [`94bc57d`](https://github.com/zumerlab/snapdom/commit/94bc57dc53cb63d82532467b4a041ab26da7481a)
- Try fix fallback images [`67bedd3`](https://github.com/zumerlab/snapdom/commit/67bedd3c7cb6bda3e2291fe494805a58263e6dce)
- Add same-origin iframe support .See #222 [`f50720f`](https://github.com/zumerlab/snapdom/commit/f50720fe76d8d114c1de31ffe802ade1edd7060e)
- Fix regression that doesnt reset origial translate [`800c427`](https://github.com/zumerlab/snapdom/commit/800c427d327f41fbcc9703dfa5a3e99b9b7c789f)
- Fix duplicated values on textArea [`0915f8d`](https://github.com/zumerlab/snapdom/commit/0915f8d4f1b9e58800407ba28ad86e16b6cc4621)
- Update types defs [`648f4a9`](https://github.com/zumerlab/snapdom/commit/648f4a965106c58c6f63d384bf8db600a661146c)
- 增强图像处理功能，添加图像加载失败时的后备图像源支持，并记录原始图像尺寸以便于使用。更新类型定义以包含新选项。 [`011620a`](https://github.com/zumerlab/snapdom/commit/011620a3c8dbabed9c2e509766c4516205fbad66)
- Improves mask handling [`f3915ea`](https://github.com/zumerlab/snapdom/commit/f3915ea919b927b5f2ff0a9f3c865beb7b08b231)
- ✨ feat: [`e3a4556`](https://github.com/zumerlab/snapdom/commit/e3a4556a4085c0968bcce9f54d7d0fb9bbcfc6a7)
- Ensure custom fonts are capured [`8125689`](https://github.com/zumerlab/snapdom/commit/81256893249b2313edfebacb9d68ec6ed4fa9ed2)
- update test [`09904dc`](https://github.com/zumerlab/snapdom/commit/09904dca975c6fe38abf5bd11c4145c157ff185c)
- update docs [`e5f3d5d`](https://github.com/zumerlab/snapdom/commit/e5f3d5d88c783c2efbbf1b05dc83f9e30311d2fa)
- Try new approach for solve Safari fonts/images decoding [`5b77738`](https://github.com/zumerlab/snapdom/commit/5b7773847f02809826a9ed459321100cfbd50518)
- update [`b1bc01a`](https://github.com/zumerlab/snapdom/commit/b1bc01a11c810cac231fc664949ce286135be28b)
- update defaultImageUrl usage at README.md [`c330fef`](https://github.com/zumerlab/snapdom/commit/c330fef60ffef2a1adb73bb1d05d8418138ea0b0)
- fix again extra margin viewport [`f3d8455`](https://github.com/zumerlab/snapdom/commit/f3d84554856f4b1ab709dac8bb4055227d0309bd)
- Two separate mode: filterMode and excludeMode [`394e7f4`](https://github.com/zumerlab/snapdom/commit/394e7f4ca2171fb1028eb382b2331d4718f6a350)
- add font test [`320943e`](https://github.com/zumerlab/snapdom/commit/320943ed4abdbb52adfd6f208f7cc1af9fde3197)
- update [`89777df`](https://github.com/zumerlab/snapdom/commit/89777df0c4bf3afe716fa8008e046b50e7e90835)
- Fix Safari bug that prevents capture [`6a43e59`](https://github.com/zumerlab/snapdom/commit/6a43e59d1c311452c7d16e1adc9bb12bb89132b4)
- update [`a0b3a9c`](https://github.com/zumerlab/snapdom/commit/a0b3a9c1c4d5c3d73f9a85f5da359ea7e917ba4a)
- update [`056d988`](https://github.com/zumerlab/snapdom/commit/056d98822653035de365e343e5bfffe320d5f9c8)
- Workaround Safari See #231 [`593ad59`](https://github.com/zumerlab/snapdom/commit/593ad59383d0b3adbcb139f6892ae321a08c60d5)
- Improve webFonts render. See #229 [`3082a3a`](https://github.com/zumerlab/snapdom/commit/3082a3ae019f424e127f3c065cbcfa7bad59bb39)
- Fix first custom font bug on Safari [`971d976`](https://github.com/zumerlab/snapdom/commit/971d9762dd73263689057e16fb47c00d2e0eba1b)
- update [`d6a4531`](https://github.com/zumerlab/snapdom/commit/d6a4531ace34bdae14eb0c1819adf76b60e77dd1)
- update demo [`97156c8`](https://github.com/zumerlab/snapdom/commit/97156c85271e99fa6f777320dff70be0e16d05c7)
- Fix big that affects overall capture fidelity [`35539a5`](https://github.com/zumerlab/snapdom/commit/35539a50da67c30e28c39272a4c1efefbf24a2e2)
- MInify styles [`2e01c68`](https://github.com/zumerlab/snapdom/commit/2e01c680f9710c72775633878b0236e26fcca1e6)
- fix backgroundColor regression [`21a6a39`](https://github.com/zumerlab/snapdom/commit/21a6a3923d81d2f733d6bc61136a9d4eda8f1a62)
- update to avoid vitest issues [`51ef80d`](https://github.com/zumerlab/snapdom/commit/51ef80d24b693ceee3e33d75e2b64ba7037e49ea)
- update exports to avoid vitest fails [`91a554e`](https://github.com/zumerlab/snapdom/commit/91a554ecb696810591b3916cb14be21074773eb9)
- update demo [`de6f667`](https://github.com/zumerlab/snapdom/commit/de6f6674827505ed76f819ea843e4004acb6756f)
- update [`aec42ae`](https://github.com/zumerlab/snapdom/commit/aec42ae854551cc8d51f1cc7d1072aba871d1225)
- remove iframe limitation [`77abf8f`](https://github.com/zumerlab/snapdom/commit/77abf8f617fd1942565ee141406757c3704f45ae)
- fonts safari [`791e506`](https://github.com/zumerlab/snapdom/commit/791e506f07804b6ed0db67962fe6998a60994c7c)
- chore: update contributors list [`4cc5a00`](https://github.com/zumerlab/snapdom/commit/4cc5a008e33a780da3d9a3e4542da456f10da6a5)
- Merge pull request #220 from Jarvis2018/main [`adb6455`](https://github.com/zumerlab/snapdom/commit/adb6455fd6ff9db128dda5a59ac7556a16c851fa)
- Merge pull request #215 from xiaobai-web715/dev [`37be327`](https://github.com/zumerlab/snapdom/commit/37be327f7c55ae20ee65001a8469f59284dbe12f)
- update [`b1ad47f`](https://github.com/zumerlab/snapdom/commit/b1ad47f31deb4978d5a41eaa2f703c16ff17c70c)
- IconFont doc [`9b62a9f`](https://github.com/zumerlab/snapdom/commit/9b62a9f4aaa1dbd58bccc7663f86a8890ac3214f)
- update [`b4a0e4e`](https://github.com/zumerlab/snapdom/commit/b4a0e4e9b368a534a101d59b2ba4d8219ef462b0)
- test: increases coverage [`7ebc871`](https://github.com/zumerlab/snapdom/commit/7ebc87143101a9e5c8573f5ae76ede2884b59eb8)
- Increase test coverage [`0c63478`](https://github.com/zumerlab/snapdom/commit/0c634785157ca9f611973976000b2f25ba7c9549)
- Improves internal styles and class generator [`59efdc1`](https://github.com/zumerlab/snapdom/commit/59efdc1b62764c0a6789b28af849c9556ffc46a3)
- add a new hero [`57be597`](https://github.com/zumerlab/snapdom/commit/57be59789a19674e181ddb5bed317f570ed7d736)
- update test [`4204706`](https://github.com/zumerlab/snapdom/commit/420470698e9534bef390c8ed35cd812b0f0609cd)
- chore: update contributors list [`76ed282`](https://github.com/zumerlab/snapdom/commit/76ed28218e2e4479753e063836fea04d38d65b52)
- Merge pull request #183 from zhanghaotian2018/main [`84a77c8`](https://github.com/zumerlab/snapdom/commit/84a77c822e161a28a1e1d873e36f772cb57bf204)
- fix: invalid border-width check [`21333b8`](https://github.com/zumerlab/snapdom/commit/21333b8c1e9c1ff1aa30a5c7f05870cc25076809)
- move file [`5ed7552`](https://github.com/zumerlab/snapdom/commit/5ed75525a895ec720b4f319b3eeb8c8d43c5c75e)
- Move files [`f36eeab`](https://github.com/zumerlab/snapdom/commit/f36eeab706853bb8e534a13e2658b25a79989e67)
- Improve pseudo elements detection. Closes # 143 [`539e488`](https://github.com/zumerlab/snapdom/commit/539e488c018a1bf7be05e0d9d969e350c9ed4291)
- Add `filter` and `exclude` options for element exclusion. [`a683357`](https://github.com/zumerlab/snapdom/commit/a6833570965606d47db1c05e7d817ef470c80629)
- Create CODE_OF_CONDUCT.md [`0d3f11a`](https://github.com/zumerlab/snapdom/commit/0d3f11a2e55801922e995107f40b1cb151dbe0a3)
- Improve split multiple backgrounds [`0e67a9b`](https://github.com/zumerlab/snapdom/commit/0e67a9b72fb1ea7ea4a625d5f6dc2eb40438d7cd)
- update [`355866f`](https://github.com/zumerlab/snapdom/commit/355866fd073dde644079e45bccb629e98ef51b6c)
- chore: update contributors list [`da22404`](https://github.com/zumerlab/snapdom/commit/da2240490b46ff4a0747f7db741b822dbc6ba3c4)
- Fix dpr option propagation. Ref #151 [`6780857`](https://github.com/zumerlab/snapdom/commit/67808570be1365e178b6030d62a8c9f8daeba058)
- Add check [`bf9a888`](https://github.com/zumerlab/snapdom/commit/bf9a888525e99dd663c17455755bb1478f1cb9d7)
- Document width and  height options [`0f7fb7a`](https://github.com/zumerlab/snapdom/commit/0f7fb7a02d9159a831a1dfc4cfbd9f6f3420bca7)
- add roadmap [`9bd4281`](https://github.com/zumerlab/snapdom/commit/9bd42810683d58967019a135fe106137765f2a82)
- Update test [`22f4d6d`](https://github.com/zumerlab/snapdom/commit/22f4d6d1b2da0316fe0b1d23077a6645d1704164)
- Add test for fetch images [`45c7678`](https://github.com/zumerlab/snapdom/commit/45c76785018fdc89f4ee2e72ad54f6308fe29590)
- Update issue templates [`7868bb4`](https://github.com/zumerlab/snapdom/commit/7868bb421a6a739af0cbe65cb9469bdc84ead774)
- Update [`7da2892`](https://github.com/zumerlab/snapdom/commit/7da2892e69d04903111bbd24421a574e0034a83b)
- Add html-to-image to benckmark. #103 [`c4fcdd0`](https://github.com/zumerlab/snapdom/commit/c4fcdd0da9de7657c42a90fc40ba2b6cedb550aa)
- Update update-contributors.js [`2a77e4c`](https://github.com/zumerlab/snapdom/commit/2a77e4c82dab36803b005cc6bceab06689a0e52c)
- Add sponsor [`a222510`](https://github.com/zumerlab/snapdom/commit/a2225104ad3aa28b816a96f31d176ab5563bc7fb)
- Fix scale background-image [`b1ba326`](https://github.com/zumerlab/snapdom/commit/b1ba326a3a3708a8b2958f2588354bdfa8762cc9)
- Reenables all libraries to test [`1baf269`](https://github.com/zumerlab/snapdom/commit/1baf2690fe54795ec809ab890be7661894e0abec)
- Update clone.js [`b8cca28`](https://github.com/zumerlab/snapdom/commit/b8cca2885d97d367bb715c107264131975e72718)
- Update test [`9d63bca`](https://github.com/zumerlab/snapdom/commit/9d63bca73486f092f91309e02ce56bc6037c7149)
- Update update-contributors.js [`962c7c6`](https://github.com/zumerlab/snapdom/commit/962c7c6a4e23d5b8a0ef4c72111a617ffac3add4)
- Fix typo [`28ee7fa`](https://github.com/zumerlab/snapdom/commit/28ee7fa444ae61e0c3a1fe03bd2f4a4ada7af759)
- Add layui icon font [`7f6fa5a`](https://github.com/zumerlab/snapdom/commit/7f6fa5a41901c99cd94de1e45762dd7cc9907b8f)
- chore: update contributors list [`cf4b494`](https://github.com/zumerlab/snapdom/commit/cf4b494be856ccf3b29300ac449b942529f5a5e0)
- Remove default backgroundColor on download(). Ref #142 [`a875fe3`](https://github.com/zumerlab/snapdom/commit/a875fe31c1c1fc9a1d0d59ef2934b5930a6b7c88)
- chore: update contributors list [`cea5b84`](https://github.com/zumerlab/snapdom/commit/cea5b84615a008583e363456120c43c2d9db9bc8)
- chore: update docs to show `exclude` and `filter` [`550a5ad`](https://github.com/zumerlab/snapdom/commit/550a5ad14d284441ad20143bfe3c05021e616d1a)
- fix: missing `width` and `height` in types [`9b7d93b`](https://github.com/zumerlab/snapdom/commit/9b7d93b9f3cf87b036086427f885ec40989f3264)
- chore: update contributors list [`e1e66dd`](https://github.com/zumerlab/snapdom/commit/e1e66dd42bbb8cf0a3813dc7184b753e26232d82)
- chore: update contributors list [`2be00a7`](https://github.com/zumerlab/snapdom/commit/2be00a7e32ad2c637b9ca820cb72645a502d46ce)
- Update snapdom.d.ts [`e02ecde`](https://github.com/zumerlab/snapdom/commit/e02ecdeeaa20bc16ba0793ab8ae8232593806dac)
- Merge pull request #156 from fu050409/fix/border-check [`2f08c9b`](https://github.com/zumerlab/snapdom/commit/2f08c9b3b1d114c72e3395821365c71468ac8348)
- Merge pull request #149 from sharuzzaman/patch-1 [`97d9afb`](https://github.com/zumerlab/snapdom/commit/97d9afbe5ea60f16952a5531032df75e8df404e1)
- chore: update contributors list [`7c49104`](https://github.com/zumerlab/snapdom/commit/7c49104921a700aea92b26b85c625b08438690d0)
- Merge pull request #131 from kohaiy/patch-1 [`e38d67b`](https://github.com/zumerlab/snapdom/commit/e38d67b0102edf75a9f6e742bd45eacc43be51c1)
- chore: credit contributor @rbbydotdev [`37860d5`](https://github.com/zumerlab/snapdom/commit/37860d5b1668817143fa9b944cfa164272062d37)
- chore: credit contributor @miusuncle [`945e241`](https://github.com/zumerlab/snapdom/commit/945e241a5d3ff2bc0573a85c03f7bbf736b57034)
- Clean transform RootElement prop [`f293e5b`](https://github.com/zumerlab/snapdom/commit/f293e5be0e3ca6a97d43467976d80175d988916d)
- Check if getStyle is iterable [`24dfe05`](https://github.com/zumerlab/snapdom/commit/24dfe056f6d35fe56ab39325b9c4492f84e64cd5)
- Update update-contributors.yml [`7a08887`](https://github.com/zumerlab/snapdom/commit/7a08887ba63c897cd099bb2684cd6ed5a2eaf839)
- Update update-contributors.yml [`018052c`](https://github.com/zumerlab/snapdom/commit/018052c862584996cc547395204a1caf1acdc704)
- Fix: add type def for `SnapOptions` [`3bc06b0`](https://github.com/zumerlab/snapdom/commit/3bc06b05b111f0fb36fc93c3e9395b5976ab4d12)
- chore: update contributors list [`cd52ed5`](https://github.com/zumerlab/snapdom/commit/cd52ed5ece706cd0b56a9ec04da196bd57966b6f)
- Merge pull request #105 from tarwin/main [`e714ac7`](https://github.com/zumerlab/snapdom/commit/e714ac7a395630c6c2181065008c460e2d152928)
- fix margin on mobile [`36297c8`](https://github.com/zumerlab/snapdom/commit/36297c89c085f605922f88ac5113f2f176c6a1a9)
- update [`7c5441e`](https://github.com/zumerlab/snapdom/commit/7c5441ed4b2c602bcee60b314162f10412b260c5)
- Add benchmark against html2canvas [`f196afe`](https://github.com/zumerlab/snapdom/commit/f196afeb43b23624680a77e52a80222a476f055d)
- Add description [`bcae4af`](https://github.com/zumerlab/snapdom/commit/bcae4af3ce9e0953fea8410303e6d77fe3e01e3e)
- mobile friendly [`42dada8`](https://github.com/zumerlab/snapdom/commit/42dada88bdbe886033890071e8e76499358a6b91)
- chore: update contributors list [`ec7c275`](https://github.com/zumerlab/snapdom/commit/ec7c27590318df95e7aa903ec7cbd92112b6c2e8)
- Update issue templates [`352dba3`](https://github.com/zumerlab/snapdom/commit/352dba3e53452f09fb5d056a0c5fb9216701a0f4)
- Update index.html [`1bf3bc1`](https://github.com/zumerlab/snapdom/commit/1bf3bc1b15f4d28b50363c73410cea25ad589cda)
- add options.crossOrigin [`49f8ac6`](https://github.com/zumerlab/snapdom/commit/49f8ac6524e3f54e67505d048a4ad34c529ab6c9)
- Update issue templates [`d832dbd`](https://github.com/zumerlab/snapdom/commit/d832dbd14df70f07d3f3ec9b62016dc4d19d8c9a)
- Create update-contributors.js [`453dff0`](https://github.com/zumerlab/snapdom/commit/453dff07d0fd8f333627ed22a6e8a64373dbd62d)
- Create CONTRIBUTING.md [`9a7be15`](https://github.com/zumerlab/snapdom/commit/9a7be151f6b36abd5a582aebbcaacfe759716c3a)
- Improve icon-font conversion [`7bac4ee`](https://github.com/zumerlab/snapdom/commit/7bac4ee3b152d6364c218aaa6d2bed4ad9997943)
- handle multiple background image in inlineBackgroundImages function [`95a5490`](https://github.com/zumerlab/snapdom/commit/95a5490f2de5a139f39c0286111eb4e84990fd00)
- Update issue templates [`b69b5a4`](https://github.com/zumerlab/snapdom/commit/b69b5a4cb72e3bd0ca5f8ae5b43448c8aab95752)
- Fix compress mode [`652cfe9`](https://github.com/zumerlab/snapdom/commit/652cfe9a8947029e31db6b089829fe8da87c0b42)
- Create update-contributors.yml [`b48e334`](https://github.com/zumerlab/snapdom/commit/b48e334043e2a18212620df413b8742d72959468)
- Improve: Device Pixel Ratio handling, thanks @jswhisperer [`1a14f69`](https://github.com/zumerlab/snapdom/commit/1a14f69d340e935126b5388febe5d711c4b94e14)
- update [`57d6b15`](https://github.com/zumerlab/snapdom/commit/57d6b1529c56e890a43cc427f817c731784f6ca0)
- Update index.html [`f002bca`](https://github.com/zumerlab/snapdom/commit/f002bca6ee6330ae9d6f2550d36ce59414de29b0)
- Update update-contributors.js [`46a868b`](https://github.com/zumerlab/snapdom/commit/46a868baa45bd068be687b19bbd50cb06ceb9cf0)
- Update issue templates [`24d478f`](https://github.com/zumerlab/snapdom/commit/24d478f32795b42b13f70b4319b5e2cd0ba3fa70)
- Add files via upload [`0aecf4e`](https://github.com/zumerlab/snapdom/commit/0aecf4e46093743ca854397509a8be91e08cb666)
- Create FUNDING.yml [`ddf914c`](https://github.com/zumerlab/snapdom/commit/ddf914c96727b3a82bbea4694d19dc0eb2b518e3)
- chore: update contributors list [`020eff8`](https://github.com/zumerlab/snapdom/commit/020eff873c18fc601c145f957bdc566403e18649)
- Fix .toCanvas scale [`fb47284`](https://github.com/zumerlab/snapdom/commit/fb4728463a65620bd4f4f8f50cd8b2263ba7bbe7)
- Remove some logs [`4348b39`](https://github.com/zumerlab/snapdom/commit/4348b390ab8bb88c59ba9b0d24adbe58051b277a)
- update [`e444762`](https://github.com/zumerlab/snapdom/commit/e444762ddb173d283b761e13a1e5e16c8853e325)
- add ga [`6d8a73f`](https://github.com/zumerlab/snapdom/commit/6d8a73fd52997e9e1a91944bd9a46d95c8c8507c)
- Update update-contributors.js [`b4cf877`](https://github.com/zumerlab/snapdom/commit/b4cf87709f632be2e03f40b0af5661393f8f8793)
- chore: update contributors list [`a2d28d9`](https://github.com/zumerlab/snapdom/commit/a2d28d952b18787d8e7aabf1b6d12cd8e45fa436)
- Chore: delete old comments [`ff81a40`](https://github.com/zumerlab/snapdom/commit/ff81a40e8a1b4baa8bacca2ed2ec59124df40b6e)
- Update index.html [`46e4b41`](https://github.com/zumerlab/snapdom/commit/46e4b41209c44766425e96fb9be94e1d1c08b6ae)
- Update doc [`7cf19de`](https://github.com/zumerlab/snapdom/commit/7cf19de5df40735b17958359251c481c1b517d8c)
- Update index.html [`997dab3`](https://github.com/zumerlab/snapdom/commit/997dab3293df81dc906116acbf7b4f388a270b39)
- update [`0355286`](https://github.com/zumerlab/snapdom/commit/035528627f957213d35f1c63d9f73528deb972cf)
- Update cdn [`37533a2`](https://github.com/zumerlab/snapdom/commit/37533a2c2a858000e93d8d33009241a4be5f8726)
- Update index.html [`1a2a04c`](https://github.com/zumerlab/snapdom/commit/1a2a04cbb3f4e81e2713d823d5b8dcdeb508591d)
- Update update-contributors.js [`7dca4a1`](https://github.com/zumerlab/snapdom/commit/7dca4a1d3bbaacc14295f0e891095db1b39a76d0)
- Ignore generated screenshots tests [`cce8ead`](https://github.com/zumerlab/snapdom/commit/cce8ead47c470280761a34f7c98f9a2fd0796a34)
- Update index.html [`5dd6749`](https://github.com/zumerlab/snapdom/commit/5dd67495df0a5cd48eda168565a81969d5639f40)
- Prevent erasing non url background [`0d626cb`](https://github.com/zumerlab/snapdom/commit/0d626cb32b8958afd7e7fd6f96d5a71c6795113b)
- Update index.html [`25d970f`](https://github.com/zumerlab/snapdom/commit/25d970fb1142c07bf10c8d9eba491ecdb3bf3e37)
- update [`1cf93b7`](https://github.com/zumerlab/snapdom/commit/1cf93b7e25eaa39878f2334e9c240e98ed98f847)
- update [`2d4380b`](https://github.com/zumerlab/snapdom/commit/2d4380b4c900d3230a44a5af0380d149e55caca9)
- Update issue templates [`48a56fb`](https://github.com/zumerlab/snapdom/commit/48a56fb7f5006b20e64de6a592ec38c7a59b3cd8)
- Update index.html [`7585674`](https://github.com/zumerlab/snapdom/commit/7585674ed21bb7009b84d1f948ceed2d5ed5ae69)
- chore [`9f76e0c`](https://github.com/zumerlab/snapdom/commit/9f76e0cb1e7761604693588092ac8b1796cc892e)
- chore: update contributors list [`9987328`](https://github.com/zumerlab/snapdom/commit/9987328a796bb3eb70eb45cda4485dc8f5906688)
- docs: add @jhbae200 as contributor for PR #46 [`afe3094`](https://github.com/zumerlab/snapdom/commit/afe3094360f14712a55c1be134ab993c094a670b)
- Merge pull request #44 from elliots/support-use-credentials-on-images [`005f23e`](https://github.com/zumerlab/snapdom/commit/005f23e529962d73e7550f9f20e92bdc7c8eb8ab)
- format code [`146fd95`](https://github.com/zumerlab/snapdom/commit/146fd95ec93d6b842acb28272aad43f787dc954a)
- first public version [`aac1d99`](https://github.com/zumerlab/snapdom/commit/aac1d997836362dd008d6372173c9dd84a76197f)
- new demo gallery [`b8b2b6e`](https://github.com/zumerlab/snapdom/commit/b8b2b6eb4373999af5e67fc87418d6c6ab96199f)
- Delete functions [`c5040d9`](https://github.com/zumerlab/snapdom/commit/c5040d90b6276daa04e919ca4b0ecdf205f73af9)
- improve cache handling [`27d7b19`](https://github.com/zumerlab/snapdom/commit/27d7b19cfafeed83f4b30a824638ee7edd63e10b)
- Add as draft new default approach - not implemented [`6f4ec41`](https://github.com/zumerlab/snapdom/commit/6f4ec41c7146525c9db5cfce103e131bb3f19616)
- add some examples [`3ce9dd2`](https://github.com/zumerlab/snapdom/commit/3ce9dd2807c8b84ed927c186621850a2518dfd2a)
- Reorganice and add helpers [`c4f4182`](https://github.com/zumerlab/snapdom/commit/c4f4182a3e9ce636a2a263a05d75e64b33b25d7b)
- Update code documentation [`6f933bc`](https://github.com/zumerlab/snapdom/commit/6f933bca3f1e9a9054f2e0e63807dfd52dda6270)
- Add tests [`bdd5a7f`](https://github.com/zumerlab/snapdom/commit/bdd5a7f491561966cd04bf72ca74185dc8e5a766)
- Update to reflect new public API [`b6024cb`](https://github.com/zumerlab/snapdom/commit/b6024cb800b848103411d4e8f4be9a7ffdb84f48)
- Add tests [`455e7f2`](https://github.com/zumerlab/snapdom/commit/455e7f20e8a72f6a646a7d1e900f41fb22a18666)
- Check if element to capture exists [`dfa96f2`](https://github.com/zumerlab/snapdom/commit/dfa96f2f720238fdff5df6e24b4572691ad6198f)
- Feat: captures icon fonts [`7b39e5f`](https://github.com/zumerlab/snapdom/commit/7b39e5fb964bc023f6d6fad555b357de5ab113f0)
- Improve capture logic [`79ab1b9`](https://github.com/zumerlab/snapdom/commit/79ab1b9e165dd08a34338fe0d837b0330be48539)
- Initial commit [`fb1c063`](https://github.com/zumerlab/snapdom/commit/fb1c06307b4b822bb898477beca46f88109ac196)
- Update readme [`fdc2877`](https://github.com/zumerlab/snapdom/commit/fdc2877fd9e6fb73bc5d7bc9cf1f4a405f088be0)
- Omit process default styles - temporary [`2953196`](https://github.com/zumerlab/snapdom/commit/2953196e00aa6bf9d026df95089d3fc81812f24d)
- Add font example [`26c59c8`](https://github.com/zumerlab/snapdom/commit/26c59c864aeaae80b54c22ace32e96396cb9eae6)
- update to v.0.9.2 [`e0179a1`](https://github.com/zumerlab/snapdom/commit/e0179a160e361a1e7d58ee5e83747f385cacb887)
- Add preCache [`48bd910`](https://github.com/zumerlab/snapdom/commit/48bd910743a638ae8ce35ab7d617ad05a75d29a2)
- update [`d90fcb9`](https://github.com/zumerlab/snapdom/commit/d90fcb97bdeb75a2adaaa14b25bd6ebced4a70e2)
- Optimice [`cc638e7`](https://github.com/zumerlab/snapdom/commit/cc638e7f0f2e63a24eeee65ab4d87755e7207dec)
- Add options as Object and allow bgColor on jpg and webp [`e5abaa7`](https://github.com/zumerlab/snapdom/commit/e5abaa72de77f75ebe6901935c5f539cda253db2)
- Update commented docs [`cfd2272`](https://github.com/zumerlab/snapdom/commit/cfd2272b065e8c11fff1a729c6cbec1f14000668)
- Add benchmarks section [`6becbb1`](https://github.com/zumerlab/snapdom/commit/6becbb12014d3cf33ec49264ca088486f08a5ce1)
- Update tests and benckmarks [`f06a0f8`](https://github.com/zumerlab/snapdom/commit/f06a0f835e42036a19761152cf5bf941b53d2f27)
- update tests [`3cd5b70`](https://github.com/zumerlab/snapdom/commit/3cd5b70427613d7d595dd15736cb545db6411d88)
- Update documentation - add precache() [`a689566`](https://github.com/zumerlab/snapdom/commit/a6895665858f9eb574b0195dc918cef680c1651b)
- Add helper to check Safari [`6c9ee04`](https://github.com/zumerlab/snapdom/commit/6c9ee0484c598dd56d52e62f3de37499024ad5e5)
- Remove preWarm [`d3bd582`](https://github.com/zumerlab/snapdom/commit/d3bd582c144775617fc6221c4504466eb4cd6bef)
- Fix capture output format [`2afa36a`](https://github.com/zumerlab/snapdom/commit/2afa36a1c41ff798ded5b7f8ecef1632e08ab716)
- Fix bug on collectUsedTagNames() [`d627f18`](https://github.com/zumerlab/snapdom/commit/d627f18b6c0512545ab695bfae660cac8f64a9f0)
- Update index.html [`0345fb1`](https://github.com/zumerlab/snapdom/commit/0345fb1f177297db0e17141c5737f9b3b510e6ca)
- update [`111fdb4`](https://github.com/zumerlab/snapdom/commit/111fdb444b3c6d61dcb0e6bb2e21c871f5e73587)
- update [`c0e64d0`](https://github.com/zumerlab/snapdom/commit/c0e64d00905898660db68f054f5f5598c3fb9581)
- update [`26ff7ea`](https://github.com/zumerlab/snapdom/commit/26ff7ea0528d569820bed8748520a7d02c6506cd)
- fix change files prop [`548adbe`](https://github.com/zumerlab/snapdom/commit/548adbe9490b0ed4fd7e9fb77e7d6e69a6dc28c9)
- Add cache Maps [`091484c`](https://github.com/zumerlab/snapdom/commit/091484c00941822684afc9148a59cb23e4b34627)
- Omit delay function - temporary [`0f04721`](https://github.com/zumerlab/snapdom/commit/0f04721c458ba921694ee38117b8e0b8231a8c1a)
- update unpkg url [`13ce66b`](https://github.com/zumerlab/snapdom/commit/13ce66bfee83802c32edfd9019959540d260cf84)
- update [`bdbba7a`](https://github.com/zumerlab/snapdom/commit/bdbba7aeff458a60d5a83b5ead2d4f9402492fd3)
- update [`f70a917`](https://github.com/zumerlab/snapdom/commit/f70a9173c7b11d659e6bf80c6ef60b9f71e652b7)
- Add demo site [`88d0faa`](https://github.com/zumerlab/snapdom/commit/88d0faa1b27db0d305e8b78c7280c8a5e83384a5)
- Expose preCache [`1e96db1`](https://github.com/zumerlab/snapdom/commit/1e96db14c6c4e697361ceed2fb6f9c618801a138)
- chore: añadir AGENTS.md a .gitignore [`596f142`](https://github.com/zumerlab/snapdom/commit/596f14247430eabf6c8bb779b500e20d21724e81)
- chore(plugins): bump version to 2.1.0 [`8ace17e`](https://github.com/zumerlab/snapdom/commit/8ace17e8fbc10c27087b2cbbae263114122c22e4)
- chore(plugins): bump to 1.2.0 [`31079ee`](https://github.com/zumerlab/snapdom/commit/31079ee76f873ccdcbd28c9ee539cfcc387a374f)
- chore(plugins): bump to 1.0.3 [`19a4a7e`](https://github.com/zumerlab/snapdom/commit/19a4a7ec748e770e8b9c021f1131663eca271100)
- update [`ea624c3`](https://github.com/zumerlab/snapdom/commit/ea624c362acb7c0f953f3c202dd78f83c84742ce)
- update [`3a547df`](https://github.com/zumerlab/snapdom/commit/3a547dfccc46e835ac585057d80b03ef5b324e7b)
- Update index.html [`bedf815`](https://github.com/zumerlab/snapdom/commit/bedf815299c421e3fe810a480f32bb291aae40b1)
- Update description [`4db784b`](https://github.com/zumerlab/snapdom/commit/4db784b4250b6eac6da8932e651872147fbc8bc1)
- add homepage [`aa85c5d`](https://github.com/zumerlab/snapdom/commit/aa85c5d9f1777c437b07e624d874f7f1a0fac6a9)
- FIx bug that prevent scale on png format [`77a5265`](https://github.com/zumerlab/snapdom/commit/77a52651bd0ea8ccb451f199bd3d8f9e2478bf84)
- update [`ffa3a9a`](https://github.com/zumerlab/snapdom/commit/ffa3a9ad942987a5b52a7c9080914bed912db558)
- Update index.html [`8f4fb95`](https://github.com/zumerlab/snapdom/commit/8f4fb95a8f839159bd00c3338c7c3dc9fb23071c)
- update [`d84d395`](https://github.com/zumerlab/snapdom/commit/d84d39599abbd8fbd31727ff3a6650278ec0e28c)
- Fix menu options [`8e87681`](https://github.com/zumerlab/snapdom/commit/8e876810c721fa0306c0f7d1b427ba6b111f8afe)
- Disable user zoom [`3813580`](https://github.com/zumerlab/snapdom/commit/381358028159c51b9ed0da11e25928da490170fb)
- Chore [`38c08c0`](https://github.com/zumerlab/snapdom/commit/38c08c0c5a9eda486619855b9df47f33f490a921)
- fix url [`bebec7f`](https://github.com/zumerlab/snapdom/commit/bebec7fd70141b3a82d41a5f6cc0849dcfb0c715)
- chore [`2f788af`](https://github.com/zumerlab/snapdom/commit/2f788afd3b25ae6391af6a41086e0b5c3595a701)
- Ignore generated output [`4a48d31`](https://github.com/zumerlab/snapdom/commit/4a48d31348fe97f91bcbb6ed1eb0e59ca9f3d3e8)
- update [`b541784`](https://github.com/zumerlab/snapdom/commit/b5417842e5ffcc788fcf66316f34980b5871b574)
- Ensure donwload file measure. See #241 [`eed1995`](https://github.com/zumerlab/snapdom/commit/eed1995a56664c0ace5d94422ba6bb8b5ef82324)
- chore: update contributors list [`054b827`](https://github.com/zumerlab/snapdom/commit/054b82733046ffa7416324707c2989542e76d67c)
- Add Blob Types options [`f5146a8`](https://github.com/zumerlab/snapdom/commit/f5146a87ae4515c9d4443a4189301f569d75f94b)
- chore: update contributors list [`6047a4d`](https://github.com/zumerlab/snapdom/commit/6047a4dc083ccf388f4ef0b1d2b7ff44675f9efa)
- chore: update contributors list [`dadb608`](https://github.com/zumerlab/snapdom/commit/dadb6086beb15dfe14696d27013a629e2a2ab791)
- chore: update contributors list [`c9853ba`](https://github.com/zumerlab/snapdom/commit/c9853ba70f0be822318a8bf28a3cf6b49a0179a6)
- Task, delete console.log [`80f1013`](https://github.com/zumerlab/snapdom/commit/80f10130ec815464fd7f87b3bfa29a0108032b9c)
- chore: update contributors list [`93d3f03`](https://github.com/zumerlab/snapdom/commit/93d3f037a2e688e3a23e93787ee948b4222c3fbf)
- chore: update contributors list [`8ac4aa1`](https://github.com/zumerlab/snapdom/commit/8ac4aa1f5a21373e73f86b22d0cdad8def37a8ea)
- Create config.yml [`51700c4`](https://github.com/zumerlab/snapdom/commit/51700c4457abb070df34520887991508ce32ad7f)
- Chore: add dry bump script [`5c421c7`](https://github.com/zumerlab/snapdom/commit/5c421c75a1775a3b8c1fbd6a688fcfe409f676af)
- Update index.html [`eebc2bc`](https://github.com/zumerlab/snapdom/commit/eebc2bc01a6581f25995d5a9e946aa6bde08dfdc)
- change hero to Mr SnapDOM [`16e22cf`](https://github.com/zumerlab/snapdom/commit/16e22cf7aaabd0285e4b29aac16455d2212fa08e)
- update image [`0ec788c`](https://github.com/zumerlab/snapdom/commit/0ec788c562011990a008edb2b8f9b0cf18da8940)

#### [v2.22.0](https://github.com/zumerlab/snapdom/compare/v2.18.0...v2.22.0)

> 25 July 2026

✨ feat
- feat: warn once when width-softened text risks re-wrap without reconcile:true [`1b882d6`](https://github.com/zumerlab/snapdom/commit/1b882d69efd07357abfdacc97469b48b6713b278)
- feat: add burst:true capture memoization, replacing session() [`c3f0a56`](https://github.com/zumerlab/snapdom/commit/c3f0a56dd0b02401ef078a411e3e7033e3fcdc10)
- feat(pseudo): add function to strip CSS content alt-text suffix. Ref #458 [`9cefe86`](https://github.com/zumerlab/snapdom/commit/9cefe86b37510a3e953f5734aed31f4aec31bafb)
- feat(session): close the MutationObserver-only staleness gap [`b15b418`](https://github.com/zumerlab/snapdom/commit/b15b418e744f732afb17f06159e01d55bc875127)
- feat: snapdom.session — memoized repeated captures with mutation tracking [`94f206c`](https://github.com/zumerlab/snapdom/commit/94f206c8377359ec5ed32ba281f7818e36eeae7d)
- feat: reconcile option — measured layout reconciliation of the clone against the live DOM [`1597d77`](https://github.com/zumerlab/snapdom/commit/1597d77acbbb99fed1723d38a296bbf6a8f8a55e)
- feat(plugins): per-node resolveNode hook + internal tag handler registry [`aacc512`](https://github.com/zumerlab/snapdom/commit/aacc5120df170d6368f8799a54058e025535488a)

🛠 fix
- fix: resolve &lt;picture&gt; srcset via media-query matching, not currentSrc [`b94f652`](https://github.com/zumerlab/snapdom/commit/b94f6522c67b5fbfb738820e7233ca08d6500350)
- fix: capture roots that are themselves the target element were skipped [`23a3611`](https://github.com/zumerlab/snapdom/commit/23a36110eb15a85944a7c0fffd3296fd634d49c2)
- fix: resolve image-set()/-webkit-image-set() by device pixel ratio [`f1e1cc2`](https://github.com/zumerlab/snapdom/commit/f1e1cc2ab186e557f4077277554e92103e930f8f)
- fix(css): emit the base reset for tags evicted from the defaultStyle cache [`ef584a8`](https://github.com/zumerlab/snapdom/commit/ef584a86fa146d244966cb78ce2a95004625a9c1)
- fix(styles): keep the height of wrappers whose children are all out of flow [`714cdb4`](https://github.com/zumerlab/snapdom/commit/714cdb4e871166e50d10e72ed7efebe59ddfea7b)
- fix(capture): stop background/asset passes losing the session nodeMap when same-origin iframes capture concurrently [`f5e1778`](https://github.com/zumerlab/snapdom/commit/f5e17784b3305a61fa8df56d4e0011565da54e19)
- fix(clone): drop &lt;picture&gt; &lt;source&gt; elements so inlined &lt;img&gt; src is not overridden [`ff7b10d`](https://github.com/zumerlab/snapdom/commit/ff7b10d1c9d28f2bba6ae1c50bfa85cd3efbfebc)
- fix(images): inline the capture root itself when it is an &lt;img&gt; or SVG &lt;image&gt; [`5d5bf71`](https://github.com/zumerlab/snapdom/commit/5d5bf7193113957265f34e75cb69abad1b444752)
- fix(CSSVar): update SVG_TEMPLATE_TAGS and refine isInSvgTemplate logic for mask/clipPath handling. Closes #459 [`509bed1`](https://github.com/zumerlab/snapdom/commit/509bed143eb4612b4deebc0f4e5bb1d3640dcc7d)
- fix(capture): honor filterMode:'remove' in shrink pass and height estimate [`e84557e`](https://github.com/zumerlab/snapdom/commit/e84557e86e884ccc4bb02359f3b81248e5b8d9a0)
- fix: serialize session.capture() calls to stop races on shared cache.session [`9f3cb23`](https://github.com/zumerlab/snapdom/commit/9f3cb238e9fac4cac904f4375d7db955c9f1f144)
- fix: reuse snapFetch in pictureResolver instead of a hand-rolled fetch pipeline [`a737419`](https://github.com/zumerlab/snapdom/commit/a737419a60657f6665ded760b71af14d0a049e1c)
- fix(types): drop phantom snapdom.toJpeg(), add clip option, document outer* defaults [`633a09c`](https://github.com/zumerlab/snapdom/commit/633a09c0300c5ce71a077d8a74cd493656ddffe6)
- fix: stop a failed export from poisoning every later export on the same result [`e69f51b`](https://github.com/zumerlab/snapdom/commit/e69f51bff1b018bee909dc8fc8fdd9dcaca18ea9)
- fix: dedup extendIconFonts entries instead of growing list unboundedly [`56cbe26`](https://github.com/zumerlab/snapdom/commit/56cbe26c724612910aa6c54f74ca2f537bf2c268)
- fix: derive missing export dimension from post-bleed viewBox, not pre-bleed box [`4173c93`](https://github.com/zumerlab/snapdom/commit/4173c9361a783d617e38e759b275645b96ee95a2)
- fix: stop color-tint plugin from clipping bleed content [`56784aa`](https://github.com/zumerlab/snapdom/commit/56784aa16d6a080a057828715d6ec0adffae3631)
- fix: align margin-collapse neutralization by nodeMap, not child index [`9fa7d89`](https://github.com/zumerlab/snapdom/commit/9fa7d89bf145305eb216d930395d2c737abcc9b9)
- fix(pseudo): render box-generating pseudos that paint only via box-shadow/outline [`d239ec4`](https://github.com/zumerlab/snapdom/commit/d239ec47d926e1ced2f2a0d3980aee855f0e8664)

📦 other (chore/docs/refactor/…)
- docs: plain restyle, npm run site local-dist server, clearer burst demo [`13f8662`](https://github.com/zumerlab/snapdom/commit/13f8662fbec07f8aba8d48312fc369c412bbfc49)
- test: split burst benchmark into isolated static/mutating files [`72bbe81`](https://github.com/zumerlab/snapdom/commit/72bbe8130a9336070a778982e4cafef43b7cb111)
- docs(labs): add a live burst capture demo with a real Pikachu card [`3706d62`](https://github.com/zumerlab/snapdom/commit/3706d62301c0da964d248d1942744fac96a0ea08)
- docs: document reconcile, burst, invalidate, and image-set() resolution [`5d9d74f`](https://github.com/zumerlab/snapdom/commit/5d9d74fa0024414b3fdead4daab4591e24249431)
- chore: update contributors list [`bf37697`](https://github.com/zumerlab/snapdom/commit/bf37697b51c853f531f827e4c17d2d086d6b3d80)
- docs: add CORS & external resources guidance to README [`84221c1`](https://github.com/zumerlab/snapdom/commit/84221c18e5e6bb2c99567129daeb2ebde0e1ad66)
- test(clone): stop asserting picture &lt;source&gt; resolution timing across engines [`e1fb59e`](https://github.com/zumerlab/snapdom/commit/e1fb59eb73939902248662cbd709b44938e1d865)
- docs: drop Tanker from the Web fonts showcase paragraph, use plain sans-serif [`64aabbf`](https://github.com/zumerlab/snapdom/commit/64aabbfea7b8d613d89deef7399ebb3f61e574ef)
- test: add type-checking for types/snapdom.d.ts to the test pipeline [`a06a71a`](https://github.com/zumerlab/snapdom/commit/a06a71a1cc901355af80332655a74644110ce774)
- perf: defer buildCounterContext's document walk until actually needed [`8020750`](https://github.com/zumerlab/snapdom/commit/8020750260924115da501dec7cf211375040781c)
- perf(preCache): use fused collectFontUsage (one walk instead of two) [`6a8a488`](https://github.com/zumerlab/snapdom/commit/6a8a48817e6272d297f4d4ec607c41726e30ab3b)
- docs(types): add reconcile option, snapdom.session / CaptureSession, resolveNode plugin hook [`bc0f854`](https://github.com/zumerlab/snapdom/commit/bc0f85459314e7ac4e7f09abe319deb961ee26b8)
- perf(raster): header-peek instead of full SVG decode, single decode/encode cycle, async canvas encode [`af8c549`](https://github.com/zumerlab/snapdom/commit/af8c549078304cd5748d2109e9660877ffb04552)
- perf: fuse tree passes — single-walk font usage collector, snapshot-flagged background pass [`f7274f7`](https://github.com/zumerlab/snapdom/commit/f7274f708c6f5c8fc0ccc4a788483679ff657dc2)
- perf: parallelize network-bound capture phases and memoize image downsampling [`b7fedc7`](https://github.com/zumerlab/snapdom/commit/b7fedc74aa9d2f9e7de712bccdeb9f28f9f6681b)
- perf(clone): skip idle machinery per child in fast mode, make canvas pre-rAF Safari-only [`a5536ae`](https://github.com/zumerlab/snapdom/commit/a5536ae8c3918194c439cf7f2484c384f96fe88a)
- perf: stop self-invalidating the style epoch, memoize scrollbar CSS scan, gate Safari warmup walk [`7a5179d`](https://github.com/zumerlab/snapdom/commit/7a5179d74f5d20aa399d1d89fcac642187bc62b3)


#### [v2.18.0](https://github.com/zumerlab/snapdom/compare/v2.16.0...v2.18.0)

> 21 July 2026

feat
- feat: emulate backdrop-filter at capture time #457
- feat: clip option + snapdom.viewport() — region capture with offscreen culling 328226b

fix
- fix: shadow fidelity in WebKit's SVG rasterization b7e9af2
- Fix rotated-root captures clipped at edges (d31) 64c5a8f
- fix: key the embedded-fonts cache by document identity 05ef9a9
- fix: guard content-sized boxes against sub-pixel width truncation (text re-wrap) 4b92392
- Fix type definitions drift: compress default, quality default, missing options (excludeStyleProps, fontStylesheetDomains, safariWarmupAttempts, debug, filename), toRaw/to on result, LocalFont.stretchPct 7a473c4
- fix: keep root filter blur() and always expand bbox for its bleed 3f6e6e7
- fix: stop compensating the root's stripped translation in the viewBox bbox 3241481
- fix: repair the broken htmlInCanvas re-export in the plugins barrel 1b74a1a
- fix: stop stabilizeLayout from leaving a permanent border on the source element cf3da9b
- fix: guard the container padding offset against Chromium 140 all:initial expansion 0b24929

other (docs)
- FEATURES_CN.md: '按设计跳过' → '有意跳过'. The phrasing fix was independently #453
- docs: refine Chinese documentation dce83ab
- docs: add Chinese translation maintenance guide 4e53063
- Update FEATURES_CN.md to change '按设计跳过' to '有意跳过' 56ff167

other (test)
- Make the test suite pass on Firefox and WebKit 74de348
- Add cross-browser test runs (BROWSER=firefox|webkit|all) with per-engine visual baselines f2b72d8
- test: wait for KaTeX CDN + fonts in the d454 visual demo 8205e1b

other (chore/refactor/merge)
- chore: add cross-engine visual report (npm run report:cross) 5b6e8cd
- chore: update snapdom plugins version ed984ff
- refactor(api): drop snapdom.viewport() — clip: 'viewport' is the one spelling 4a0f301
- Merge pull request #455 from mosuzi/codex/discussion-450-chinese-docs-review 5b0d149


#### [v2.16.0](https://github.com/zumerlab/snapdom/compare/v2.15.0...v2.16.0)

> 13 July 2026

- fix(iframe): rasterize long iframe documents and pin them to the viewport to prevent full expansion during capture [`#449`](https://github.com/zumerlab/snapdom/issues/449) [`c610d4a`](https://github.com/zumerlab/snapdom/commit/c610d4a05acc0c2f2f68bf26297bca1eb8f4fe74)
- fix(textarea): first letter issue expanded to textarea [`#447`](https://github.com/zumerlab/snapdom/issues/447) [`bc5ce38`](https://github.com/zumerlab/snapdom/commit/bc5ce38ed096b1560b8294e2a382aa77f0cbf27a)
- fix(iframe): improve margin and padding handling in pinIframeViewport to preserve content offset [`#448`](https://github.com/zumerlab/snapdom/issues/448) [`6a78d3b`](https://github.com/zumerlab/snapdom/commit/6a78d3bbf9b88d317e6881ab7fae90f0b4591f12)


#### [v2.15.0](https://github.com/zumerlab/snapdom/compare/v2.15.0-dev.1...v2.15.0)

> 3 July 2026

- fix(capture): drop *-prefixed attributes to keep XMLSerializer output well-formed [`#445`](https://github.com/zumerlab/snapdom/pull/445)
- refactor(tests): simplify tests for *-prefixed HTML attributes [`0a818bf`](https://github.com/zumerlab/snapdom/commit/0a818bf6dff1b032bbac26591525d45245532c0f)

#### [v2.15.0-dev.1](https://github.com/zumerlab/snapdom/compare/v2.15.0-dev.0...v2.15.0-dev.1)

> 24 June 2026

- fix(fonts): scan the capture element's ownerDocument so iframe fonts embed (#441) [`#442`](https://github.com/zumerlab/snapdom/pull/442)
- fix(fonts): scan the capture element's ownerDocument for fonts [`#441`](https://github.com/zumerlab/snapdom/issues/441)
- fix: use nodeMap for source/clone child alignment in inlineBackgroundImages [`#440`](https://github.com/zumerlab/snapdom/pull/440)
- Delete .github/workflows/issue-triage.yml [`ab5b36f`](https://github.com/zumerlab/snapdom/commit/ab5b36f5b74f62dd38be211687f036bec965cc41)
- Delete .github/workflows/label-sync.yml [`7366d5a`](https://github.com/zumerlab/snapdom/commit/7366d5a95c78c48f295ffeb46fb31ce421ba82df)
- fix(capture): preserve parent session across nested iframe capture [`cb0ece1`](https://github.com/zumerlab/snapdom/commit/cb0ece12bcba812dcd16a2f133561458e541973c)
- chore: update contributors list [`f18dee0`](https://github.com/zumerlab/snapdom/commit/f18dee05a16681ff41f4db48098eafd3198617a3)
- chore(compress): raise RES_FACTOR to 0.95 [`0bd87d7`](https://github.com/zumerlab/snapdom/commit/0bd87d7e67aa2f12f3e9cfdd83847404555fe58f)
- update [`b541784`](https://github.com/zumerlab/snapdom/commit/b5417842e5ffcc788fcf66316f34980b5871b574)

#### [v2.15.0-dev.0](https://github.com/zumerlab/snapdom/compare/v2.12.9...v2.15.0-dev.0)

> 17 June 2026

- feat: opt-in perceptual image downsampling (compress option) [`e353569`](https://github.com/zumerlab/snapdom/commit/e353569b4c622324e4e721f314b7bb583ff2c57e)
- chore: remove unused exporters registry [`711d591`](https://github.com/zumerlab/snapdom/commit/711d5914220a991520d04a5df9df028d9e1e66cc)
- feat(compress): downsample CSS backgrounds and SVG &lt;image&gt; too [`6666f59`](https://github.com/zumerlab/snapdom/commit/6666f59d7de1e2f204344e8872356d93b79626f4)
- fix: content-aware width softening [`0832e72`](https://github.com/zumerlab/snapdom/commit/0832e72481213d27bfeb341b62cd84d85c0c8820)
- feat(compress): enable image downsampling by default + docs + image benchmark [`7148c74`](https://github.com/zumerlab/snapdom/commit/7148c74bbacc279ee3838f06e67cbbfb5af12d4d)
- refactor: simplify compress to a boolean option [`39e8714`](https://github.com/zumerlab/snapdom/commit/39e87142f0a008b22e88e79d3c4770a053d90aa9)
- fix(#394): pre-decode foreignObject images before raster (cross-browser) [`9895218`](https://github.com/zumerlab/snapdom/commit/9895218f5a17c321f495abcf76abd9dd4d21b6ad)
- feat(compress): downsample oversized images below visible resolution (0.6 factor) [`47b9ed7`](https://github.com/zumerlab/snapdom/commit/47b9ed7f3b196ec0edc1ed52e4187a6e7a7f491c)
- fix(#394): wait for foreignObject image compositing on all browsers [`25279e9`](https://github.com/zumerlab/snapdom/commit/25279e9a1f965be4197fd544c15b4ebe9eea7c88)
- fix(compress): decode images before drawing to avoid blank downsamples [`5aedeca`](https://github.com/zumerlab/snapdom/commit/5aedeca184eef99179b43be32764b4a3033844ae)
- types: add compress option to SnapdomOptions [`495a089`](https://github.com/zumerlab/snapdom/commit/495a089fe499d37d1820fc1399be7d1407e311d8)
- fix: reuse preCache image dataURLs in the capture path [`37d99a5`](https://github.com/zumerlab/snapdom/commit/37d99a50e756d0554c0f9bdcb2ef35933c05405c)
- fix: pass the documented payload to before/afterExport hooks [`1a14fd0`](https://github.com/zumerlab/snapdom/commit/1a14fd0e0a8cee97285e026e70982762dd63a74f)
- fix: re-fetch a font when its resource cache entry was evicted [`2e938a4`](https://github.com/zumerlab/snapdom/commit/2e938a445b00efb13d66ff7cc8e5e12e1857436c)
- chore(deps): bump esbuild to ^0.28.1 (fixes Dependabot high alert) [`3d9a8e6`](https://github.com/zumerlab/snapdom/commit/3d9a8e63969192b01520961cf50f017708623f44)

#### [v2.12.9](https://github.com/zumerlab/snapdom/compare/v2.12.8...v2.12.9)

> 16 June 2026

- fix: emit captured width as a min-width floor instead of dropping it
- fix(#432): escape U+FFFE/U+FFFF noncharacters in sanitize regex

#### [v2.12.8](https://github.com/zumerlab/snapdom/compare/v2.12.2...v2.12.8)

> 3 June 2026

- fix: root margin-collapse clipping (#426) and oversized-raster decode failure [`#425`](https://github.com/zumerlab/snapdom/issues/425)
- fix(#425): strip XML-invalid control chars before serializing the clone [`880376b`](https://github.com/zumerlab/snapdom/commit/880376b196bd4bcf14e8fbd31273ee77340ef1c5)
- fix(#429): don't freeze auto-sized table cell widths [`33b81eb`](https://github.com/zumerlab/snapdom/commit/33b81eb5922e9abfc90c61360af4ceb94eb13b90)
- fix: honor the localFonts option in the capture path [`9122152`](https://github.com/zumerlab/snapdom/commit/9122152f25ee9051f4f4d79d86cd6a20cea817ed)
- fix(#429): also skip the logical inline-size and the rest of the table box tree [`69400a6`](https://github.com/zumerlab/snapdom/commit/69400a60e9e2ac9a1ee36373e9c44d9be1d7a0b2)


#### [v2.12.2](https://github.com/zumerlab/snapdom/compare/v2.12.1...v2.12.2)

> 29 May 2026

- fix(pseudo): render bordered + layout-spacer pseudo-elements (#418, #419) [`#423`](https://github.com/zumerlab/snapdom/pull/423)
- fix(pseudo): keep empty box-generating pseudos used as layout spacers [`#418`](https://github.com/zumerlab/snapdom/issues/418)
- fix(pseudo): render pseudo-elements with a single-side border [`#419`](https://github.com/zumerlab/snapdom/issues/419)
- Add new super power plugins [`88cb353`](https://github.com/zumerlab/snapdom/commit/88cb353802e4cc22b2c52f230b072801fef970e4)
- chore(plugins): v2.2.0 — gif/video/html [`9c84259`](https://github.com/zumerlab/snapdom/commit/9c8425999d0afc9b55bb8f0fb9642ada19049049)

#### [v2.12.1](https://github.com/zumerlab/snapdom/compare/v2.12.0...v2.12.1)

> 28 May 2026

- Fix for placeholder colors not being copied over on webkit browsers [`#420`](https://github.com/zumerlab/snapdom/pull/420)
- fix(pseudo): support counter-set; drop divergent dead counter duplicates [`eb8bdb7`](https://github.com/zumerlab/snapdom/commit/eb8bdb793149ec6c278ef92cfa594e4acfb6a38d)
- fix: proxy-keyed bg cache, case-insensitive font match, nodeMap icon pairing [`0623bcd`](https://github.com/zumerlab/snapdom/commit/0623bcddd818d0f34bb285c0cc01ee6d04bc469f)
- fix(bbox): correct bleed/transform math for inset shadows, blur chains, root scale [`1c43605`](https://github.com/zumerlab/snapdom/commit/1c43605367b1c661602d866b54bbdfca31e5d6b4)
- perf: trim redundant per-node work on the capture hot path [`6d1ad72`](https://github.com/zumerlab/snapdom/commit/6d1ad72548082037b9ab0132794f644fe04354f7)
- fix(capture): stop mutating the live DOM during capture (non-destructive) [`db69e78`](https://github.com/zumerlab/snapdom/commit/db69e7850d1986c5e3cccfd2c5ba283156f45afe)
- fix(export): flatten jpeg/webp background by resolved format, not export name [`1dcfbcd`](https://github.com/zumerlab/snapdom/commit/1dcfbcd73b29cae9fcc2373340bcdb71c26a0903)
- fix(cache): invalidate snapshot on option change, reset measureHints on disabled [`0b8d697`](https://github.com/zumerlab/snapdom/commit/0b8d6975cd66b91ed7b37d674ee3bad879d4a5d3)
- add SnapDIFF [`9bda342`](https://github.com/zumerlab/snapdom/commit/9bda3422821ee8ea7e11803a4a3e59ecaad427cd)
- test(precache): align cache.background keys with proxy-prefixed contract [`064b004`](https://github.com/zumerlab/snapdom/commit/064b004b702933849b77a5f668ec26e405168eef)
- fix(clone): ensure placeholder color is correctly rendered in SVG [`44899b3`](https://github.com/zumerlab/snapdom/commit/44899b349499c350f33fc67eca5d77c3f17b83e2)
- chore: update contributors list [`73358a1`](https://github.com/zumerlab/snapdom/commit/73358a10c32b121e6e28d38cf1c19a8057890aeb)
- Fix download format option types [`2f93d39`](https://github.com/zumerlab/snapdom/commit/2f93d39181c6d6ca233f7d7c9bce227f05a5c761)
- add sponsor [`70c4140`](https://github.com/zumerlab/snapdom/commit/70c41406afdebe69916b5fabd4fbc97326fdab78)
- chore: revert .gitignore to main [`3091154`](https://github.com/zumerlab/snapdom/commit/3091154b18c9a4989b06aec445c4a8ed22efe3e4)
- fix(clone): restore original placeholder logic and styles [`efe1dd9`](https://github.com/zumerlab/snapdom/commit/efe1dd9ff1db002fb01d31ad1ff9d27307aaaefc)
- chore: exclude screenshots folder in .gitignore [`d364607`](https://github.com/zumerlab/snapdom/commit/d364607d860f035b9a66f80b8b614964f5019112)
- Merge pull request #417 from puneetdixit200/fix-download-format-types [`be6bc02`](https://github.com/zumerlab/snapdom/commit/be6bc02b0b7f1efc41351ba4d523dcbad6c52cae)

#### [v2.12.0](https://github.com/zumerlab/snapdom/compare/v2.9.0...v2.12.0)

> 5 May 2026

- feat(plugin)!: rename prompt-export to agent-map, focused on visual agents [`cd5ca18`](https://github.com/zumerlab/snapdom/commit/cd5ca18467873c36df2c0a5b017d877720e18e31)
- update Mr SnapDOM theme [`d9fb7bc`](https://github.com/zumerlab/snapdom/commit/d9fb7bca21ee2d821c03fa72b2409d5090f15ade)
- feat(plugin: prompt-export): richer element map for LLM agents [`dd0769a`](https://github.com/zumerlab/snapdom/commit/dd0769aea7587a0ebaae21977723e9d8e4b8da49)
- html2canvas is not good [`4002631`](https://github.com/zumerlab/snapdom/commit/4002631bcdae4518b2fcce81cf6a6df3e2d0c1e0)
- feat(plugin: prompt-export): default include omits image; +benchmark section [`7adc87f`](https://github.com/zumerlab/snapdom/commit/7adc87f54955379d5891759c050e9fc38610ba00)
- update html-in-canva to new API [`935069a`](https://github.com/zumerlab/snapdom/commit/935069aaa3effbfb08b8d49cb41f554979a218ba)
- Añadir prueba de regresión para el problema #235: corregir el renderizado de `counter(x) ")"` sin espacios adicionales. [`6e209e8`](https://github.com/zumerlab/snapdom/commit/6e209e8ba1c91fddf8ba7225b409f74b366e19e4)
- feat(clone): enhance SVG handling by preventing var() materialization in templates. See #408 [`5d566fa`](https://github.com/zumerlab/snapdom/commit/5d566fa610ee0e718a45b3311fdc46b4067b5c55)
- test(visual): skip suite when demos/ folder is absent [`652693b`](https://github.com/zumerlab/snapdom/commit/652693b3b78c10ce89f741cdb189f601fe2aa687)



#### [v2.9.0](https://github.com/zumerlab/snapdom/compare/v2.8.0...v2.9.0)

> 23 April 2026

- fix(toCanvas): wait for compositing after decode on Safari. Fixes #394 [`#394`](https://github.com/zumerlab/snapdom/issues/394)
- fix(iframe): restore live iframe scroll position after capture. Closes #393 [`#393`](https://github.com/zumerlab/snapdom/issues/393)
- fix(capture): preserve mask-mode and mask-composite through shorthand inlining. [`#402`](https://github.com/zumerlab/snapdom/issues/402)
- fix(capture): phantom whitespace in inline-flex + gap elements. Fixes #406 [`#406`](https://github.com/zumerlab/snapdom/issues/406)
- docs(site): add prompt-export to the plugins page + live demo [`b451415`](https://github.com/zumerlab/snapdom/commit/b4514152d9b03108330e50ef6c4c7eeb62df8c06)
- fix(plugins): enforce local-first priority for plugin-provided exports. See #401 [`ed272f4`](https://github.com/zumerlab/snapdom/commit/ed272f44599b92c70f0b86aa87d3c4d2308d6ab4)
- fix(capture): drop invisible border props from style snapshot. See #390 [`8942fd4`](https://github.com/zumerlab/snapdom/commit/8942fd47a9884addb88b0a3667e4da72bd959455)
- docs(plugins): add prompt-export section to plugins README [`f9743db`](https://github.com/zumerlab/snapdom/commit/f9743db21e4e13830a72303e0bfd54465866e8b1)
- fix(capture): disable WebKit text autosizer inside foreignObject. See #327 [`9c49d6a`](https://github.com/zumerlab/snapdom/commit/9c49d6a592a4c85c1faf07d5922e783893f01b4f)
- fix(images): increase batch size for processing images to 6 to optimize HTTP/1.1 connection limits [`311c9e4`](https://github.com/zumerlab/snapdom/commit/311c9e4ff84f6750c68242ed8dcb5168ba6c6703)
- fix(plugin: prompt-export): flow metadata to the toPrompt() export [`b94b589`](https://github.com/zumerlab/snapdom/commit/b94b5895bf55a97512907b016bba64ea67a8000e)
- Merge pull request #398 from kohaiy/patch-2 [`da438d5`](https://github.com/zumerlab/snapdom/commit/da438d53418568a47e222d2be3f16e596dfb23ce)

#### [v2.8.0](https://github.com/zumerlab/snapdom/compare/v2.7.0...v2.8.0)

> 8 April 2026

- Improve robustness of icon font detection [`#397`](https://github.com/zumerlab/snapdom/pull/397)
- feat(docs): add LLM-friendly documentation links and new reference files [`bc7ece1`](https://github.com/zumerlab/snapdom/commit/bc7ece1e1b864afd3c1eb6c36ff6ed0516106fcb)
- feat(plugins): add prompt-export plugin for LLM-friendly captures [`314c51a`](https://github.com/zumerlab/snapdom/commit/314c51a46464342a9f21508c1a4ce49477277c6f)
- feat: extract pictureResolver into standalone module [`1d3dd70`](https://github.com/zumerlab/snapdom/commit/1d3dd70b060861500a23758d07de95d7ed4a8ed5)
- feat(docs): add official and community plugins sections to README, including installation instructions, usage examples, and detailed descriptions of each plugin's functionality. [`b10235e`](https://github.com/zumerlab/snapdom/commit/b10235e30a67cdeb1cda144ed23edc4771a790bc)
- feat(docs): enhance plugin documentation with event tracking attributes for improved analytics on user interactions [`84d6901`](https://github.com/zumerlab/snapdom/commit/84d6901e606112d369b684d681c15dcde228d651)
- feat(docs): add tracking scripts and enhance plugin documentation with event tracking for better analytics [`20de0f2`](https://github.com/zumerlab/snapdom/commit/20de0f2cdae6de394d4a5d6dd122d386a5fbca7c)
- Ensure font names are escaped before creating dynamic RegExp [`2cd41ec`](https://github.com/zumerlab/snapdom/commit/2cd41ecb77cf2c64bcb8b6591aaa6cc51aa459cb)
- fix(docs): update "Build a Plugin" link to anchor and add section ID for improved navigation in documentation [`3c01910`](https://github.com/zumerlab/snapdom/commit/3c0191063ea48677176cec58b73932461de07b8c)



#### [v2.7.0](https://github.com/zumerlab/snapdom/compare/v2.6.0...v2.7.0)

> 27 March 2026

- feat(docs): enhance documentation with new community plugins section, update index and labs pages, and add shared CSS for consistent styling across SnapDOM documentation. [`d35278c`](https://github.com/zumerlab/snapdom/commit/d35278c1d3d677a80d5ff7f6bca62181baab876d)
- feat(plugins): add multiple new SnapDOM plugins including ascii-export, color-tint, filter, html-in-canvas, pdf-image, picture-resolver, replace-text, timestamp-overlay. Each plugin enhances image processing and manipulation capabilities. Ref #391 [`a4d2331`](https://github.com/zumerlab/snapdom/commit/a4d23319ccb9a884c8533ad8ec686833b6ace0c9)
- feat(docs): add contributing guidelines and plugin specification for SnapDOM plugins, including usage examples, lifecycle hooks, and best practices. [`5243a34`](https://github.com/zumerlab/snapdom/commit/5243a349f3766275b24fd77ab49834d7103ba65a)
- feat(plugin-template): add initial SnapDOM plugin template with example usage and options. See #391 
- feat(workspaces): add workspaces configuration to package.json for better package management [`3032187`](https://github.com/zumerlab/snapdom/commit/30321873eb81386b9180bfe9f97350fe2be90075)


#### [v2.6.0](https://github.com/zumerlab/snapdom/compare/v2.5.0...v2.6.0)

> 23 March 2026

- fix(clone): add support for copying form validation attributes and handle nested foreignObject in deepClone [`f87c896`](https://github.com/zumerlab/snapdom/commit/f87c8961280c6230de3ef2045e4eecca58482ae3)
- fix(clone): video frames (#277), SVG paint props (#365), placeholder color (#315), object-fit (#337), cross-origin iframe warn (NEW-7) [`946ec83`](https://github.com/zumerlab/snapdom/commit/946ec836b7b32c9ac23fc34f8f550d896289db3f)
- fix(clone): sanitize XML-invalid control characters from attribute values [`4218a17`](https://github.com/zumerlab/snapdom/commit/4218a178f98eb1c7cbda6b031048bcccc76ee059)
- fix(transforms): handle matrix3d transforms and extract decomposeScaleShear as shared helper (#216) [`0b5eeab`](https://github.com/zumerlab/snapdom/commit/0b5eeab7585820d571b4d0a06361ede630657cc6)
- fix(prepare): force content-visibility:visible before capture (#281) and fix fixed elements inside scroll wrappers (#364) [`ba2aa6d`](https://github.com/zumerlab/snapdom/commit/ba2aa6de155552766d476f712bd9de11acf68c5d)
- fix(styles): handle detached elements in inlineAllStyles and evict oversized snapshotKeyCache [`02280d2`](https://github.com/zumerlab/snapdom/commit/02280d2545c96785c39f665b564e469334dde960)
- Bumped version [`96da0a5`](https://github.com/zumerlab/snapdom/commit/96da0a5576e21380ca5942f6cb3bcb7a9536581f)
- fix(counter): implement counter-set support to manage top values without new scopes [`f869a46`](https://github.com/zumerlab/snapdom/commit/f869a46d4d2320ab16c0ddf079c93abfcc008479)
- fix(capture): implement caching for clone measurements to optimize performance [`ff455c2`](https://github.com/zumerlab/snapdom/commit/ff455c20272a5f90d41db2e6f7b33f675cbed80d)
- fix(counter): handle negative values in formatCounter and update tests for counter resolution [`b9b965d`](https://github.com/zumerlab/snapdom/commit/b9b965d08c16afae65a95535c052591778893f90)
- fix(fonts): embed all families in font-family fallback chain, not just the primary (#357) [`13ab5c8`](https://github.com/zumerlab/snapdom/commit/13ab5c8629c715b67eb6a5fc0209ecfd0309e110)
- fix(styles): enforce visibility:hidden when content-visibility:hidden to prevent content leakage in snapshots [`4f5f15a`](https://github.com/zumerlab/snapdom/commit/4f5f15a865ea05d4186d5671c5d104593b1aba87)
- fix(outline): enhance parseOutline to account for outline-offset in bleed calculation [`7f45084`](https://github.com/zumerlab/snapdom/commit/7f4508474747d526f8ee432fbdf67846ada2bcbd)
- fix(inlinePseudoElements): enhance style comparison by including additional CSS properties [`df2dd99`](https://github.com/zumerlab/snapdom/commit/df2dd9913bd40a77fec37676d3a59d16ada3126c)
- fix(capture): normalize foreignObject defaults for flex layout (#351) and whitespace (#349) [`55f3962`](https://github.com/zumerlab/snapdom/commit/55f3962845ff29bf2c5011efc897ac382968b52b)
- fix(download): ignore non-image type field to prevent format override (#339) [`3f42049`](https://github.com/zumerlab/snapdom/commit/3f420494e9b7a0380ddac4b8e26538957470c2a7)
- fix(CSSVar): prevent redundant property resolution by tracking visited properties [`e76d700`](https://github.com/zumerlab/snapdom/commit/e76d7002298225a1b0e1b98a2b922e6b4ad9a53f)
- fix(clone.helpers): preserve vertical-align from original input in checkbox/radio replacement (#311) [`ccaf138`](https://github.com/zumerlab/snapdom/commit/ccaf1389fed364c5ccd4128a8e1ed528dbea346b)
- fix(pseudo): increase CSS_RULE_SCAN_BUDGET to 1000 for better performance in large applications [`a09f438`](https://github.com/zumerlab/snapdom/commit/a09f438743a4ee1456c40d7d9f2c1a44d473369f)
- fix(cache): add persistent cache for clone-in-document layout measurements [`c65049b`](https://github.com/zumerlab/snapdom/commit/c65049b457356cdf3725467b73ab1fc2653ce67f)
- fix(toCanvas): omit CSS inset box-shadows in canvas export to prevent incorrect rendering [`ff4a137`](https://github.com/zumerlab/snapdom/commit/ff4a137344282bf4c59ec25bacc2cc694ae98733)
- fix(css): exclude zoom from style snapshot to prevent double-zoom inside foreignObject (#369) [`8f80d2a`](https://github.com/zumerlab/snapdom/commit/8f80d2a9097a147fdf86beb880b75bd45824d966)
- fix(background): preserve all url() layers in background shorthand when inlining images [`fe18140`](https://github.com/zumerlab/snapdom/commit/fe181403bd53a5da077b4ac300ebc2dad357c7e3)


#### [v2.5.0](https://github.com/zumerlab/snapdom/compare/v2.1.0...v2.5.0)

> 17 March 2026

- fix: CSS vars perf, scrollbar styles, SVG image inline, nested line-clamp, iframe pseudos & isolation, Tailwind border (#334 #341 #348 #362 #371 #372 #386) [`#387`](https://github.com/zumerlab/snapdom/pull/387)
- fix: enable image download on iOS via Web Share API [`#384`](https://github.com/zumerlab/snapdom/pull/384)
- feat(scrollbar): implement custom scrollbar style collection for capture, ensuring styles are applied correctly. Closes #334 [`#334`](https://github.com/zumerlab/snapdom/issues/334)
- feat(styles): normalize Tailwind border styles in capture and inlineAllStyles to ensure consistent output. Closes #362 [`#362`](https://github.com/zumerlab/snapdom/issues/362)
- feat(lineClamp): introduce lineClampTree function to apply line-clamp to nested elements, enhancing ellipsis rendering. Closes #386 [`#386`](https://github.com/zumerlab/snapdom/issues/386)
- test(styles): add tests for excluding CSS properties from snapshots, ensuring fidelity with CSS variables. Closes #348 [`#348`](https://github.com/zumerlab/snapdom/issues/348)
- test(capture): add test for iframe CSS isolation to ensure wrapper div does not inherit iframe styles. Closes #372 [`#372`](https://github.com/zumerlab/snapdom/issues/372)
- refactor(capture): replace getComputedStyle with getStyle for improved iframe support and consistency across style retrieval. Closes #371 [`#371`](https://github.com/zumerlab/snapdom/issues/371)
- feat(pseudo): implement suppression of native ::before/::after pseudo-elements in cloned styles to prevent double rendering. Closes #359 [`#359`](https://github.com/zumerlab/snapdom/issues/359)
- fix(capture): update Safari padding logic to avoid edge clipping by applying padding only when necessary based on bounding box transforms. Closes #333 [`#333`](https://github.com/zumerlab/snapdom/issues/333)
- test(fonts): add test for cross-origin CSS support in embedCustomFonts function, verifying correct handling of custom CDN stylesheets. Closes #309 [`#309`](https://github.com/zumerlab/snapdom/issues/309)
- feat(fonts): add fontStylesheetDomains option to support cross-origin CSS fetching, enhancing font loading capabilities. Closes #309, closes #370 [`#309`](https://github.com/zumerlab/snapdom/issues/309) [`#370`](https://github.com/zumerlab/snapdom/issues/370)
- feat(styles): add support for capturing -webkit-text-stroke properties in Safari to enhance style snapshot accuracy. Closes #340 [`#340`](https://github.com/zumerlab/snapdom/issues/340)
- fix(styles): normalize inline styles to ensure !important rules in stylesheets correctly override inline styles in clones. Fixes #328. [`#328`](https://github.com/zumerlab/snapdom/issues/328)
- refactor: improve dimension handling in deepClone and createCheckboxRadioReplacement functions for better accuracy and consistency. Closes #321. See #378 [`#321`](https://github.com/zumerlab/snapdom/issues/321)
- refactor: enhance checkbox/radio replacement for Firefox with SVG implementation for consistent rendering and improved styling. Closes #290 [`#290`](https://github.com/zumerlab/snapdom/issues/290)
- fix(background): resolve relative URLs and fallback to `background` shorthand for url() when background-image is empty. Closes #343 [`#343`](https://github.com/zumerlab/snapdom/issues/343)
- fix: enable image download on iOS via Web Share API [`#383`](https://github.com/zumerlab/snapdom/issues/383)
- feat(tests): add comprehensive test coverage for various modules including exporters, utils, and modules to improve overall code reliability [`06cc896`](https://github.com/zumerlab/snapdom/commit/06cc8962709e5ce651b54b67c63c38fe5ecc498d)
- feat(debug): introduce debug option to log suppressed errors for troubleshooting, enhancing error visibility during capture processes [`f107bbe`](https://github.com/zumerlab/snapdom/commit/f107bbef52521fdd92b77987b44b512313f3b88d)
- fix: Firefox checkbox radio replacement [`b97e553`](https://github.com/zumerlab/snapdom/commit/b97e5539849d08dc871b9a2e486c9505bdfc081e)
- refactor(cache): implement EvictingMap for cache management to limit memory usage and improve performance [`212cd4f`](https://github.com/zumerlab/snapdom/commit/212cd4f0471613b68a47427a1e23f7d076d303de)
- refactor(styles): improve height handling for transparent wrappers to support margin collapsing and enhance layout stability [`c50ccef`](https://github.com/zumerlab/snapdom/commit/c50ccefe931e4809d12c8993dde6aba3f9b46a54)
- fix(styles): prevent overriding border styles when using border-image, and improve getStyle fallback handling [`a5857c5`](https://github.com/zumerlab/snapdom/commit/a5857c5c49febe3d39729f214ca29914928af34a)
- feat(images): add support for inlining SVG &lt;image&gt; elements as data URLs, addressing #341. [`f7d4616`](https://github.com/zumerlab/snapdom/commit/f7d46160913bcf5dad26be0103ef01dc7d29243c)
- feat(safari): implement font and image decode warmup for Safari to address WebKit Bug #219770, enhancing capture reliability [`ad450ce`](https://github.com/zumerlab/snapdom/commit/ad450ce8a10a7094ecbde0ee20db626fabe78423)
- test(getStyle): add tests to ensure getStyle never returns undefined for elements and pseudo-elements [`83c3854`](https://github.com/zumerlab/snapdom/commit/83c3854dc520a0e944a6cf1d23dbc5cdaf8e520a)
- refactor(snapdom): streamline plugin exports by consolidating export functions into a loop for improved maintainability [`ca35387`](https://github.com/zumerlab/snapdom/commit/ca353871b2b696252ddd21572ae31106b39d3c76)
- feat(capture): enhance DOM capture dimensions for root elements by measuring scroll dimensions and using a temporary container for accurate height and width calculations [`31e50f2`](https://github.com/zumerlab/snapdom/commit/31e50f27b3069527cc83f1fe8990c3a8c376e35c)
- fix(css): enhance getWindowForElement and getStyle functions to handle cross-document scenarios and improve fallback logic [`b0fbc8d`](https://github.com/zumerlab/snapdom/commit/b0fbc8d44745811a7c5627e34ef764e02ff188f7)
- refactor(context): remove inline cache policy normalization and import from cache module for improved code organization [`0492756`](https://github.com/zumerlab/snapdom/commit/04927566faf919c7a3df07287f799b152e5d4c8f)
- feat(safari): add `safariWarmupAttempts` option to optimize font and image decoding for improved capture performance [`2474c05`](https://github.com/zumerlab/snapdom/commit/2474c0528051940e503c08ca52861042e57cc880)
- fix(styles): prevent width constraints on inline and specific tags to avoid text wrapping issues [`674ef27`](https://github.com/zumerlab/snapdom/commit/674ef276bcad8e4107c57fee3e976083590a5dd0)
- chore: update contributors list [`b30de75`](https://github.com/zumerlab/snapdom/commit/b30de75ab66cac137334a0ef68ca2bf9133f88c4)
- docs: update README files to replace NPM version badge with weekly downloads badge [`8e12d01`](https://github.com/zumerlab/snapdom/commit/8e12d01fbeb861989eb1d60c534596c55ce9207a)
- chore(.gitignore): add 'demos/' directory to .gitignore to exclude demo files from version control [`fa34905`](https://github.com/zumerlab/snapdom/commit/fa34905450d889e48b9b943c941f29386627acc5)
- refactor(prepare): simplify deepClone call by removing redundant element argument for cleaner code [`399bfaf`](https://github.com/zumerlab/snapdom/commit/399bfaf127bb4416200068334dc069a5bfcef2ab)
- fix(styles): adjust inline style for timestamp demo to prevent text wrapping [`b88e8d7`](https://github.com/zumerlab/snapdom/commit/b88e8d74f67fe67e3ac610972c53ff49752f6b74)
- fix(snapdom): remove redundant safariWarmup reset to improve iteration logic [`72d3fb7`](https://github.com/zumerlab/snapdom/commit/72d3fb72968d136f1c71d234d57272ce0f3fb6e1)
- Merge PR #384: enable image download on iOS via Web Share API [`05bc67c`](https://github.com/zumerlab/snapdom/commit/05bc67c76dbe6cc02946773de8413d48e314b3d9)
- Merge main into dev (2.1.0) [`5f5ab34`](https://github.com/zumerlab/snapdom/commit/5f5ab345194832225e311421d177963ce3c4c59e)

#### [v2.1.0](https://github.com/zumerlab/snapdom/compare/v2.0.2...v2.1.0)

> 10 March 2026

- fix(background): inline background-image inside shadow DOM hosts [`#379`](https://github.com/zumerlab/snapdom/pull/379)
- Update URL handling to use location.origin in fonts.js [`#380`](https://github.com/zumerlab/snapdom/pull/380)
- fix: use nodeMap for source-clone alignment in inlinePseudoElements [`#381`](https://github.com/zumerlab/snapdom/pull/381)
- fix(background): properly inline background-image inside shadow DOM hosts [`#318`](https://github.com/zumerlab/snapdom/issues/318)
- update demo site [`4de1850`](https://github.com/zumerlab/snapdom/commit/4de1850d84d1698e8574fe405007fb47d6a677ea)
- feat: classify open issues by importance with priority labels and triage workflows [`246a4c4`](https://github.com/zumerlab/snapdom/commit/246a4c43eef13fe8b654e297f52a639a7ad670b1)
- fix: Enhanced font embedding functionality for dynamically injected stylesheets [`3d4985a`](https://github.com/zumerlab/snapdom/commit/3d4985a6d40963c30ff188207a62ac1e287709ba)
- fix: resolve CSS transform double-scale bug (issue #321) [`d41504b`](https://github.com/zumerlab/snapdom/commit/d41504b8dcf94454a331337c49d74928d533f49a)
- fix: improve demo capture functionality with Safari support and locking mechanism [`2cb3856`](https://github.com/zumerlab/snapdom/commit/2cb3856e55f0f1d8e0d2ac050d549705203fc6ae)
- refactor: update build configuration for legacy and ESM outputs, removing module structure and adding subpath exports [`94f6289`](https://github.com/zumerlab/snapdom/commit/94f62897054f37923c5cd3e4e2d3a57a0fde8db4)
- docs: update README to reflect changes in SnapDOM ESM build structure and usage instructions [`8e5a710`](https://github.com/zumerlab/snapdom/commit/8e5a7103b45ae2d326a93218c977a371407d8cec)
- fix: only change to location.origin when treating inline styles in font.js [`94c91c6`](https://github.com/zumerlab/snapdom/commit/94c91c61d57b79a083c75d27aa3025beb1dcb535)
- fix: validate fallback image data before setting source [`2c754fe`](https://github.com/zumerlab/snapdom/commit/2c754fec37e3ce18c512ff3ee61e386fcf780589)
- fix: ensure image is only appended if data URL is valid [`46957c5`](https://github.com/zumerlab/snapdom/commit/46957c51c49d766db5ad60357f5664a7cf500049)
- fix: ensure valid CSS text is fetched for font links [`201209f`](https://github.com/zumerlab/snapdom/commit/201209faad857dd21a01ebc2ae5dc740a33819ce)
- Merge pull request #301 from Amyuan23/fix/svg-root-font-size [`5bd53ba`](https://github.com/zumerlab/snapdom/commit/5bd53ba4887dba4664589b51651747809a89f8ab)
- Merge pull request #350 from ZiuChen/fix/remote-katex-font [`3cbbd57`](https://github.com/zumerlab/snapdom/commit/3cbbd577eae0c751fbac41cd3b3ff0aeb251ca0e)
- Merge pull request #378 from FlavioLimaMindera/fix-scale-image-issue-321 [`e53f2f8`](https://github.com/zumerlab/snapdom/commit/e53f2f8c4a83617a14c168c0c2615bde283d4696)
- Fix: Inherit root font-size in SVG output [`3bdf300`](https://github.com/zumerlab/snapdom/commit/3bdf300ce417d56b928ea3c1b7258103a35f2445)
- Merge pull request #374 from kohaiy/patch-1 [`0b21142`](https://github.com/zumerlab/snapdom/commit/0b21142b87d1874aaaa88bc7fc9630eb506ab958)

#### [v2.0.2](https://github.com/zumerlab/snapdom/compare/v2.0.1...v2.0.2)

> 20 January 2026

- Fix bug when captured element is SVG. Closes #324 [`#324`](https://github.com/zumerlab/snapdom/issues/324)
- Improve docs for blob [`#352`](https://github.com/zumerlab/snapdom/issues/352)

#### [v2.0.1](https://github.com/zumerlab/snapdom/compare/v2.0.0...v2.0.1)

> 26 November 2025

- Fix spaces. Closes #326 [`#326`](https://github.com/zumerlab/snapdom/issues/326)
- Fix download options. Closes #323 [`#323`](https://github.com/zumerlab/snapdom/issues/323)
- Fix Safari Image Issue. See #330 [`ba80b6f`](https://github.com/zumerlab/snapdom/commit/ba80b6f66393886298cdb2fc7ce134d1824184f7)
- Minify mjs version [`9155d4f`](https://github.com/zumerlab/snapdom/commit/9155d4fa2e2fc4bb6a0e3d7a991fc75818644084)
- Add a re-export for preCache. See #332 [`acc5b79`](https://github.com/zumerlab/snapdom/commit/acc5b79a0c8d38de9f6dea5b98bf1179b54ef671)


### [v2.0.0](https://github.com/zumerlab/snapdom/compare/v2.0.0-dev.4...v2.0.0)

> 18 November 2025

- V2 release!! [`#319`](https://github.com/zumerlab/snapdom/pull/319)


#### [v2.0.0-dev.4](https://github.com/zumerlab/snapdom/compare/v2.0.0-dev.3...v2.0.0-dev.4)

> 18 November 2025

- Feature enable tree-shakeable code [`ebb7b6a`](https://github.com/zumerlab/snapdom/commit/ebb7b6add3b47c75a450e0264d628837303def5d)
- Fix bug when img has height with % units. Closes #268 [`#268`](https://github.com/zumerlab/snapdom/issues/268)
- Fix regression to process MathJax [`7ef116c`](https://github.com/zumerlab/snapdom/commit/7ef116cdbbfcba0793cd918b2ba8ad94e063f74f)
- Fix bug See #316 [`7efbede`](https://github.com/zumerlab/snapdom/commit/7efbede5970ed09982c06f8cfa3fe45d990d8fdf)

#### [v2.0.0-dev.3](https://github.com/zumerlab/snapdom/compare/v2.0.0-dev.2...v2.0.0-dev.3)

> 11 November 2025

- Reorganice helper functions [`d1fd982`](https://github.com/zumerlab/snapdom/commit/d1fd98240459f07897311a42e09c1ad3e3a48c62)
- Perf improvement [`daf0eca`](https://github.com/zumerlab/snapdom/commit/daf0eca47c0d11828e1a702b6d64d8ab7450581d)
- Fix placeholder dimensions when image loading fails [`e44b9d9`](https://github.com/zumerlab/snapdom/commit/e44b9d947efaf28fec8976dc13b398788d461d52)


#### [v2.0.0-dev.2](https://github.com/zumerlab/snapdom/compare/v2.0.0-dev.1...v2.0.0-dev.2)

> 9 November 2025

- Integrate createBackground into toCanvas. Closes #297 [`#297`](https://github.com/zumerlab/snapdom/issues/297)
- Add Chinese translation of README.md (readme_cn.md) [`#298`](https://github.com/zumerlab/snapdom/issues/298)
- Adjust final dimensions when excludeMode: remove. See #294 [`a860827`](https://github.com/zumerlab/snapdom/commit/a8608271ffd9b891ec815fa7e3130c0e1be45307)
- Improve material icon / symbols. See #304 [`526c4c8`](https://github.com/zumerlab/snapdom/commit/526c4c8e6874b2dab6110c8ac3361a29b1dc91de)
- Add XHTML sanitize. See #282 [`0039301`](https://github.com/zumerlab/snapdom/commit/003930196ed6e11c5dd54fce75d814046a36637d)
- Add detection to Baidu on iOS. Also detect other apps/browsers on iOS. See #295 [`97e6dff`](https://github.com/zumerlab/snapdom/commit/97e6dffa34440d157b0b2b1afc5267d7b15c1d7b)
- add support for text-underline-offset. See #303 [`fb603bc`](https://github.com/zumerlab/snapdom/commit/fb603bca971a10577215c436b73ba5468a4255ae)
- add support for text-underline-offset. See#303 [`0b93c0d`](https://github.com/zumerlab/snapdom/commit/0b93c0de7a720a7c6708a50a153de86ba6f2684e)
- fix: improve CSS src property parsing in font faces [`dbe52a1`](https://github.com/zumerlab/snapdom/commit/dbe52a121a7d68441570c02ae32c607907e188dc)


#### [v2.0.0-dev.1](https://github.com/zumerlab/snapdom/compare/v2.0.0-dev.0...v2.0.0-dev.1)

> 23 October 2025

- Add basic support for icons with ligature such as material-icons. Closes #275 [`#275`](https://github.com/zumerlab/snapdom/issues/275)
- Replace straighten with outerTransforms, and noShadows with outerShadows [`902f032`](https://github.com/zumerlab/snapdom/commit/902f032a43ed4919701765d89818c7782902b403)
- Fix straighten regression [`60c6569`](https://github.com/zumerlab/snapdom/commit/60c6569ebcfbc9ea562c9bddfe9f01c6ea4136db)


#### [v2.0.0-dev.0](https://github.com/zumerlab/snapdom/compare/v1.9.14...v2.0.0-dev.0)

> 14 October 2025

- Document plugin system [`d87ac01`](https://github.com/zumerlab/snapdom/commit/d87ac01fcf0beb8779afbe2be709aa1b35cf7113)
- First plugin and exporter draft [`5da0948`](https://github.com/zumerlab/snapdom/commit/5da09483b82e18ca0fc6873393b9d6830632fcfc)
- Fix subpixel bug. See #261 [`465950b`](https://github.com/zumerlab/snapdom/commit/465950b18e68ce0faf94b229bd65511128cd18a7)
- Update demos with plugins [`50e6c4f`](https://github.com/zumerlab/snapdom/commit/50e6c4f85d74bb769fcd7f753f92a3c5be4536c6)
- Update plugin system [`4e21b47`](https://github.com/zumerlab/snapdom/commit/4e21b475fdc42c6eade9cb4dada5bb5ffeb71978)
- Enhance external SVG defs. See #262 [`cd4a7fb`](https://github.com/zumerlab/snapdom/commit/cd4a7fbf0e2d9fc1651c06d5c5f5a3a8f0f54329)
- First plugin system draft [`9c6b91b`](https://github.com/zumerlab/snapdom/commit/9c6b91bc4352de3d323c0746a4e3040058dad519)
- Fix complex canvas render on Safari. See #263 [`2697207`](https://github.com/zumerlab/snapdom/commit/2697207c98373867bcbb91d4afb73d3820c878d3)
- Enhance CSS vars detection. See #262 [`6655303`](https://github.com/zumerlab/snapdom/commit/665530377bceff05ff9c1570301019bd95370a9c)
- Fix counter CSS reset and bug when exist background-image. See #265 [`3c29997`](https://github.com/zumerlab/snapdom/commit/3c299978e2a4cd4c2daf07d64de5772b28e880b8)
- FIx excludeFonts defs. See #260 [`84b1770`](https://github.com/zumerlab/snapdom/commit/84b1770dd2e6e487e22afcd04c2d34cd0490528c)
- Fix local register [`9c4508e`](https://github.com/zumerlab/snapdom/commit/9c4508e0cdeb445b76babd71483fe154e0e2ee3e)
- Enable use built-in exporters in custom exporter [`5c6fe36`](https://github.com/zumerlab/snapdom/commit/5c6fe367101d8dfec710372d2b0a7362da3597a3)
- Fix background-repeat. See #259 [`0ad5fa4`](https://github.com/zumerlab/snapdom/commit/0ad5fa4ee56e417016ce495ea299cf4a3c586f6a)
- Fix export name format jpg -&gt; jpeg [`47d532a`](https://github.com/zumerlab/snapdom/commit/47d532a98be096829b592295527c1a6428d6a5d8)
- Update roadmap [`dff59b9`](https://github.com/zumerlab/snapdom/commit/dff59b9ea62fed09a9146fd1e9d897dace30a37b)
- Fix local plugin registration [`0997618`](https://github.com/zumerlab/snapdom/commit/0997618fb2e716ead23bfbe4824bb8365987ccd4)


#### [v1.9.14](https://github.com/zumerlab/snapdom/compare/v1.9.13...v1.9.14)

> 5 October 2025

- Recompile builds [`fca9e00`](https://github.com/zumerlab/snapdom/commit/fca9e00d49bb675d6b6103ba2de3f898c85c5578)


#### [v1.9.13](https://github.com/zumerlab/snapdom/compare/v1.9.12-dev.4...v1.9.13)

> 5 October 2025

- Improve CSS vars detection. Closes #255 [`#255`](https://github.com/zumerlab/snapdom/issues/255)
- Fix toImg() dimensions when scale==1. Closes #254 [`#254`](https://github.com/zumerlab/snapdom/issues/254)
- Enhance web fonts detection on deph relative paths. See #253 [`e2a8c45`](https://github.com/zumerlab/snapdom/commit/e2a8c454fbab7590f39f77da544193f8e5af13ab)
- Add two new options to control transforms and shadows on root element [`8c9a75f`](https://github.com/zumerlab/snapdom/commit/8c9a75f77940221107a6005e458514cca981b2eb)
- Add toSvg() in replacement of toImg() [`10e2043`](https://github.com/zumerlab/snapdom/commit/10e2043182672b42dfbda4268fb17f75bc3b561a), [`122317e`](https://github.com/zumerlab/snapdom/commit/122317eb0301f8375cc23ea8f3fd2361d1b759a4)
- Improve relative path detection. See #253 [`34158e0`](https://github.com/zumerlab/snapdom/commit/34158e0f5cf8f797cd49416f090d06d2d233542d)
- Lint code [`c754981`](https://github.com/zumerlab/snapdom/commit/c7549812a018d28809e0e2b314c973abe0cd542c)
- Lint tests [`ee974ed`](https://github.com/zumerlab/snapdom/commit/ee974ede694f324f674b688aa7cce16f7ec30a90)


#### [v1.9.12-dev.4](https://github.com/zumerlab/snapdom/compare/v1.9.12-dev.3...v1.9.12-dev.4)

> 30 September 2025

- Add basic support to sticky elements. See #232 [`02893e6`](https://github.com/zumerlab/snapdom/commit/02893e60e7f3244c1274d64232e7dbf338a283ec)
- Update types [`19317e6`](https://github.com/zumerlab/snapdom/commit/19317e6ff34599028e627f891ae5a2d28036bac1)
- fix formating [`58ca761`](https://github.com/zumerlab/snapdom/commit/58ca7616e3e82ec81122804264466f33d79c45c2)
- Enhance browser detection. See #251 [`cfe753c`](https://github.com/zumerlab/snapdom/commit/cfe753c280ab0c0cda8aca88978a550257caf23f)
- Fix pseudo capture. See #252 [`e85678e`](https://github.com/zumerlab/snapdom/commit/e85678e54fac6736c3dac8a0eaac8f1607dcbb6a)
- Merge pull request #249 from K1ender/dev [`e497bba`](https://github.com/zumerlab/snapdom/commit/e497bbae30e2c539c53715f9dd0bed585d10cf9a)



#### [v1.9.12-dev.3](https://github.com/zumerlab/snapdom/compare/v1.9.12-dev.2...v1.9.12-dev.3)

> 26 September 2025

- Captures CSS shadows [`050365f`](https://github.com/zumerlab/snapdom/commit/050365f8ab2087a912c71c468b4b1c234b21dd6a)
- Improve counter simulation [`4c9e21d`](https://github.com/zumerlab/snapdom/commit/4c9e21d6bc0135614b882e1940ce31b64c5e40b2)
- Fix scale, width, height options [`8ef48cb`](https://github.com/zumerlab/snapdom/commit/8ef48cb2e038c286eea9b7ce2baafac30c062a5e)
- Just run safariWarmup if it is needed [`a32846d`](https://github.com/zumerlab/snapdom/commit/a32846d6f48ab8c583b1f26c41d19f3cff67ab55)
- Safari, in case of scale, width or height options use png to ensure fidelity [`0711a77`](https://github.com/zumerlab/snapdom/commit/0711a7774f6f545cd05e0cce86f3354fe377b02d)
- Sanitize container [`a6ba396`](https://github.com/zumerlab/snapdom/commit/a6ba396c52406bf9c5dd0ffd27f9460cd34b028e)


#### [v1.9.12-dev.2](https://github.com/zumerlab/snapdom/compare/v1.9.12-dev.1...v1.9.12-dev.2)

> 22 September 2025

- Fix margin collapsing in some cases. See #243 [`7fe0a3f`](https://github.com/zumerlab/snapdom/commit/7fe0a3ffe6e9827b276f0c0337c60c8c02c4129c)



#### [v1.9.12-dev.1](https://github.com/zumerlab/snapdom/compare/v1.9.12-dev.0...v1.9.12-dev.1)

> 20 September 2025

- Modularize counters [`024a7f9`](https://github.com/zumerlab/snapdom/commit/024a7f9b2d1b4805c7b12b5cbb62f0200295cc8f)
- Improve CSS counter() and counters() handling. See #120, see #235 [`8fb0385`](https://github.com/zumerlab/snapdom/commit/8fb03859301075ea9b096197ec5b4dbca4223a95)
- Feat lineClamp. See #241 [`4082cd6`](https://github.com/zumerlab/snapdom/commit/4082cd6c39ff43bcb842a81768e11b858c5e8559)
- Fix width/height options [`7cd2111`](https://github.com/zumerlab/snapdom/commit/7cd21114d1337e48b5d743cb94989feb1a1a0d20)
- Fix bug that hangs snapDOM on some browsers. See #236 [`bc3c400`](https://github.com/zumerlab/snapdom/commit/bc3c400356a6f32f8d1d8a986c9a427e6dd13c7f)
- Fix bug that overrides options.width/heigth. See #241 [`49fbb63`](https://github.com/zumerlab/snapdom/commit/49fbb63ac6c28a66a8e6d9076618bee7b6beab62)
- Improve webFonts render. See #229 [`3082a3a`](https://github.com/zumerlab/snapdom/commit/3082a3ae019f424e127f3c065cbcfa7bad59bb39)
- Feat. detect wechat browser. See #223 [`e7c4723`](https://github.com/zumerlab/snapdom/commit/e7c4723a24ad3a9c52da5a2e021c115b354bcf66)
- Ensure donwload file measure. See #241 [`eed1995`](https://github.com/zumerlab/snapdom/commit/eed1995a56664c0ace5d94422ba6bb8b5ef82324)
- Add iframe support [`ec59e4b`](https://github.com/zumerlab/snapdom/commit/ec59e4bad3dbb639cde37aed929dccb42b54e6b5)

#### [v1.9.12-dev.0](https://github.com/zumerlab/snapdom/compare/v1.9.11...v1.9.12-dev.0)

> 11 September 2025

- Try fix fallback images [`67bedd3`](https://github.com/zumerlab/snapdom/commit/67bedd3c7cb6bda3e2291fe494805a58263e6dce)
- Two separate mode: filterMode and excludeMode [`394e7f4`](https://github.com/zumerlab/snapdom/commit/394e7f4ca2171fb1028eb382b2331d4718f6a350)
- Workaround Safari See #231 [`593ad59`](https://github.com/zumerlab/snapdom/commit/593ad59383d0b3adbcb139f6892ae321a08c60d5)
- Try new approach for solve Safari fonts/images decoding [`5b77738`](https://github.com/zumerlab/snapdom/commit/5b7773847f02809826a9ed459321100cfbd50518)


#### [v1.9.11](https://github.com/zumerlab/snapdom/compare/v1.9.10...v1.9.11)

> 9 September 2025

- Fix Safari bug that prevents capture [`6a43e59`](https://github.com/zumerlab/snapdom/commit/6a43e59d1c311452c7d16e1adc9bb12bb89132b4)


#### [v1.9.10](https://github.com/zumerlab/snapdom/compare/v1.9.10-dev.2...v1.9.10)

> 9 September 2025

- Merge dev branch  [`#225`](https://github.com/zumerlab/snapdom/pull/225)
- Strip dev comments [`e02066b`](https://github.com/zumerlab/snapdom/commit/e02066b6ef8e6c2b1d50b86096500f914ac025af)
- increase test coverage [`0c59fa0`](https://github.com/zumerlab/snapdom/commit/0c59fa0d276b7899cf2b721d32e7934e701df76b)
- Update types defs [`648f4a9`](https://github.com/zumerlab/snapdom/commit/648f4a965106c58c6f63d384bf8db600a661146c)
- Improves mask handling [`f3915ea`](https://github.com/zumerlab/snapdom/commit/f3915ea919b927b5f2ff0a9f3c865beb7b08b231)
- fix backgroundColor regression [`21a6a39`](https://github.com/zumerlab/snapdom/commit/21a6a3923d81d2f733d6bc61136a9d4eda8f1a62)


#### [v1.9.10-dev.2](https://github.com/zumerlab/snapdom/compare/v1.9.10-dev.1...v1.9.10-dev.2)

> 8 September 2025

- Fix cache disabled bug. Closes #221 [`#221`](https://github.com/zumerlab/snapdom/issues/221)
- Add extra margin when element has transform [`6688eee`](https://github.com/zumerlab/snapdom/commit/6688eee661de2d91249f9db28948629f421b14b4)
- Feat. handkles css trasnforms and scale rotate new props. Ref #216 [`d151da1`](https://github.com/zumerlab/snapdom/commit/d151da1993f1374d2bae16ed1a076a05f9ff8d45)
- Add same-origin iframe support .See #222 [`f50720f`](https://github.com/zumerlab/snapdom/commit/f50720fe76d8d114c1de31ffe802ade1edd7060e)
- Fix regression that doesnt reset origial translate [`800c427`](https://github.com/zumerlab/snapdom/commit/800c427d327f41fbcc9703dfa5a3e99b9b7c789f)
- Fix duplicated values on textArea [`0915f8d`](https://github.com/zumerlab/snapdom/commit/0915f8d4f1b9e58800407ba28ad86e16b6cc4621)
- 增强图像处理功能，添加图像加载失败时的后备图像源支持，并记录原始图像尺寸以便于使用。更新类型定义以包含新选项。 [`011620a`](https://github.com/zumerlab/snapdom/commit/011620a3c8dbabed9c2e509766c4516205fbad66)
- ✨ feat: [`e3a4556`](https://github.com/zumerlab/snapdom/commit/e3a4556a4085c0968bcce9f54d7d0fb9bbcfc6a7)
- remove iframe limitation [`77abf8f`](https://github.com/zumerlab/snapdom/commit/77abf8f617fd1942565ee141406757c3704f45ae)
- Merge pull request #220 from Jarvis2018/main [`adb6455`](https://github.com/zumerlab/snapdom/commit/adb6455fd6ff9db128dda5a59ac7556a16c851fa)
- Merge pull request #215 from xiaobai-web715/dev [`37be327`](https://github.com/zumerlab/snapdom/commit/37be327f7c55ae20ee65001a8469f59284dbe12f)


#### [v1.9.10-dev.1](https://github.com/zumerlab/snapdom/compare/v1.9.10-dev.0...v1.9.10-dev.1)

> 3 September 2025

- Fix flickering on Safari. Closes #197 [`#197`](https://github.com/zumerlab/snapdom/issues/197)
- Prevents default svg values overwrite custom ones. Closes #217 [`#217`](https://github.com/zumerlab/snapdom/issues/217)
- Feature: add placeholders option to disable rendered placeholder for iframes and fallback images. Closes #137 [`#137`](https://github.com/zumerlab/snapdom/issues/137)
- FIx textarea styles. Closes #212 [`#212`](https://github.com/zumerlab/snapdom/issues/212)


#### [v1.9.10-dev.0](https://github.com/zumerlab/snapdom/compare/v1.9.9...v1.9.10-dev.0)

> 29 August 2025

- Code refactor, cache improve, options centralized [`3bd7182`](https://github.com/zumerlab/snapdom/commit/3bd71822cf72614b3bb5993039482fdb05833ceb)
- Improve performance and cache [`8882025`](https://github.com/zumerlab/snapdom/commit/88820259d4000fd36dbf4f59bb4940a6e12e6611)
- Enhance font handling [`cb1e04a`](https://github.com/zumerlab/snapdom/commit/cb1e04af0551f097b44eeb84ba64a97e869b6f60)
- Improve capture fidelity [`e05f027`](https://github.com/zumerlab/snapdom/commit/e05f027b8eb3b5b90e22a9d8ce7a7279f7b1614b)
- fix font fetching [`70dd092`](https://github.com/zumerlab/snapdom/commit/70dd092adb14899031f0596d83ec354c9ab023b9)
- Set compress as default [`7e5ab00`](https://github.com/zumerlab/snapdom/commit/7e5ab007f653f995b09ecbbf7711d69937fdef4a)
- optimice code [`df52437`](https://github.com/zumerlab/snapdom/commit/df524379288fcb08dd19b8957d627a24b898685e)
- Core update: increase X3 speed capture compared 1.9.9 [`94bc57d`](https://github.com/zumerlab/snapdom/commit/94bc57dc53cb63d82532467b4a041ab26da7481a)
- Ensure custom fonts are capured [`8125689`](https://github.com/zumerlab/snapdom/commit/81256893249b2313edfebacb9d68ec6ed4fa9ed2)
- Fix first custom font bug on Safari [`971d976`](https://github.com/zumerlab/snapdom/commit/971d9762dd73263689057e16fb47c00d2e0eba1b)
- Fix bug that affects overall capture fidelity [`35539a5`](https://github.com/zumerlab/snapdom/commit/35539a50da67c30e28c39272a4c1efefbf24a2e2)
- update to avoid vitest issues [`51ef80d`](https://github.com/zumerlab/snapdom/commit/51ef80d24b693ceee3e33d75e2b64ba7037e49ea)


#### [v1.9.9](https://github.com/zumerlab/snapdom/compare/v1.9.8...v1.9.9)

> 14 August 2025

- Improves external fonts handling. Closes #139, closes #146, closes #186 [`#139`](https://github.com/zumerlab/snapdom/issues/139) [`#146`](https://github.com/zumerlab/snapdom/issues/146) [`#186`](https://github.com/zumerlab/snapdom/issues/186)
- Handles srcset. Closes #190 [`#190`](https://github.com/zumerlab/snapdom/issues/190)
- Fix speed regression. [`542ed00`](https://github.com/zumerlab/snapdom/commit/542ed003e3f35c19bd51fd5317f5572c12ba1ac8)
- Handles Blob scr [`fe27239`](https://github.com/zumerlab/snapdom/commit/fe27239ac3efef9a0e9e7f0feeb223dd74fd9086). Closes [`#169`](https://github.com/zumerlab/snapdom/issues/169) 


#### [v1.9.8](https://github.com/zumerlab/snapdom/compare/v1.9.7...v1.9.8)

> 10 August 2025

- fix(types): update `preCache` [`#166`](https://github.com/zumerlab/snapdom/pull/166)
- Fix defs & symbols outside captured element and hidden visibility, closes #178. Stabilize layout before cloning, closes  #179. Fix inline styles, closes #177 [`#178`](https://github.com/zumerlab/snapdom/issues/178) [`#177`](https://github.com/zumerlab/snapdom/issues/177)  [`#179`](https://github.com/zumerlab/snapdom/issues/179)
- Fix icontFont alignment and rendered size. Closes #176 [`#176`](https://github.com/zumerlab/snapdom/issues/176)
- Ensure skip empty pseudo elements. Closes #168 [`#168`](https://github.com/zumerlab/snapdom/issues/168)
- Add basic border-image support. Closes #159 [`#159`](https://github.com/zumerlab/snapdom/issues/159)
- Fix input css styles. Closes #144, closes #147 [`#144`](https://github.com/zumerlab/snapdom/issues/144) [`#147`](https://github.com/zumerlab/snapdom/issues/147)


#### [v1.9.7](https://github.com/zumerlab/snapdom/compare/v1.9.6...v1.9.7)

> 27 July 2025

- Fix input css styles. Closes #144, closes #147 [`#144`](https://github.com/zumerlab/snapdom/issues/144) [`#147`](https://github.com/zumerlab/snapdom/issues/147)
- Fix Safari scale. Closes #133 [`#133`](https://github.com/zumerlab/snapdom/issues/133)
- Fix @font-face. Closes #145 [`#145`](https://github.com/zumerlab/snapdom/issues/145)
- Fix edge case that generates blank images on Safari. Closes #129 [`#129`](https://github.com/zumerlab/snapdom/issues/129)
- Improve pseudo elements detection. Closes # 143 [`539e488`](https://github.com/zumerlab/snapdom/commit/539e488c018a1bf7be05e0d9d969e350c9ed4291)
- Remove default backgroundColor on download(). Ref dissussion #142 [`a875fe3`](https://github.com/zumerlab/snapdom/commit/a875fe31c1c1fc9a1d0d59ef2934b5930a6b7c88)
- Update docs, thanks @kohaiy[`e38d67b`](https://github.com/zumerlab/snapdom/commit/e38d67b0102edf75a9f6e742bd45eacc43be51c1)

#### [v1.9.6](https://github.com/zumerlab/snapdom/compare/v1.9.5...v1.9.6)

> 20 July 2025

- Add options argument to toBlob function. Thanks @rbbydotdev [`#118`](https://github.com/zumerlab/snapdom/pull/118)
- Keep canvas CSS style. Fixes #121. [`#121`](https://github.com/zumerlab/snapdom/issues/121)
- Improve: handles local() source font. See #114 [`c088aa0`](https://github.com/zumerlab/snapdom/commit/c088aa01422bf6ea6c1be70a88d09d540eae5038)
- Improve webcomponent clone [`a0f37a5`](https://github.com/zumerlab/snapdom/commit/a0f37a57079057548e97a973bc6c734b4141769d)
- Perf: unifies cache [`fe3a368`](https://github.com/zumerlab/snapdom/commit/fe3a3680ddef2736fc0176dcbc210fc760149038)
- Improve cache handling. [`183ae2f`](https://github.com/zumerlab/snapdom/commit/183ae2f90debfb472164df01616f2558136a9f8f)
- Adjust cache reset [`ff33ed3`](https://github.com/zumerlab/snapdom/commit/ff33ed374dcc02272225ca0154a84c304e6fc19a)
- Improve regex [`1b4d5ad`](https://github.com/zumerlab/snapdom/commit/1b4d5ada356bce55caecd008df746f891d379c48)
- Add primitive support to css counter. See #120 [`160bc2e`](https://github.com/zumerlab/snapdom/commit/160bc2eaf984051e23031664040ea91166bca061)
- Fix bug background-color on export formats. See #90 [`47a34a9`](https://github.com/zumerlab/snapdom/commit/47a34a971cc875ec4d9eab772266df81a94438e7)
- Fix regression textArea duplication [`1759fd0`](https://github.com/zumerlab/snapdom/commit/1759fd0ae1681e17df946d507ae4d704efff1b18)
- Prevent process local ids. See #128 [`659e862`](https://github.com/zumerlab/snapdom/commit/659e8627bb6545f7843de1bcf808dc6bfb4dff3e)
- Add node version and improve docs. See #123. Thanks @miusuncle [`e457bf6`](https://github.com/zumerlab/snapdom/commit/e457bf64ca2b4294aaf237c165f865ea50cc0c14)


#### [v1.9.5](https://github.com/zumerlab/snapdom/compare/v1.9.3...v1.9.5)

> 14 July 2025

 Fix: add type def for `SnapOptions`. Thanks @simon1uo  [`#111`](https://github.com/zumerlab/snapdom/pull/111)
- Add `checkbox.indeterminate`. Thanks @titoBouzout [`#104`](https://github.com/zumerlab/snapdom/pull/104)
- Add mask-image CSS detection (closes #106) [`#106`](https://github.com/zumerlab/snapdom/issues/106)
- Add slot detection (closes # 97) / Fix textarea content duplication (closes #110) [`#110`](https://github.com/zumerlab/snapdom/issues/110)
- Add html-to-image to benchmark. Closes #103 [`#103`](https://github.com/zumerlab/snapdom/issues/103)

#### [v1.8.0](https://github.com/zumerlab/snapdom/compare/v1.7.1...v1.8.0)

> 30 June 2025

- fix: encode same uri multiple times [`#65`](https://github.com/zumerlab/snapdom/pull/65)
- Add Lucide to icon font detection [`#50`](https://github.com/zumerlab/snapdom/pull/50)
- Avoid background-image logic duplication, closes #66 [`#66`](https://github.com/zumerlab/snapdom/issues/66)
- Feat: sanitize rootElement to avoid CSS layout conflicts. Fixes #56, fixes #24 [`#56`](https://github.com/zumerlab/snapdom/issues/56) [`#24`](https://github.com/zumerlab/snapdom/issues/24)
- Fix: canvas style props, closes #63 [`#63`](https://github.com/zumerlab/snapdom/issues/63)
- Feat: handling @import and optimice cache, closes #61 [`#61`](https://github.com/zumerlab/snapdom/issues/61)
- Compile .js to es2015, closes #58 [`#58`](https://github.com/zumerlab/snapdom/issues/58)
- Fix background image handling, closes #57 [`#57`](https://github.com/zumerlab/snapdom/issues/57)
- Improve inlinePseudoElements() to handle decorative properties, closes #55 [`#55`](https://github.com/zumerlab/snapdom/issues/55)
- Add ::first-letter detection, closes #52 [`#52`](https://github.com/zumerlab/snapdom/issues/52)
- test: increases coverage [`7ebc871`](https://github.com/zumerlab/snapdom/commit/7ebc87143101a9e5c8573f5ae76ede2884b59eb8)
- Increase test coverage [`0c63478`](https://github.com/zumerlab/snapdom/commit/0c634785157ca9f611973976000b2f25ba7c9549)
- Improve split multiple backgrounds [`0e67a9b`](https://github.com/zumerlab/snapdom/commit/0e67a9b72fb1ea7ea4a625d5f6dc2eb40438d7cd)
- chore: update contributors list [`da22404`](https://github.com/zumerlab/snapdom/commit/da2240490b46ff4a0747f7db741b822dbc6ba3c4)
- chore: update contributors list [`ec7c275`](https://github.com/zumerlab/snapdom/commit/ec7c27590318df95e7aa903ec7cbd92112b6c2e8)
- Add check [`bf9a888`](https://github.com/zumerlab/snapdom/commit/bf9a888525e99dd663c17455755bb1478f1cb9d7)
- Create update-contributors.js [`453dff0`](https://github.com/zumerlab/snapdom/commit/453dff07d0fd8f333627ed22a6e8a64373dbd62d)
- Document width and  height options [`0f7fb7a`](https://github.com/zumerlab/snapdom/commit/0f7fb7a02d9159a831a1dfc4cfbd9f6f3420bca7)
- Create update-contributors.yml [`b48e334`](https://github.com/zumerlab/snapdom/commit/b48e334043e2a18212620df413b8742d72959468)
- Update [`7da2892`](https://github.com/zumerlab/snapdom/commit/7da2892e69d04903111bbd24421a574e0034a83b)
- Bumped version [`f322f51`](https://github.com/zumerlab/snapdom/commit/f322f51e2369bfdbbc1218c15e8375b0858bf73d)
- Update README.md [`99c51a8`](https://github.com/zumerlab/snapdom/commit/99c51a89e2b486bbfc2810d94350428cbc9595f2)
- Update update-contributors.js [`46a868b`](https://github.com/zumerlab/snapdom/commit/46a868baa45bd068be687b19bbd50cb06ceb9cf0)
- Update update-contributors.js [`2a77e4c`](https://github.com/zumerlab/snapdom/commit/2a77e4c82dab36803b005cc6bceab06689a0e52c)
- chore: update contributors list [`020eff8`](https://github.com/zumerlab/snapdom/commit/020eff873c18fc601c145f957bdc566403e18649)
- Update update-contributors.js [`b4cf877`](https://github.com/zumerlab/snapdom/commit/b4cf87709f632be2e03f40b0af5661393f8f8793)
- chore: update contributors list [`a2d28d9`](https://github.com/zumerlab/snapdom/commit/a2d28d952b18787d8e7aabf1b6d12cd8e45fa436)
- Update doc [`7cf19de`](https://github.com/zumerlab/snapdom/commit/7cf19de5df40735b17958359251c481c1b517d8c)
- Update update-contributors.js [`962c7c6`](https://github.com/zumerlab/snapdom/commit/962c7c6a4e23d5b8a0ef4c72111a617ffac3add4)
- Update README.md [`183de8c`](https://github.com/zumerlab/snapdom/commit/183de8ce06c8df35fcbc3a32bb4204c14a657310)
- Update README.md [`4352ae7`](https://github.com/zumerlab/snapdom/commit/4352ae75fb445857c14c64eb9a2ea7dbe82733c3)
- Update update-contributors.js [`7dca4a1`](https://github.com/zumerlab/snapdom/commit/7dca4a1d3bbaacc14295f0e891095db1b39a76d0)
- Update README.md [`ebb7f32`](https://github.com/zumerlab/snapdom/commit/ebb7f3204892d0d42713e7a2a14d261177a24d31)
- Clean transform RootElement prop [`f293e5b`](https://github.com/zumerlab/snapdom/commit/f293e5be0e3ca6a97d43467976d80175d988916d)
- Check if getStyle is iterable [`24dfe05`](https://github.com/zumerlab/snapdom/commit/24dfe056f6d35fe56ab39325b9c4492f84e64cd5)
- chore: update contributors list [`8ac4aa1`](https://github.com/zumerlab/snapdom/commit/8ac4aa1f5a21373e73f86b22d0cdad8def37a8ea)
- chore: update contributors list [`9987328`](https://github.com/zumerlab/snapdom/commit/9987328a796bb3eb70eb45cda4485dc8f5906688)
- Update README.md [`4b52b87`](https://github.com/zumerlab/snapdom/commit/4b52b87e33b6a2f5d34460b2bff13e47ad011a73)

#### [v1.7.1](https://github.com/zumerlab/snapdom/compare/v1.3.0...v1.7.1)

> 19 June 2025

- Improve inlineBackgroundImages to support multiple background-image values.  [`#46`](https://github.com/zumerlab/snapdom/pull/46)
- Add @font-face / FontFace() deteccion, closes #43 [`#43`](https://github.com/zumerlab/snapdom/issues/43)
- update [`7c5441e`](https://github.com/zumerlab/snapdom/commit/7c5441ed4b2c602bcee60b314162f10412b260c5)
- Add benchmark against html2canvas [`f196afe`](https://github.com/zumerlab/snapdom/commit/f196afeb43b23624680a77e52a80222a476f055d)
- Add description [`bcae4af`](https://github.com/zumerlab/snapdom/commit/bcae4af3ce9e0953fea8410303e6d77fe3e01e3e)
- Update issue templates [`352dba3`](https://github.com/zumerlab/snapdom/commit/352dba3e53452f09fb5d056a0c5fb9216701a0f4)
- add options.crossOrigin [`49f8ac6`](https://github.com/zumerlab/snapdom/commit/49f8ac6524e3f54e67505d048a4ad34c529ab6c9)
- Update issue templates [`d832dbd`](https://github.com/zumerlab/snapdom/commit/d832dbd14df70f07d3f3ec9b62016dc4d19d8c9a)
- Create CONTRIBUTING.md [`9a7be15`](https://github.com/zumerlab/snapdom/commit/9a7be151f6b36abd5a582aebbcaacfe759716c3a)
- handle multiple background image in inlineBackgroundImages function [`95a5490`](https://github.com/zumerlab/snapdom/commit/95a5490f2de5a139f39c0286111eb4e84990fd00)
- Update issue templates [`b69b5a4`](https://github.com/zumerlab/snapdom/commit/b69b5a4cb72e3bd0ca5f8ae5b43448c8aab95752)
- update [`57d6b15`](https://github.com/zumerlab/snapdom/commit/57d6b1529c56e890a43cc427f817c731784f6ca0)
- Update index.html [`f002bca`](https://github.com/zumerlab/snapdom/commit/f002bca6ee6330ae9d6f2550d36ce59414de29b0)
- Update issue templates [`24d478f`](https://github.com/zumerlab/snapdom/commit/24d478f32795b42b13f70b4319b5e2cd0ba3fa70)
- Bumped version [`d109fd7`](https://github.com/zumerlab/snapdom/commit/d109fd739197bbc37089f5acfe65ed10a6f48050)
- Add files via upload [`0aecf4e`](https://github.com/zumerlab/snapdom/commit/0aecf4e46093743ca854397509a8be91e08cb666)
- update [`e444762`](https://github.com/zumerlab/snapdom/commit/e444762ddb173d283b761e13a1e5e16c8853e325)
- Update index.html [`997dab3`](https://github.com/zumerlab/snapdom/commit/997dab3293df81dc906116acbf7b4f388a270b39)
- update [`0355286`](https://github.com/zumerlab/snapdom/commit/035528627f957213d35f1c63d9f73528deb972cf)
- Prevent erasing non url background [`0d626cb`](https://github.com/zumerlab/snapdom/commit/0d626cb32b8958afd7e7fd6f96d5a71c6795113b)
- docs: add @jhbae200 as contributor for PR #46 [`afe3094`](https://github.com/zumerlab/snapdom/commit/afe3094360f14712a55c1be134ab993c094a670b)
- Merge pull request #44 from elliots/support-use-credentials-on-images [`005f23e`](https://github.com/zumerlab/snapdom/commit/005f23e529962d73e7550f9f20e92bdc7c8eb8ab)
- Update index.html [`25d970f`](https://github.com/zumerlab/snapdom/commit/25d970fb1142c07bf10c8d9eba491ecdb3bf3e37)
- update [`ea624c3`](https://github.com/zumerlab/snapdom/commit/ea624c362acb7c0f953f3c202dd78f83c84742ce)
- update [`1cf93b7`](https://github.com/zumerlab/snapdom/commit/1cf93b7e25eaa39878f2334e9c240e98ed98f847)
- update [`3a547df`](https://github.com/zumerlab/snapdom/commit/3a547dfccc46e835ac585057d80b03ef5b324e7b)
- update [`2d4380b`](https://github.com/zumerlab/snapdom/commit/2d4380b4c900d3230a44a5af0380d149e55caca9)
- Update index.html [`bedf815`](https://github.com/zumerlab/snapdom/commit/bedf815299c421e3fe810a480f32bb291aae40b1)
- Update issue templates [`48a56fb`](https://github.com/zumerlab/snapdom/commit/48a56fb7f5006b20e64de6a592ec38c7a59b3cd8)
- Create config.yml [`51700c4`](https://github.com/zumerlab/snapdom/commit/51700c4457abb070df34520887991508ce32ad7f)
- update image [`0ec788c`](https://github.com/zumerlab/snapdom/commit/0ec788c562011990a008edb2b8f9b0cf18da8940)

#### [v1.3.0](https://github.com/zumerlab/snapdom/compare/v1.2.5...v1.3.0)

> 14 June 2025

- fix: double scaled images [`#38`](https://github.com/zumerlab/snapdom/pull/38)
- Fix: background img &  img base64 in pseudo elements, closes #36 [`#36`](https://github.com/zumerlab/snapdom/issues/36)
- Feat: captures input values, closes #35 [`#35`](https://github.com/zumerlab/snapdom/issues/35)
- Improve: Device Pixel Ratio handling, thanks @jswhisperer [`1a14f69`](https://github.com/zumerlab/snapdom/commit/1a14f69d340e935126b5388febe5d711c4b94e14)
- Bumped version [`489be08`](https://github.com/zumerlab/snapdom/commit/489be081e6c7e50f1e4ba08d932d79c0ae242d45)
- Update description [`4db784b`](https://github.com/zumerlab/snapdom/commit/4db784b4250b6eac6da8932e651872147fbc8bc1)

#### [v1.2.5](https://github.com/zumerlab/snapdom/compare/v1.2.2...v1.2.5)

> 9 June 2025

- Fix duplicated font-icon when embedFonts is true, closes #30 [`#30`](https://github.com/zumerlab/snapdom/issues/30)
- Fix url with encode url, closes #29 [`#29`](https://github.com/zumerlab/snapdom/issues/29)
- Fix .toCanvas scale [`fb47284`](https://github.com/zumerlab/snapdom/commit/fb4728463a65620bd4f4f8f50cd8b2263ba7bbe7)
- Bumped version [`75b917a`](https://github.com/zumerlab/snapdom/commit/75b917a4fefc5fa9b55da3c028c43955f0656087)
- Update cdn [`37533a2`](https://github.com/zumerlab/snapdom/commit/37533a2c2a858000e93d8d33009241a4be5f8726)
- add homepage [`aa85c5d`](https://github.com/zumerlab/snapdom/commit/aa85c5d9f1777c437b07e624d874f7f1a0fac6a9)

#### [v1.2.2](https://github.com/zumerlab/snapdom/compare/v1.2.1...v1.2.2)

> 4 June 2025

- Patch: type script definitions, closes #23 [`#23`](https://github.com/zumerlab/snapdom/issues/23)
- Bumped version [`548d7f3`](https://github.com/zumerlab/snapdom/commit/548d7f30a889d34ae4dac28a8dedc43262089325)

#### [v1.2.1](https://github.com/zumerlab/snapdom/compare/v1.1.0...v1.2.1)

> 31 May 2025

- feat(embedFonts): also embed icon fonts when embedFonts is true [`#18`](https://github.com/zumerlab/snapdom/issues/18)
- Fix expose snapdom and preCache on browser compilation, closes #26 [`#26`](https://github.com/zumerlab/snapdom/issues/26)
- Improve icon-font conversion [`7bac4ee`](https://github.com/zumerlab/snapdom/commit/7bac4ee3b152d6364c218aaa6d2bed4ad9997943)
- Fix compress mode [`652cfe9`](https://github.com/zumerlab/snapdom/commit/652cfe9a8947029e31db6b089829fe8da87c0b42)
- Bumped version [`0cd7973`](https://github.com/zumerlab/snapdom/commit/0cd797320b92310d86df0ce6296706d1f7f0ad5d)
- Remove some logs [`4348b39`](https://github.com/zumerlab/snapdom/commit/4348b390ab8bb88c59ba9b0d24adbe58051b277a)
- Chore: delete old comments [`ff81a40`](https://github.com/zumerlab/snapdom/commit/ff81a40e8a1b4baa8bacca2ed2ec59124df40b6e)
- Chore: add dry bump script [`5c421c7`](https://github.com/zumerlab/snapdom/commit/5c421c75a1775a3b8c1fbd6a688fcfe409f676af)

#### [v1.1.0](https://github.com/zumerlab/snapdom/compare/v1.0.0...v1.1.0)

> 28 May 2025

- Add typescript declaration, closes #23 [`#23`](https://github.com/zumerlab/snapdom/issues/23)
- Feat. support scrolling state, closes #20 [`#20`](https://github.com/zumerlab/snapdom/issues/20)
- Fix bug by removing trim spaces, closes #21 [`#21`](https://github.com/zumerlab/snapdom/issues/21)
- fix margin on mobile [`36297c8`](https://github.com/zumerlab/snapdom/commit/36297c89c085f605922f88ac5113f2f176c6a1a9)
- mobile friendly [`42dada8`](https://github.com/zumerlab/snapdom/commit/42dada88bdbe886033890071e8e76499358a6b91)
- Update index.html [`1bf3bc1`](https://github.com/zumerlab/snapdom/commit/1bf3bc1b15f4d28b50363c73410cea25ad589cda)
- Create FUNDING.yml [`ddf914c`](https://github.com/zumerlab/snapdom/commit/ddf914c96727b3a82bbea4694d19dc0eb2b518e3)
- Bumped version [`7a9f3d8`](https://github.com/zumerlab/snapdom/commit/7a9f3d8662099d15bcc2046ba88043eb3d3b1bfb)
- add ga [`6d8a73f`](https://github.com/zumerlab/snapdom/commit/6d8a73fd52997e9e1a91944bd9a46d95c8c8507c)
- Update index.html [`46e4b41`](https://github.com/zumerlab/snapdom/commit/46e4b41209c44766425e96fb9be94e1d1c08b6ae)
- Update index.html [`1a2a04c`](https://github.com/zumerlab/snapdom/commit/1a2a04cbb3f4e81e2713d823d5b8dcdeb508591d)
- Ignore generated screenshots tests [`cce8ead`](https://github.com/zumerlab/snapdom/commit/cce8ead47c470280761a34f7c98f9a2fd0796a34)
- Update index.html [`5dd6749`](https://github.com/zumerlab/snapdom/commit/5dd67495df0a5cd48eda168565a81969d5639f40)
- FIx bug that prevent scale on png format [`77a5265`](https://github.com/zumerlab/snapdom/commit/77a52651bd0ea8ccb451f199bd3d8f9e2478bf84)
- Update README.md [`d8440f3`](https://github.com/zumerlab/snapdom/commit/d8440f3864931509f1b369d7e301d6ecccb63b14)
- update [`ffa3a9a`](https://github.com/zumerlab/snapdom/commit/ffa3a9ad942987a5b52a7c9080914bed912db558)
- Update README.md [`9c79e6e`](https://github.com/zumerlab/snapdom/commit/9c79e6e406ff9cb4df1539480e057b6828ef1788)
- Update index.html [`7585674`](https://github.com/zumerlab/snapdom/commit/7585674ed21bb7009b84d1f948ceed2d5ed5ae69)
- Update index.html [`8f4fb95`](https://github.com/zumerlab/snapdom/commit/8f4fb95a8f839159bd00c3338c7c3dc9fb23071c)
- Update index.html [`eebc2bc`](https://github.com/zumerlab/snapdom/commit/eebc2bc01a6581f25995d5a9e946aa6bde08dfdc)

### [v1.0.0](https://github.com/zumerlab/snapdom/compare/v1.0.0-pre.1747581859131...v1.0.0)

> 19 May 2025

- format code [`146fd95`](https://github.com/zumerlab/snapdom/commit/146fd95ec93d6b842acb28272aad43f787dc954a)
- new demo gallery [`b8b2b6e`](https://github.com/zumerlab/snapdom/commit/b8b2b6eb4373999af5e67fc87418d6c6ab96199f)
- Update code documentation [`6f933bc`](https://github.com/zumerlab/snapdom/commit/6f933bca3f1e9a9054f2e0e63807dfd52dda6270)
- Add benchmarks section [`6becbb1`](https://github.com/zumerlab/snapdom/commit/6becbb12014d3cf33ec49264ca088486f08a5ce1)
- Update documentation - add precache() [`a689566`](https://github.com/zumerlab/snapdom/commit/a6895665858f9eb574b0195dc918cef680c1651b)
- Bumped version [`50d48c0`](https://github.com/zumerlab/snapdom/commit/50d48c05458e971a16375ca89da08eedad049e0c)
- chore [`9f76e0c`](https://github.com/zumerlab/snapdom/commit/9f76e0cb1e7761604693588092ac8b1796cc892e)
- update [`d84d395`](https://github.com/zumerlab/snapdom/commit/d84d39599abbd8fbd31727ff3a6650278ec0e28c)

#### [v1.0.0-pre.1747581859131](https://github.com/zumerlab/snapdom/compare/v0.9.9...v1.0.0-pre.1747581859131)

> 18 May 2025

- Fix retina and scale bug, closes #15 [`#15`](https://github.com/zumerlab/snapdom/issues/15)
- Improve public API, closes #16 [`#16`](https://github.com/zumerlab/snapdom/issues/16)
- Fix bug to render canvas with precache compress mode, closes #13 [`#13`](https://github.com/zumerlab/snapdom/issues/13)
- Update to reflect new public API [`b6024cb`](https://github.com/zumerlab/snapdom/commit/b6024cb800b848103411d4e8f4be9a7ffdb84f48)
- Update tests and benckmarks [`f06a0f8`](https://github.com/zumerlab/snapdom/commit/f06a0f835e42036a19761152cf5bf941b53d2f27)
- Add helper to check Safari [`6c9ee04`](https://github.com/zumerlab/snapdom/commit/6c9ee0484c598dd56d52e62f3de37499024ad5e5)
- Remove preWarm [`d3bd582`](https://github.com/zumerlab/snapdom/commit/d3bd582c144775617fc6221c4504466eb4cd6bef)
- Bumped version [`fb0855d`](https://github.com/zumerlab/snapdom/commit/fb0855d55eafdbcae79f537b7e1a51e2cd4d1dfc)

#### [v0.9.9](https://github.com/zumerlab/snapdom/compare/v0.9.8...v0.9.9)

> 14 May 2025

- Bumped version [`676b00d`](https://github.com/zumerlab/snapdom/commit/676b00d71b5b51ea3a90c1aa95776a9b226378a3)
- Fix bug on collectUsedTagNames() [`d627f18`](https://github.com/zumerlab/snapdom/commit/d627f18b6c0512545ab695bfae660cac8f64a9f0)
- update [`c0e64d0`](https://github.com/zumerlab/snapdom/commit/c0e64d00905898660db68f054f5f5598c3fb9581)
- Fix menu options [`8e87681`](https://github.com/zumerlab/snapdom/commit/8e876810c721fa0306c0f7d1b427ba6b111f8afe)

#### [v0.9.8](https://github.com/zumerlab/snapdom/compare/v0.9.7...v0.9.8)

> 14 May 2025

- Add font example [`26c59c8`](https://github.com/zumerlab/snapdom/commit/26c59c864aeaae80b54c22ace32e96396cb9eae6)
- Bumped version [`0819d89`](https://github.com/zumerlab/snapdom/commit/0819d89bc52af1417e31b54e695af8491b709969)
- update tests [`3cd5b70`](https://github.com/zumerlab/snapdom/commit/3cd5b70427613d7d595dd15736cb545db6411d88)
- Fix capture output format [`2afa36a`](https://github.com/zumerlab/snapdom/commit/2afa36a1c41ff798ded5b7f8ecef1632e08ab716)
- Update index.html [`0345fb1`](https://github.com/zumerlab/snapdom/commit/0345fb1f177297db0e17141c5737f9b3b510e6ca)
- Add demo site [`88d0faa`](https://github.com/zumerlab/snapdom/commit/88d0faa1b27db0d305e8b78c7280c8a5e83384a5)
- Disable user zoom [`3813580`](https://github.com/zumerlab/snapdom/commit/381358028159c51b9ed0da11e25928da490170fb)

#### [v0.9.7](https://github.com/zumerlab/snapdom/compare/v0.9.2...v0.9.7)

> 14 May 2025

- Update Dev branch [`#11`](https://github.com/zumerlab/snapdom/pull/11)
- Delete functions [`c5040d9`](https://github.com/zumerlab/snapdom/commit/c5040d90b6276daa04e919ca4b0ecdf205f73af9)
- improve cache handling [`27d7b19`](https://github.com/zumerlab/snapdom/commit/27d7b19cfafeed83f4b30a824638ee7edd63e10b)
- add some examples [`3ce9dd2`](https://github.com/zumerlab/snapdom/commit/3ce9dd2807c8b84ed927c186621850a2518dfd2a)
- Reorganice and add helpers [`c4f4182`](https://github.com/zumerlab/snapdom/commit/c4f4182a3e9ce636a2a263a05d75e64b33b25d7b)
- Add tests [`455e7f2`](https://github.com/zumerlab/snapdom/commit/455e7f20e8a72f6a646a7d1e900f41fb22a18666)
- Check if element to capture exists [`dfa96f2`](https://github.com/zumerlab/snapdom/commit/dfa96f2f720238fdff5df6e24b4572691ad6198f)
- Improve capture logic [`79ab1b9`](https://github.com/zumerlab/snapdom/commit/79ab1b9e165dd08a34338fe0d837b0330be48539)
- Update readme [`fdc2877`](https://github.com/zumerlab/snapdom/commit/fdc2877fd9e6fb73bc5d7bc9cf1f4a405f088be0)
- Add preCache [`48bd910`](https://github.com/zumerlab/snapdom/commit/48bd910743a638ae8ce35ab7d617ad05a75d29a2)
- Optimice [`cc638e7`](https://github.com/zumerlab/snapdom/commit/cc638e7f0f2e63a24eeee65ab4d87755e7207dec)
- Bumped version [`3b26632`](https://github.com/zumerlab/snapdom/commit/3b266324c747c4bc139b99e4978493df79a5555c)
- update [`111fdb4`](https://github.com/zumerlab/snapdom/commit/111fdb444b3c6d61dcb0e6bb2e21c871f5e73587)
- Add cache Maps [`091484c`](https://github.com/zumerlab/snapdom/commit/091484c00941822684afc9148a59cb23e4b34627)
- update [`bdbba7a`](https://github.com/zumerlab/snapdom/commit/bdbba7aeff458a60d5a83b5ead2d4f9402492fd3)
- Update README.md [`c1756a9`](https://github.com/zumerlab/snapdom/commit/c1756a9192f8e3af90fd66da7e19c5fb883dbe0a)
- Expose preCache [`1e96db1`](https://github.com/zumerlab/snapdom/commit/1e96db14c6c4e697361ceed2fb6f9c618801a138)
- Chore [`38c08c0`](https://github.com/zumerlab/snapdom/commit/38c08c0c5a9eda486619855b9df47f33f490a921)
- fix url [`bebec7f`](https://github.com/zumerlab/snapdom/commit/bebec7fd70141b3a82d41a5f6cc0849dcfb0c715)
- Update README.md [`fb0ab3a`](https://github.com/zumerlab/snapdom/commit/fb0ab3ae528d4b37223e4eef03135e9be6a62b0b)
- Update README.md [`1a76186`](https://github.com/zumerlab/snapdom/commit/1a76186d938a7a776a33c0e42ecc6813e86a9262)
- Update README.md [`90d18a1`](https://github.com/zumerlab/snapdom/commit/90d18a165725ca3369fb5ebf48c281e0dd1377ae)

#### [v0.9.2](https://github.com/zumerlab/snapdom/compare/v0.9.2-pre.1746130901718...v0.9.2)

> 1 May 2025

- chore [`2f788af`](https://github.com/zumerlab/snapdom/commit/2f788afd3b25ae6391af6a41086e0b5c3595a701)

#### [v0.9.2-pre.1746130901718](https://github.com/zumerlab/snapdom/compare/v0.9.1...v0.9.2-pre.1746130901718)

> 1 May 2025

- This PR dramatically improves the speed and accuracy of snapDOM. It increases the result size and may produce some long tasks, but it provides a solid foundation to address these side effects in the future. [`#6`](https://github.com/zumerlab/snapdom/pull/6)
- Add as draft new default approach - not implemented [`6f4ec41`](https://github.com/zumerlab/snapdom/commit/6f4ec41c7146525c9db5cfce103e131bb3f19616)
- Add tests [`bdd5a7f`](https://github.com/zumerlab/snapdom/commit/bdd5a7f491561966cd04bf72ca74185dc8e5a766)
- Feat: captures icon fonts [`7b39e5f`](https://github.com/zumerlab/snapdom/commit/7b39e5fb964bc023f6d6fad555b357de5ab113f0)
- Omit process default styles - temporary [`2953196`](https://github.com/zumerlab/snapdom/commit/2953196e00aa6bf9d026df95089d3fc81812f24d)
- update to v.0.9.2 [`e0179a1`](https://github.com/zumerlab/snapdom/commit/e0179a160e361a1e7d58ee5e83747f385cacb887)
- Add options as Object and allow bgColor on jpg and webp [`e5abaa7`](https://github.com/zumerlab/snapdom/commit/e5abaa72de77f75ebe6901935c5f539cda253db2)
- Update commented docs [`cfd2272`](https://github.com/zumerlab/snapdom/commit/cfd2272b065e8c11fff1a729c6cbec1f14000668)
- Update README.md [`fef6751`](https://github.com/zumerlab/snapdom/commit/fef6751ffa90d379c8d829998277825daddc27b8)
- update [`26ff7ea`](https://github.com/zumerlab/snapdom/commit/26ff7ea0528d569820bed8748520a7d02c6506cd)
- Update README.md [`3fda999`](https://github.com/zumerlab/snapdom/commit/3fda999bbdefb5aa32186bb07c59249f9a86e7e9)
- Update README.md [`8ee616b`](https://github.com/zumerlab/snapdom/commit/8ee616baf0059eefcf7e83e7930f5ab8f3850eb5)
- Omit delay function - temporary [`0f04721`](https://github.com/zumerlab/snapdom/commit/0f04721c458ba921694ee38117b8e0b8231a8c1a)
- update unpkg url [`13ce66b`](https://github.com/zumerlab/snapdom/commit/13ce66bfee83802c32edfd9019959540d260cf84)
- Bumped version [`9e4f518`](https://github.com/zumerlab/snapdom/commit/9e4f51885bddebd5364fb4ca96647233304e0dc7)
- Update README.md [`3733476`](https://github.com/zumerlab/snapdom/commit/373347665ca89249244038eaf48731f6d7ee37b8)
- Update README.md [`00c74b0`](https://github.com/zumerlab/snapdom/commit/00c74b07881373275d8c0e5144696d594b031e7e)
- Update README.md [`dd2c9c5`](https://github.com/zumerlab/snapdom/commit/dd2c9c5dd507a432e4dc75e67c5d2d311073e791)
- Update README.md [`d271cf7`](https://github.com/zumerlab/snapdom/commit/d271cf77f5747ee69df07785fef34e8c5e63649e)
- Update README.md [`02bf650`](https://github.com/zumerlab/snapdom/commit/02bf6506ae7e3cf03507e10d8f76983c07f39c66)

#### [v0.9.1](https://github.com/zumerlab/snapdom/compare/v0.9.0...v0.9.1)

> 27 April 2025

- update [`d90fcb9`](https://github.com/zumerlab/snapdom/commit/d90fcb97bdeb75a2adaaa14b25bd6ebced4a70e2)
- Bumped version [`99c286a`](https://github.com/zumerlab/snapdom/commit/99c286a8883ede66ff93aa96a62d008411e4ded0)
- fix change files prop [`548adbe`](https://github.com/zumerlab/snapdom/commit/548adbe9490b0ed4fd7e9fb77e7d6e69a6dc28c9)
- update [`f70a917`](https://github.com/zumerlab/snapdom/commit/f70a9173c7b11d659e6bf80c6ef60b9f71e652b7)

#### v0.9.0

> 27 April 2025

- first public version [`aac1d99`](https://github.com/zumerlab/snapdom/commit/aac1d997836362dd008d6372173c9dd84a76197f)
- Initial commit [`fb1c063`](https://github.com/zumerlab/snapdom/commit/fb1c06307b4b822bb898477beca46f88109ac196)
