// Lo que la HOJA DE ESTILO de la pagina le cuesta a una captura.
//
// Todas las demas escenas montan en una pagina vacia, donde ningun selector de autor existe.
// Ninguna pagina real es asi, y la diferencia no es chica: una sola regla ::before que no
// matchea ningun nodo hacia que el pase de pseudos recorriera el arbol entero para descubrir
// que no habia nada que hacer. Sin un arma con CSS de host, esa regresion era invisible aca y
// solo aparecia midiendo dentro del sitio de docs.
//
// html2canvas va de control: no tiene un pase equivalente, asi que sus dos filas tienen que
// dar iguales. Si se mueven, lo que se movio es la maquina, no el codigo.
//
// UNA SOLA ETAPA DE SALIDA, como en toda esta categoria: PNG data URL, defaults, scale 1, dpr 1.
//
// Run:  npx vitest bench __tests__/category.hostcss.benchmark.js --browser.headless --watch=false
import { bench, describe, beforeAll, afterAll } from 'vitest'
import { snapdom } from '../src/index'
import { loadLibs, bigTableHTML } from './category.libs.js'

const LIBS = await loadLibs()

let root = null
let sheet = null
beforeAll(() => {
  root = document.createElement('div')
  root.style.width = '640px'
  root.innerHTML = bigTableHTML(500)
  document.body.appendChild(root)
})
afterAll(() => { root?.remove(); fresh?.remove(); sheet?.remove(); splitSheet?.remove() })

// La regla es deliberadamente inerte: no matchea un solo nodo de la captura. Lo que mide el
// arma no es aplicar un pseudo, es el costo de que la pagina MENCIONE uno.
const withHostCss = () => {
  if (!sheet) {
    sheet = document.createElement('style')
    sheet.setAttribute('data-bench-hostcss', '')
    sheet.textContent = '.hc-absent::before{content:"x"}\n.hc-absent-2 li::marker{color:red}'
    document.head.appendChild(sheet)
  }
}
const withoutHostCss = () => { if (sheet) { sheet.remove(); sheet = null } }

// La otra trampa de la misma clase: selectores que PUEDEN distinguir gemelos identicos
// (`:hover`, `:first-child`, `p + p`) apagaban el identity share para el documento entero,
// aunque esten atados a clases que la captura no contiene. Toda pagina real los tiene; la
// tabla de 500 filas pagaba 536k lecturas de estilo computado en vez de 77k (2026-09-02).
// Se mide con un elemento FRESCO por iteracion: el share solo pesa en nodos frios, y sobre
// el mismo elemento recapturado el snapshot cache por nodo esconde la diferencia por completo
// (medido: 153 vs 153 ms con y sin el fix). Contenido unico por elemento, como en
// category.cold, para que ninguna etapa se sirva del image cache.
let splitSheet = null
let fresh = null
let salt = 0
const freshRoot = () => {
  fresh?.remove()
  fresh = document.createElement('div')
  fresh.style.width = '640px'
  fresh.innerHTML = `<div style="height:14px;font-size:11px">capture #${salt++}</div>` + bigTableHTML(500)
  document.body.appendChild(fresh)
  return fresh
}
const withSplittingCss = () => {
  withoutHostCss()
  if (!splitSheet) {
    splitSheet = document.createElement('style')
    splitSheet.setAttribute('data-bench-hostcss', '')
    splitSheet.textContent = '.hc-btn:hover{color:red}\n.hc-label:first-child{margin:0}\n.hc-faq p + p{margin-top:1em}'
    document.head.appendChild(splitSheet)
  }
}
const withoutSplittingCss = () => { if (splitSheet) { splitSheet.remove(); splitSheet = null } }

const OPTS = { warmupIterations: 1, iterations: 8, time: 0 }

describe('Host CSS: tabla de 500 filas, con y sin reglas de pseudo en la pagina', () => {
  bench('snapDOM · pagina sin reglas de pseudo', async () => {
    withoutHostCss()
    await snapdom.toPng(root, { scale: 1, dpr: 1, burst: false })
  }, OPTS)

  bench('snapDOM · pagina con reglas de pseudo que no matchean', async () => {
    withoutSplittingCss()
    withHostCss()
    await snapdom.toPng(root, { scale: 1, dpr: 1, burst: false })
  }, OPTS)

  bench('snapDOM · elemento fresco, pagina sin reglas', async () => {
    withoutSplittingCss()
    withoutHostCss()
    await snapdom.toPng(freshRoot(), { scale: 1, dpr: 1, burst: false })
  }, OPTS)

  bench('snapDOM · elemento fresco, pagina con :hover/:first-child/+ que no matchean', async () => {
    withSplittingCss()
    await snapdom.toPng(freshRoot(), { scale: 1, dpr: 1, burst: false })
  }, OPTS)

  bench('html2canvas 1.4.1 · sin reglas (control)', async () => {
    withoutSplittingCss()
    withoutHostCss()
    await LIBS['html2canvas 1.4.1'](root)
  }, OPTS)

  bench('html2canvas 1.4.1 · con reglas (control)', async () => {
    withHostCss()
    await LIBS['html2canvas 1.4.1'](root)
  }, OPTS)
})
