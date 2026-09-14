# SnapDOM performance measurements

These are recorded measurements from v3 development. They are examples of specific workloads, not a speed guarantee for every page or browser.

For current measurements, run the [live comparison](https://snapdom.dev/compare/live/) or the commands below. The public lab loads the published package and reports its version; `npm run site` uses this checkout.

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
npx vitest run __tests__/category.capabilities.test.js --browser.headless --reporter=verbose
```

For the comparison inside the docs page, run `npm run site` in one terminal and `node scripts/realpage-bench.mjs` in another. `BROWSER=all` selects Chromium, Firefox and WebKit for the browser suites that support it.

The live lab and tests share [the same adapters and scenes](docs/compare/live/harness.js). Keep the output stage, scale, DPR, version and memoization mode in any report of these numbers.
