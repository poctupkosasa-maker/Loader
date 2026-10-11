/*
 * Renderer smoke probe.
 *
 * Loads the production renderer bundle in a real Electron window and reports
 * whether the React application actually mounted. Used by the "Smoke test
 * packaged UI" workflow to catch blank-window regressions (for example when
 * the bundled HTML references its assets with URLs that do not resolve).
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SCENARIOS = JSON.parse(process.env.SMOKE_SCENARIOS || '[]');
const OUT_DIR = process.env.SMOKE_OUT || path.join(process.cwd(), 'smoke-screenshots');
const WAIT_MS = Number(process.env.SMOKE_WAIT_MS || 4000);

const DOM_STATE = `(() => {
  const root = document.getElementById('root');
  const body = getComputedStyle(document.body);
  return {
    rootChildren: root ? root.childElementCount : -1,
    text: ((root && root.innerText) || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
    styleSheets: document.styleSheets.length,
    background: body.backgroundColor,
    title: document.title,
  };
})()`;

async function runScenario(win, scenario) {
  const logs = [];
  const record = (entry) => logs.push(String(entry).slice(0, 300));

  const onConsole = (event, ...rest) => {
    const message = event && typeof event === 'object' && 'message' in event ? event.message : rest[1];
    const level = event && typeof event === 'object' && 'level' in event ? event.level : rest[0];
    record(`console.${level}: ${message}`);
  };
  const onFailLoad = (_event, code, description, url) => record(`did-fail-load ${code} ${description} ${url}`);
  const onPreloadError = (_event, preloadPath, error) => record(`preload-error ${preloadPath} ${error && error.message}`);

  win.webContents.on('console-message', onConsole);
  win.webContents.on('did-fail-load', onFailLoad);
  win.webContents.on('preload-error', onPreloadError);

  try {
    await win.loadURL(scenario.url);
  } catch (error) {
    record(`loadURL threw: ${error && error.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

  let state;
  try {
    state = await win.webContents.executeJavaScript(DOM_STATE, true);
  } catch (error) {
    state = { error: String(error && error.message) };
  }

  const shot = path.join(OUT_DIR, `${scenario.name}.png`);
  try {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(shot, image.toPNG());
  } catch (error) {
    record(`screenshot failed: ${error && error.message}`);
  }

  win.webContents.off('console-message', onConsole);
  win.webContents.off('did-fail-load', onFailLoad);
  win.webContents.off('preload-error', onPreloadError);

  return { ...scenario, state, logs: logs.slice(0, 20), screenshot: shot };
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    backgroundColor: '#101210',
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  const results = [];
  for (const scenario of SCENARIOS) {
    results.push(await runScenario(win, scenario));
  }

  fs.writeFileSync(path.join(OUT_DIR, 'renderer-probe.json'), JSON.stringify({ scenarios: results }, null, 2));
  console.log('SMOKE_RESULT ' + JSON.stringify({ scenarios: results }));
  app.exit(0);
}).catch((error) => {
  console.log('SMOKE_RESULT ' + JSON.stringify({ fatal: String(error && error.stack) }));
  app.exit(1);
});
