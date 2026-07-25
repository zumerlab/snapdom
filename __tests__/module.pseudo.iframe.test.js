import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

// Elements from a same-origin iframe belong to that iframe's realm, so
// `instanceof Element` against the parent window's Element is false and every
// guard using it silently bailed — dropping ::before/::after (and picture/icon
// handling) from iframe-body captures. Guards now use nodeType checks.

function makeIframe(html) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'width:240px;height:120px;border:0'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument
  doc.open()
  doc.write(html)
  doc.close()
  return iframe
}

describe('pseudo-elements inside same-origin iframes', () => {
  afterEach(() => {
    document.querySelectorAll('iframe').forEach((f) => f.remove())
  })

  it('captures a ::before label on an element inside the iframe body', async () => {
    const iframe = makeIframe(`<!DOCTYPE html><html><head><style>
      .box { position: relative; margin-top: 20px; border: 1px solid #000; }
      .box::before { content: 'IFRAME-LABEL'; position: absolute; top: -10px; left: 8px; background: #2D5BFF; color: #fff; }
    </style></head><body><div class="box">content</div></body></html>`)
    const target = iframe.contentDocument.body
    expect(target instanceof Element).toBe(false) // cross-realm precondition

    const result = await snapdom(target)
    const svg = decodeURIComponent(result.url.split(',')[1])
    expect(svg).toContain('IFRAME-LABEL')
  })
})
