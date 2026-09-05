import { afterEach, describe, expect, it } from 'vitest'
import { deepClone } from '../src/core/clone.js'
import { createCaptureSession } from '../src/core/session.js'

let select
afterEach(() => select?.remove())

function mount(html, multiple = false) {
  select = document.createElement('select')
  select.multiple = multiple
  select.innerHTML = html
  document.body.appendChild(select)
  return select
}

async function selectedLabels(options = {}) {
  const clone = await deepClone(select, createCaptureSession('soft'), options)
  // Selection properties disappear in SVG serialization. Assert the attributes that
  // actually survive the export instead of just the detached clone's live properties.
  return Array.from(clone.options).filter(option => option.hasAttribute('selected'))
    .map(option => option.textContent)
}

describe('select cloning preserves selected option identity', () => {
  it('keeps only the selected label when several options share one value', async () => {
    mount('<option value="same">First</option><option value="same">Second</option>')
    select.selectedIndex = 0
    expect(await selectedLabels()).toEqual(['First'])
    select.selectedIndex = 1
    expect(await selectedLabels()).toEqual(['Second'])
  })

  it('does not select an empty-value option when the live selection is empty', async () => {
    mount('<option value="">Empty value</option><option value="b">Second</option>')
    select.selectedIndex = -1
    const clone = await deepClone(select, createCaptureSession('soft'), {})
    const parsed = new DOMParser().parseFromString(new XMLSerializer().serializeToString(clone), 'application/xhtml+xml')
    const restored = parsed.documentElement
    expect(restored.options[restored.selectedIndex]?.textContent || '').toBe('')
    expect(Array.from(restored.options).filter(option => option.selected && !option.hidden)).toEqual([])
  })

  it('keeps multiple selections after an earlier option is excluded', async () => {
    mount('<option id="drop">Excluded</option><option>Chosen</option><option>Last</option>', true)
    select.options[1].selected = true
    expect(await selectedLabels({ exclude: ['#drop'], excludeMode: 'remove' })).toEqual(['Chosen'])
  })

  it('clears default selections that no longer match the live state', async () => {
    mount('<option selected>Default</option><option>Current</option>', true)
    select.options[0].selected = false
    select.options[1].selected = true
    expect(await selectedLabels()).toEqual(['Current'])
  })
})
