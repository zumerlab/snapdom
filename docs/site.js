const starNodes = document.querySelectorAll('[data-star-count]')

if (starNodes.length) {
  const compact = value => new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)

  fetch('https://api.github.com/repos/zumerlab/snapdom')
    .then(response => response.ok ? response.json() : Promise.reject())
    .then(repo => starNodes.forEach(node => { node.textContent = compact(repo.stargazers_count) }))
    .catch(() => {})
}
