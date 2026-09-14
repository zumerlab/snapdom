// The differential path deliberately handles only subtree-local work. These cases need
// whole-tree preparation (viewport anchoring, top-layer lifting, selection composition,
// and per-tag/root fixups), so correctness means declining the diff and producing exactly
// the same frame as an explicit full capture.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { __diffStats, tryDiffCapture } from '../src/core/diff.js'
import { createContext } from '../src/core/context.js'

const OPTS = { burst: true, dpr: 1, scale: 1, embedFonts: false, compress: false }

afterEach(() => {
  try {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close()
    for (const popover of document.querySelectorAll('[popover]')) {
      if (popover.matches(':popover-open')) popover.hidePopover()
    }
  } catch { /* element may already have been detached */ }
  window.getSelection()?.removeAllRanges()
  document.head.querySelectorAll('style[data-diff-bailout]').forEach((node) => node.remove())
  document.body.innerHTML = ''
})

beforeEach(() => {
  __diffStats.attempts = 0
  __diffStats.served = 0
})

function nestedRoot(css = '') {
  const root = document.createElement('div')
  root.style.cssText = `width:320px;height:180px;background:white;color:black;${css}`
  const shell = document.createElement('section')
  const inner = document.createElement('div')
  shell.appendChild(inner)
  root.appendChild(shell)
  document.body.appendChild(root)
  return { root, inner }
}

async function prime(root, options = {}) {
  const opts = { ...OPTS, ...options }
  const first = await snapdom(root, opts)
  const memo = await snapdom(root, opts)
  expect(memo).toBe(first)
  return opts
}

async function pixels(result) {
  const canvas = await result.toCanvas({ dpr: 1, scale: 1 })
  return {
    width: canvas.width,
    height: canvas.height,
    data: canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data,
  }
}

async function expectSamePixels(actual, oracle) {
  const a = await pixels(actual)
  const b = await pixels(oracle)
  expect([a.width, a.height]).toEqual([b.width, b.height])
  let differing = 0
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > 8 ||
        Math.abs(a.data[i + 1] - b.data[i + 1]) > 8 ||
        Math.abs(a.data[i + 2] - b.data[i + 2]) > 8 ||
        Math.abs(a.data[i + 3] - b.data[i + 3]) > 8) differing++
  }
  expect(differing).toBe(0)
}

async function expectFullFallback(root, opts, mutate, { attempt = 'required' } = {}) {
  const attempts = __diffStats.attempts
  const served = __diffStats.served
  await mutate()
  await new Promise((resolve) => setTimeout(resolve, 0))

  const actual = await snapdom(root, opts)
  const oracle = await snapdom(root, { ...opts, burst: false })
  expect(actual.url).toBe(oracle.url)
  await expectSamePixels(actual, oracle)
  if (attempt === 'required') expect(__diffStats.attempts).toBe(attempts + 1)
  else {
    expect(__diffStats.attempts).toBeGreaterThanOrEqual(attempts)
    expect(__diffStats.attempts).toBeLessThanOrEqual(attempts + 1)
  }
  expect(__diffStats.served).toBe(served)
}

