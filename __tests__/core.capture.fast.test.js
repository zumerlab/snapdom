// fast: false | 'auto' (#503). A capture of an ArcGIS feature table held the main thread for
// its whole clone, one 480 ms task, and the page stopped painting and taking input. v2's
// `fast: false` fixed that for the reporter at 45% more time; v3 slices by time budget instead
// (createSlicer). What has to hold: the default never yields, a yielding capture renders the
// same bytes, and a capture whose page changed while it yielded is redone in one task.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { createSlicer } from '../src/utils/browser.js'
import { createContext } from '../src/core/context.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

const BLUE = [0, 0, 255]

/** A 40px #first and #last block around `sections` x 5 filler elements. 600 outlast a 16 ms
 *  slice on every engine; chromium and webkit clone them inside auto's 40 ms, hence 2400
 *  there. `cache: 'disabled'` keeps each capture cold. */
function scene(sections = 600) {
  const root = document.createElement('div')
  root.style.cssText = 'width:320px;background:#fff'
  const block = (id) => {
    const b = document.createElement('div')
    b.id = id
    b.style.cssText = 'width:40px;height:40px;background:rgb(255,0,0)'
    return b
  }
  const filler = document.createElement('div')
  filler.style.cssText = 'height:40px;overflow:hidden'
  let html = ''
  for (let i = 0; i < sections; i++) html += `<section style="padding:${i % 3}px"><p><b>${i}</b><i>x</i><span>y</span></p></section>`
  filler.innerHTML = html
  root.append(block('first'), filler, block('last'))
  document.body.appendChild(root)
  mounted.push(root)
  return root
}

/** Whether a timer queued when the clone stage starts has run by the time it ends. */
async function yieldedDuringClone(el, fast) {
  let fired = false
  let firedByAfterClone = null
  const probe = {
    name: 'yield-probe',
    beforeClone() { setTimeout(() => { fired = true }, 0) },
    afterClone() { firedByAfterClone = fired },
  }
  await snapdom(el, { fast, burst: false, cache: 'disabled', plugins: [probe] })
  return firedByAfterClone
}

const pixel = (canvas, x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3))

describe('createSlicer', () => {
  it('is null unless fast is false or auto', () => {
    expect(createSlicer(true)).toBe(null)
    expect(createSlicer(undefined)).toBe(null)
    expect(createSlicer('yes')).toBe(null)
  })

  it('shares one pause between walks and starts a fresh slice after it', async () => {
    const slicer = createSlicer(false)
    expect(slicer.due()).toBe(false)
    const end = performance.now() + 20
    while (performance.now() < end) { /* spend the slice */ }
    expect(slicer.due()).toBe(true)
    const pause = slicer.pause()
    expect(slicer.pause()).toBe(pause)
    await pause
    expect(slicer.yielded).toBe(true)
    expect(slicer.due()).toBe(false)
  })
})

describe('fast option', () => {
  it('normalizes to true, false or auto', () => {
    expect(createContext({}).fast).toBe(true)
    expect(createContext({ fast: false }).fast).toBe(false)
    expect(createContext({ fast: 'auto' }).fast).toBe('auto')
    expect(createContext({ fast: 'yes' }).fast).toBe(true)
  })

  it('yields during a long clone with false and auto, never with the default', async () => {
    const el = scene(2400)
    expect(await yieldedDuringClone(el, undefined)).toBe(false)
    expect(await yieldedDuringClone(el, false)).toBe(true)
    expect(await yieldedDuringClone(el, 'auto')).toBe(true)
  })

  it('lets a short capture finish before auto ever yields', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:40px;height:40px;background:rgb(255,0,0)'
    document.body.appendChild(el)
    mounted.push(el)
    expect(await yieldedDuringClone(el, 'auto')).toBe(false)
  })

  it('renders the same bytes whether the clone yields or not', async () => {
    const el = scene()
    const whole = await snapdom(el, { burst: false, cache: 'disabled' })
    const sliced = await snapdom(el, { fast: false, burst: false, cache: 'disabled' })
    expect(sliced.url).toBe(whole.url)
  })

  // The redo relies on burst's watcher, so the probe has to be `pure` to keep burst engaged.
  it('redoes the clone in one task when the page changed while it yielded', async () => {
    const el = scene()
    const first = el.querySelector('#first')
    const last = el.querySelector('#last')
    let changed = false
    const mutate = {
      name: 'mutate-mid-capture',
      pure: true,
      beforeClone() {
        setTimeout(() => {
          first.style.background = 'rgb(0,0,255)'
          last.style.background = 'rgb(0,0,255)'
          changed = true
        }, 0)
      },
    }
    const res = await snapdom(el, { fast: false, cache: 'disabled', dpr: 1, plugins: [mutate] })
    expect(changed).toBe(true)
    const canvas = await res.toCanvas()
    // Torn, #first keeps the red it was cloned with and #last shows the blue it changed to.
    expect(pixel(canvas, 20, 20)).toEqual(BLUE)
    expect(pixel(canvas, 20, 100)).toEqual(BLUE)
  })
})
