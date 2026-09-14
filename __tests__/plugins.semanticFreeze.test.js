// The semantic exports (toContext / toAgentMap) describe THE CAPTURED INSTANT, and they
// obey the same exclusion policy as the image. Both were broken: toContext() read the live
// DOM when it was called, and each plugin had its own idea of what `exclude` means.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { contextExport } from '../packages/plugins/context-export.js'
import { agentMap } from '../packages/plugins/agent-map.js'

function mount(html) {
  const host = document.createElement('div')
  host.style.cssText = 'width:400px'
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

describe('semantic exports are frozen at the captured instant', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('toContext() describes the DOM as it was captured, not as it is now', async () => {
    const host = mount('<p id="t">antes</p>')
    const res = await snapdom(host, { plugins: [contextExport()] })

    host.querySelector('#t').textContent = 'despues'
    host.insertAdjacentHTML('beforeend', '<button>nuevo</button>')

    const out = await res.toContext()
    expect(out).toContain('antes')
    expect(out).not.toContain('despues')
    expect(out).not.toContain('nuevo')
  })

  it('the frozen snapshot survives a node being detached before export', async () => {
    const host = mount('<h1>Titulo</h1><section><a href="/x">enlace</a></section>')
    const res = await snapdom(host, { plugins: [contextExport()] })
    host.querySelector('section').remove()

    const json = await res.toContext({ format: 'json' })
    const flat = JSON.stringify(json)
    expect(flat).toContain('Titulo')
    expect(flat).toContain('/x')
  })

  it('export options still format the SAME frozen text', async () => {
    const host = mount('<p>0123456789abcdefghij</p>')
    const res = await snapdom(host, { plugins: [contextExport()] })
    host.querySelector('p').textContent = 'REEMPLAZADO'

    const short = await res.toContext({ maxTextLength: 5 })
    expect(short).toContain('0123…')
    expect(short).not.toContain('REEMPLAZADO')
    // Same snapshot, different formatting: the full text is still there at the wider cap.
    expect(await res.toContext({ maxTextLength: 120 })).toContain('0123456789abcdefghij')
  })
})

describe('one exclusion policy for image and semantics', () => {
  afterEach(() => { document.body.innerHTML = '' })

  const SECRET = 'TARJETA-4111-1111'

  async function capture(options) {
    const host = mount(
      '<p>publico</p>' +
      `<div class="pii">${SECRET}</div>` +
      '<button class="pii">Cobrar</button>'
    )
    return snapdom(host, { ...options, plugins: [contextExport(), agentMap({ image: false })] })
  }

  // Every spelling of the same policy. Each must redact the image AND both semantic views.
  for (const [label, options] of [
    ['exclude selector', { exclude: ['.pii'] }],
    ['exclude predicate', { exclude: [(el) => el.classList?.contains('pii')] }],
    ['selector and predicate mixed', { exclude: ['.pii', (el) => el.classList?.contains('pii')] }],
  ]) {
    it(`${label}: excluded content reaches neither the image nor the semantic output`, async () => {
      const res = await capture(options)
      expect(decodeURIComponent(res.url.split(',')[1])).not.toContain(SECRET)
      const ctx = String(await res.toContext())
      expect(ctx).toContain('publico')
      expect(ctx).not.toContain(SECRET)
      const { map } = await res.toAgentMap()
      expect(JSON.stringify(map)).not.toContain('Cobrar')
    })
  }

  it('data-capture="exclude" is honored by the agent map too', async () => {
    const host = mount('<button>Ver</button><button data-capture="exclude">Borrar todo</button>')
    const res = await snapdom(host, { plugins: [contextExport(), agentMap({ image: false })] })
    const { map } = await res.toAgentMap()
    expect(map.map((e) => e.n)).toEqual(['Ver'])
    expect(String(await res.toContext())).not.toContain('Borrar todo')
  })
})

describe('semantic exports see what core clones', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('a capture root that is itself interactive is in the map', async () => {
    const host = mount('<button id="solo">Solo</button>')
    const btn = host.querySelector('#solo')
    const res = await snapdom(btn, { plugins: [agentMap({ image: false })] })
    const { map } = await res.toAgentMap()
    expect(map.length).toBe(1)
    expect(map[0].r).toBe('button')
    expect(map[0].n).toBe('Solo')
  })

  it('open shadow DOM is represented, slotted light content included', async () => {
    const host = mount('')
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<style>button{color:red}</style><button>Accion sombra</button><slot></slot>'
    host.innerHTML = '<a href="/luz">Enlace de luz</a>'
    await new Promise((r) => requestAnimationFrame(r))

    const res = await snapdom(host, { plugins: [contextExport(), agentMap({ image: false })] })

    const outline = await res.toContext()
    expect(outline).toContain('Accion sombra')
    expect(outline).toContain('Enlace de luz')
    expect(outline).not.toContain('color:red')

    const { map } = await res.toAgentMap()
    const names = map.map((e) => e.n).sort()
    expect(names).toEqual(['Accion sombra', 'Enlace de luz'])
  })

  it('exclusion prunes inside the shadow root as well', async () => {
    const host = mount('')
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<button>Ver</button><button class="pii">Borrar</button>'
    await new Promise((r) => requestAnimationFrame(r))

    const res = await snapdom(host, { exclude: ['.pii'], plugins: [contextExport(), agentMap({ image: false })] })
    const { map } = await res.toAgentMap()
    expect(map.map((e) => e.n)).toEqual(['Ver'])
    expect(String(await res.toContext())).not.toContain('Borrar')
  })
})
