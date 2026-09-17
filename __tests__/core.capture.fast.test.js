// fast: false | 'auto' (#503). A capture of an ArcGIS feature table held the main thread for
// its whole clone, one 480 ms task, and the page stopped painting and taking input. v2's
// `fast: false` fixed that for the reporter at 45% more time; v3 slices by time budget instead
// (createSlicer). What has to hold: the default never yields, a yielding capture renders the
// same bytes, and a watched capture whose page changed while it yielded is redone in one task.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index.js'
import { createSlicer } from '../src/utils/browser.js'
import { createContext } from '../src/core/context.js'

const mounted = []
const channels = []
afterEach(() => {
  while (mounted.length) mounted.pop().remove()
  while (channels.length) {
    const channel = channels.pop()
    channel.port1.close()
    channel.port2.close()
  }
  vi.restoreAllMocks()
})

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

/** Spend a slice after the first block was cloned, then mutate in the next pause. A tiny
 * scene plus one deliberately slow native clone makes this independent of machine speed.
 * A listener registered before the slicer's resume handler injects the external mutation
 * in that real message task. Separate timer/message queues have no portable ordering. */
function changeDuringPause(el, mutate) {
  const spacer = el.children[1]
  const cloneNode = spacer.cloneNode.bind(spacer)
  const NativeChannel = window.MessageChannel
  const observation = { armed: false, ran: false }
  vi.spyOn(window, 'MessageChannel').mockImplementation(function () {
    const channel = new NativeChannel()
    channels.push(channel)
    channel.port1.addEventListener('message', () => {
      if (!observation.armed || observation.ran) return
      mutate()
      observation.ran = true
    })
    return channel
  })
  vi.spyOn(spacer, 'cloneNode').mockImplementation((deep) => {
    const clone = cloneNode(deep)
    if (!observation.armed) {
      observation.armed = true
      const end = performance.now() + 45
      while (performance.now() < end) { /* exceed false's 16 ms and auto's 40 ms */ }
    }
    return clone
  })
  return observation
}

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

  it('auto allows 40 ms before its first pause, then uses 16 ms slices', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const slicer = createSlicer('auto')
    now = 39
    expect(slicer.due()).toBe(false)
    now = 40
    expect(slicer.due()).toBe(true)
    await slicer.pause()
    now = 55
    expect(slicer.due()).toBe(false)
    now = 56
    expect(slicer.due()).toBe(true)
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

  it('renders the same bytes whether the clone yields or not', async () => {
    const el = scene()
    const whole = await snapdom(el, { burst: false, cache: 'disabled' })
    const sliced = await snapdom(el, { fast: false, burst: false, cache: 'disabled' })
    expect(sliced.url).toBe(whole.url)
  })

  it.each([false, 'auto'])('redoes a torn clone with fast: %s and renders the final state', async (fast) => {
    const el = scene(0)
    const first = el.querySelector('#first')
    const last = el.querySelector('#last')
    const firstClones = vi.spyOn(first, 'cloneNode')
    const change = changeDuringPause(el, () => {
      first.style.background = 'rgb(0,0,255)'
      last.style.background = 'rgb(0,0,255)'
      first.textContent = 'after'
      last.textContent = 'after'
      el.style.width = '360px'
    })
    let watched = false
    let changedByAfterClone = false
    const probe = {
      name: 'watch-torn-capture',
      pure: true,
      beforeClone(ctx) { watched = typeof ctx.__tornSinceStart === 'function' },
      afterClone() { changedByAfterClone = change.ran },
    }
    const res = await snapdom(el, { fast, cache: 'disabled', dpr: 1, plugins: [probe] })
    expect(watched).toBe(true)
    expect(changedByAfterClone).toBe(true)
    expect(firstClones).toHaveBeenCalledTimes(2)
    const canvas = await res.toCanvas()
    expect(canvas.width).toBe(360)
    expect(canvas.height).toBe(120)
    expect(pixel(canvas, 20, 20)).toEqual(BLUE)
    expect(pixel(canvas, 20, 100)).toEqual(BLUE)
    const svg = new DOMParser().parseFromString(decodeURIComponent(res.url.split(',')[1]), 'image/svg+xml')
    expect(svg.getElementById('first').textContent).toBe('after')
    expect(svg.getElementById('last').textContent).toBe('after')
  })

  // This matrix records the watcher's eligibility boundary, not approval of torn output.
  // Non-memoizable captures still need independent change detection before auto is safe as
  // a default. An actual pause and its raster outcome are covered for eligible trees above.
  it.each([
    ['static tree', {}, null, true],
    ['burst disabled', { burst: false }, null, false],
    ['canvas', {}, 'canvas', false],
    ['video', {}, 'video', false],
    ['iframe', {}, 'iframe', false],
    ['filter callback', { filter: () => true }, null, false],
    ['exclude callback', { exclude: [() => false] }, null, false],
    ['style callback', { excludeStyleProps: () => false }, null, false],
    ['fallback callback', { fallbackURL: () => null }, null, false],
    ['selection', { captureSelection: true }, null, false],
    ['impure plugin', {}, null, false],
  ])('exposes the mid-capture watcher boundary for %s', async (name, options, tag, watched) => {
    const el = scene(0)
    if (tag) {
      const opaque = document.createElement(tag)
      opaque.style.display = 'none'
      el.appendChild(opaque)
    }
    let hasWatcher = null
    const probe = {
      name: 'watch-eligibility',
      pure: name !== 'impure plugin',
      beforeClone(ctx) {
        if (ctx.element === el) hasWatcher = typeof ctx.__tornSinceStart === 'function'
      },
    }
    await snapdom(el, { fast: false, cache: 'disabled', ...options, plugins: [probe] })
    expect(hasWatcher).toBe(watched)
  })

  it.todo('auto does not yield without a mid-capture change detector')
  it.todo('auto does not expose stabilizeLayout root geometry changes during a pause')
  it.todo('fast: false refreshes a non-memoizable clone when its source changes during a pause')
})
