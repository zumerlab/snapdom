import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

// Sibling pseudo-counter overrides used to live in a module-global WeakMap guarded by a
// shared epoch that ANY capture start bumped — a concurrent capture wiped the accumulated
// counters mid-sibling-walk and numbering restarted partway down the list (1,2,1,2…).
// The state now lives on the per-capture sessionCache.

const IMG_URL = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="teal"/></svg>'
)

function makeCounterList(cls) {
  const style = document.createElement('style')
  style.textContent = `
    ul.${cls} { list-style: none; counter-reset: item; }
    ul.${cls} li::before { counter-increment: item; content: counter(item) ". "; }
    ul.${cls} li span.icon::after { content: url("${IMG_URL}"); }
  `
  document.head.appendChild(style)
  const ul = document.createElement('ul')
  ul.className = cls
  for (let i = 0; i < 4; i++) {
    const li = document.createElement('li')
    li.appendChild(Object.assign(document.createElement('span'), { className: 'icon' }))
    li.appendChild(document.createTextNode(' item'))
    ul.appendChild(li)
  }
  document.body.appendChild(ul)
  return { ul, style }
}

describe('pseudo counter numbering under concurrent captures', () => {
  afterEach(() => { document.body.innerHTML = ''; document.head.querySelectorAll('style').forEach(s => s.remove()) })

  it('both captures keep full 1..4 numbering', async () => {
    const a = makeCounterList('bh-race-a')
    const b = makeCounterList('bh-race-b')

    const [resA, resB] = await Promise.all([snapdom(a.ul), snapdom(b.ul)])
    for (const res of [resA, resB]) {
      const svg = decodeURIComponent(res.url.split(',')[1])
      for (const n of ['1.', '2.', '3.', '4.']) expect(svg).toContain(n)
    }
  })
})
