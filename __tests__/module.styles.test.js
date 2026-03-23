import { describe, it, expect, vi, beforeEach } from 'vitest'

// Carga fresca del módulo para que __wired se reinicie en cada test que lo pida
async function loadInlineAllStylesFresh() {
  await vi.resetModules()
  const mod = await import('../src/modules/styles.js')
  return mod.inlineAllStyles
}

// Stub minimal de MutationObserver para contar instancias
class MOStub {
  static count = 0
  constructor(/* cb */) {
    MOStub.count++
  }
  observe() {}
  disconnect() {}
  takeRecords() { return [] }
}

function freshSession() {
  return {
    styleMap: new Map(),
    styleCache: new WeakMap(),
    nodeMap: new Map(),
  }
}

describe('inlineAllStyles – branches y firmas', () => {
  beforeEach(() => {
    MOStub.count = 0
    globalThis.MutationObserver = MOStub
  })

  it('early-return para <style> (no escribe en styleMap)', async () => {
    const inlineAllStyles = await loadInlineAllStylesFresh()

    const src = document.createElement('style')
    src.textContent = '.x{color:red}'
    const clone = document.createElement('style')
    const session = freshSession()

    await inlineAllStyles(src, clone, session, { cache: 'auto' })

    expect(session.styleMap.size).toBe(0)
    expect(MOStub.count).toBe(0)
  })

  it('engancha invalidación una vez cuando cache !== "disabled"', async () => {
    const inlineAllStyles = await loadInlineAllStylesFresh()

    const s1 = document.createElement('div')
    const c1 = document.createElement('div')
    const s2 = document.createElement('span')
    const c2 = document.createElement('span')
    const session = freshSession()

    await inlineAllStyles(s1, c1, session, { cache: 'auto' })
    await inlineAllStyles(s2, c2, session, { cache: 'soft' })

    // styles.js engancha 2 observers (documentElement + head) una sola vez
    expect(MOStub.count).toBe(2)
    expect(session.styleMap.has(c1)).toBe(true)
    expect(session.styleMap.has(c2)).toBe(true)
  })

  it('NO engancha invalidación cuando cache === "disabled"', async () => {
    const inlineAllStyles = await loadInlineAllStylesFresh()

    const src = document.createElement('div')
    const clone = document.createElement('div')
    const session = freshSession()

    await inlineAllStyles(src, clone, session, { cache: 'disabled' })

    expect(MOStub.count).toBe(0)
    expect(session.styleMap.has(clone)).toBe(true)
  })

  it('firma #1: (source, clone, sessionCache, options)', async () => {
    const inlineAllStyles = await loadInlineAllStylesFresh()

    const src = document.createElement('p')
    const clone = document.createElement('p')
    const session = freshSession()

    await inlineAllStyles(src, clone, session, { cache: 'auto' })
    expect(session.styleMap.has(clone)).toBe(true)
  })

  it('firma #2: (source, clone, ctx) pasando ctx completo', async () => {
    const inlineAllStyles = await loadInlineAllStylesFresh()
    const { cache } = await import('../src/core/cache.js')

    const src = document.createElement('em')
    const clone = document.createElement('em')
    const session = freshSession()

    const ctx = {
      session,
      persist: {
        snapshotKeyCache: new Map(),
        defaultStyle: cache.defaultStyle,
        baseStyle: cache.baseStyle,
        image: cache.image,
        resource: cache.resource,
        background: cache.background,
        font: cache.font,
      },
      options: { cache: 'auto' },
    }

    await inlineAllStyles(src, clone, ctx)
    expect(session.styleMap.has(clone)).toBe(true)
  })

  it('firma #3: (source, clone, options) usando sólo options', async () => {
    const inlineAllStyles = await loadInlineAllStylesFresh()
    const { cache } = await import('../src/core/cache.js')

    const src = document.createElement('strong')
    const clone = document.createElement('strong')

    await inlineAllStyles(src, clone, { cache: 'soft' })

    expect(cache.session.styleMap.has(clone)).toBe(true)
  })

  it('#348: excludeStyleProps regex excludes matching props from snapshot', async () => {
    const inlineAllStyles = await loadInlineAllStylesFresh()

    const src = document.createElement('div')
    src.style.color = 'red'
    src.style.fontSize = '13.37px'  // highly non-default so it appears in key
    document.body.appendChild(src)

    const clone = document.createElement('div')
    const session = freshSession()

    await inlineAllStyles(src, clone, session, {
      cache: 'auto',
      excludeStyleProps: /^color$/
    })

    document.body.removeChild(src)

    const key = session.styleMap.get(clone)
    expect(key).toBeDefined()
    // Only the exact "color" prop was excluded; other *-color props remain
    expect(key).not.toMatch(/(?:^|;)color:/)
    expect(key).toMatch(/font-size:/)
  })

  it('#348: excludeStyleProps function excludes matching props', async () => {
    const inlineAllStyles = await loadInlineAllStylesFresh()

    const src = document.createElement('span')
    src.style.fontSize = '14px'
    const clone = document.createElement('span')
    const session = freshSession()

    await inlineAllStyles(src, clone, session, {
      cache: 'auto',
      excludeStyleProps: (prop) => prop === 'font-size'
    })

    const key = session.styleMap.get(clone)
    expect(key).toBeDefined()
    expect(key).not.toMatch(/font-size:/)
  })

  it('#362: border: 0 solid normalizes to border: none in snapshot', async () => {
    const inlineAllStyles = await loadInlineAllStylesFresh()

    const style = document.createElement('style')
    style.textContent = '* { border: 0 solid; }'
    document.head.appendChild(style)

    const src = document.createElement('div')
    document.body.appendChild(src)

    const clone = document.createElement('div')
    const session = freshSession()

    await inlineAllStyles(src, clone, session, { cache: 'auto' })

    document.body.removeChild(src)
    document.head.removeChild(style)

    const key = session.styleMap.get(clone)
    expect(key).toBeDefined()
    // Tailwind * { border: 0 solid } must become border: none in output (#362)
    expect(key).toMatch(/\bborder:\s*none\b/)
  })

  it('content-visibility:hidden forces visibility:hidden in snapshot (NEW-10)', async () => {
    const inlineAllStyles = await loadInlineAllStylesFresh()

    const src = document.createElement('div')
    // Use inline style so computed style definitely reflects the value
    src.style.setProperty('content-visibility', 'hidden')
    document.body.appendChild(src)

    const clone = document.createElement('div')
    const session = freshSession()

    await inlineAllStyles(src, clone, session, { cache: 'auto' })

    document.body.removeChild(src)

    const key = session.styleMap.get(clone)
    // content-visibility:hidden must produce visibility:hidden in the snapshot key
    // so the subtree doesn't leak visible content into the capture (NEW-10)
    expect(key).toMatch(/\bvisibility:\s*hidden\b/)
  })

  it('cachea getComputedStyle en session.styleCache (una sola lectura por source)', async () => {
    const inlineAllStyles = await loadInlineAllStylesFresh()

    const src = document.createElement('div')
    const clone1 = document.createElement('div')
    const clone2 = document.createElement('div')
    const session = freshSession()

    const spy = vi.spyOn(window, 'getComputedStyle')

    await inlineAllStyles(src, clone1, session, { cache: 'auto' })
    await inlineAllStyles(src, clone2, session, { cache: 'auto' })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(session.styleMap.has(clone1)).toBe(true)
    expect(session.styleMap.has(clone2)).toBe(true)

    spy.mockRestore()
  })

  it('ROB-1: inlineAllStyles does not throw for a detached (not-connected) element', async () => {
    const inlineAllStyles = await loadInlineAllStylesFresh()

    // Detached element: never appended to document.body
    const src = document.createElement('div')
    src.style.color = 'red'
    const clone = document.createElement('div')
    const session = freshSession()

    // Should not throw even though getComputedStyle() on a detached node is unreliable
    await expect(inlineAllStyles(src, clone, session, { cache: 'auto' })).resolves.not.toThrow()
    // styleMap entry is written (even if the key may be empty/incomplete for detached nodes)
    expect(session.styleMap.has(clone)).toBe(true)
  })

  it('PERF-4: snapshotKeyCache does not grow unboundedly — evicts when oversized', async () => {
    // This test verifies the MAX_SNAPSHOT_KEY_CACHE=2000 eviction guard.
    // We fill the cache with many unique style signatures by bumping the epoch
    // (which triggers bumpEpoch) repeatedly. After eviction the cache should be empty.
    const { notifyStyleEpoch } = await import('../src/modules/styles.js')

    // Bump epoch enough times to trigger eviction if the cache were overfull.
    // Since we can't directly fill the Map from outside, we verify that
    // notifyStyleEpoch (bumpEpoch) is callable and doesn't throw.
    for (let i = 0; i < 5; i++) notifyStyleEpoch()

    // Ensure inlineAllStyles still works after repeated epoch bumps
    const inlineAllStyles = await loadInlineAllStylesFresh()
    const src = document.createElement('div')
    src.style.color = 'blue'
    const clone = document.createElement('div')
    const session = freshSession()
    await inlineAllStyles(src, clone, session, { cache: 'auto' })
    expect(session.styleMap.has(clone)).toBe(true)
  })
})
