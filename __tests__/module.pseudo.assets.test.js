// The ::before/::after asset pipeline: masks and background images must go through the
// same inlining (and the same options) as element-level ones. Kept out of
// module.pseudo.test.js on purpose — that file mocks inlineSingleBackgroundEntry, which
// is exactly the machinery under test here.
import { describe, it, expect, vi, afterEach } from 'vitest'

const requests = []
vi.mock('../src/modules/snapFetch.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    snapFetch: vi.fn(async (url, opts) => {
      requests.push({ url: String(url), useProxy: opts && opts.useProxy })
      return { ok: false, data: null, status: 0, fromCache: false, url: String(url) }
    }),
  }
})

const { snapdom } = await import('../src/api/snapdom.js')

afterEach(() => {
  document.head.querySelectorAll('style[data-pa-test]').forEach((s) => s.remove())
  document.body.innerHTML = ''
})

function mount(css, html = '<div class="zzm"></div>') {
  const style = document.createElement('style')
  style.setAttribute('data-pa-test', '')
  style.textContent = css
  document.head.appendChild(style)
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

async function blueInk(host) {
  const res = await snapdom(host, { cache: 'disabled', dpr: 1, scale: 1 })
  const c = await res.toCanvas()
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let n = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] > 170 && d[i + 3] > 40) n++
  }
  return n
}

describe('pseudo-element assets', () => {
  // The style reset blanks maskImage so a stale mask cannot leak in, but nothing restored
  // it — every masked icon pseudo (the standard way to tint an SVG icon) captured as a
  // solid rectangle. Controls: the element path (always correct) and an unmasked pseudo.
  it('a masked ::before keeps its mask', async () => {
    const MASK = 'linear-gradient(to right, black 0 50%, transparent 50% 100%)'
    const shapes = {
      unmaskedPseudo: '.zzm::before { content:""; display:block; width:80px; height:40px; background:rgb(0,0,255) }',
      maskedElement: `.zzm { width:80px; height:40px; background:rgb(0,0,255); -webkit-mask-image:${MASK}; mask-image:${MASK} }`,
      maskedPseudo: `.zzm::before { content:""; display:block; width:80px; height:40px; background:rgb(0,0,255); -webkit-mask-image:${MASK}; mask-image:${MASK} }`,
    }
    const ink = {}
    for (const [key, css] of Object.entries(shapes)) {
      const host = mount(css)
      ink[key] = await blueInk(host)
      host.remove()
      document.head.querySelectorAll('style[data-pa-test]').forEach((s) => s.remove())
    }
    expect(ink.maskedElement).toBeLessThan(ink.unmaskedPseudo * 0.75)
    expect(ink.maskedPseudo).toBeLessThan(ink.unmaskedPseudo * 0.75)
  })

  // `bgSplits.map(inlineSingleBackgroundEntry)` passed map's INDEX where options belongs,
  // so useProxy/CORS settings never reached a pseudo background. The element in the same
  // scene is the control: it always proxied correctly.
  it('useProxy reaches ::before backgrounds, not just element ones', async () => {
    const REMOTE = 'https://cross.example.invalid/img.png'
    const host = mount(
      `.zzp::before { content:""; display:block; width:20px; height:20px; background-image:url("${REMOTE}") }`,
      `<div class="zzp"></div><div style="width:20px;height:20px;background-image:url('${REMOTE}')"></div>`
    )
    requests.length = 0
    await snapdom(host, { cache: 'disabled', useProxy: 'https://myproxy.test/?u=' })
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.filter((r) => !r.useProxy)).toEqual([])
  })
})
