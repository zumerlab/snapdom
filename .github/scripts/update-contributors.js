// .github/scripts/update-contributors.js
import { writeFileSync, readFileSync } from 'fs';

const repo = 'zumerlab/snapdom';
const readmePaths = ['README.md', 'README_CN.md'];
const size = 40;

// Cuentas que no son personas (además de todo lo que GitHub marca como Bot)
const excluded = new Set([
  'claude',
  'chatgpt',
  'codex',
  'copilot',
  'cursoragent',
  'devin-ai-integration',
  'github-actions',
  'dependabot',
]);

function isHuman(c) {
  const login = c.login.toLowerCase();
  if (c.type !== 'User') return false;
  if (login.endsWith('[bot]')) return false;
  return !excluded.has(login);
}

async function fetchContributors() {
  const headers = {
    'User-Agent': 'GitHub Action',
    Accept: 'application/vnd.github+json',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const all = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/contributors?per_page=100&page=${page}`,
      { headers }
    );
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

// GitHub borra el atributo style en los README, así que el redondeo
// se hace en la imagen misma (images.weserv.nl recorta en círculo).
function avatarUrl(c) {
  const src = `${c.avatar_url}${c.avatar_url.includes('?') ? '&' : '?'}s=${size * 2}`;
  const params = new URLSearchParams({
    url: src,
    w: String(size * 2),
    h: String(size * 2),
    fit: 'cover',
    mask: 'circle',
    output: 'png',
    maxage: '7d',
  });
  return `https://images.weserv.nl/?${params}`.replace(/&/g, '&amp;');
}

function buildHTML(contributors) {
  return (
    '\n<p>\n' +
    contributors
      .map(
        (c) =>
          `<a href="${c.html_url}" title="${c.login}"><img src="${avatarUrl(c)}" width="${size}" height="${size}" alt="${c.login}"/></a>`
      )
      .join('\n') +
    '\n</p>\n'
  );
}

function updateReadmes(contributorHTML) {
  for (const path of readmePaths) {
    const content = readFileSync(path, 'utf8');
    const updated = content.replace(
      /<!-- CONTRIBUTORS:START -->([\s\S]*?)<!-- CONTRIBUTORS:END -->/,
      () => `<!-- CONTRIBUTORS:START -->${contributorHTML}<!-- CONTRIBUTORS:END -->`
    );
    writeFileSync(path, updated);
  }
}

fetchContributors()
  .then((contributors) => {
    const humans = contributors.filter(isHuman);
    updateReadmes(buildHTML(humans));
    console.log(`Contributors: ${humans.length} (de ${contributors.length})`);
  })
  .catch((err) => {
    console.error('Error fetching contributors:', err);
    process.exit(1);
  });
