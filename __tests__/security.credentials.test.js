// Credential-leak regression suite, split along the line v3 draws between the two surfaces:
//
//  - The IMAGE is a fidelity surface. It shows what the browser paints, so an email/tel/cc
//    field that renders in the clear on screen renders in the clear in the capture. The one
//    exception is type=password, where the mask is fidelity-NEUTRAL (the control already
//    paints bullets) and therefore free. Redacting the rest is opt-in: `redactInputs`.
//  - SEMANTIC output (agentMap / contextExport) is NOT a fidelity surface. It is text handed
//    to a model or a log, so it redacts by default and keeps doing so.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { agentMap } from '../packages/plugins/agent-map.js'
import { contextExport } from '../packages/plugins/context-export.js'
import { redactInputs } from '../packages/plugins/redact-inputs.js'

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

  it('serialized SVG never carries the password, and keeps everything else verbatim', async () => {
    const form = secretForm()
    const res = await snapdom(form, { cache: 'disabled' })
    const svg = decodeURIComponent(res.url.split(',')[1])
    // Fidelity-neutral mask: the control paints bullets either way, so the secret has no
    // reason to be in the payload.
    expect(svg).not.toContain(SECRETS.password)
    expect(svg).toContain('•'.repeat(SECRETS.password.length))
    // Everything the browser paints in the clear is captured in the clear. Masking these
    // made the image disagree with the page.
    expect(svg).toContain(SECRETS.email)
    expect(svg).toContain(SECRETS.tel)
    expect(svg).toContain(SECRETS.cc)
    expect(svg).toContain(SECRETS.otp)
    expect(svg).toContain('NotaVisible123')
  })

  it('redactInputs opts the image back into full redaction', async () => {
    const form = secretForm()
    const res = await snapdom(form, { plugins: [redactInputs()], cache: 'disabled' })
    const svg = decodeURIComponent(res.url.split(',')[1])
    assertNoSecrets(svg)
    // Only what was asked for: an ordinary field is still captured faithfully.
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

  it('the canvas engine inherits the rule instead of reimplementing it', async () => {
    // It used to sync form state into its own live-DOM copy, with its own masking call.
    // It consumes core's clone now, so there is exactly one place that decides this and
    // the assertions above already cover it. Kept as a marker so the duplicate does not
    // come back: the engine must own no form-state code of its own.
    const src = await import('../src/engines/htmlInCanvas.js')
    expect(src.syncFormState).toBeUndefined()
  })

  it('semantic-only entries carry the flag and receive no badges', async () => {
    const host = document.createElement('div')
    host.innerHTML = '<h2>Título</h2><p>Un párrafo largo.</p><button>Acción</button>'
    document.body.appendChild(host)
    const res = await snapdom(host, { plugins: [agentMap({ semantic: true, image: 'annotated',
      labelStyle: { color: 'rgb(220, 0, 0)', backgroundColor: 'rgb(220, 0, 0)', boxShadow: 'none' },
    })], cache: 'disabled' })
    const out = await res.toAgentMap()
    const semantics = out.map.filter(e => e.isSemanticOnly)
    expect(semantics.length).toBeGreaterThan(0)
    // Badges belong to the annotated export, so raw exports of this same capture remain
    // clean. Paint the label text the same red as its background to sample the centers.
    const img = new Image()
    img.src = out.image
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    for (const entry of out.map) {
      const [x, y, w, h] = entry.b
      const pixel = ctx.getImageData(x + w / 2, y + h / 2, 1, 1).data
      const red = pixel[0] > 150 && pixel[1] < 50 && pixel[2] < 50
      expect(red).toBe(!entry.isSemanticOnly)
    }
  })
})
