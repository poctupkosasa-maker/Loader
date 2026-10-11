/*
 * Publishes the smoke-test report as a pull request comment so the outcome of a
 * headless run is reviewable without downloading artifacts. The comment is
 * updated in place on every run.
 */
const fs = require('node:fs');
const path = require('node:path');

const MARKER = '<!-- ui-smoke-report -->';
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const REPOSITORY = process.env.GITHUB_REPOSITORY;
const ISSUE = process.env.SMOKE_PR;
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

const readWhenPresent = (file, lines) => {
  try {
    const content = fs.readFileSync(file, 'utf8').split('\n');
    const tail = content.length > lines ? content.slice(-lines) : content;
    return `\n<details><summary>${path.basename(file)} (last ${tail.length} lines)</summary>\n\n\`\`\`text\n${tail.join('\n').slice(-12000)}\n\`\`\`\n</details>\n`;
  } catch {
    return '';
  }
};

async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'loader-smoke-test',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`${method} ${url} failed: ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json().catch(() => null);
}

async function main() {
  const report = JSON.parse(fs.readFileSync('smoke-report.json', 'utf8'));
  const rows = report.scenarios.map((scenario) => {
    const state = scenario.state || {};
    const rendered = typeof state.rootChildren === 'number' && state.rootChildren > 0;
    const logs = (scenario.logs || []).slice(0, 2).join(' ').replace(/\|/g, '/').slice(0, 180) || 'none';
    return `| \`${scenario.name}\` | ${rendered ? 'rendered' : 'blank'} | ${state.rootChildren ?? '?'} | ${logs} |`;
  });

  const body = [
    MARKER,
    '## Renderer smoke test',
    '',
    `Run ${process.env.GITHUB_RUN_ID || ''} on \`${process.env.GITHUB_SHA?.slice(0, 7) || ''}\`.`,
    '',
    '| scenario | result | #root children | console |',
    '| --- | --- | --- | --- |',
    ...(rows.length ? rows : ['| — | no scenarios recorded | — | — |']),
    report.fatal?.length ? `\n**Probe failures**\n\n\`\`\`text\n${report.fatal.join('\n').slice(0, 1500)}\n\`\`\`\n` : '',
    readWhenPresent('probe-app.log', 120),
    readWhenPresent('probe-renderer.log', 40),
  ].join('\n');

  const comments = await request('GET', `${API}/repos/${REPOSITORY}/issues/${ISSUE}/comments?per_page=100`);
  const existing = (comments || []).find((comment) => typeof comment.body === 'string' && comment.body.includes(MARKER));
  if (existing) {
    await request('PATCH', `${API}/repos/${REPOSITORY}/issues/comments/${existing.id}`, { body });
    console.log(`Updated smoke report comment ${existing.id}`);
  } else {
    const created = await request('POST', `${API}/repos/${REPOSITORY}/issues/${ISSUE}/comments`, { body });
    console.log(`Created smoke report comment ${created?.id}`);
  }
}

main().catch((error) => {
  console.log(`Could not publish smoke report: ${error.message}`);
  process.exit(0);
});
