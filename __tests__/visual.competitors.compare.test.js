// Fidelity comparison: COMPETITORS vs snapdom over the REAL demo corpus, per engine.
//
// Why it exists: when a competitor beats snapdom on a speed benchmark, the project's creed
// is fidelity over speed — so before spending on that gap, the question is whether the
// competitor is FAITHFUL on real pages at all. The capability matrix cannot answer it (a
// coarse cell passes easily); the ~80 demos are the corpus that can. Add a competitor by
// appending one entry to COMPETITORS below — the artifacts, summary and gallery
// (scripts/report-competitors.mjs) key everything by its id.
//
// What "reference" means here: snapdom's captures, not the live DOM — no library can
// screenshot the live DOM from inside the page, and snapdom's output on this corpus is the
// validated one (71/71 demos pixel-identical to the shipped v2 line on chromium, plus the
// per-engine baselines this repo maintains). A large domlens-vs-snapdom mismatch is
// therefore "domlens diverges from the validated rendering", and the per-demo numbers say
// where to look; eyeball the worst before drawing conclusions about WHO is wrong.
//
// Both captures run INSIDE the demo's iframe realm (styles/fonts must be read from its
// document — same reason snapdiff injects). Animations are paused at t=0 first so both
// libraries capture the same frame. Network-dependent demos are skipped by the same
// pageNeedsNetwork gate the visual suite uses.
//
// GATED: does nothing under plain `npm test`. Run with
//   VITE_COMPETITOR_COMPARE=1 npx vitest run __tests__/visual.competitors.compare.test.js --browser.headless
//   BROWSER=all VITE_COMPETITOR_COMPARE=1 npx vitest run __tests__/visual.competitors.compare.test.js --browser.headless
import { describe, it, expect, vi } from 'vitest'
import { server } from '@vitest/browser/context'
import { pageNeedsNetwork } from './helpers/network-gate.js'

const RUN = !!import.meta.env.VITE_COMPETITOR_COMPARE
const ENGINE = server?.browser || 'unknown'
const DEMOS = Object.keys(import.meta.glob('/demos/d*.html')).sort()

/** The competitors under comparison. `imp` is the module line injected into the demo's
 *  iframe realm; `call` receives (win, el) and must resolve to something toDataUrlIn
 *  understands. One entry per library; everything downstream keys off `id`. */
const COMPETITORS = [
  {
    id: 'domlens',
    imp: "import { capture as __c_domlens } from 'https://cdn.jsdelivr.net/npm/domlens.js@0.1.0/+esm'; window.__c_domlens = __c_domlens",
    // Nested on purpose: domlens silently ignores a flat `scale` and falls back to
    // devicePixelRatio, which only shows up off headless. See helpers/domlens.js.
    call: (win, el) => win.__c_domlens(el, { output: { scale: 1 } }),
  },
]
const TOL = 25          // per-channel tolerance before a pixel counts as different
const DIM_SLACK = 2     // px of size difference tolerated before flagging DIM

vi.setConfig({ testTimeout: 600000, hookTimeout: 60000 }) // 160 captures, network demos included

function navigate(iframe, url) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('iframe load timeout')), 20000)
    iframe.onload = () => { clearTimeout(t); resolve() }
    iframe.src = url
  })
}

async function settle(win) {
  const doc = win.document
  await new Promise((r) => win.requestAnimationFrame(() => win.requestAnimationFrame(r)))
  try { await Promise.race([doc.fonts?.ready, new Promise((r) => setTimeout(r, 3000))]) } catch { /* best effort */ }
  try { await Promise.allSettled([...doc.images].map((im) => im.decode?.())) } catch { /* best effort */ }
  // Pin every animation to its first frame so both libraries capture the same instant.
  try { for (const a of doc.getAnimations()) { a.currentTime = 0; a.pause() } } catch { /* best effort */ }
  await new Promise((r) => win.requestAnimationFrame(r))
}

function inject(iframe, code) {
  return new Promise((resolve, reject) => {
    const s = iframe.contentDocument.createElement('script')
    s.type = 'module'
    s.textContent = code
    const t = setTimeout(() => reject(new Error('module inject timeout')), 15000)
    iframe.contentWindow.__injected = () => { clearTimeout(t); resolve() }
    s.textContent += '\nwindow.__injected()'
    iframe.contentDocument.head.appendChild(s)
  })
}

