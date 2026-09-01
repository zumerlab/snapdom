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
afterAll(() => { root?.remove(); sheet?.remove() })

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

const OPTS = { warmupIterations: 1, iterations: 8, time: 0 }

describe('Host CSS: tabla de 500 filas, con y sin reglas de pseudo en la pagina', () => {
  bench('snapDOM · pagina sin reglas de pseudo', async () => {
    withoutHostCss()
    await snapdom.toPng(root, { scale: 1, dpr: 1, burst: false })
  }, OPTS)

  bench('snapDOM · pagina con reglas de pseudo que no matchean', async () => {
    withHostCss()
    await snapdom.toPng(root, { scale: 1, dpr: 1, burst: false })
  }, OPTS)

  bench('html2canvas 1.4.1 · sin reglas (control)', async () => {
    withoutHostCss()
    await LIBS['html2canvas 1.4.1'](root)
  }, OPTS)

  bench('html2canvas 1.4.1 · con reglas (control)', async () => {
    withHostCss()
    await LIBS['html2canvas 1.4.1'](root)
  }, OPTS)
})
