import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

// Under clip the font usage walk only looks at elements within 200px of the window: text far
// outside it is culled from the clone, so embedding its font is pure payload.

describe('clip: font embedding follows the window', () => {
  const nodes = []
  afterEach(() => { for (const n of nodes.splice(0)) n.remove() })

  it('embeds the font of text inside the window and skips one 5000px away', async () => {
    const style = document.createElement('style')
    style.textContent = `
      @font-face { font-family: 'ClipNearFam'; src: url(data:font/woff2;base64,TkVBUg==); }
      @font-face { font-family: 'ClipFarFam'; src: url(data:font/woff2;base64,RkFSRg==); }
    `
    document.head.appendChild(style)
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:absolute;left:0;top:0;width:300px'
    wrap.innerHTML = `
      <div style="font-family:ClipNearFam;height:40px">near</div>
      <div style="font-family:ClipFarFam;margin-top:5000px">far</div>
    `
    document.body.appendChild(wrap)
    nodes.push(style, wrap)

    const url = await snapdom.toRaw(wrap, { clip: { x: 0, y: 0, width: 300, height: 200 }, embedFonts: true, cache: 'disabled' })
    const svg = decodeURIComponent(url.split(',')[1])
    expect(svg).toContain('TkVBUg==')
    expect(svg).not.toContain('RkFSRg==')
  })
})
