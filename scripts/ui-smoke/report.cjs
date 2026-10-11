/*
 * Merges the probe reports, publishes the result as check annotations and
 * writes smoke-report.json for the workflow summary.
 */
const fs = require('node:fs');
const path = require('node:path');

const OUT_DIR = process.env.SMOKE_OUT || path.join(process.cwd(), 'smoke-screenshots');
const REPORT_PATH = path.join(process.cwd(), 'smoke-report.json');

const escape = (value) => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const files = fs.existsSync(OUT_DIR)
  ? fs.readdirSync(OUT_DIR).filter((file) => file.endsWith('.json') && file !== 'smoke-report.json')
  : [];

const scenarios = [];
const fatal = [];
for (const file of files) {
  const parsed = JSON.parse(fs.readFileSync(path.join(OUT_DIR, file), 'utf8'));
  if (parsed.fatal) fatal.push(`${file}: ${parsed.fatal}`);
  if (Array.isArray(parsed.scenarios)) scenarios.push(...parsed.scenarios);
}

const report = { scenarios, fatal };
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

for (const entry of fatal) {
  console.log(`::error title=Smoke probe crashed::${escape(entry)}`);
}

let failed = false;
for (const scenario of scenarios) {
  const state = scenario.state || {};
  const rendered = typeof state.rootChildren === 'number' && state.rootChildren > 0;
  const logs = (scenario.logs || []).slice(0, 3).join(' | ') || 'no console errors';
  const summary = `rendered=${rendered} rootChildren=${state.rootChildren} stylesheets=${state.styleSheets} background=${state.background} location=${state.location} | logs: ${logs}`;
  console.log(`::${rendered ? 'notice' : 'error'} title=Smoke ${scenario.name}::${escape(summary)}`);
  if (scenario.name === 'packaged-app' && !rendered) failed = true;
}

if (!scenarios.some((scenario) => scenario.name === 'packaged-app')) {
  console.log('::error title=Smoke packaged-app::the packaged application was never inspected');
  failed = true;
}

console.log(JSON.stringify(report));
if (failed) {
  console.log('::error title=Smoke result::the packaged application did not render its interface');
  process.exit(1);
}
