# v3 beta release review — 2026-09-05

This review covers `3.0.0-beta.0`, starting from `acd64ae`, for the planned publication
around September 15. It includes source review, regression fixes, browser rendering,
package installation, type resolution and real Safari export checks. Existing uncommitted
website changes were left outside the review commits.

No confirmed release blocker remains in the tested scope after the corrections below.
The final complete browser run passed 4,768 tests with 20 expected skips and no failures.

## Findings fixed

| Priority | Defect and user impact | Correction and regression coverage |
| --- | --- | --- |
| P1 | Agent/context exports could expose textarea default text despite masking input state. Agent names and full text could also include excluded descendants or excluded referenced labels. | Semantic text extraction follows the exclusion boundary and omits textarea values. Credential regression tests cover both exporters and external labels. |
| P1 | Concurrent resource requests with different headers could receive the same response; an anonymous failure could suppress a credentialed retry. | Custom-header requests bypass shared caches, without storing credential values in keys. Credential modes distinguish ordinary request keys. |
| P2 | Temporary preparation styles lost `!important`, border longhands or `border-image`; concurrent captures could undo each other's overrides. | Reference-counted temporary declarations restore original CSS while preserving unrelated application edits. Tests cover priorities, concurrent undos and absent style attributes. |
| P2 | Selects with duplicate option values, excluded options or no selection could paint the wrong label. | Selection follows source-option identity; a hidden blank option preserves an empty single-select through XML serialization. |
| P2 | Fonts used only inside open shadow roots were missed, including automatic embedding and pseudo-element glyphs. | Font collection visits nested open shadow roots and their pseudo styles. Local font fixtures verify embedding. |
| P2 | Inherited vertical writing disappeared when only an ancestor had inline `writing-mode`/`text-orientation`. | Both inherited properties are retained in normal and pseudo style scans. A pixel regression compares inherited and explicit styling. |
| P2 | Fixed backgrounds used the top window's viewport inside iframes; fixed gradients ignored explicit sizes. | Use the element's owner window and resolve gradient sizes against its viewport. |
| P2 | CSS `image-set()` split data URLs and quoted filenames at embedded commas. | Candidate splitting respects strings and nested functions. |
| P2 | `{urlRaw}` proxy templates failed; ordinary asset URLs with `url`/`target` query parameters bypassed the proxy. Malformed URLs or throwing error observers could reject an otherwise nonthrowing fetch. | Correct template/routing detection and isolate diagnostic failures. |
| P2 | `fromString('Before <strong>inside</strong> after')` dropped surrounding text. | Preserve the wrapper for mixed text/element fragments. |
| P2 | Downscaling thin captures could produce a zero-height canvas, null PNG Blob or invalid SVG image. | Clamp derived output dimensions to at least one pixel across image/canvas exporters. |
| P2 | `BlobOptions` did not accept the documented `format` field. | Add the canonical field and compile-time checks; retain deprecated `type`. |
| Docs | Video filename documentation promised extension rewriting that does not occur. | Clarify that the default follows the container and custom filenames are used verbatim. |

## Release validation improvements

- Vitest discovers only `__tests__/**/*.test.js`. A scratch `.snapeye` test previously
  imported an unavailable alias, raising Vite's error overlay over otherwise valid test
  pages and corrupting live screenshots and pointer tests.
- Freshness checks cover both distributed bundles and changes to `package.json`, not just
  the ESM file and source code.
- Release preflight requires every eligible demo baseline in each selected browser and
  rejects baseline-update mode, including flags loaded by Vite from `.env` files. The suite and preflight share the three intentionally
  animated demo exclusions.
- Under `REQUIRE_VISUAL=1`, unavailable network coverage fails explicitly instead of being
  silently skipped. Ordinary contributor runs retain the adaptive network gate.
- `npm run release` validates all three browser engines. Test commands run lint without
  automatically rewriting the checkout. Four Node tests cover the release preflight.
- `scripts/safari-release-smoke.mjs` provides a repeatable real Safari test using the built
  ESM artifact and local resources. It creates and closes its own WebDriver session/server.

## Evidence

Local machine-readable evidence is in ignored `output/beta-review-tests.json`, `output/beta-review-tests.log`,
`output/beta-review-safari.json` and `output/beta-review-audit.json`.

