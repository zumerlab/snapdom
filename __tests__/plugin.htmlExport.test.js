import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { htmlExport } from '../packages/plugins/html-export.js'

describe('htmlExport plugin', () => {
  let el

  beforeEach(() => {
    el = document.createElement('div')
    el.style.cssText = 'width:120px;height:60px;background:#3344ff;color:#fff;font-size:14px;padding:8px'
    el.innerHTML = '<span class="mark">Hello SnapDOM</span>'
    document.body.appendChild(el)
  })

  afterEach(() => {
    el.remove()
  })

  /* ── Plugin shape ───────────────────────────── */

  it('returns a valid plugin exposing an html export', () => {
    const p = htmlExport()
    expect(p.name).toBe('html-export')
    expect(typeof p.defineExports).toBe('function')
    expect(typeof p.defineExports().html).toBe('function')
  })

  it('exposes result.toHtml()', async () => {
    const result = await snapdom(el, { plugins: [htmlExport()] })
    expect(typeof result.toHtml).toBe('function')
  })

  /* ── Output shape ───────────────────────────── */

  it('returns a full HTML document by default', async () => {
    const result = await snapdom(el, { plugins: [htmlExport()] })
    const html = await result.toHtml()
    expect(typeof html).toBe('string')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<style>')
    expect(html).toContain('Hello SnapDOM')
  })

  it('returns a bare fragment when fullDocument:false', async () => {
    const result = await snapdom(el, { plugins: [htmlExport()] })
    const html = await result.toHtml({ fullDocument: false })
    expect(html).not.toContain('<!DOCTYPE html>')
    expect(html.trimStart().startsWith('<style>')).toBe(true)
    expect(html).toContain('Hello SnapDOM')
  })

  it('embeds the captured styles inline (no external refs)', async () => {
    const result = await snapdom(el, { plugins: [htmlExport()] })
    const html = await result.toHtml()
    // background color of the captured element should be inlined as a rule/style
    expect(html).toMatch(/rgb\(51,\s*68,\s*255\)|#3344ff/i)
    // no <link rel=stylesheet> or remote url() left dangling
    expect(html).not.toContain('<link')
  })

  /* ── Re-rendering fidelity ──────────────────── */

  it('produced document renders the original text in an isolated iframe', async () => {
    const result = await snapdom(el, { plugins: [htmlExport()] })
    const html = await result.toHtml()

    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'width:200px;height:120px;border:0'
    document.body.appendChild(iframe)
    await new Promise((res) => { iframe.onload = res; iframe.srcdoc = html })
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

    const doc = iframe.contentDocument
    expect(doc.body.textContent).toContain('Hello SnapDOM')
    // the original mark element survived the round-trip
    expect(doc.querySelector('.mark')).not.toBeNull()
    iframe.remove()
  })
})
