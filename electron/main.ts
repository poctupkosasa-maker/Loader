import 'dotenv/config';
import { app, BrowserWindow, net, protocol } from 'electron';
import log from 'electron-log/main';
import { isAbsolute, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ConsoleLine, DownloadProgress } from '../shared/types';
import { registerIpc } from './ipc';
import { AuthService } from './services/AuthService';
import { DatabaseService } from './services/DatabaseService';
import { DownloadService } from './services/DownloadService';
import { JavaService } from './services/JavaService';
import { LaunchService } from './services/LaunchService';
import { LoaderService } from './services/LoaderService';
import { ModService } from './services/ModService';
import { ProfileService } from './services/ProfileService';
import { SecureStore } from './services/SecureStore';
import { VersionService } from './services/VersionService';

/**
 * The packaged renderer is served from a privileged custom scheme instead of
 * file://. A file:// page has an opaque origin: the page CSP cannot match
 * 'self', storage APIs stay unavailable, and Chromium applies stricter rules to
 * module scripts there than to a real origin. Serving the bundle from a
 * privileged scheme keeps production behaviour aligned with the dev server and
 * follows Electron's security guide (recommendation 18).
 */
const RENDERER_SCHEME = 'app';
const RENDERER_HOST = 'loader';
const RENDERER_URL = `${RENDERER_SCHEME}://${RENDERER_HOST}/index.html`;
const RENDERER_ROOT = join(__dirname, '../../dist');

protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

let mainWindow: BrowserWindow | null = null;
let database: DatabaseService | null = null;

function registerRendererProtocol(): void {
  protocol.handle(RENDERER_SCHEME, async (request) => {
    try {
      const { pathname } = new URL(request.url);
      const decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
      const candidate = join(RENDERER_ROOT, decoded);
      const traversal = relative(RENDERER_ROOT, candidate);
      if (traversal.startsWith('..') || isAbsolute(traversal)) {
        return new Response('Forbidden', { status: 403 });
      }
      return await net.fetch(pathToFileURL(candidate).toString());
    } catch (error) {
      log.warn('Renderer asset request failed:', request.url, error);
      return new Response('Not found', { status: 404 });
    }
  });
}

function sendToRenderer<T>(channel: string, payload: T): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function emitConsole(line: ConsoleLine): void {
  const prefix = `[${line.stream}]`;
  if (line.stream === 'stderr') log.warn(`${prefix} ${line.text}`);
  else log.info(`${prefix} ${line.text}`);
  sendToRenderer('console:line', line);
}

function emitProgress(progress: DownloadProgress): void {
  sendToRenderer('download:progress', progress);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#101210',
    title: 'Loader — Minecraft Launcher',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  const startUrl = app.isPackaged ? RENDERER_URL : 'http://localhost:5173';
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const permitted = app.isPackaged
      ? url.startsWith(`${RENDERER_SCHEME}://${RENDERER_HOST}/`)
      : url.startsWith('http://localhost:5173');
    if (!permitted) event.preventDefault();
  });
  void mainWindow.loadURL(startUrl).catch((error: unknown) => {
    log.error('Renderer failed to load:', error);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

async function initialize(): Promise<void> {
  log.initialize();
  log.transports.file.level = 'info';
  log.info('Starting Loader Minecraft Launcher');

  database = new DatabaseService(app.getPath('userData'));
  const secureStore = new SecureStore();
  const auth = new AuthService(database, secureStore, (event) => sendToRenderer('auth:event', event));
  const downloads = new DownloadService(emitProgress, 6);
  const versions = new VersionService(database, downloads);
  const java = new JavaService();
  const loaders = new LoaderService(database, downloads, versions, java, emitConsole);
  const mods = new ModService(database, downloads, versions);
  const profiles = new ProfileService(database);
  const launch = new LaunchService(
    database,
    auth,
    versions,
    java,
    emitConsole,
    (state) => sendToRenderer('game:state', state),
  );

  registerIpc({
    database,
    auth,
    versions,
    loaders,
    profiles,
    mods,
    launch,
    getMainWindow: () => mainWindow,
  });
  if (app.isPackaged) registerRendererProtocol();
  createWindow();
}

app.whenReady().then(() => initialize()).catch((error: unknown) => {
  log.error('Launcher initialization failed:', error);
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  try {
    database?.close();
  } catch (error) {
    log.error('Could not close SQLite database cleanly:', error);
  }
});

process.on('uncaughtException', (error) => log.error('Uncaught exception:', error));
process.on('unhandledRejection', (reason) => log.error('Unhandled rejection:', reason));
