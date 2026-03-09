// .github/scripts/update-contributors.js
import { writeFileSync, readFileSync } from 'fs';
import https from 'https';

const repo = 'zumerlab/snapdom';
const readmePaths = ['README.md', 'README_CN.md']; 

function fetchContributors() {
  const options = {
    hostname: 'api.github.com',
    path: `/repos/${repo}/contributors`,
    headers: { 'User-Agent': 'GitHub Action', 'Accept': 'application/vnd.github.v3+json' }
  };

  return new Promise((resolve, reject) => {
    https
      .get(options, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(`GitHub API error: ${res.statusCode}`));
          }
        });
      })
      .on('error', reject);
  });
}

function buildHTML(contributors) {
  return (
    '\n<p>\n' +
    contributors
      .map((c) => {
        const avatar = `<a href="${c.html_url}" title="${c.login}"><img src="${c.avatar_url}&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="${c.login}"/></a>`;
        return avatar;
      })
      .join('\n') +
    '\n</p>\n'
  );
}

function updateReadmes(contributorHTML) {
  for (const path of readmePaths) {
    //try {
      const content = readFileSync(path, 'utf8');
      const updated = content.replace(
        /<!-- CONTRIBUTORS:START -->([\s\S]*?)<!-- CONTRIBUTORS:END -->/,
        `<!-- CONTRIBUTORS:START -->${contributorHTML}<!-- CONTRIBUTORS:END -->`
      );
      writeFileSync(path, updated);
    //} catch () {
    //}
  }
}

fetchContributors()
  .then((contributors) => {
    const filtered = contributors.filter(
      (c) => c.type !== 'Bot' && c.login !== 'github-actions[bot]'
    );
    const html = buildHTML(filtered);
    updateReadmes(html);
  })
  .catch((err) => {
    console.error('Error fetching contributors:', err);
    process.exit(1);
  });
