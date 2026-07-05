(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn()
    else document.addEventListener('DOMContentLoaded', fn)
  }
  ready(function () {
    document.querySelectorAll('.code-block').forEach(function (block) {
      if (block.dataset.copyReady) return
      block.dataset.copyReady = '1'
      var code = block.textContent
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'code-copy'
      btn.setAttribute('aria-label', 'Copy code')
      btn.textContent = 'Copy'
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(code).then(function () {
          btn.textContent = 'Copied'
          btn.classList.add('copied')
          setTimeout(function () {
            btn.textContent = 'Copy'
            btn.classList.remove('copied')
          }, 1500)
        }).catch(function () {
          btn.textContent = 'Error'
          setTimeout(function () { btn.textContent = 'Copy' }, 1500)
        })
      })
      block.appendChild(btn)
    })
  })
})()
