// The pseudo pass had a scan of its own before the gates, which answered "no pseudo here" for
// what it could not read: a sheet of another origin, and the rules past its budget of 1000. The
// whole pass was skipped and the box was not painted. That scan is gone: the gates decide.
import { it, expect, afterEach } from 'vitest'
import { commands } from 'vitest/browser'
import { snapdom } from '../src/index.js'

const RULE = '.sd-blind::before{content:"";display:block;width:40px;height:40px;background:rgb(255,0,0)}'
let frame
afterEach(() => frame?.remove())

/** A document with no sheet of its own, so nothing else turns the pass on. */
async function blank() {
  frame = document.createElement('iframe')
  document.body.appendChild(frame)
  await new Promise((resolve) => { frame.onload = resolve; frame.srcdoc = '<!doctype html><body style="margin:0">' })
  return frame.contentDocument
}

async function redPixels(doc) {
  const root = doc.createElement('div')
  root.style.cssText = 'width:120px;height:120px;background:#fff'
  root.innerHTML = '<div class="sd-blind"></div>'
  doc.body.appendChild(root)
  expect(root.firstChild.getBoundingClientRect().height).toBe(40)
  const canvas = await snapdom.toCanvas(root, { dpr: 1, scale: 1, burst: false, embedFonts: false })
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let red = 0
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) red++
  return red
}

it('a ::before declared only in a sheet of another origin is painted', async () => {
  const doc = await blank()
  const link = doc.createElement('link')
  link.rel = 'stylesheet'
  link.href = await commands.serveCrossOriginCss(RULE)
  await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; doc.head.appendChild(link) })
  expect(() => link.sheet.cssRules).toThrow()
  expect(await redPixels(doc)).toBe(1600)
})

it('a ::before declared after a thousand other rules is painted', async () => {
  const doc = await blank()
  const sheet = new frame.contentWindow.CSSStyleSheet()
  sheet.replaceSync(Array.from({ length: 1001 }, (_, i) => `.sd-filler-${i}{color:#000}`).join('') + RULE)
  doc.adoptedStyleSheets = [sheet]
  expect(await redPixels(doc)).toBe(1600)
})
