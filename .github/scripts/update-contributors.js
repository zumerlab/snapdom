// .github/scripts/update-contributors.js
import { writeFileSync, readFileSync } from 'fs';
import https from 'https';

const repo = 'zumerlab/snapdom';
const readmePath = 'README.md';

function fetchContributors() {
  const options = {
    hostname: 'api.github.com',
    path: `/repos/${repo}/contributors`,
    headers: { 'User-Agent': 'GitHub Action', 'Accept': 'application/vnd.github.v3+json' }
  };

  return new Promise((resolve, reject) => {
    https.get(options, (res) => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`GitHub API error: ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

function buildHTML(contributors) {
  return (
    '\n<p align="">\n' +
    contributors
      .map(c => {
        const avatar = `<a href="${c.html_url}" title="${c.login}" style="display:inline-block;width:60px;height:60px;margin:5px;">
  <span style="
    display:inline-block;
    width:60px;
    height:60px;
    border-radius:50%;
    background-image:url('${c.avatar_url}&s=100');
    background-size:cover;
    background-position:center;
    background-repeat:no-repeat;
    display:inline-block;
  "></span>
</a>`;
        return avatar;
      })
      .join('\n') +
    '\n</p>\n'
  );
}


function updateReadme(contributorHTML) {
  const content = readFileSync(readmePath, 'utf8');
  const updated = content.replace(
    /<!-- CONTRIBUTORS:START -->([\s\S]*?)<!-- CONTRIBUTORS:END -->/,
    `<!-- CONTRIBUTORS:START -->${contributorHTML}<!-- CONTRIBUTORS:END -->`
  );
  writeFileSync(readmePath, updated);
}

fetchContributors()
  .then(contributors => {
    const filtered = contributors.filter(c => c.type !== 'Bot' && c.login !== 'github-actions[bot]');
    const html = buildHTML(filtered);
    updateReadme(html);
  })
  .catch(err => {
    console.error('Error fetching contributors:', err);
    process.exit(1);
  });
