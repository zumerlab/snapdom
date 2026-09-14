// An entry animation whose 0% keyframe hides the element (opacity:0 / transform)
// must not blank it out in the capture: the clone must render the element's
// CURRENT (post-animation) frame, not replay the animation from 0%.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'

const added = []
function mount(el) { document.body.appendChild(el); added.push(el); return el }
afterEach(() => { while (added.length) added.pop().remove(); window.scrollTo(0, 0) })

describe('entry keyframe animations do not blank the captured element', () => {
  it('a fixed element that finished a fade-in (opacity 0→1) is captured opaque', async () => {
    const style = mount(document.createElement('style'))
    style.textContent =
      '@keyframes snapFadeIn { from { opacity: 0; transform: scale(0.9) translateY(10px); } to { opacity: 1; transform: none; } }'
    const box = mount(document.createElement('div'))
    box.style.cssText =
      'position:fixed;left:20px;top:20px;width:60px;height:60px;background:rgb(0, 0, 255);z-index:9999;margin:0;animation:snapFadeIn 60ms ease both;'

    // Let the entry animation finish so the LIVE element is fully opaque.
    await Promise.all(box.getAnimations().map((a) => a.finished))
    expect(getComputedStyle(box).opacity).toBe('1')

    const canvas = await snapdom.toCanvas(document.body, { clip: 'viewport', dpr: 1 })
    const ctx = canvas.getContext('2d')
    const sx = canvas.width / window.innerWidth
    const sy = canvas.height / window.innerHeight
    const px = ctx.getImageData(Math.round(50 * sx), Math.round(50 * sy), 1, 1).data

    // Without the fix the clone replays snapFadeIn from 0% (opacity:0) → transparent → blank.
    expect(px[2]).toBeGreaterThan(200) // blue channel present
    expect(px[0]).toBeLessThan(60)
    expect(px[3]).toBeGreaterThan(200) // fully opaque, not the 0% frame
  })

  it('preserves native suppression when a painted pseudo is currently display:none', async (ctx) => {
    const style = mount(document.createElement('style'))
    style.textContent = `
      @keyframes snapPseudoDisappear {
        from { display: block; }
        to { display: none; }
      }
      .animated-pseudo::before {
        content: "";
        display: block;
        width: 60px;
        height: 60px;
        background: rgb(255, 0, 0);
        animation: snapPseudoDisappear 10s linear both;
      }
    `
    const box = mount(document.createElement('div'))
    box.className = 'animated-pseudo'
    box.style.cssText = 'width:60px;height:60px;background:white;margin:0;'
    const [animation] = box.getAnimations({ subtree: true })
    animation.currentTime = 10000
    animation.pause()
    // Gecko does not animate `display` in keyframes, so the pseudo never becomes
    // non-generated there and the scenario cannot be set up: skip, not fail.
    if (getComputedStyle(box, '::before').display !== 'none') ctx.skip()
    // The non-generated fast path must retain the suppression marker that the
    // previous materialization path added, or cloned CSS can replay the red frame.

    const canvas = await snapdom.toCanvas(document.body, { dpr: 1 })
    const pixel = canvas.getContext('2d').getImageData(30, 30, 1, 1).data

    expect([...pixel]).toEqual([255, 255, 255, 255])
  })
})
