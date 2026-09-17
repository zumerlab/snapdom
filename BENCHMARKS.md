# SnapDOM performance measurements

The historical tables below are recorded measurements from v3 development. They are examples of specific workloads, not a speed guarantee or evidence that the current checkout has no regressions.

## Regression check against the published stable release

```sh
npm run test:benchmark
# Other engines, sequentially (Playwright WebKit is not Safari):
npm run test:benchmark -- --browser all
# Investigate an inconclusive workload with more independent rounds:
npm run test:benchmark -- --scenes shadow --modes recapture --rounds 24
# A predeclared confirmation of specific inconclusive cells:
npm run test:benchmark -- --cases card:fresh,table:recapture --rounds 32
```

`npm run release` also runs this gate in Chromium after correctness and packaging checks.
Other engines are explicit runs with `--browser`; a Chromium result says nothing about their
performance.

Every run resolves `@zumer/snapdom@latest` from the npm registry, requires a stable version,
downloads that exact tarball and verifies its SHA-512 integrity. It fails if the registry or
artifact is unavailable; it never silently substitutes a stale baseline. The candidate is a
fresh **compiled build of the working tree**, including uncommitted changes. A report records
the commit, dirty files, both bundle hashes, exact stable version, fixture hash and browser/OS.
The fixture, harness, runner and statistical code are archived with their hashes.
It does not change the package version, commit, push or publish anything.

The two versions run sequentially in **separate browser contexts**, with a fresh context for
each workload/arm/round. They never share a page, globals or library caches. AB/BA order is
balanced across 16 paired rounds by default. Fixture construction, fonts, image readiness and
layout settlement are outside the stopwatch. Assets are local HTTP fixtures; no CDN or remote
website is involved in the measured work.
Document stylesheets and font faces stay installed while fresh elements are replaced.
Shadow-root styles are recreated with their components. Replacing the app's stylesheets on
every sample would measure cache invalidation as well as a new element, a different workload.

The workload matrix includes a complex card, a 250-row table, utility CSS with about 10,000
rules, 150 nested shadow roots, 40 HTTP images, embedded webfonts, deep flex/grid trees and a
dashboard. Each non-polling scene measures first capture, fresh elements and recaptures:

| Mode | What is measured |
| --- | --- |
| `first` | One first capture in a new context, default memo policy and no warmup. Page assets are already loaded; this is not cold network latency. |
| `fresh` | New element per capture with the default memo policy; warm library/resource caches after two untimed warmups. |
| `recapture` | Same element with changing content; `burst:false` forces the pipeline rather than a memo hit. |
| `poll-static` | Eight captures of an unchanged dashboard, with automatic memoization. |
| `poll-mutating` | Eight captures; dashboard value and painted witnesses change every fourth tick. |

All arms end at the same PNG data URL: `snapdom()` → `result.toCanvas()` →
`canvas.toDataURL('image/png')`. Raw samples preserve capture, raster, encode and total latency.
Polling totals sum eight capture/export latencies, excluding the gaps between ticks. It is a
capture-cost benchmark, not a UI responsiveness or complete application-load benchmark.
The default matrix uses `fast:true`. Canvas/video/iframe workloads, clipping, high DPR,
`toBlob()`/`toPng()` helper overhead and `fast:false` responsiveness are not covered by this
performance gate; their correctness tests remain separate.

Each timed output checks dimensions and painted witnesses, including a witness inside the
mutated dashboard card. Untimed captures are compared with native browser screenshots and
with the stable output; PNGs are saved for inspection. New incorrect pixels cannot cancel
out an improvement elsewhere. A bad fixture or fidelity regression withholds the timing
verdict; faster blank or stale output is not a win. Pixel tolerance is 20 per channel; over
5% native/capture mismatch invalidates the fixture, and over 0.1 percentage points of newly
incorrect pixels requires review. These are detection thresholds, not a complete visual
correctness proof; the visual regression suite is still required.

The statistical unit is a **paired round**, not individual correlated calls inside one page.
The runner compares medians within each round, then reports median paired ratios and ms
differences with exact binomial-rank confidence intervals. Bonferroni correction provides
familywise 95% coverage per browser across the capture/total comparisons and both intervals.
It keeps all samples, including outliers. The default 16 rounds intentionally gives
conservative intervals; extra calls within a round cannot replace more independent rounds.
The decision concerns typical latency (paired medians), not a p95 or worst-case guarantee;
individual timings remain in the JSON for investigating stalls.

- `regression`: the lower confidence bounds exceed **both 5% and 1 ms**.
- `no-regression-detected`: the upper bounds rule out a slowdown above those thresholds.
  This is not a claim of zero slowdown or permission to accept a known regression.
- `inconclusive`: intervals cross the threshold, there are fewer than 12 rounds, or the
  AB/BA order effect exceeds both 5% and 1 ms without a supported regression. An order
  effect blocks a passing verdict but cannot hide a slowdown supported by both lower
  bounds; the report preserves that diagnostic. Exit code **2**, not success.
