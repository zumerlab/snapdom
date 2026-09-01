// Fidelity comparison: domlens vs snapdom over the REAL demo corpus, per engine.
//
// Why it exists: domlens beats snapdom on the per-element-cold benchmark, and the project's
// creed is fidelity over speed — so before spending on that gap, the question is whether
// domlens is FAITHFUL on real pages at all. The capability matrix cannot answer it (domlens
// passes every coarse cell); the ~80 demos are the corpus that can.
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
//   VITE_DOMLENS_COMPARE=1 npx vitest run __tests__/visual.domlens.compare.test.js --browser.headless
//   BROWSER=all VITE_DOMLENS_COMPARE=1 npx vitest run __tests__/visual.domlens.compare.test.js --browser.headless
import { describe, it, expect, vi } from 'vitest'
import { server } from '@vitest/browser/context'
import { pageNeedsNetwork } from './helpers/network-gate.js'

const RUN = !!import.meta.env.VITE_DOMLENS_COMPARE
const ENGINE = server?.browser || 'unknown'
const DEMOS = Object.keys(import.meta.glob('/demos/d*.html')).sort()
const DOMLENS_URL = 'https://cdn.jsdelivr.net/npm/domlens.js@0.1.0/+esm'
const TOL = 25          // per-channel tolerance before a pixel counts as different
const DIM_SLACK = 2     // px of size difference tolerated before flagging DIM

vi.setConfig({ testTimeout: 300000, hookTimeout: 60000 }) // 112 captures; firefox needs well past 45s

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

describe.skipIf(!RUN)(`domlens vs snapdom over the demo corpus [${ENGINE}]`, () => {
  it('captures every offline demo with both and diffs them', async () => {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:900px;border:0;visibility:hidden'
    document.body.appendChild(iframe)

    const rows = []
    try {
      for (const url of DEMOS) {
        const name = url.replace('/demos/', '').replace('.html', '')
        if (await pageNeedsNetwork(url)) { rows.push({ name, skip: 'network' }); continue }
        try {
          await navigate(iframe, 'about:blank')
          await navigate(iframe, url)
          const win = iframe.contentWindow
          const doc = iframe.contentDocument
          await settle(win)

          await inject(iframe, `
            import { snapdom } from '/dist/snapdom.mjs'
            import { capture } from '${DOMLENS_URL}'
            window.__snap = snapdom; window.__lens = capture`)

          const el = doc.querySelector('#target') || doc.body
          // The LIVE element's own box is the arbiter when the two captures disagree on
          // size: a capture that does not even match the live geometry has chopped or
          // inflated the content, no eyeballing needed.
          const liveR = el.getBoundingClientRect()
          const live = `${Math.round(el === doc.body ? Math.max(liveR.width, doc.documentElement.scrollWidth) : liveR.width)}x${Math.round(el === doc.body ? Math.max(liveR.height, doc.documentElement.scrollHeight) : liveR.height)}`
          const snapRes = await win.__snap(el, { embedFonts: true, burst: false })
          const snapUrl = await toDataUrlIn(win, await snapRes.toCanvas({ dpr: 1 }))
          const lensUrl = await toDataUrlIn(win, await win.__lens(el, { scale: 1 }))

          const A = await toBitmap(snapUrl)
          const B = await toBitmap(lensUrl)
          const dim = (Math.abs(A.w - B.w) > DIM_SLACK || Math.abs(A.h - B.h) > DIM_SLACK)
            ? `${A.w}x${A.h} vs ${B.w}x${B.h}` : ''
          const d = diff(A, B)
          rows.push({ name, pct: d.pct, region: d.region, dim, live })
        } catch (e) {
          rows.push({ name, error: String(e?.message || e).slice(0, 70) })
        }
      }
    } finally {
      iframe.remove()
    }

    const compared = rows.filter((r) => r.pct !== undefined)
    compared.sort((a, b) => b.pct - a.pct)
    console.log(`\n=== domlens vs snapdom — ${ENGINE} · ${compared.length} compared, ` +
      `${rows.filter((r) => r.skip).length} skipped (network), ${rows.filter((r) => r.error).length} errored ===`)
    console.log('demo'.padEnd(34) + 'mismatch'.padStart(9) + '  dim-mismatch          live-el      diff-region')
    for (const r of compared) {
      console.log(r.name.padEnd(34) + (r.pct.toFixed(2) + '%').padStart(9) +
        '  ' + (r.dim || '—').padEnd(20) + '  ' + (r.live || '').padEnd(11) + '  ' + r.region)
    }
    for (const r of rows.filter((x) => x.error)) console.log(`ERROR  ${r.name}: ${r.error}`)

    const median = compared.length ? compared[Math.floor(compared.length / 2)].pct : 0
    const over5 = compared.filter((r) => r.pct > 5).length
    console.log(`\nmedian ${median.toFixed(2)}% · >5% mismatch on ${over5}/${compared.length} demos · ` +
      `dim mismatches ${compared.filter((r) => r.dim).length}`)
    expect(compared.length).toBeGreaterThan(20)
  })
})
