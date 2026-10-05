// One source-code treatment for static articles, generated examples and detail dialogs.
(() => {
  const sourceNodes = new WeakMap()
  const sourceText = node => {
    const copy = node.cloneNode(true)
    copy.querySelectorAll('button').forEach(button => button.remove())
    copy.querySelectorAll('br').forEach(br => br.replaceWith('\n'))
    return copy.textContent
  }
  function language(block, text) {
    const declared = (block.className + ' ' + (block.querySelector('code')?.className || '')).match(/(?:lang|language)-(\w+)/)?.[1]
    if (declared && Prism.languages[declared]) return declared
    if (/^\s*(?:npm |npx |pnpm |yarn |git |curl |# |\$ )/.test(text)) return 'bash'
    if (/^\s*[\[{]/.test(text) && /"\w+"\s*:/.test(text)) return 'json'
    if (/^\s*</.test(text)) return 'markup'
    if (/^\s*(?:[.#][\w-]+|:root|@media)\s*\{/.test(text)) return 'css'
    if (/\b(?:interface|type)\s+\w+|:\s*(?:string|number|boolean)\b/.test(text)) return 'typescript'
    if (/<[A-Za-z][\w.-]*(?:\s|>|\/)/.test(text)) return 'jsx'
    return 'javascript'
  }
  function enhance(block) {
    if (block.closest('[data-results],#capture-output,.demo-print,[data-pdf-output]') || block.dataset.codeOutput !== undefined) return
    let content = block.querySelector(':scope > code')
    if (!content) {
      const text = sourceText(block)
      if (!text.trim()) return
      content = document.createElement('code')
      content.textContent = text
      block.replaceChildren(content)
    }
    const text = sourceText(content)
    if (sourceNodes.get(content) === text) return
    sourceNodes.set(content, text)
    const lang = language(block, text)
    content.innerHTML = Prism.highlight(text, Prism.languages[lang], lang)
    content.dataset.language = lang
    block.classList.add('site-code-block')
    const wrap = block.closest('.pane-code,.code-block-wrap,.modal-code-wrap')
    let button = wrap?.querySelector('button[data-copy],button[data-copy-text],button.copy-btn,#capture-copy')
    if (button?.id === 'capture-copy') return // The Playground already handles its clipboard and errors.
    if (button) button.remove()
    button = block.querySelector(':scope > .code-copy')
    if (!button) {
      button = document.createElement('button')
      button.type = 'button'
      button.className = 'code-copy'
      button.textContent = 'Copy'
      button.setAttribute('aria-label', 'Copy code')
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(sourceText(content))
          button.textContent = 'Copied'; button.classList.add('copied'); button.setAttribute('aria-label', 'Code copied')
        } catch { button.textContent = 'Copy failed'; button.setAttribute('aria-label', 'Copy failed. Select the code and copy it manually.') }
        setTimeout(() => { button.textContent = 'Copy'; button.classList.remove('copied'); button.setAttribute('aria-label', 'Copy code') }, 1500)
      })
      block.append(button)
    }
  }
  function scan(root) {
    if (root.nodeType === Node.TEXT_NODE) root = root.parentElement
    if (!(root instanceof Element) && root !== document) return
    const block = root.closest?.('pre,.code-block')
    if (block) enhance(block)
    else {
      if (root.matches?.('pre,.code-block')) enhance(root)
      root.querySelectorAll('pre,.code-block').forEach(enhance)
    }
  }
  function start() {
    scan(document)
    new MutationObserver(records => {
      const roots = new Set(records.map(record => record.target))
      roots.forEach(scan)
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
})()
