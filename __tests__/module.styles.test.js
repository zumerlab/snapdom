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
})
