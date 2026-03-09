// .github/scripts/classify-issues.js
// Classifies all open issues by importance and applies priority labels.
// Usage: GITHUB_TOKEN=<token> node .github/scripts/classify-issues.js
// Dry-run (no changes): GITHUB_TOKEN=<token> node .github/scripts/classify-issues.js --dry-run

import https from 'https';

const repo = 'zumerlab/snapdom';
const [owner, repoName] = repo.split('/');
const token = process.env.GITHUB_TOKEN;
const dryRun = process.argv.includes('--dry-run');

if (!token) {
  console.error('Error: GITHUB_TOKEN environment variable is required.');
  process.exit(1);
}

// ─── Classification rules ────────────────────────────────────────────────────

// Keywords for each priority tier
const CRITICAL_KEYWORDS = [
  'the source image cannot be decoded',
  'crash', 'data loss',
  '报错',  // Chinese: "reports an error"
];

const HIGH_PRIORITY_KEYWORDS = [
  'pseudo-element', 'pseudo element',
  'iframe',
  'font', '字体',
  'background-image', 'background image',
  'cross-origin', 'cross origin',
  'checkbox',
  'radio button', 'radio ',
  'webkit-text-stroke', 'text-stroke',
  'transform', 'matrix',
  'katex',
  'scrollbar', 'scroll position',
  'border style',
  'svg image',
  'video',
];

const LOW_KEYWORDS = [
  'why ', 'how can', 'how do',
  'is it possible', 'does it support',
  'configuration option', 'timeout',
  'cors',
  'wicg', 'experiment',
  'announcement', 'inactivity',
  'plugin idea',
];

const SAFARI_KEYWORDS = ['safari', 'ios', 'webkit', 'iphone', 'ipad', 'apple'];
const FIREFOX_KEYWORDS = ['firefox', 'mozilla', 'gecko'];

/**
 * Determines the priority label for a given issue based on its title and body.
 * Returns one of: 'priority: critical', 'priority: high', 'priority: medium', 'priority: low'
 */
function classifyPriority(issue) {
  const title = (issue.title || '').toLowerCase();
  const body  = (issue.body  || '').toLowerCase();
  const text  = title + ' ' + body;

  if (CRITICAL_KEYWORDS.some(k => text.includes(k))) {
    return 'priority: critical';
  }

  if (LOW_KEYWORDS.some(k => text.includes(k))) {
    return 'priority: low';
  }

  if (HIGH_PRIORITY_KEYWORDS.some(k => text.includes(k))) {
    return 'priority: high';
  }

  return 'priority: medium';
}

/**
 * Additional type/browser labels to add based on content.
 */
function classifyExtra(issue) {
  const title = (issue.title || '').toLowerCase();
  const body  = (issue.body  || '').toLowerCase();
  const text  = title + ' ' + body;
  const extra = [];

  if (SAFARI_KEYWORDS.some(k => text.includes(k)))  extra.push('safari-hates-me');
  if (FIREFOX_KEYWORDS.some(k => text.includes(k))) extra.push('Fails on Firefox');

  return extra;
}

// ─── GitHub API helpers ───────────────────────────────────────────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'User-Agent': 'classify-issues-script',
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${token}`,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${buf}`));
        } else {
          resolve(buf ? JSON.parse(buf) : null);
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function fetchOpenIssues() {
  const issues = [];
  let page = 1;
  while (true) {
    const batch = await request('GET', `/repos/${owner}/${repoName}/issues?state=open&per_page=100&page=${page}`);
    if (!batch || batch.length === 0) break;
    // Exclude pull requests (GitHub includes PRs in /issues endpoint)
    issues.push(...batch.filter(i => !i.pull_request));
    if (batch.length < 100) break;
    page++;
  }
  return issues;
}

async function addLabels(issueNumber, labels) {
  await request('POST', `/repos/${owner}/${repoName}/issues/${issueNumber}/labels`, { labels });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`Fetching open issues for ${repo}…`);
  const issues = await fetchOpenIssues();
  console.log(`Found ${issues.length} open issues.\n`);

  if (dryRun) {
    console.log('DRY RUN — no labels will be applied.\n');
  }

  const summary = { critical: [], high: [], medium: [], low: [] };

  for (const issue of issues) {
    const existingLabels = issue.labels.map(l => l.name);
    const hasPriority = existingLabels.some(l => l.startsWith('priority:'));

    const priorityLabel = classifyPriority(issue);
    const extraLabels   = classifyExtra(issue).filter(l => !existingLabels.includes(l));
    const newLabels     = [
      ...(hasPriority ? [] : [priorityLabel]),
      ...extraLabels
    ];

    const level = priorityLabel.replace('priority: ', '');
    summary[level].push(`#${issue.number}: ${issue.title}`);

    if (newLabels.length === 0) {
      console.log(`#${issue.number} — no new labels needed (existing: ${existingLabels.join(', ') || 'none'})`);
      continue;
    }

    console.log(`#${issue.number} [${priorityLabel}] — adding: ${newLabels.join(', ')}`);

    if (!dryRun) {
      try {
        await addLabels(issue.number, newLabels);
      } catch (err) {
        console.error(`  ✗ Failed to label #${issue.number}: ${err.message}`);
      }
    }
  }

  console.log('\n── Classification Summary ──────────────────────────');
  for (const [level, list] of Object.entries(summary)) {
    console.log(`\n${level.toUpperCase()} (${list.length}):`);
    list.forEach(t => console.log(`  ${t}`));
  }
})();

