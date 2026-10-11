import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_IDS } from '../../shared/types';
import type { Account, AppSettings, InstalledMod, LauncherProfile, LoaderKind, ThemeId } from '../../shared/types';

type ProfileRow = {
  id: string;
  name: string;
  game_dir: string;
  version_id: string;
  loader: LoaderKind;
  created_at: number;
  active: number;
};

type ModRow = {
  profile_id: string;
  file_name: string;
  name: string;
  version: string;
  enabled: number;
  source: InstalledMod['source'];
  project_id: string | null;
  icon_url: string | null;
};

/** Local SQLite persistence for profiles, preferences, account metadata, and mod state. */
export class DatabaseService {
  private readonly db: Database.Database;
  private readonly profilesRoot: string;

  constructor(userDataPath: string) {
    mkdirSync(userDataPath, { recursive: true });
    this.profilesRoot = join(userDataPath, 'profiles');
    this.db = new Database(join(userDataPath, 'launcher.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        game_dir TEXT NOT NULL,
        version_id TEXT NOT NULL DEFAULT 'latest-release',
        loader TEXT NOT NULL DEFAULT 'vanilla',
        created_at INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS account (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT NOT NULL,
        uuid TEXT NOT NULL,
        kind TEXT NOT NULL,
        skin_url TEXT
      );
      CREATE TABLE IF NOT EXISTS mods (
        profile_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        name TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'local',
        project_id TEXT,
        icon_url TEXT,
        PRIMARY KEY (profile_id, file_name),
        FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
      );
    `);

    const exists = this.db.prepare('SELECT id FROM profiles LIMIT 1').get();
    if (!exists) {
      const id = 'default';
      this.db.prepare(`INSERT INTO profiles (id, name, game_dir, version_id, loader, created_at, active)
        VALUES (?, ?, ?, ?, ?, ?, 1)`).run(
        id,
        'Default profile',
        join(this.profilesRoot, id),
        'latest-release',
        'vanilla',
        Date.now(),
      );
    }
    this.setDefaultSetting('minRam', 2);
    this.setDefaultSetting('maxRam', 4);
    this.setDefaultSetting('javaPath', '');
    this.setDefaultSetting('javaArgs', '');
    this.setDefaultSetting('language', 'en');
  }

  private setDefaultSetting(key: string, value: unknown): void {
    this.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
  }

  getSettings(): AppSettings {
    const entries = this.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
    const values = Object.fromEntries(entries.map(({ key, value }) => [key, JSON.parse(value) as unknown]));
    const active = this.getProfiles().find((profile) => profile.active);
    return {
      minRam: Number(values.minRam ?? 2),
      maxRam: Number(values.maxRam ?? 4),
      javaPath: String(values.javaPath ?? ''),
      javaArgs: String(values.javaArgs ?? ''),
      language: values.language === 'ru' ? 'ru' : 'en',
      theme: THEME_IDS.includes(values.theme as ThemeId) ? (values.theme as ThemeId) : 'loader',
      gameDir: active?.gameDir ?? '',
      curseForgeApiKeyConfigured: Boolean(process.env.CURSEFORGE_API_KEY),
    };
  }

  saveSettings(settings: AppSettings): AppSettings {
    const update = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    const transaction = this.db.transaction(() => {
      update.run('minRam', JSON.stringify(settings.minRam));
      update.run('maxRam', JSON.stringify(settings.maxRam));
      update.run('javaPath', JSON.stringify(settings.javaPath));
      update.run('javaArgs', JSON.stringify(settings.javaArgs));
      update.run('language', JSON.stringify(settings.language));
      update.run('theme', JSON.stringify(settings.theme));
      if (settings.gameDir.trim()) {
        const profile = this.getActiveProfile();
        this.db.prepare('UPDATE profiles SET game_dir = ? WHERE id = ?').run(settings.gameDir, profile.id);
      }
    });
    transaction();
    return this.getSettings();
  }

  getAccount(): Account | null {
    const row = this.db.prepare('SELECT username, uuid, kind, skin_url FROM account WHERE id = 1').get() as
      | { username: string; uuid: string; kind: Account['kind']; skin_url: string | null }
      | undefined;
    return row ? { username: row.username, uuid: row.uuid, kind: row.kind, skinUrl: row.skin_url ?? undefined } : null;
  }

  saveAccount(account: Account): void {
    this.db.prepare(`INSERT INTO account (id, username, uuid, kind, skin_url) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET username = excluded.username, uuid = excluded.uuid, kind = excluded.kind, skin_url = excluded.skin_url`)
      .run(account.username, account.uuid, account.kind, account.skinUrl ?? null);
  }

  clearAccount(): void {
    this.db.prepare('DELETE FROM account WHERE id = 1').run();
  }

  getProfiles(): LauncherProfile[] {
    const rows = this.db.prepare('SELECT * FROM profiles ORDER BY created_at ASC').all() as ProfileRow[];
    return rows.map((row) => this.profileFromRow(row));
  }

  getProfile(id: string): LauncherProfile {
    const row = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as ProfileRow | undefined;
    if (!row) throw new Error('That launcher profile no longer exists.');
    return this.profileFromRow(row);
  }

  getActiveProfile(): LauncherProfile {
    const row = this.db.prepare('SELECT * FROM profiles WHERE active = 1 LIMIT 1').get() as ProfileRow | undefined;
    if (!row) throw new Error('No active launcher profile is configured.');
    return this.profileFromRow(row);
  }

  createProfile(name: string): LauncherProfile {
    const cleanName = name.trim().slice(0, 40);
    if (!cleanName) throw new Error('Give the profile a name first.');
    const id = randomUUID();
    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'profile';
    const gameDir = join(this.profilesRoot, `${slug}-${id.slice(0, 8)}`);
    this.db.prepare(`INSERT INTO profiles (id, name, game_dir, version_id, loader, created_at, active)
      VALUES (?, ?, ?, 'latest-release', 'vanilla', ?, 0)`).run(id, cleanName, gameDir, Date.now());
    return this.getProfile(id);
  }

  updateProfile(id: string, patch: Partial<Pick<LauncherProfile, 'name' | 'gameDir' | 'versionId' | 'loader'>>): LauncherProfile {
    const current = this.getProfile(id);
    const next = { ...current, ...patch };
    if (!next.name.trim()) throw new Error('Profile name cannot be empty.');
    this.db.prepare('UPDATE profiles SET name = ?, game_dir = ?, version_id = ?, loader = ? WHERE id = ?')
      .run(next.name.trim().slice(0, 40), next.gameDir, next.versionId, next.loader, id);
    return this.getProfile(id);
  }

  setProfileVersion(id: string, versionId: string, loader: LoaderKind): void {
    this.getProfile(id);
    this.db.prepare('UPDATE profiles SET version_id = ?, loader = ? WHERE id = ?').run(versionId, loader, id);
  }

  setActiveProfile(id: string): void {
    this.getProfile(id);
    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE profiles SET active = 0').run();
      this.db.prepare('UPDATE profiles SET active = 1 WHERE id = ?').run(id);
    });
    transaction();
  }

  deleteProfile(id: string): void {
    const profile = this.getProfile(id);
    if (profile.active) throw new Error('Select another profile before deleting this one.');
    const count = (this.db.prepare('SELECT COUNT(*) AS count FROM profiles').get() as { count: number }).count;
    if (count <= 1) throw new Error('The last profile cannot be removed.');
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  }

  upsertMod(profileId: string, mod: InstalledMod): void {
    this.getProfile(profileId);
    this.db.prepare(`INSERT INTO mods (profile_id, file_name, name, version, enabled, source, project_id, icon_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, file_name) DO UPDATE SET name = excluded.name, version = excluded.version,
      enabled = excluded.enabled, source = excluded.source, project_id = excluded.project_id, icon_url = excluded.icon_url`)
      .run(profileId, mod.fileName, mod.name, mod.version, mod.enabled ? 1 : 0, mod.source, mod.projectId ?? null, mod.iconUrl ?? null);
  }

  getMods(profileId: string): InstalledMod[] {
    this.getProfile(profileId);
    const rows = this.db.prepare('SELECT * FROM mods WHERE profile_id = ? ORDER BY name COLLATE NOCASE').all(profileId) as ModRow[];
    return rows.map((row) => ({
      fileName: row.file_name,
      name: row.name,
      version: row.version,
      enabled: Boolean(row.enabled),
      source: row.source,
      projectId: row.project_id ?? undefined,
      iconUrl: row.icon_url ?? undefined,
    }));
  }

  removeModRecord(profileId: string, fileName: string): void {
    this.db.prepare('DELETE FROM mods WHERE profile_id = ? AND file_name = ?').run(profileId, fileName);
  }

  close(): void {
    this.db.close();
  }

  private profileFromRow(row: ProfileRow): LauncherProfile {
    return {
      id: row.id,
      name: row.name,
      gameDir: row.game_dir,
      versionId: row.version_id,
      loader: row.loader,
      createdAt: row.created_at,
      active: Boolean(row.active),
    };
  }
}
