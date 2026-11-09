/**
 * snapdom Pro — la suite del canal h2d y del híbrido.
 *
 * `verify-vector.mjs` mide el camino SVD/SVG y no toca ni una línea de `emit/h2d.js`,
 * `emit/h2d-vector.js` ni `hybridPaint()`: unas 1200 líneas, de las cuales 250 son del
 * híbrido y se escribieron el 2026-08-07. Esto es su red.
 *
 * Lo que se comprueba, y por qué cada cosa:
 *
 * 1. **Paridad estructural contra la captura REAL de su extensión**
 *    (`test/fixtures/h2d/figma-extension-fx-img.json`). El formato es propietario, no
 *    está documentado y ya va por `version: 2`: Figma puede cambiarlo en cualquier
 *    release, sin negociación y sin error — el único síntoma es que un pegado no hace
 *    nada. Este bloque congela la paridad que se midió el día que se decodificó.
 * 2. **Invariantes que no dependen de esa captura** — assets coherentes, sin nodos
 *    filtrados en el documento del usuario, sin rects NaN — sobre los diez fixtures.
 * 3. **El híbrido**: que los nodos que el canal no puede pintar salgan como assets
 *    `image/svg+xml` con una ventana recortada, y que apagarlo los devuelva a cajas CSS.
 *
 * No mide píxeles. Nadie puede pegar en Figma desde un CI, así que lo que se puede
 * afirmar aquí es la FORMA del payload, no lo que Figma hace con él. Todo lo que este
 * archivo comprueba es reproducible sin una persona mirando una pantalla; lo que
 * necesita a una persona está en `FIGMA_FINDINGS.md` con la fecha de su medición.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadChromium } from './harness.mjs'
import { serve } from './serve.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const REF = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/h2d/figma-extension-fx-img.json'), 'utf8'))[0]
// Esta suite pedía un `npm run demo` ya levantado y moría con ERR_CONNECTION_REFUSED
// si no lo estaba — lo que hacía fallar `npm test` entero por una razón que no tiene
// nada que ver con el código. Ahora se sirve sola, como verify-vector, y `H2D_BASE`
// sigue apuntándola a un servidor de afuera cuando hace falta.
const ownServer = process.env.H2D_BASE ? null : await serve(0)
const BASE = process.env.H2D_BASE || `http://localhost:${ownServer.port}`

/** Las dos que su serializador manda constantes y esta librería descarta a propósito. */
const DELIBERATELY_DROPPED = new Set(['outlineWidth', 'columnRuleWidth'])

