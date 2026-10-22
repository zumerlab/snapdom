import { describe, it, expect, afterEach } from 'vitest'
import { prepareClone } from '../src/core/prepare.js'
import { createContext } from '../src/core/context.js'
import { emulateBackdropFilters } from '../src/modules/backdropFilter.js'

// Two frosted panels: the second panel's backdrop copy contains the first panel, which
// precedes it in tree order. That copy of the first panel must lose its raw backdrop-filter,
// or the rasterizer smears it a second time inside the frost (#457).

describe('backdrop-filter on sibling panels', () => {
  let root
  afterEach(() => root?.remove())

  it('strips the raw backdrop-filter of an earlier panel inside a later panel\'s frost', async () => {
    root = document.createElement('div')
    root.style.cssText = 'position:relative;width:200px;height:100px;background:linear-gradient(90deg, red, blue)'
    root.innerHTML = `
      <div data-p="1" style="position:absolute;left:10px;top:10px;width:80px;height:80px;backdrop-filter:blur(4px)"></div>
      <div data-p="2" style="position:absolute;left:60px;top:10px;width:80px;height:80px;backdrop-filter:blur(4px)"></div>
    `
    document.body.appendChild(root)
    const { clone, nodeMap } = await prepareClone(root, createContext({}))
    emulateBackdropFilters(root, clone, nodeMap)

    const second = clone.querySelector(':scope > [data-p="2"]')
    // The frost is the first child; inside it sits the pruned copy of the clone.
    const earlier = second.firstElementChild.querySelector('[data-p="1"]')
    expect(earlier).not.toBeNull()
    expect(earlier.style.getPropertyValue('backdrop-filter')).toBe('none')
    expect(earlier.style.getPropertyPriority('backdrop-filter')).toBe('important')
  })
})