| Check | Result |
| --- | --- |
| Complete browser suite (`BROWSER=all REQUIRE_VISUAL=1`) | 633 files passed, 6 skipped; 4,768 tests passed, 20 skipped; 45.89 seconds |
| Visual regression coverage | All 77 eligible demos per engine passed (231 comparisons); all 12 live-DOM fidelity cases passed; baselines were not updated |
| Final visual-only run after env-file gate hardening | 231 passed, 9 intended skips; 18 files passed in 13.47 seconds (`output/beta-review-visual-final.json`) |
| ESLint, TypeScript, legacy bundle isolation | Passed |
| Release preflight regression tests | 4 passed |
| Packed core and official plugins | Entrypoints present; offline consumer install, strict Node16/Bundler type resolution, runtime imports and global isolation passed |
| npm audit | 0 reported vulnerabilities across the installed dependency tree |
| Real Safari 26.6.2 | 15 checks passed: repeated first draws, changing canvas pixels, thin PNG/SVG/Blob exports, large output dimensions/pixels, shadow fonts and mixed fragments |
| Independent GIF encoder verification | 44 deterministic palette fixtures decoded and matched every RGBA pixel |
| Chromium repeated-capture benchmark smoke | 20 unchanged captures: 8.63 ms without memoization vs 2.69 ms with it; one mutation every four captures: 3.89 ms vs 2.68 ms. These are per-batch means in separate fixtures, not a before/after release comparison. |
| Final ESM bundle | 244,360 bytes; 82,115 bytes gzip |
| Final script-tag bundle | 244,019 bytes; 81,961 bytes gzip |

The comparison against `acd64ae` used 72 isolated browser runs: a card, a 500-row table
and 24 open shadow components, four alternating-order rounds, and identical production
ESM settings. It timed the completed SVG capture stage with `embedFonts: false`; final
canvas decoding and pixel hashes were checked outside the timing. No material speed
regression was demonstrated. This short run cannot resolve possible differences of 1–5%.

| Browser | Warmed full 500-row capture, baseline → reviewed | Median paired time ratio |
| --- | --- | --- |
| Chromium | 20.95 → 21.00 ms | 1.002× |
| Firefox | 60.00 → 61.00 ms | 1.025× |
| WebKit | 19.00 → 19.00 ms | 1.026× |

All 36 paired final captures matched in dimensions and exact decoded pixel hashes.
All 10,080 measured unchanged captures reused their previous result; mutation batches
reused exactly the expected 75%. Ratios use paired round medians, so they need not equal
the ratio of aggregate medians above. Card/memo percentage changes near browser timer
precision are not interpretable. These timings do not cover external font loading,
compression or large raster encoding. Full timings, cold-call results and methodology are
in `output/beta-review-performance.json` and `output/beta-review-performance.md`.

An earlier full run included one WebKit compression timeout at 15 seconds. The same test
passed in isolation in 42 ms, alongside all-engine selection checks (18/18). No compression
code, timeout or assertion was weakened to make it pass. The intermediate report is retained
as `output/beta-review-tests-before-isolation.json`.

## Scope and publication follow-up

The tests exercise Chromium, Firefox, Playwright WebKit and a limited real macOS Safari
smoke test. They do not establish coverage of physical iOS/Android devices, every OS font
environment or every external site. The experimental `html-in-canvas` engine remains
excluded from default bundles; its source-level tests run in the regular suite.

The expected skipped tests include three animated demos per engine, optional competitor
comparisons and browser-specific cases that do not apply to that engine. WebKit also skips
two banded-versus-main-document parity comparisons because its decode-frame path differs
from that reference even without banding; the suite still tests the band route itself.

Before publication:

1. Run `npm run release` on the exact final code and retained visual baselines with a working
   network connection. Baselines are local artifacts, so a fresh checkout needs them supplied.
2. Run the real Safari smoke again after any renderer/exporter changes. Start
   `safaridriver -p 4447` with Remote Automation enabled, compile, then run
   `node scripts/safari-release-smoke.mjs`.
3. Update release notes and the README's current statement that no v3 npm tag is available
   when publishing that tag. Check the intended package version and npm dist-tag.

No package was published and no commits were pushed by this review.