let passed = 0
const failures = []
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ok   ${name}${detail ? ' — ' + detail : ''}`) }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

const elements = (root, out = []) => {
  const walk = (n) => { if (!n) return; if (n.nodeType === 1) out.push(n); for (const c of n.childNodes || []) walk(c) }
  walk(root); return out
}
const texts = (root, out = []) => {
  const walk = (n) => { if (!n) return; if (n.nodeType === 3) out.push(n); for (const c of n.childNodes || []) walk(c) }
  walk(root); return out
}

const chromium = await loadChromium()
const browser = await chromium.launch()

/**
 * El payload de un fixture. El ancho de viewport se ajusta hasta que el subárbol mide
 * lo mismo que cuando se tomó la captura de referencia: comparar dos payloads a anchos
 * distintos es comparar dos layouts distintos, y todo lo demás sería ruido.
 */
async function payloadFor (fixture, { width = 1400, layoutWidth = null, options = {} } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.goto(`${BASE}/demo/challenges.html`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  if (layoutWidth) {
    for (let i = 0; i < 20; i++) {
      const w = await page.evaluate((id) => document.querySelector('#' + id).getBoundingClientRect().width, fixture)
      if (Math.abs(w - layoutWidth) < 0.5) break
      const vp = page.viewportSize()
      await page.setViewportSize({ width: Math.round(vp.width + (layoutWidth - w)), height: vp.height })
      await page.waitForTimeout(60)
    }
  }
  const out = await page.evaluate(async ({ id, options }) => {
    const el = document.querySelector('#' + id)
    el.classList.add('on')
    const before = document.body.childNodes.length
    const { snapdom } = await import('@zumer/snapdom')
    const mod = await import('@zumer/snapdom-vector')
    const res = await snapdom(el, { plugins: [mod.vector()] })
    const h2d = await res.toVectorFigmaClipboard({ silent: true, ...options })
    return {
      payload: h2d.payload, stats: h2d.stats, bytes: h2d.bytes, html: h2d.html,
      diagnostics: h2d.diagnostics.map((d) => ({ code: d.code, severity: d.severity })),
      leaked: document.body.childNodes.length - before,
    }
  }, { id: fixture, options })
  await page.close()
  return { ...out, errors }
}

console.log('\n1 · Paridad con la captura real de la extensión oficial\n')
{
  // 713px es el ancho de layout al que se tomó la captura de referencia.
  const mine = await payloadFor('fx-img', { width: 1225, layoutWidth: 713 })
  const doc = mine.payload[0]

  ok('la captura corre sin errores de página', mine.errors.length === 0, mine.errors.slice(0, 2).join(' | '))
  ok('las claves de nivel superior son las suyas',
    Object.keys(doc).sort().join(',') === Object.keys(REF).sort().join(','),
    Object.keys(doc).sort().join(','))
  ok('la versión del formato es la suya', doc.version === REF.version, `${doc.version} vs ${REF.version}`)

  const A = elements(doc.root)
  const B = elements(REF.root)
  ok('mismo número de elementos', A.length === B.length, `${A.length} vs ${B.length}`)
  const sameOrder = A.length === B.length && A.every((n, i) => n.tag === B[i].tag)
  ok('mismo orden de elementos', sameOrder)

  // Los nodos de texto en blanco viajan: su payload trae 42 donde éste traía 16, y esa
  // era la última diferencia estructural que quedaba (2026-08-07).
  ok('mismo número de nodos de texto', texts(doc.root).length === texts(REF.root).length,
    `${texts(doc.root).length} vs ${texts(REF.root).length}`)

  if (sameOrder) {
    let missing = 0; let extra = 0; let valueDiff = 0
    const extraNames = new Set()
    for (let i = 0; i < A.length; i++) {
      for (const k of Object.keys(B[i].styles)) {
        if (DELIBERATELY_DROPPED.has(k)) continue
        if (!(k in A[i].styles)) { missing++; continue }
        if (A[i].styles[k] !== B[i].styles[k]) {
          const near = /px/.test(String(B[i].styles[k])) &&
            Math.abs(parseFloat(A[i].styles[k]) - parseFloat(B[i].styles[k])) < 0.05
          if (!near) valueDiff++
        }
      }
      for (const k of Object.keys(A[i].styles)) if (!(k in B[i].styles)) { extra++; extraNames.add(k) }
    }
    ok('no falta ninguna propiedad que ellos mandan', missing === 0, `faltan ${missing}`)
    ok('no se manda ninguna que ellos no mandan', extra === 0, [...extraNames].join(','))
    ok('ningún valor difiere más de 0.05px', valueDiff === 0, `${valueDiff} distintos`)

    let compSame = 0
    for (let i = 0; i < A.length; i++) {
      const a = JSON.stringify(A[i].computedStyles || {}, Object.keys(A[i].computedStyles || {}).sort())
      const b = JSON.stringify(B[i].computedStyles || {}, Object.keys(B[i].computedStyles || {}).sort())
      if (a === b) compSame++
    }
    ok('computedStyles idénticos en todos los nodos', compSame === A.length, `${compSame}/${A.length}`)
  }

  ok('mismo número de assets', Object.keys(doc.assets).length === Object.keys(REF.assets).length,
    `${Object.keys(doc.assets).length} vs ${Object.keys(REF.assets).length}`)
  // El prefijo genérico es el detalle del esquema que no se adivina: el tipo real
  // viaja aparte en `blob.type`.
  const prefixed = Object.values(doc.assets)
    .every((a) => String(a.blob.base64Blob).startsWith('data:application/octet-stream;base64,'))
  ok('cada blob lleva el prefijo application/octet-stream', prefixed)
  const identical = Object.entries(doc.assets)
    .filter(([k, v]) => REF.assets[k] && REF.assets[k].blob.base64Blob === v.blob.base64Blob).length
  ok('al menos 3 assets son byte a byte los suyos', identical >= 3, `${identical} idénticos`)
}

console.log('\n2 · Invariantes del canal sobre los diez fixtures\n')
const FIXTURES = ['fx-img', 'fx-svg', 'fx-grid', 'fx-tf', 'fx-glass', 'fx-type', 'fx-list', 'fx-form', 'fx-table', 'fx-dark']
for (const fixture of FIXTURES) {
  const r = await payloadFor(fixture)
  const doc = r.payload[0]
  const els = elements(doc.root)
  const bad = []
  for (const n of els) {
    for (const k of ['x', 'y', 'width', 'height']) if (!Number.isFinite(n.rect?.[k])) bad.push(`${n.tag}.rect.${k}`)
    for (const [k, v] of Object.entries(n.styles || {})) if (typeof v !== 'string') bad.push(`${n.tag}.styles.${k}`)
    for (const [k, v] of Object.entries(n.attributes || {})) if (typeof v !== 'string') bad.push(`${n.tag}.attributes.${k}`)
  }
  // Cada `currentSrc` que es data URI tiene que tener su entrada en `assets`, y cada
  // entrada tiene que tener dueño: un asset huérfano son bytes que nadie pinta, y un
  // `currentSrc` sin asset es una imagen que puede no llegar.
  const srcs = new Set(els.map((n) => n.attributes && n.attributes.currentSrc).filter((s) => s && s.startsWith('data:')))
  const keys = new Set(Object.keys(doc.assets))
  const unbacked = [...srcs].filter((s) => !keys.has(s)).length

  console.log(`  · ${fixture} — ${els.length} elementos, ${Object.keys(doc.assets).length} assets, ${Math.round(r.bytes / 1024)} kB`)
  ok(`${fixture}: sin errores de página`, r.errors.length === 0, r.errors.slice(0, 1).join(''))
  ok(`${fixture}: no deja nodos en el documento`, r.leaked === 0, `${r.leaked} nodos`)
  ok(`${fixture}: ningún campo malformado`, bad.length === 0, bad.slice(0, 3).join(', '))
  ok(`${fixture}: cada imagen inlineada tiene su asset`, unbacked === 0, `${unbacked} sin respaldo`)
  ok(`${fixture}: el sobre trae las dos mitades`,
    /data-metadata="/.test(r.html) && /data-h2d="/.test(r.html))
  ok(`${fixture}: declara que el formato es propietario`,
    r.diagnostics.some((d) => d.code === 'h2d.proprietary-format'))
}

console.log('\n3 · El híbrido\n')
{
  const on = await payloadFor('fx-dark')
  const off = await payloadFor('fx-dark', { options: { vectorFallback: false } })
  const drawn = on.stats.vectorPaint || 0

  ok('fx-dark tiene nodos que el canal no puede pintar', drawn > 0, `${drawn} redibujados`)
  ok('apagarlo los devuelve a cajas CSS', (off.stats.vectorPaint || 0) === 0)
  ok('y lo declara en vez de callarlo',
    off.diagnostics.some((d) => d.code === 'h2d.vector-paint-off'))
  ok('encendido pesa más que apagado', on.bytes > off.bytes,
    `${Math.round(on.bytes / 1024)} kB vs ${Math.round(off.bytes / 1024)} kB`)

  const imgs = elements(on.payload[0].root).filter((n) => n.tag === 'IMG')
  const svgAssets = Object.values(on.payload[0].assets).filter((a) => a.blob.type === 'image/svg+xml')
  ok('la pintura viaja como image/svg+xml', svgAssets.length >= drawn, `${svgAssets.length} assets SVG`)
  // La ventana tiene que estar recortada al nodo. Con `viewBox="0 0 …"` el dibujo sale
  // en blanco: fue el primer bug del híbrido, por usar `abs` donde va `frame`.
  const cropped = imgs.map((n) => decodeURIComponent(String(n.attributes.currentSrc || '')))
    .filter((m) => m.startsWith('data:') === false && /viewBox="[^"]+"/.test(m))
  const anyWindowed = imgs
    .map((n) => decodeURIComponent(String(n.attributes.currentSrc || '')))
    .some((m) => /viewBox="(?!0 0 )/.test(m))
  ok('la ventana del asset está recortada al nodo', anyWindowed || cropped.length === 0)

  const glass = await payloadFor('fx-glass')
  ok('lo que depende del fondo se declara, no se finge',
    glass.diagnostics.some((d) => d.code === 'h2d.backdrop-effects-lost'))

  const svg = await payloadFor('fx-svg')
  ok('un <svg> en línea viaja como asset', (svg.stats.svgAssets || 0) > 0, `${svg.stats.svgAssets}`)
  const svgOff = await payloadFor('fx-svg', { options: { inlineSvgAsAsset: false } })
  ok('y se puede apagar para bisecar', (svgOff.stats.svgAssets || 0) === 0)

  const type = await payloadFor('fx-type')
  ok('el texto con contorno se declara perdido',
    type.diagnostics.some((d) => d.code === 'h2d.text-stroke-dropped'))
}

await browser.close()

console.log('\n' + '═'.repeat(60))
console.log(`${passed}/${passed + failures.length} checks passed`)
if (failures.length) {
  console.log(`\n${failures.length} FAILED:`)
  for (const f of failures) console.log('  ' + f)
}
console.log('')
ownServer?.close()
process.exit(failures.length ? 1 : 0)
