/*
 * Renders every theme of the built renderer and saves a screenshot per theme.
 *
 *   SMOKE_PAGE=file:///path/dist/index.html SMOKE_THEMES=a,b,c node this
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = process.env.SMOKE_PAGE;
const THEMES = (process.env.SMOKE_THEMES || '').split(',').filter(Boolean);
const OUT_DIR = process.env.SMOKE_OUT || path.join(process.cwd(), 'smoke-screenshots');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PROBE = `(() => {
  const root = document.getElementById('root');
  const panel = document.querySelector('.panel');
  const style = (element) => element ? getComputedStyle(element) : null;
  return {
    theme: document.documentElement.dataset.theme || '',
    rootChildren: root ? root.childElementCount : -1,
    body: style(document.body)?.backgroundColor || '',
    panel: panel ? getComputedStyle(panel).backgroundColor : '',
    accent: style(document.documentElement).getPropertyValue('--accent').trim(),
    text: style(document.documentElement).getPropertyValue('--ink-26').trim(),
  };
})()`;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    backgroundColor: '#101210',
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await window.loadURL(PAGE);
  await sleep(3000);

  const results = [];
  const capture = async (theme, page) => {
    const state = await window.webContents.executeJavaScript(PROBE, true);
    const image = await window.webContents.capturePage();
    const file = path.join(OUT_DIR, `theme-${theme}-${page}.png`);
    fs.writeFileSync(file, image.toPNG());
    results.push({ theme, page, ...state, screenshot: path.basename(file) });
  };

  for (const theme of THEMES) {
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; true`, true);
    await sleep(650);
    await capture(theme, 'home');
  }

  // The settings page shows the theme gallery itself.
  const openedSettings = await window.webContents.executeJavaScript(`(() => {
    const target = [...document.querySelectorAll('.nav-item')].find((item) => /settings|настройки/i.test(item.textContent || ''));
    if (!target) return false;
    target.click();
    return true;
  })()`, true);
  await sleep(1200);
  if (openedSettings) {
    for (const theme of THEMES) {
      await window.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; true`, true);
      await sleep(500);
      await capture(theme, 'settings');
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'theme-shots.json'), JSON.stringify({ results, openedSettings }, null, 2));
  console.log('THEME_SHOTS ' + JSON.stringify({ openedSettings, themes: results.length, applied: results.every((item) => item.rootChildren > 0) }));
  console.log(JSON.stringify(results.slice(0, 4)));
  app.exit(0);
}

main().catch((error) => {
  console.log('THEME_SHOTS ' + JSON.stringify({ fatal: String(error && error.stack) }));
  app.exit(1);
});
