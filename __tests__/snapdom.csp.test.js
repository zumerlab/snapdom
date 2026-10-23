import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

let host
afterEach(() => host?.remove())

// The frame's own sheet carries the nonce; snapdom's CSS cannot, so an inline <style> from
// it is refused the way a strict-CSP app refuses it.
async function mountFrame(csp) {
  host = document.createElement('div')
  const frame = document.createElement('iframe')
  frame.style.cssText = 'width:400px;height:300px;border:0;display:block'
  const meta = csp ? '<meta http-equiv="Content-Security-Policy" content="style-src \'self\' \'nonce-sd\'">' : ''
  frame.srcdoc = `<!doctype html><html><head>${meta}<style nonce="sd">body{margin:0}.r{height:4px;line-height:4px;font-size:4px;overflow:hidden}</style></head>` +
    `<body>${'<div class="r">x</div>'.repeat(20)}</body></html>`
  host.appendChild(frame)
  await new Promise(resolve => { frame.onload = resolve; document.body.appendChild(host) })
  const doc = frame.contentDocument
  const violations = []
  doc.addEventListener('securitypolicyviolation', e => violations.push(e.violatedDirective))
  return { doc, violations }
}

async function capture(target, violations, options) {
  const canvas = await snapdom.toCanvas(target, { dpr: 1, embedFonts: false, cache: 'disabled', ...options })
  // Violation events are queued as tasks.
  await new Promise(r => setTimeout(r, 0))
  return { w: canvas.width, h: canvas.height, violations }
}

async function measureBody(csp, options) {
  const { doc, violations } = await mountFrame(csp)
  const out = await capture(doc.body, violations, options)
  host.remove()
  return out
}

describe("measurement mounts under CSP style-src 'self'", () => {
  it('a body capture keeps its size and logs no violation', async () => {
    const open = await measureBody(false)
    const strict = await measureBody(true)
    expect(strict.violations).toEqual([])
    expect(strict.h).toBe(open.h)
    expect(strict.w).toBe(open.w)
  })

  it('reconcile adds no violation', async () => {
    const strict = await measureBody(true, { reconcile: true })
    expect(strict.violations).toEqual([])
  })

  it('the iframe viewport pin adds no violation inside a strict frame', async () => {
    const { violations } = await mountFrame(true)
    const strict = await capture(host, violations)
    expect(strict.violations).toEqual([])
    expect(strict.h).toBe(300)
  })
})
