// toContext(): compact, LLM-readable structure of the captured UI. Token economy and
// determinism are the contract: wrappers collapse, hidden content is skipped, output
// is stable for a stable DOM.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { contextExport } from '../packages/plugins/context-export.js'

function fixture() {
  const host = document.createElement('div')
  host.id = 'app'
  host.style.cssText = 'width:400px'
  host.innerHTML = `
    <div><div><h1>Panel de control</h1></div></div>
    <p>Estado del sistema: <strong>activo</strong></p>
    <div style="display:none">texto oculto</div>
    <form>
      <input type="text" placeholder="buscar" value="hola">
      <input type="checkbox" checked>
      <button aria-label="Enviar búsqueda">Ir</button>
    </form>
    <a href="/docs">Documentación</a>
  `
  document.body.appendChild(host)
  return host
}

describe('contextExport', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('outline carries structure, text, state and geometry — hidden content excluded', async () => {
    const res = await snapdom(fixture(), { plugins: [contextExport()] })
    const out = await res.toContext()
    expect(typeof out).toBe('string')
    expect(out).toContain('h1')
    expect(out).toContain('"Panel de control"')
    expect(out).toContain('{value=•••• hasValue placeholder=buscar}')
    expect(out).toContain('checked')
    expect(out).toContain('label=Enviar búsqueda')
    expect(out).toContain('href=/docs')
    expect(out).not.toContain('texto oculto')
    // Wrapper collapse: the double div around the h1 hoists away.
    expect(out).not.toMatch(/div\n\s+div\n\s+h1/)
    // Geometry present as [x,y wxh]
    expect(out).toMatch(/\[\d+,\d+ \d+x\d+\]/)
  })

  it('json format returns the tree with node count', async () => {
    const res = await snapdom(fixture(), { plugins: [contextExport()] })
    const out = await res.toContext({ format: 'json' })
    expect(out.root.tag).toBe('div')
    expect(out.nodes).toBeGreaterThan(3)
    expect(out.truncated).toBe(false)
  })

  it('output is deterministic for a stable DOM (agent verification loops)', async () => {
    const host = fixture()
    const res1 = await snapdom(host, { plugins: [contextExport()] })
    const a = await res1.toContext()
    const res2 = await snapdom(host, { plugins: [contextExport()] })
    const b = await res2.toContext()
    expect(a).toBe(b)
  })

  it('survives auto-burst + a nested mutation (differential recapture path)', async () => {
    const host = fixture()
    // Memoized from the first capture, the engine may serve the next one from the diff path, which
    // builds its result without running captureDOM — the source element has to come from
    // the context itself, not from a capture hook.
    for (let i = 0; i < 4; i++) await snapdom(host, { plugins: [contextExport()] })
    host.querySelector('p').textContent = 'updated'
    await new Promise(r => setTimeout(r, 30))

    const res = await snapdom(host, { plugins: [contextExport()] })
    await expect(res.toContext()).resolves.toContain('div')
  })

  // `exclude` is the redaction feature. The image already honours it; a semantic export
  // that did not would hand the redacted text straight to a model.
  it('excluded content does not leak through the semantic export', async () => {
    const host = document.createElement('div')
    host.innerHTML = '<p>publico</p><div class="pii">TARJETA-4111-1111</div>'
    document.body.appendChild(host)
    const res = await snapdom(host, { exclude: ['.pii'], plugins: [contextExport()] })
    const svg = decodeURIComponent(res.url.split(',')[1])
    expect(svg).not.toContain('TARJETA')
    expect(String(await res.toContext())).not.toContain('TARJETA')
  })

  it('stays inside a sane token budget for a real-ish card grid', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:800px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px'
    for (let i = 0; i < 48; i++) {
      const card = document.createElement('div')
      card.innerHTML = `<div><h3>Card ${i}</h3><p>Descripción breve del item número ${i}</p><button>Abrir</button></div>`
      host.appendChild(card)
    }
    document.body.appendChild(host)
    const res = await snapdom(host, { plugins: [contextExport()] })
    const out = await res.toContext()
    // ~4 chars/token heuristic: a 48-card dashboard should stay well under ~4k tokens.
    expect(out.length / 4).toBeLessThan(4000)
    expect(out).toContain('Card 47')
  })
})
