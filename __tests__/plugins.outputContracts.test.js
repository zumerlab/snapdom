import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'
import { asciiExport, colorTint, htmlExport, contextExport, agentMap } from '../packages/plugins/index.js'

afterEach(() => { document.body.innerHTML = '' })
function element(html = '<button>Save</button>') {
  const root = document.createElement('div')
  root.style.cssText = 'position:absolute;left:10px;top:20px;width:100px;height:50px;background:black'
  root.innerHTML = html
  document.body.append(root)
  return root
}
const options = { dpr: 1, embedFonts: false }

describe('official plugin output contracts', () => {
  it('exports Unicode ASCII ramps without broken surrogate pairs and rejects empty ramps', async () => {
    const result = await snapdom(element(''), { ...options, plugins: [asciiExport({ width: 2, charset: ' 🟢' })] })
    const art = await result.toAscii()
    expect(art).toBe('🟢🟢\n')
    await expect(result.toAscii({ charset: '' })).rejects.toThrow('charset')
  })

  it('escapes document metadata without changing the captured markup', async () => {
    const root = element('<p>Frozen text</p>')
    const result = await snapdom(root, { ...options, plugins: [htmlExport({ title: '<Report & "notes">', lang: 'en" data-x="bad' })] })
    root.textContent = 'Changed later'
    const document = new DOMParser().parseFromString(await result.toHtml(), 'text/html')
    expect(document.title).toBe('<Report & "notes">')
    expect(document.documentElement.lang).toBe('en" data-x="bad')
    expect(document.documentElement.hasAttribute('data-x')).toBe(false)
    expect(document.body.textContent).toContain('Frozen text')
    expect(await result.toHtml({ fullDocument: false })).not.toContain('<title>')
  })

  it('rejects invalid semantic budgets instead of returning plausible empty evidence', async () => {
    expect(() => contextExport({ maxNodes: 0 })).toThrow('maxNodes')
    expect(() => contextExport({ maxTextLength: -1 })).toThrow('maxTextLength')
    const result = await snapdom(element(), { ...options, plugins: [agentMap({ needs: 'clone', image: false })] })
    await expect(result.toAgentMap({ maxImageWidth: 0 })).rejects.toThrow('maxImageWidth')
    expect((await result.toAgentMap()).map[0].n).toBe('Save')
    expect(() => colorTint({ opacity: 2 })).toThrow('opacity')
  })
})
