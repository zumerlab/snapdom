// The border box `collect/box.js` measures must equal the browser's own, for
// every untransformed element in every fixture.
//
// `getComputedStyle().width` resolves against the USED box, so it reports the
// content width under `box-sizing:content-box` and the BORDER width under
// `border-box`. `borderBoxSize` used to add the padding and borders in both
// cases, inflating every `border-box` element by its own edges — and since
// `*{box-sizing:border-box}` is the modern default, that was most of them. A
// flat fill hides it (the backend paints the node's frame); anything positioned
// against the box does not: `.pcard-ring`'s conic sweep landed 10px off centre.
//
// The probe layer is `background-origin:border-box; background-size:100% 100%`,
// whose resolved rect IS the border box collectBox believes in — nothing here
// re-implements the formula it is checking.
import { chromium } from 'playwright'

const FIXTURES = ['fx-card', 'fx-type', 'fx-ui', 'fx-table', 'fx-z']
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
await page.goto('http://localhost:4321/demo/vector.html', { waitUntil: 'load' })
await page.waitForFunction('window.__ready === true')

let checked = 0, withEdges = 0, oldWrong = 0
const bad = []
for (const fx of FIXTURES) {
  const r = await page.evaluate(async (fx) => {
    window.__vector.select(fx)
    const mod = await import('/src/collect/box.js')
    const root = document.getElementById(fx)
    const bad = []
    let checked = 0, withEdges = 0, oldWrong = 0
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const cs = getComputedStyle(el)
      if (cs.transform !== 'none' || cs.display === 'none') continue
      if (/^inline($|-)/.test(cs.display) && cs.display !== 'inline-block') continue
      const rect = el.getBoundingClientRect()
      if (!rect.width && !rect.height) continue
      checked++
      const pw = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      const bw = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)
      if (pw + bw > 0) withEdges++
      // What the pre-fix formula would have said, as a control.
      if (/px$/.test(cs.width) && Math.abs(parseFloat(cs.width) + pw + bw - rect.width) > 0.02) oldWrong++

      const prev = el.getAttribute('style') || ''
      el.style.backgroundImage = 'linear-gradient(to right, red, blue)'
      el.style.backgroundOrigin = 'border-box'
      el.style.backgroundSize = '100% 100%'
      el.style.backgroundPosition = '0 0'
      const got = mod.collectBox(el, getComputedStyle(el), { mode: 'design' })
      el.setAttribute('style', prev)

      const fill = (got.fills || []).find((f) => f.rect)
      if (!fill) continue
      if (Math.abs(fill.rect.w - rect.width) > 0.02 || Math.abs(fill.rect.h - rect.height) > 0.02) {
        bad.push({
          fx,
          el: el.tagName + (String(el.className || '').split(' ')[0] ? '.' + String(el.className).split(' ')[0] : ''),
          boxSizing: cs.boxSizing, border: cs.borderWidth, padding: cs.padding,
          got: [+fill.rect.w.toFixed(2), +fill.rect.h.toFixed(2)],
          real: [+rect.width.toFixed(2), +rect.height.toFixed(2)],
        })
      }
    }
    return { checked, withEdges, oldWrong, bad }
  }, fx)
  checked += r.checked; withEdges += r.withEdges; oldWrong += r.oldWrong; bad.push(...r.bad)
}
await browser.close()

console.log(`${checked} elements checked (${withEdges} with a border or padding)`)
console.log(`pre-fix formula would have been wrong on ${oldWrong} of them`)
console.log(bad.length ? `FAIL: ${bad.length} wrong\n${JSON.stringify(bad, null, 2)}` : 'PASS: every border box matches the browser')
process.exit(bad.length ? 1 : 0)
