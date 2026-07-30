// Phase-0 credential-leak regression suite: typed secrets must never appear in ANY
// output — semantic (agentMap/context), serialized SVG, or engine form-state sync.
// These assertions fail against the pre-fix code (raw el.value / slice(0,40) paths).
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { agentMap } from '../packages/plugins/agent-map.js'
import { contextExport } from '../packages/plugins/context-export.js'
import { syncFormState } from '../src/engines/htmlInCanvas.js'

const SECRETS = {
  password: 'S3CRET-PW-XYZ123',
  email: 'leaked.email@example.com',
  tel: '+54911555SECRET',
  cc: '4111111111111111',
  otp: '998877',
}

function secretForm() {
  const form = document.createElement('form')
  form.innerHTML = `
    <input type="password" value="${SECRETS.password}">
    <input type="email" value="${SECRETS.email}">
    <input type="tel" value="${SECRETS.tel}">
    <input type="text" autocomplete="cc-number" value="${SECRETS.cc}">
    <input type="text" autocomplete="one-time-code" value="${SECRETS.otp}">
    <input type="text" class="plain" value="NotaVisible123">
    <textarea>texto libre del usuario</textarea>
    <button type="submit">Enviar</button>
  `
  document.body.appendChild(form)
  return form
}

const assertNoSecrets = (str) => {
  for (const [k, v] of Object.entries(SECRETS)) {
    expect(str.includes(v), `secret "${k}" leaked`).toBe(false)
  }
}

describe('credential leak (Phase 0)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('serialized SVG carries no sensitive values (masked at transfer time)', async () => {
    const form = secretForm()
    const res = await snapdom(form, { cache: 'disabled' })
    const svg = decodeURIComponent(res.url.split(',')[1])
    assertNoSecrets(svg)
    // Non-sensitive values keep raster fidelity.
    expect(svg).toContain('NotaVisible123')
  })

  it('agentMap output carries no secrets and masks non-sensitive values', async () => {
    const form = secretForm()
    const res = await snapdom(form, { plugins: [agentMap({ image: false, fields: 'full' })], cache: 'disabled' })
    const out = await res.toAgentMap()
    const json = JSON.stringify(out)
    assertNoSecrets(json)
    expect(json).not.toContain('NotaVisible123') // masked by default in semantic output
    const plain = out.map.find(e => e.r === 'textbox' && e.s && e.s.hasValue && e.s.value)
    expect(plain, 'non-sensitive input reports masked value + hasValue').toBeTruthy()
    expect(plain.s.value).toMatch(/^•+$/)
  })

  it('context outline carries no secrets, only masks/hasValue', async () => {
    const form = secretForm()
    const res = await snapdom(form, { plugins: [contextExport()], cache: 'disabled' })
    const out = await res.toContext()
    assertNoSecrets(out)
    expect(out).not.toContain('NotaVisible123')
    expect(out).toContain('hasValue')
  })

  it('htmlInCanvas syncFormState masks sensitive inputs in the copy', () => {
    const form = secretForm()
    const copy = form.cloneNode(true)
    syncFormState(form, copy)
    assertNoSecrets(copy.outerHTML)
    expect(copy.outerHTML).toContain('NotaVisible123')
  })

  it('semantic-only entries carry the flag and receive no badges', async () => {
    const host = document.createElement('div')
    host.innerHTML = '<h2>Título</h2><p>Un párrafo largo.</p><button>Acción</button>'
    document.body.appendChild(host)
    const res = await snapdom(host, { plugins: [agentMap({ semantic: true, image: 'annotated' })], cache: 'disabled' })
    const out = await res.toAgentMap()
    const semantics = out.map.filter(e => e.isSemanticOnly)
    expect(semantics.length).toBeGreaterThan(0)
    // Badges live in the annotated clone's overlay — count must equal INTERACTIVE entries.
    const svg = decodeURIComponent(res.url.split(',')[1])
    const overlay = svg.match(/data-snap-agent-overlay/g) || []
    expect(overlay.length).toBeGreaterThan(0)
    // Badges are <span> children of the overlay carrying the entry index.
    const overlayMarkup = (svg.split('data-snap-agent-overlay')[1] || '').split('</div>')[0]
    const badges = (overlayMarkup.match(/<span/g) || []).length
    const interactive = out.map.length - semantics.length
    expect(badges).toBe(interactive)
  })
})
