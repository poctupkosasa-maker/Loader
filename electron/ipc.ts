import { ipcMain, dialog, shell, type BrowserWindow } from 'electron';
import type { AppSettings, LoaderKind } from '../shared/types';
import { AuthService } from './services/AuthService';
import { DatabaseService } from './services/DatabaseService';
import { LaunchService } from './services/LaunchService';
import { LoaderService } from './services/LoaderService';
import { ModService } from './services/ModService';
import { ProfileService } from './services/ProfileService';
import { VersionService } from './services/VersionService';

export interface IpcServices {
  database: DatabaseService;
  auth: AuthService;
  versions: VersionService;
  loaders: LoaderService;
  profiles: ProfileService;
  mods: ModService;
  launch: LaunchService;
  getMainWindow: () => BrowserWindow | null;
}

const stringArg = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
};
const sourceArg = (value: unknown): 'modrinth' | 'curseforge' => {
  if (value !== 'modrinth' && value !== 'curseforge') throw new Error('Mod source is invalid.');
  return value;
};

/** Registers the only renderer entry-points. No Node objects cross the context bridge. */
export function registerIpc(services: IpcServices): void {
  const handle = (channel: string, listener: (...args: any[]) => unknown) => ipcMain.handle(channel, (_event, ...args) => listener(...args));

  handle('app:bootstrap', async () => {
    const active = services.database.getActiveProfile();
    return {
      account: services.database.getAccount(),
      profiles: services.database.getProfiles(),
      activeProfileId: active.id,
      settings: services.database.getSettings(),
      installedVersions: await services.versions.getInstalledVersions(active.id),
      microsoftConfigured: services.auth.isConfigured,
    };
  });
  handle('versions:manifest', (force?: boolean) => services.versions.getManifest(Boolean(force)));
  handle('versions:installed', (profileId: unknown) => services.versions.getInstalledVersions(stringArg(profileId, 'Profile')));
  handle('versions:install', (profileId: unknown, versionId: unknown) => services.versions.installVersion(stringArg(profileId, 'Profile'), stringArg(versionId, 'Version')));
  handle('loaders:install', (profileId: unknown, loader: unknown, gameVersion: unknown) => {
    const validLoaders: LoaderKind[] = ['fabric', 'forge', 'quilt', 'neoforge'];
    if (typeof loader !== 'string' || !validLoaders.includes(loader as LoaderKind)) throw new Error('Mod loader is invalid.');
    return services.loaders.install(stringArg(profileId, 'Profile'), loader as Exclude<LoaderKind, 'vanilla'>, stringArg(gameVersion, 'Minecraft version'));
  });

  handle('auth:offline', (username: unknown) => services.auth.loginOffline(stringArg(username, 'Username')));
  handle('auth:microsoft', async () => {
    await services.auth.beginMicrosoftLogin();
    return { started: true as const };
  });
  handle('auth:logout', () => services.auth.logout());
  handle('auth:cancel', () => services.auth.cancelMicrosoftLogin());
  handle('app:open-external', async (rawUrl: unknown) => {
    const url = stringArg(rawUrl, 'URL');
    const parsed = new URL(url);
    const allowedHosts = new Set(['microsoft.com', 'www.microsoft.com', 'aka.ms', 'login.live.com', 'modrinth.com', 'www.modrinth.com', 'curseforge.com', 'www.curseforge.com', 'support.modrinth.com']);
    if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) throw new Error('Only Microsoft verification links can be opened from the launcher.');
    await shell.openExternal(parsed.toString());
  });

  handle('profiles:list', () => services.profiles.list());
  handle('profiles:create', (name: unknown) => services.profiles.create(stringArg(name, 'Profile name')));
  handle('profiles:update', (profileId: unknown, patch: unknown) => {
    if (!patch || typeof patch !== 'object') throw new Error('Profile changes are invalid.');
    const source = patch as Record<string, unknown>;
    const safePatch: Record<string, string> = {};
    for (const key of ['name', 'gameDir', 'versionId', 'loader']) {
      const value = source[key];
      if (value !== undefined) {
        if (typeof value !== 'string' || value.length > 2048) throw new Error(`Profile ${key} is invalid.`);
        if (key === 'loader' && !['vanilla', 'fabric', 'forge', 'quilt', 'neoforge'].includes(value)) throw new Error('Profile loader is invalid.');
        if (key === 'versionId' && !/^[A-Za-z0-9._+-]{1,100}$/.test(value)) throw new Error('Profile version is invalid.');
        safePatch[key] = value;
      }
    }
    return services.profiles.update(stringArg(profileId, 'Profile'), safePatch as Parameters<ProfileService['update']>[1]);
  });
  handle('profiles:delete', (profileId: unknown) => services.profiles.delete(stringArg(profileId, 'Profile')));
  handle('profiles:activate', (profileId: unknown) => services.profiles.setActive(stringArg(profileId, 'Profile')));

  handle('settings:get', () => services.database.getSettings());
  handle('settings:save', (value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Settings are invalid.');
    const settings = value as AppSettings;
    const minRam = Number(settings.minRam);
    const maxRam = Number(settings.maxRam);
    if (!Number.isFinite(minRam) || !Number.isFinite(maxRam) || minRam < 1 || maxRam > 64 || minRam > maxRam) {
      throw new Error('RAM settings must be between 1 and 64 GB, with minimum no greater than maximum.');
    }
    if (typeof settings.javaPath !== 'string' || typeof settings.javaArgs !== 'string') throw new Error('Java settings are invalid.');
    const safeSettings: AppSettings = {
      ...services.database.getSettings(),
      minRam: Math.round(minRam),
      maxRam: Math.round(maxRam),
      javaPath: settings.javaPath.slice(0, 2048),
      javaArgs: settings.javaArgs.slice(0, 4000),
      language: settings.language === 'ru' ? 'ru' : 'en',
      gameDir: typeof settings.gameDir === 'string' ? settings.gameDir.slice(0, 2048) : '',
    };
    return services.database.saveSettings(safeSettings);
  });
  handle('dialog:choose-path', async (kind: unknown) => {
    const mainWindow = services.getMainWindow();
    if (kind === 'directory') {
      const options = { title: 'Choose game directory', properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : result.filePaths[0] ?? null;
    }
    if (kind === 'java') {
      const filters = process.platform === 'win32' ? [{ name: 'Java executable', extensions: ['exe'] }] : [{ name: 'Java executable', extensions: ['*'] }];
      const options = { title: 'Choose Java executable', properties: ['openFile'] as Array<'openFile'>, filters };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : result.filePaths[0] ?? null;
    }
    throw new Error('Path chooser type is invalid.');
  });

  handle('mods:search', (query: unknown, profileId: unknown, source: unknown) => services.mods.search(
    typeof query === 'string' ? query.slice(0, 120) : '', stringArg(profileId, 'Profile'), sourceArg(source),
  ));
  handle('mods:list', (profileId: unknown) => services.mods.list(stringArg(profileId, 'Profile')));
  handle('mods:install', (profileId: unknown, source: unknown, projectId: unknown, versionId?: unknown) => services.mods.install(
    stringArg(profileId, 'Profile'), sourceArg(source), stringArg(projectId, 'Project'), typeof versionId === 'string' ? versionId : undefined,
  ));
  handle('mods:enabled', (profileId: unknown, fileName: unknown, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Mod state is invalid.');
    return services.mods.setEnabled(stringArg(profileId, 'Profile'), stringArg(fileName, 'Mod file'), enabled);
  });

  handle('game:launch', (profileId: unknown) => services.launch.launch(stringArg(profileId, 'Profile')));
  handle('game:stop', () => services.launch.stop());
}