describe('differential recapture whole-tree bailouts', () => {
  it('bails when a scrolled capture root needs fixed-position anchoring', async () => {
    const { root, inner } = nestedRoot('overflow:auto;position:relative')
    inner.style.height = '500px'
    const fixed = document.createElement('div')
    fixed.style.cssText = 'position:fixed;left:24px;top:24px;width:120px;height:40px;background:#f20;color:white'
    fixed.textContent = 'before'
    inner.appendChild(fixed)
    root.scrollTop = 80
    // Let the browser's deferred scroll event land before burst starts tracking the root.
    await new Promise((resolve) => requestAnimationFrame(() => resolve()))

    const opts = await prime(root)
    await expectFullFallback(root, opts, () => { fixed.textContent = 'after' })
  })

  it('bails while a nested modal requires top-layer lifting and a backdrop', async () => {
    const style = document.createElement('style')
    style.dataset.diffBailout = ''
    style.textContent = 'dialog::backdrop{background:rgba(0,0,180,.75)}'
    document.head.appendChild(style)

    const { root, inner } = nestedRoot()
    const dialog = document.createElement('dialog')
    dialog.style.cssText = 'width:140px;height:60px;background:#ff0;color:#000'
    dialog.textContent = 'modal'
    inner.appendChild(dialog)
    const changing = document.createElement('span')
    changing.textContent = 'before'
    inner.appendChild(changing)
    dialog.showModal()
    await new Promise((resolve) => requestAnimationFrame(() => resolve()))

    const opts = await prime(root)
    // WebKit's top-layer render-state signature can widen this to a full frame before
    // diff is attempted. Either route is correct; neither may serve a differential frame.
    await expectFullFallback(root, opts, () => { changing.textContent = 'after' }, { attempt: 'optional' })
  })

  it('bails while a nested popover requires top-layer lifting', async () => {
    const { root, inner } = nestedRoot()
    const popover = document.createElement('div')
    popover.setAttribute('popover', 'manual')
    popover.style.cssText = 'width:140px;height:60px;background:#0af;color:#000'
    popover.textContent = 'popover'
    inner.appendChild(popover)
    const changing = document.createElement('span')
    changing.textContent = 'before'
    inner.appendChild(changing)
    popover.showPopover()
    await new Promise((resolve) => requestAnimationFrame(() => resolve()))

    const opts = await prime(root)
    await expectFullFallback(root, opts, () => { changing.textContent = 'after' }, { attempt: 'optional' })
  })

  it('bails when captureSelection needs to rebuild selection paint', async () => {
    const style = document.createElement('style')
    style.dataset.diffBailout = ''
    style.textContent = '.selected::selection{background:rgb(255,0,120);color:white}'
    document.head.appendChild(style)

    const { root, inner } = nestedRoot()
    const selected = document.createElement('span')
    selected.style.cssText = 'font:24px Arial'
    selected.textContent = 'selected words'
    inner.appendChild(selected)

    const range = document.createRange()
    range.selectNodeContents(selected)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
    // Selection capture is now excluded at the memo boundary too. Keep a direct guard on
    // diff's own defence: it must bail before consulting any retained style artefact.
    let inspectedRetainedStyles = 0
    const direct = await tryDiffCapture(root, {
      retained: {
        clone: root.cloneNode(true),
        srcToClone: new Map(),
        styleMap: { values() { inspectedRetainedStyles++; return [][Symbol.iterator]() } },
      },
    }, createContext({ captureSelection: true }))
    expect(direct).toBeNull()
    expect(inspectedRetainedStyles).toBe(0)

    const opts = { ...OPTS, captureSelection: true }
    const first = await snapdom(root, opts)
    const fresh = await snapdom(root, opts)
    expect(fresh).not.toBe(first)
    await expectFullFallback(root, opts, () => { selected.className = 'selected' }, { attempt: 'optional' })
  })

  it('bails when a rebuilt PRE needs the full-pipeline margin reset', async () => {
    const { root, inner } = nestedRoot()
    const pre = document.createElement('pre')
    pre.style.cssText = 'font:20px monospace;background:#f90;margin:32px 0 0'
    pre.textContent = 'before'
    inner.appendChild(pre)

    const opts = await prime(root)
    await expectFullFallback(root, opts, () => { pre.textContent = 'after' })
  })

  it('bails when backdrop-filter pre-composition is present in the retained tree', async () => {
    const { root, inner } = nestedRoot('background:repeating-linear-gradient(90deg,#000 0 8px,#fff 8px 16px)')
    const frosted = document.createElement('div')
    frosted.style.cssText = 'width:220px;height:80px;background:rgba(255,255,255,.2);backdrop-filter:blur(8px)'
    const changing = document.createElement('span')
    changing.textContent = 'before'
    frosted.appendChild(changing)
    inner.appendChild(frosted)

    const opts = await prime(root)
    await expectFullFallback(root, opts, () => { changing.textContent = 'after' })
  })

  it('bails when the dirty subtree newly activates backdrop-filter', async () => {
    const style = document.createElement('style')
    style.dataset.diffBailout = ''
    style.textContent = '.new-frost{backdrop-filter:blur(8px)}'
    document.head.appendChild(style)

    const { root, inner } = nestedRoot('background:repeating-linear-gradient(90deg,#000 0 8px,#fff 8px 16px)')
    const frosted = document.createElement('div')
    frosted.style.cssText = 'width:220px;height:80px;background:rgba(255,255,255,.2)'
    frosted.textContent = 'frost later'
    inner.appendChild(frosted)

    const opts = await prime(root)
    await expectFullFallback(root, opts, () => { frosted.className = 'new-frost' })
  })

  it('checks retained backdrop-filter styles only once', async () => {
    const { root } = nestedRoot()
    let scans = 0
    const styleMap = new Map([[root, 'display:block;backdrop-filter:blur(4px);']])
    styleMap.values = () => {
      scans++
      return Map.prototype.values.call(styleMap)
    }
    const state = {
      retained: {
        clone: root.cloneNode(true),
        srcToClone: new Map(),
        styleMap,
      },
    }
    const context = createContext({})

    expect(await tryDiffCapture(root, state, context)).toBeNull()
    expect(await tryDiffCapture(root, state, context)).toBeNull()
    expect(scans).toBe(1)
  })

  it('runs a full capture when pure early lifecycle hooks cannot run in diff', async () => {
    const { root, inner } = nestedRoot()
    let beforeSnapCalls = 0
    let beforeCloneCalls = 0
    const opts = await prime(root, {
      plugins: [{
        name: 'early-lifecycle',
        pure: true,
        beforeSnap() { beforeSnapCalls++ },
        beforeClone() { beforeCloneCalls++ },
      }],
    })
    expect([beforeSnapCalls, beforeCloneCalls]).toEqual([1, 1])

    await expectFullFallback(root, opts, () => { inner.textContent = 'changed' })
    // The actual full fallback and the explicit-full oracle each run both hooks.
    expect([beforeSnapCalls, beforeCloneCalls]).toEqual([3, 3])
  })
})