/** Normalize either library's output to a PNG data URL INSIDE the iframe realm. A data URL
 *  is realm-neutral; a canvas or result object from the iframe realm is not — the parent
 *  document's drawImage rejects foreign-realm objects ("not of type CanvasImageSource"),
 *  which is exactly how the first version of this file errored on all 56 demos. tagName
 *  checks are realm-safe where instanceof is not. */
async function toDataUrlIn(win, out) {
  if (typeof out === 'string') return out
  if (out?.tagName === 'IMG') return out.src
  if (out?.tagName === 'CANVAS') return out.toDataURL('image/png')
  if (out && typeof out.toPng === 'function') return toDataUrlIn(win, await out.toPng())
  if (out && typeof out.arrayBuffer === 'function') {
    return await new Promise((resolve, reject) => {
      const fr = new win.FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = reject
      fr.readAsDataURL(out)
    })
  }
  throw new Error('unrecognized capture output')
}

async function toBitmap(url) {
  const img = new Image()
  img.src = url
  await img.decode()
  const w = img.naturalWidth
  const h = img.naturalHeight
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  // Composite over WHITE before diffing: whether an empty region serializes as transparent
  // or as white is a normalization choice each library makes (and exposes as an option),
  // not a fidelity difference. Without this, a transparent-vs-white background made every
  // empty pixel "different" and the first run reported a 75% median that was all ground,
  // no figure.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0)
  return { w, h, data: ctx.getImageData(0, 0, w, h).data }
}

/** Paint a human-readable diff: the snapdom capture dimmed to grayscale, RED where the two
 *  captures disagree inside the common box, ORANGE banding where only one capture has
 *  pixels (size mismatch). Returns a PNG data URL. */
function renderDiff(a, b) {
  const W = Math.max(a.w, b.w)
  const H = Math.max(a.h, b.h)
  const w = Math.min(a.w, b.w)
  const h = Math.min(a.h, b.h)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  const out = ctx.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      if (x < w && y < h) {
        const i = (y * a.w + x) * 4
        const j = (y * b.w + x) * 4
        const differs = Math.abs(a.data[i] - b.data[j]) > TOL ||
          Math.abs(a.data[i + 1] - b.data[j + 1]) > TOL ||
          Math.abs(a.data[i + 2] - b.data[j + 2]) > TOL ||
          Math.abs(a.data[i + 3] - b.data[j + 3]) > TOL
        if (differs) {
          out.data[o] = 220; out.data[o + 1] = 20; out.data[o + 2] = 20; out.data[o + 3] = 255
        } else {
          const g = 200 + (0.3 * a.data[i] + 0.59 * a.data[i + 1] + 0.11 * a.data[i + 2]) * 0.2
          out.data[o] = g; out.data[o + 1] = g; out.data[o + 2] = g; out.data[o + 3] = 255
        }
      } else {
        out.data[o] = 255; out.data[o + 1] = 160; out.data[o + 2] = 40; out.data[o + 3] = 255
      }
    }
  }
  ctx.putImageData(out, 0, 0)
  return c.toDataURL('image/png')
}

function diff(a, b) {
  const w = Math.min(a.w, b.w)
  const h = Math.min(a.h, b.h)
  let bad = 0
  let minX = w, minY = h, maxX = 0, maxY = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * a.w + x) * 4
      const j = (y * b.w + x) * 4
      if (Math.abs(a.data[i] - b.data[j]) > TOL ||
          Math.abs(a.data[i + 1] - b.data[j + 1]) > TOL ||
          Math.abs(a.data[i + 2] - b.data[j + 2]) > TOL ||
          Math.abs(a.data[i + 3] - b.data[j + 3]) > TOL) {
        bad++
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  const pct = (bad / (w * h)) * 100
  return { pct, bad, region: bad ? `${minX},${minY}..${maxX},${maxY}` : '—' }
}

