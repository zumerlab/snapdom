// The capture root's language decides its default fonts and how a font stack falls back per
// script. It lives on an ancestor, usually <html>, which the clone does not include: d42's
// <html lang="zh"> heading came out in other fonts, regular instead of bold.
import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

let frame
afterEach(() => { frame?.remove(); frame = null })

async function heading(lang, inner = '') {
  frame = document.createElement('iframe')
  frame.style.cssText = 'width:400px;height:200px;border:0'
  frame.srcdoc = `<!doctype html><html lang="${lang}"><body>${inner || '<h4 id="t" style="display:inline-block;margin:0;color:#000;background:#fff">测试页面：3行省略 + 截图 Abc</h4>'}</body></html>`
  await new Promise((resolve) => { frame.onload = resolve; document.body.appendChild(frame) })
  return frame.contentDocument.getElementById('t')
}

describe('the capture keeps the language its fonts depend on', () => {
  it('copies the document language onto the clone root', async () => {
    const t = await heading('zh')
    const svg = decodeURIComponent((await snapdom(t, { cache: 'disabled' })).url.split(',')[1])
    expect(svg).toMatch(/<h4[^>]*\blang="zh"/)
  })

  it('takes the nearest ancestor language over the document one', async () => {
    const t = await heading('en', '<div lang="ja"><h4 id="t" style="display:inline-block;margin:0">テスト</h4></div>')
    const svg = decodeURIComponent((await snapdom(t, { cache: 'disabled' })).url.split(',')[1])
    expect(svg).toMatch(/<h4[^>]*\blang="ja"/)
  })

  // Chromium's svg images do not take per-language default fonts from `lang` (nor from
  // xml:lang): the same heading stays 13.8px off with or without it.
  const honoursLang = /Chrome\//.test(navigator.userAgent) ? it.skip : it
  honoursLang('paints the text as wide as the page does', async () => {
    const t = await heading('zh')
    const live = t.getBoundingClientRect().width
    const canvas = await snapdom.toCanvas(t, { dpr: 1, cache: 'disabled', embedFonts: false })
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let max = -1
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (d[(y * canvas.width + x) * 4] < 100) max = Math.max(max, x)
    expect(Math.abs(max - live)).toBeLessThan(4)
  })
})
