/*
 * Packaged-app smoke probe.
 *
 * Connects to an already running Loader build through the Chrome DevTools
 * Protocol, reports whether the renderer mounted, and saves a screenshot.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = Number(process.env.CDP_PORT || 9222);
const OUT_DIR = process.env.SMOKE_OUT || path.join(process.cwd(), 'smoke-screenshots');
const WAIT_MS = Number(process.env.SMOKE_WAIT_MS || 5000);
const LABEL = process.env.SMOKE_LABEL || 'packaged-app';

const DOM_STATE = `(() => {
  const root = document.getElementById('root');
  const body = getComputedStyle(document.body);
  return {
    rootChildren: root ? root.childElementCount : -1,
    text: ((root && root.innerText) || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
    styleSheets: document.styleSheets.length,
    background: body.backgroundColor,
    title: document.title,
    location: location.href,
  };
})()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('timeout')));
  });
}

async function findPageTarget() {
  const deadline = Date.now() + 90_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`no debuggable page appeared on port ${PORT}${lastError ? ` (${lastError.message})` : ''}`);
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url, { perMessageDeflate: false });
    this.nextId = 0;
    this.pending = new Map();
    this.logs = [];
    this.socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method === 'Log.entryAdded' && message.params?.entry) {
        const entry = message.params.entry;
        if (entry.level === 'error' || entry.level === 'warning') this.logs.push(`log.${entry.level}: ${entry.text} ${entry.url || ''}`.slice(0, 300));
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params?.exceptionDetails;
        this.logs.push(`exception: ${details?.exception?.description || details?.text || 'unknown'}`.slice(0, 300));
      }
    });
  }

  open() {
    return new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 20_000);
    });
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const target = await findPageTarget();
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Log.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await sleep(WAIT_MS);

  const evaluated = await cdp.send('Runtime.evaluate', { expression: DOM_STATE, returnByValue: true, awaitPromise: true });
  const state = evaluated.result?.value ?? { error: evaluated.exceptionDetails?.text || 'no value' };

  const shot = path.join(OUT_DIR, `${LABEL}.png`);
  try {
    const capture = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(shot, Buffer.from(capture.data, 'base64'));
  } catch (error) {
    cdp.logs.push(`screenshot failed: ${error.message}`);
  }

  const report = { scenarios: [{ name: LABEL, url: target.url, state, logs: cdp.logs.slice(0, 20), screenshot: shot }] };
  fs.writeFileSync(path.join(OUT_DIR, `app-probe-${LABEL}.json`), JSON.stringify(report, null, 2));
  console.log('SMOKE_RESULT ' + JSON.stringify(report));
  cdp.socket.close();
}

main().catch((error) => {
  const fatal = String(error && error.stack);
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, `app-probe-${LABEL}-fatal.json`), JSON.stringify({ fatal }, null, 2));
  } catch { /* the workflow still surfaces the stdout report */ }
  console.log('SMOKE_RESULT ' + JSON.stringify({ fatal }));
  process.exit(1);
});