describe.skipIf(!RUN)(`competitors vs snapdom over the demo corpus [${ENGINE}]`, () => {
  it('captures every offline demo with both and diffs them', async () => {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:900px;border:0;visibility:hidden'
    document.body.appendChild(iframe)

    const rows = []
    try {
      for (const url of DEMOS) {
        const name = url.replace('/demos/', '').replace('.html', '')
        // Network-dependent demos are captured too — this suite is manually gated, not part
        // of npm test, and their fidelity (webfonts, CORS images, icon fonts) is exactly
        // where capture libraries diverge. The row keeps the flag so a flaky remote is
        // attributable when a number moves between runs.
        const net = await pageNeedsNetwork(url)
        try {
          await navigate(iframe, 'about:blank')
          await navigate(iframe, url)
          const win = iframe.contentWindow
          const doc = iframe.contentDocument
          await settle(win)

          await inject(iframe, `
            import { snapdom } from '/dist/snapdom.mjs'
            ${COMPETITORS.map((c) => c.imp).join('\n            ')}
            window.__snap = snapdom`)

          const el = doc.querySelector('#target') || doc.body
          // The LIVE element's own box is the arbiter when the two captures disagree on
          // size: a capture that does not even match the live geometry has chopped or
          // inflated the content, no eyeballing needed.
          const liveR = el.getBoundingClientRect()
          const live = `${Math.round(el === doc.body ? Math.max(liveR.width, doc.documentElement.scrollWidth) : liveR.width)}x${Math.round(el === doc.body ? Math.max(liveR.height, doc.documentElement.scrollHeight) : liveR.height)}`
          const snapRes = await win.__snap(el, { embedFonts: true, burst: false })
          const snapUrl = await toDataUrlIn(win, await snapRes.toCanvas({ dpr: 1 }))
          const A = await toBitmap(snapUrl)
          // Persist what each library actually captured, plus the painted diff — the
          // numbers say WHERE to look, these are what you look AT.
          const dir = `__snapshots__/competitor-compare/${ENGINE}`
          await server.commands.writeFile(`${dir}/${name}.snapdom.png`, snapUrl.split(',')[1], 'base64')
          for (const comp of COMPETITORS) {
            const compUrl = await toDataUrlIn(win, await comp.call(win, el))
            const B = await toBitmap(compUrl)
            const dim = (Math.abs(A.w - B.w) > DIM_SLACK || Math.abs(A.h - B.h) > DIM_SLACK)
              ? `${A.w}x${A.h} vs ${B.w}x${B.h}` : ''
            const d = diff(A, B)
            await server.commands.writeFile(`${dir}/${name}.${comp.id}.png`, compUrl.split(',')[1], 'base64')
            await server.commands.writeFile(`${dir}/${name}.${comp.id}.diff.png`, renderDiff(A, B).split(',')[1], 'base64')
            rows.push({ name, lib: comp.id, net, pct: d.pct, region: d.region, dim, live, snapDim: `${A.w}x${A.h}`, lensDim: `${B.w}x${B.h}` })
          }
        } catch (e) {
          rows.push({ name, error: String(e?.message || e).slice(0, 70) })
        }
      }
    } finally {
      iframe.remove()
    }

    const compared = rows.filter((r) => r.pct !== undefined)
    compared.sort((a, b) => b.pct - a.pct)
    console.log(`\n=== competitors vs snapdom — ${ENGINE} · ${compared.length} compared ` +
      `(${compared.filter((r) => r.net).length} network-dependent), ${rows.filter((r) => r.error).length} errored ===`)
    console.log('demo'.padEnd(34) + 'mismatch'.padStart(9) + '  dim-mismatch          live-el      diff-region')
    for (const r of compared) {
      console.log((r.name + '/' + r.lib + (r.net ? ' *net' : '')).padEnd(34) + (r.pct.toFixed(2) + '%').padStart(9) +
        '  ' + (r.dim || '—').padEnd(20) + '  ' + (r.live || '').padEnd(11) + '  ' + r.region)
    }
    for (const r of rows.filter((x) => x.error)) console.log(`ERROR  ${r.name}: ${r.error}`)
    await server.commands.writeFile(
      `__snapshots__/competitor-compare/${ENGINE}/summary.json`,
      JSON.stringify({ engine: ENGINE, when: new Date().toISOString(), rows }, null, 1))

    const median = compared.length ? compared[Math.floor(compared.length / 2)].pct : 0
    const over5 = compared.filter((r) => r.pct > 5).length
    console.log(`\nmedian ${median.toFixed(2)}% · >5% mismatch on ${over5}/${compared.length} demos · ` +
      `dim mismatches ${compared.filter((r) => r.dim).length}`)
    expect(compared.length).toBeGreaterThan(20)
  })
})