- Fidelity failures, detected regressions and runner errors exit **1**. A complete run with
  no detected regression exits **0**.

Reports, all raw samples, pinned artifacts and PNG evidence go to a timestamped directory
under `output/benchmark-stable/`. Keep its `report.json` when comparing runs. Run on an idle
machine with no concurrent tests/benchmarks. A lock prevents two copies of this runner from
overlapping, but cannot prevent unrelated CPU load. Do not keep rerunning until a favorable
number appears: preserve inconclusive/failing runs and investigate their cause.

The measuring instrument has controls. Both use **stable on both sides** and cannot certify
the checkout. A/A should not invent a slowdown; the slow control adds 30 ms to each candidate
capture and must detect it. Controls exit 0 only when their expectation passes; otherwise
they exit 1. An inconclusive A/A means the requested precision was not achieved, not that
identical code regressed. The report retains the statistical verdict separately:

```sh
npm run test:benchmark -- --control aa --scenes card --modes recapture
npm run test:benchmark -- --control slow --scenes card --modes recapture
```

The [live comparison](https://snapdom.dev/compare/live/) and
`npm run test:benchmark:legacy` remain exploratory competitor comparisons. They are not the
stable regression gate. The public lab loads the published package; `npm run site` uses the
checkout. Legacy tests explicitly label cases that include scene mounting in their timing.

## Method

Chromium via Playwright, headless, DPR 1, scale 1, Apple Silicon. All timed outputs end at a PNG data URL. Times are in milliseconds. The steady-state table is the median of four runs; other scene rows are individual benchmark runs. Core repeat memoization is disabled except in the polling scene. Library versions are pinned in the benchmark adapters.

A first capture and a repeat capture answer different questions. Image decoding, rasterization and PNG encoding remain part of the measured cost. Check output dimensions and visual differences before comparing timings.

## Steady state — re-capturing the same element

| Library | Complex card | Table, 500 rows | Simple node (1200×800) |
| --- | --- | --- | --- |
| **SnapDOM** | **10.0** | **130.1** | **11.1** |
| domlens.js 0.1.0 | 17.4 | 194.1 | 133.4 |
| modern-screenshot 4.7.0 | 30.5 | 579.9 | 12.2 |
| dom-to-image-more 3.10.2 | 30.4 | 683.9 | 16.9 |
| html-to-image 1.11.13 | 50.2 | 1,443.1 | 17.1 |
| html2canvas 1.4.1 | 82.5 | 365.0 | 89.2 |
| @renoun/screenshot 0.3.3 | 145.5 | 641.6 | 77.5 |
| dom-to-image 2.6.0 | 154.9 | 1,041.5 | 131.7 |
| dom-to-image-modern 1.0.2 | 156.5 | 928.2 | 129.6 |

## Real-world scenes

| Scene | SnapDOM | Next fastest | Rest of the field |
| --- | --- | --- | --- |
| CSS-heavy page — 10k author rules, 240 class-styled cards | **125.4** | domlens 137.8 | modern-screenshot 288.3 · dom-to-image-more 344.3 · html-to-image 586.1 |
| Shadow DOM — 150 open roots, 3 levels, ~3k nodes | **12.0** | domlens 65.3 | modern-screenshot 104.2 · html2canvas 140.0 · dom-to-image-more 168.1 · html-to-image 646.1 |
| Web fonts — article with Inter 400/700 + mono spans | **10.7** | modern-screenshot 23.1 | dom-to-image-more 25.0 · html-to-image 41.5 |
| Image grid — 40 same-origin PNGs fetched over HTTP | **52.1** | dom-to-image-more 59.7 | html-to-image 60.9 · domlens 66.5 · modern-screenshot 68.1 |
| Photo gallery — 9 photos, 16 Mpx of sources, 960px wide | **61.8** | html2canvas 72.3 | html-to-image 244.6 · dom-to-image-more 426.6 · modern-screenshot 628.7 · domlens 841.6 |
| Polling — 20 captures of a live dashboard | **18.6** | modern-screenshot 109.1 | dom-to-image-more 333.3 · domlens 470.4 |
| Deep nested tree — 16 chains × 10 levels, ~2,100 nodes, a `::before` stripe on every leaf | **295.5** | html2canvas 708.4 | domlens 1,106.0 · modern-screenshot 1,280.3 · html-to-image 2,240.1 |

The polling row uses automatic memoization. The image grid includes HTTP fetches. In the photo gallery, SnapDOM downsamples source images to visible resolution; html2canvas paints images already decoded by the browser. Those paths have different first-capture costs.

## Cold vs steady — per element

| Arm | ms |
| --- | --- |
| SnapDOM — fresh element each capture | **180.1** |
| domlens.js — fresh element each capture | 211.6 |
| modern-screenshot — fresh element each capture | 592.8 |
| *SnapDOM — same element re-captured, for reference* | *127.4* |

## On a real page

| Scene (per-element cold, docs page) | SnapDOM | domlens 0.1.0 | html2canvas 1.4.1 | modern-screenshot 4.7.0 | html-to-image 1.11.13 |
| --- | --- | --- | --- | --- | --- |
| Table, 500 rows (640×17312) | **191.1** | 275.0 | 375.7 | 599.0 ¹ | 1,450.1 ¹ |
| Deep nested tree (1232×15506) | **442.9** | 1,192.7 | 739.4 | 1,227.2 | 2,181.7 |
| Photo gallery (960×654) | 208.3 | 1,112.6 | **185.7** | 590.8 | 573.6 |

Each scene is mounted fresh inside the docs site; five captures per cell, median. ¹ Different output dimensions: modern-screenshot produced 640×17311 and html-to-image 605×16384. Those two table cells are not directly comparable.

## Capability matrix — verified by pixels, not by READMEs

| Library | Shadow DOM | Pseudo-elements | conic-gradient | Slotted content | adoptedStyleSheets | Painted `<canvas>` | 1st capture |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **SnapDOM** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 7 ms |
| modern-screenshot 4.7.0 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 8 ms |
| domlens.js 0.1.0 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 15 ms |
| dom-to-image-more 3.10.2 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 26 ms |
| html-to-image 1.11.13 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 31 ms |
| @renoun/screenshot 0.3.3 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | 18 ms |
| html2canvas 1.4.1 | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | 61 ms |
| dom-to-image 2.6.0 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | 109 ms |
| dom-to-image-modern 1.0.2 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | 111 ms |

The capability fixtures check painted marker pixels with a negative control. These results use library defaults. html2canvas supports the conic-gradient and adopted-stylesheet fixtures with `foreignObjectRendering: true`. Results can differ by browser.

## SVG vs html-in-canvas

Measured September 4, 2026: local v3.x.x prerelease, headed Chrome 152.0.7977.76 with the canvas drawing flag enabled, Apple M5, DPR 1 and scale 1. The native engine was confirmed active in every native sample; none used SVG fallback.

These are **recaptures with warm resource caches**, not memoized results. Each engine/scene has 30 measured samples across two rounds, with engine order reversed in the second round. Each combination uses a fresh browser context and three excluded warmups per round. Times below are medians.

| Scene | Output | SVG → canvas | Native → canvas | SVG → PNG | Native → PNG |
| --- | --- | ---: | ---: | ---: | ---: |
| Card | 480×240 | 2.7 ms | 35.5 ms | 5.7 ms | 40.4 ms |
| Dashboard | 960×720 | 6.5 ms | 35.5 ms | 11.3 ms | 41.0 ms |
| Table, 250 rows | 800×6032 | 52.6 ms | 70.9 ms | 77.2 ms | 93.8 ms |
| Gallery, 12 images | 960×720 | 14.2 ms | 34.8 ms | 21.3 ms | 42.1 ms |
| 30 Shadow DOM components | 960×720 | 19.3 ms | 34.8 ms | 22.9 ms | 38.2 ms |

Canvas times include capture and `toCanvas()`. PNG times additionally include `canvas.toDataURL('image/png')`, matching the output stage used by the comparisons above; they are not timings of the `toPng()` helper. Source and output dimensions match. Visual checks found no missing content between engines; the fixed-height Shadow DOM fixture clips its last row in the source and both outputs.

SVG was faster for all five recapture scenes. The native engine waits for browser paint updates; its latency therefore depends partly on frame scheduling. In these runs, smaller captures took about 35 ms to reach canvas. This is the current implementation's behavior, not a general limit of the browser API.

With automatic memoization, both engines returned canvas in under 1 ms for the card and dashboard. PNG encoding still added work. These results support SVG as the speed default for the measured workloads; they do not establish a universal winner for every page or browser.

To reproduce, run `SNAPDOM_CANVAS_ENGINE=1 npm run site`, then `node scripts/engine-bench.mjs 15 2` in another terminal. The runner saves per-sample capture, canvas-export and PNG-encoding times plus output images under `output/engine-bench/`.

## Run locally

```sh
npm install
npx playwright install
npm run compile
npm run test:benchmark
npm run test:benchmark:legacy
npx vitest run __tests__/category.capabilities.test.js --browser.headless --reporter=verbose
```

For the comparison inside the docs page, run `npm run site` in one terminal and `node scripts/realpage-bench.mjs` in another. `BROWSER=all` selects Chromium, Firefox and WebKit for the browser suites that support it.

The live lab and tests share [the same adapters and scenes](docs/compare/live/harness.js). Keep the output stage, scale, DPR, version and memoization mode in any report of these numbers.
