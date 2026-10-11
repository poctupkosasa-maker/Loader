import { contextBridge, ipcRenderer } from 'electron';
import type { LauncherAPI } from '../shared/types';

const subscribe = <T,>(channel: string, listener: (payload: T) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const api: LauncherAPI = {
  getBootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  getManifest: (forceRefresh) => ipcRenderer.invoke('versions:manifest', forceRefresh),
  getInstalledVersions: (profileId) => ipcRenderer.invoke('versions:installed', profileId),
  installVersion: (profileId, versionId) => ipcRenderer.invoke('versions:install', profileId, versionId),
  installLoader: (profileId, loader, gameVersion) => ipcRenderer.invoke('loaders:install', profileId, loader, gameVersion),

  loginOffline: (username) => ipcRenderer.invoke('auth:offline', username),
  loginMicrosoft: () => ipcRenderer.invoke('auth:microsoft'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  cancelMicrosoftLogin: () => ipcRenderer.invoke('auth:cancel'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),

  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  createProfile: (name) => ipcRenderer.invoke('profiles:create', name),
  updateProfile: (profileId, patch) => ipcRenderer.invoke('profiles:update', profileId, patch),
  deleteProfile: (profileId) => ipcRenderer.invoke('profiles:delete', profileId),
  setActiveProfile: (profileId) => ipcRenderer.invoke('profiles:activate', profileId),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  choosePath: (kind) => ipcRenderer.invoke('dialog:choose-path', kind),

  searchMods: (query, profileId, source) => ipcRenderer.invoke('mods:search', query, profileId, source),
  listMods: (profileId) => ipcRenderer.invoke('mods:list', profileId),
  installMod: (profileId, source, projectId, versionId) => ipcRenderer.invoke('mods:install', profileId, source, projectId, versionId),
  setModEnabled: (profileId, fileName, enabled) => ipcRenderer.invoke('mods:enabled', profileId, fileName, enabled),

  launch: (profileId) => ipcRenderer.invoke('game:launch', profileId),
  stopGame: () => ipcRenderer.invoke('game:stop'),

  onDownloadProgress: (listener) => subscribe('download:progress', listener),
  onConsoleLine: (listener) => subscribe('console:line', listener),
  onAuthEvent: (listener) => subscribe('auth:event', listener),
  onLaunchState: (listener) => subscribe('game:state', listener),
};

contextBridge.exposeInMainWorld('launcher', api);
