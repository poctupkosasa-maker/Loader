import type {
  Account, AppSettings, AuthEvent, ConsoleLine, DownloadProgress, InstalledMod,
  InstalledVersion, LauncherAPI, LauncherProfile, ModSearchResult, VersionManifest,
} from '../../shared/types';

const desktopBridge = typeof window !== 'undefined' && 'launcher' in window ? window.launcher : null;
export const isDesktop = Boolean(desktopBridge);

// Browser preview fallback keeps the renderer explorable when it is opened outside Electron.
// All real downloads, account state, and game processes still run exclusively in the main process.
function createPreviewAPI(): LauncherAPI {
  const profile: LauncherProfile = {
    id: 'preview', name: 'Fabric survival', gameDir: '~/Library/Application Support/Loader/profiles/preview',
    versionId: 'fabric-loader-0.16.10-1.21.4', loader: 'fabric', createdAt: Date.now(), active: true,
  };
  let activeProfile = profile;
  let profiles = [profile];
  let account: Account | null = { username: 'Alex', uuid: '8667ba71-b85a-4004-af54-457a9734eed7', kind: 'offline' };
  let settings: AppSettings = { minRam: 2, maxRam: 6, javaPath: '', javaArgs: '', language: 'en', gameDir: profile.gameDir, curseForgeApiKeyConfigured: false };
  let mods: InstalledMod[] = [
    { fileName: 'sodium-fabric-0.6.5.jar', name: 'Sodium', version: '0.6.5', enabled: true, source: 'modrinth', projectId: 'AANobbMI' },
    { fileName: 'lithium-fabric-0.15.3.jar', name: 'Lithium', version: '0.15.3', enabled: true, source: 'modrinth', projectId: 'gvQqBUqZ' },
    { fileName: 'iris-fabric-1.8.8.jar', name: 'Iris Shaders', version: '1.8.8', enabled: false, source: 'modrinth', projectId: 'YL57xq9U' },
  ];
  const manifest: VersionManifest = {
    latest: { release: '1.21.4', snapshot: '26.1-snapshot-1' },
    versions: [
      { id: '1.21.4', type: 'release', url: '', time: '', releaseTime: '' },
      { id: '1.21.3', type: 'release', url: '', time: '', releaseTime: '' },
      { id: '1.21.2', type: 'release', url: '', time: '', releaseTime: '' },
      { id: '1.21.1', type: 'release', url: '', time: '', releaseTime: '' },
      { id: '1.21', type: 'release', url: '', time: '', releaseTime: '' },
      { id: '1.20.4', type: 'release', url: '', time: '', releaseTime: '' },
      { id: '26.1-snapshot-1', type: 'snapshot', url: '', time: '', releaseTime: '' },
      { id: '24w14potato', type: 'snapshot', url: '', time: '', releaseTime: '' },
      { id: 'b1.7.3', type: 'old_beta', url: '', time: '', releaseTime: '' },
      { id: 'a1.2.6', type: 'old_alpha', url: '', time: '', releaseTime: '' },
    ],
  };
  const logs: ConsoleLine[] = [];
  const progressListeners = new Set<(progress: DownloadProgress) => void>();
  const consoleListeners = new Set<(line: ConsoleLine) => void>();
  const authListeners = new Set<(event: AuthEvent) => void>();
  const stateListeners = new Set<(state: { running: boolean; message: string }) => void>();
  const emitLog = (text: string, stream: ConsoleLine['stream'] = 'system') => {
    const line = { id: crypto.randomUUID(), timestamp: Date.now(), stream, text };
    logs.push(line);
    consoleListeners.forEach((listener) => listener(line));
  };
  const versions: InstalledVersion[] = [
    { id: '1.21.4', type: 'release', loader: 'vanilla', gameVersion: '1.21.4', installedAt: Date.now() },
    { id: 'fabric-loader-0.16.10-1.21.4', type: 'fabric', loader: 'fabric', gameVersion: '1.21.4', installedAt: Date.now() - 86400000 },
  ];
  const api: LauncherAPI = {
    async getBootstrap() { return { account, profiles, activeProfileId: activeProfile.id, settings, installedVersions: versions, microsoftConfigured: false }; },
    async getManifest() { return manifest; },
    async getInstalledVersions() { return versions; },
    async installVersion(_profileId, versionId) {
      const id = versionId === 'latest-release' ? manifest.latest.release : versionId;
      emitLog(`Downloading Minecraft ${id}…`);
      const progress = { id: 'demo-download', name: `${id} client`, category: 'version' as const, status: 'downloading' as const, downloaded: 82_000_000, total: 120_000_000, speed: 18_500_000, etaSeconds: 2 };
      progressListeners.forEach((listener) => listener(progress));
      await new Promise((resolve) => setTimeout(resolve, 900));
      versions.unshift({ id, type: 'release', loader: 'vanilla', gameVersion: id, installedAt: Date.now() });
      activeProfile = { ...activeProfile, versionId: id, loader: 'vanilla' };
      profiles = profiles.map((item) => item.id === activeProfile.id ? activeProfile : item);
      emitLog(`Minecraft ${id} installed.`);
      return { versionId: id, message: `Minecraft ${id} installed.` };
    },
    async installLoader(_profileId, loader, gameVersion) {
      const id = loader === 'fabric' ? `fabric-loader-0.16.10-${gameVersion}` : `${loader}-${gameVersion}`;
      emitLog(`Installing ${loader} for Minecraft ${gameVersion}…`);
      await new Promise((resolve) => setTimeout(resolve, 700));
      versions.unshift({ id, type: loader, loader, gameVersion, installedAt: Date.now() });
      activeProfile = { ...activeProfile, versionId: id, loader };
      profiles = profiles.map((item) => item.id === activeProfile.id ? activeProfile : item);
      emitLog(`${loader} profile ready.`);
      return { versionId: id, message: `${loader} profile ready.` };
    },
    async loginOffline(username) {
      account = { username, uuid: '8667ba71-b85a-4004-af54-457a9734eed7', kind: 'offline' };
      authListeners.forEach((listener) => listener({ type: 'complete', account: account ?? undefined }));
      return account;
    },
    async loginMicrosoft() { throw new Error('Microsoft sign-in works in the installed desktop build after client ID setup.'); },
    async logout() { account = null; },
    async cancelMicrosoftLogin() {},
    async openExternal() {},
    async listProfiles() { return profiles; },
    async createProfile(name) {
      const created = { ...profile, id: crypto.randomUUID(), name, active: false, versionId: 'latest-release', gameDir: `~/Loader/profiles/${name.toLowerCase().replace(/\W+/g, '-')}` };
      profiles = [...profiles, created];
      return created;
    },
    async updateProfile(profileId, patch) {
      const updated = { ...(profiles.find((item) => item.id === profileId) ?? profile), ...patch };
      profiles = profiles.map((item) => item.id === profileId ? updated : item);
      if (activeProfile.id === profileId) activeProfile = updated;
      return updated;
    },
    async deleteProfile(profileId) { profiles = profiles.filter((item) => item.id !== profileId); },
    async setActiveProfile(profileId) {
      profiles = profiles.map((item) => ({ ...item, active: item.id === profileId }));
      activeProfile = profiles.find((item) => item.id === profileId) ?? activeProfile;
    },
    async getSettings() { return settings; },
    async saveSettings(value) { settings = value; return settings; },
    async choosePath(kind) { return kind === 'directory' ? '~/Games/Minecraft' : ''; },
    async searchMods(query, _profileId, source) {
      const items: ModSearchResult[] = [
        { id: 'AANobbMI', title: 'Sodium', description: 'A modern rendering engine that improves frame rates and micro-stutter.', author: 'CaffeineMC', downloads: 91_000_000, source, projectUrl: 'https://modrinth.com/mod/sodium', iconUrl: 'https://cdn.modrinth.com/data/AANobbMI/icon.png' },
        { id: 'P7dR8mSH', title: 'Simple Voice Chat', description: 'Proximity voice chat with a clean, configurable setup.', author: 'henkelmax', downloads: 24_000_000, source, projectUrl: 'https://modrinth.com/plugin/simple-voice-chat' },
        { id: 'YL57xq9U', title: 'Iris Shaders', description: 'A modern shader loader for Minecraft, compatible with existing OptiFine shader packs.', author: 'Iris', downloads: 38_000_000, source, projectUrl: 'https://modrinth.com/mod/iris' },
      ];
      return items.filter((item) => !query || `${item.title} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
    },
    async listMods() { return mods; },
    async installMod(_profileId, source, projectId) {
      const found = (await api.searchMods('', activeProfile.id, source)).find((item) => item.id === projectId);
      if (found) mods = [{ fileName: `${found.title.toLowerCase().replace(/\s+/g, '-')}-preview.jar`, name: found.title, version: 'Latest', enabled: true, source, projectId, iconUrl: found.iconUrl }, ...mods];
      emitLog(`Mod ${found?.title ?? projectId} added to the preview profile.`);
    },
    async setModEnabled(_profileId, fileName, enabled) { mods = mods.map((mod) => mod.fileName === fileName ? { ...mod, enabled } : mod); },
    async launch() {
      emitLog('The desktop preview does not start a game process. Build and open Loader in Electron to play.', 'stderr');
      stateListeners.forEach((listener) => listener({ running: false, message: 'Open the desktop build to launch Minecraft.' }));
    },
    async stopGame() {},
    onDownloadProgress(listener) { progressListeners.add(listener); return () => progressListeners.delete(listener); },
    onConsoleLine(listener) { consoleListeners.add(listener); return () => consoleListeners.delete(listener); },
    onAuthEvent(listener) { authListeners.add(listener); return () => authListeners.delete(listener); },
    onLaunchState(listener) { stateListeners.add(listener); return () => stateListeners.delete(listener); },
  };
  return api;
}

export const api: LauncherAPI = desktopBridge ?? createPreviewAPI();
