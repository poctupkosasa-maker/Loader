/** Shared contract for the isolated renderer <-> Electron main-process bridge. */
export type AccountKind = 'microsoft' | 'offline';
export type LoaderKind = 'vanilla' | 'fabric' | 'forge' | 'quilt' | 'neoforge';
export type LanguageCode = 'en' | 'ru';

export interface Account {
  username: string;
  uuid: string;
  kind: AccountKind;
  skinUrl?: string;
}

export interface LauncherProfile {
  id: string;
  name: string;
  gameDir: string;
  versionId: string;
  loader: LoaderKind;
  createdAt: number;
  active: boolean;
}

export const THEME_IDS = [
  'loader', 'nether', 'end', 'ocean', 'bastion', 'cherry', 'sculk', 'redstone', 'daylight',
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export interface AppSettings {
  minRam: number;
  maxRam: number;
  javaPath: string;
  javaArgs: string;
  language: LanguageCode;
  gameDir: string;
  theme: ThemeId;
  curseForgeApiKeyConfigured: boolean;
}

export interface MojangVersion {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha' | string;
  url: string;
  time: string;
  releaseTime: string;
}

export interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: MojangVersion[];
}

export interface DownloadProgress {
  id: string;
  name: string;
  category: 'version' | 'library' | 'asset' | 'loader' | 'mod';
  status: 'queued' | 'downloading' | 'complete' | 'error';
  downloaded: number;
  total: number;
  speed: number;
  etaSeconds: number;
  error?: string;
}

export interface ConsoleLine {
  id: string;
  timestamp: number;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
}

export interface AuthEvent {
  type: 'device-code' | 'complete' | 'error' | 'cancelled';
  message?: string;
  verificationUri?: string;
  userCode?: string;
  expiresIn?: number;
  interval?: number;
  account?: Account;
}

export interface InstalledVersion {
  id: string;
  type: string;
  loader: LoaderKind;
  gameVersion: string;
  installedAt: number;
}

export interface ModSearchResult {
  id: string;
  title: string;
  description: string;
  author: string;
  iconUrl?: string;
  downloads: number;
  source: 'modrinth' | 'curseforge';
  projectUrl: string;
  latestVersionId?: string;
}

export interface InstalledMod {
  fileName: string;
  name: string;
  version: string;
  enabled: boolean;
  source: 'modrinth' | 'curseforge' | 'local';
  projectId?: string;
  iconUrl?: string;
}

export interface InstallResult {
  versionId: string;
  message: string;
}

export interface BootstrapData {
  account: Account | null;
  profiles: LauncherProfile[];
  activeProfileId: string;
  settings: AppSettings;
  installedVersions: InstalledVersion[];
  microsoftConfigured: boolean;
}

export interface LauncherAPI {
  getBootstrap(): Promise<BootstrapData>;
  getManifest(forceRefresh?: boolean): Promise<VersionManifest>;
  getInstalledVersions(profileId: string): Promise<InstalledVersion[]>;
  installVersion(profileId: string, versionId: string): Promise<InstallResult>;
  installLoader(profileId: string, loader: Exclude<LoaderKind, 'vanilla'>, gameVersion: string): Promise<InstallResult>;

  loginOffline(username: string): Promise<Account>;
  loginMicrosoft(): Promise<{ started: true }>;
  logout(): Promise<void>;
  cancelMicrosoftLogin(): Promise<void>;
  openExternal(url: string): Promise<void>;

  listProfiles(): Promise<LauncherProfile[]>;
  createProfile(name: string): Promise<LauncherProfile>;
  updateProfile(profileId: string, patch: Partial<Pick<LauncherProfile, 'name' | 'gameDir' | 'versionId' | 'loader'>>): Promise<LauncherProfile>;
  deleteProfile(profileId: string): Promise<void>;
  setActiveProfile(profileId: string): Promise<void>;

  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  choosePath(kind: 'directory' | 'java'): Promise<string | null>;

  searchMods(query: string, profileId: string, source: 'modrinth' | 'curseforge'): Promise<ModSearchResult[]>;
  listMods(profileId: string): Promise<InstalledMod[]>;
  installMod(profileId: string, source: 'modrinth' | 'curseforge', projectId: string, versionId?: string): Promise<void>;
  setModEnabled(profileId: string, fileName: string, enabled: boolean): Promise<void>;

  launch(profileId: string): Promise<void>;
  stopGame(): Promise<void>;

  onDownloadProgress(listener: (progress: DownloadProgress) => void): () => void;
  onConsoleLine(listener: (line: ConsoleLine) => void): () => void;
  onAuthEvent(listener: (event: AuthEvent) => void): () => void;
  onLaunchState(listener: (state: { running: boolean; message: string }) => void): () => void;
}
