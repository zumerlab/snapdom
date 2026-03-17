// __tests__/core.exporters.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  normalizeExporter,
  registerExporters,
  getExporter,
  _exportersMap,
  _clearExporters,
  runExportHooks
} from '../src/core/exporters.js'

beforeEach(() => {
  _clearExporters()
})

describe('normalizeExporter', () => {
  it('returns null for falsy spec', () => {
    expect(normalizeExporter(null)).toBeNull()
    expect(normalizeExporter(undefined)).toBeNull()
  })

  it('handles array [factory, options]', () => {
    const inst = { format: 'test', export: () => {} }
    const factory = vi.fn(() => inst)
    const opts = { foo: 1 }
    expect(normalizeExporter([factory, opts])).toBe(inst)
    expect(factory).toHaveBeenCalledWith(opts)
  })

  it('handles array with non-function factory (returns as-is)', () => {
    const inst = { format: 'x' }
    expect(normalizeExporter([inst, {}])).toBe(inst)
  })

  it('handles object { exporter, options }', () => {
    const inst = { format: 'obj' }
    const factory = vi.fn(() => inst)
    expect(normalizeExporter({ exporter: factory, options: { a: 1 } })).toBe(inst)
    expect(factory).toHaveBeenCalledWith({ a: 1 })
  })

  it('handles function spec (calls it)', () => {
    const inst = { format: 'fn' }
    const fn = vi.fn(() => inst)
    expect(normalizeExporter(fn)).toBe(inst)
    expect(fn).toHaveBeenCalled()
  })

  it('handles plain object instance', () => {
    const inst = { format: 'plain' }
    expect(normalizeExporter(inst)).toBe(inst)
  })
})

describe('registerExporters', () => {
  it('registers single exporter by format', () => {
    const ex = { format: 'png', export: () => {} }
    registerExporters(ex)
    expect(getExporter('png')).toBe(ex)
    expect(getExporter('PNG')).toBe(ex)
  })

  it('registers exporter with array of formats', () => {
    const ex = { format: ['png', 'image/png'], export: () => {} }
    registerExporters(ex)
    expect(getExporter('png')).toBe(ex)
    expect(getExporter('image/png')).toBe(ex)
  })

  it('last wins on format collision', () => {
    const a = { format: 'x', export: () => {} }
    const b = { format: 'x', export: () => {} }
    registerExporters(a)
    registerExporters(b)
    expect(getExporter('x')).toBe(b)
  })

  it('flattens defs and skips empty format', () => {
    const ex = { format: 'ok', export: () => {} }
    registerExporters([ex], null)
    expect(getExporter('ok')).toBe(ex)
  })

  it('_exportersMap returns copy', () => {
    registerExporters({ format: 't', export: () => {} })
    const m = _exportersMap()
    expect(m.get('t')).toBeDefined()
    m.clear()
    expect(getExporter('t')).toBeDefined()
  })
})

describe('getExporter', () => {
  it('returns null for empty format', () => {
    expect(getExporter('')).toBeNull()
    expect(getExporter(null)).toBeNull()
  })

  it('returns null for unknown format', () => {
    expect(getExporter('unknown')).toBeNull()
  })

  it('is case-insensitive', () => {
    const ex = { format: 'Test', export: () => {} }
    registerExporters(ex)
    expect(getExporter('test')).toBe(ex)
    expect(getExporter('  TEST  ')).toBe(ex)
  })
})

describe('runExportHooks', () => {
  it('runs work and returns result', async () => {
    const ctx = { export: { type: 'png', options: {}, url: null } }
    const result = { ok: true }
    const work = vi.fn().mockResolvedValue(result)
    const out = await runExportHooks(ctx, work)
    expect(out).toBe(result)
    expect(ctx.export.result).toBe(result)
  })

  it('calls beforeExport and afterExport via plugins', async () => {
    const beforeSpy = vi.fn()
    const afterSpy = vi.fn()
    const afterSnapSpy = vi.fn()
    const plugin = {
      name: 'test-hooks',
      beforeExport: beforeSpy,
      afterExport: afterSpy,
      afterSnap: afterSnapSpy
    }

    const ctx = { export: { type: 'png', options: {}, url: 'https://example.com/capture' }, plugins: [plugin] }
    const work = vi.fn().mockResolvedValue('done')
    await runExportHooks(ctx, work)

    // runHook passes (context, payload); payload is undefined for these hooks
    expect(beforeSpy).toHaveBeenCalledWith(ctx, undefined)
    expect(afterSpy).toHaveBeenCalledWith(ctx, undefined)
    expect(afterSnapSpy).toHaveBeenCalledWith(ctx, undefined)
  })

  it('calls afterSnap only once per url', async () => {
    const afterSnapSpy = vi.fn()
    const plugin = { name: 'snap-once', afterSnap: afterSnapSpy }

    const url = 'https://unique-' + Date.now()
    const ctx = { export: { url }, plugins: [plugin] }
    await runExportHooks(ctx, () => Promise.resolve(1))
    await runExportHooks(ctx, () => Promise.resolve(2))

    expect(afterSnapSpy).toHaveBeenCalledTimes(1)
  })
})
