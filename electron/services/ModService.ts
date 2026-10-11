import { mkdir, readdir, rename, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { InstalledMod, LoaderKind, ModSearchResult } from '../../shared/types';
import { DatabaseService } from './DatabaseService';
import { DownloadService } from './DownloadService';
import { VersionService } from './VersionService';

interface ModrinthFile {
  url: string;
  filename: string;
  primary?: boolean;
  hashes?: { sha1?: string };
}
interface ModrinthDependency { project_id?: string; version_id?: string; dependency_type: string }
interface ModrinthVersion {
  id: string;
  name?: string;
  version_number?: string;
  files: ModrinthFile[];
  dependencies?: ModrinthDependency[];
}
interface ModrinthProject {
  id: string;
  title: string;
  description?: string;
  slug?: string;
  icon_url?: string;
  downloads?: number;
  author?: string;
}

/** Mod discovery/install operations for Modrinth and API-key-backed CurseForge. */
export class ModService {
  constructor(
    private readonly database: DatabaseService,
    private readonly downloads: DownloadService,
    private readonly versions: VersionService,
  ) {}

  async search(query: string, profileId: string, source: 'modrinth' | 'curseforge'): Promise<ModSearchResult[]> {
    const profile = this.database.getProfile(profileId);
    const context = await this.getProfileContext(profile.id);
    const cleanQuery = query.trim().slice(0, 120);
    if (source === 'modrinth') {
      const facets = [['project_type:mod']];
      if (context.gameVersion) facets.push([`versions:${context.gameVersion}`]);
      if (context.loader !== 'vanilla') facets.push([`categories:${context.loader}`]);
      const params = new URLSearchParams({ query: cleanQuery, limit: '24', index: 'relevance', facets: JSON.stringify(facets) });
      const response = await fetch(`https://api.modrinth.com/v2/search?${params}`);
      if (!response.ok) throw new Error(`Modrinth search failed (${response.status}).`);
      const data = await response.json() as { hits?: Array<ModrinthProject & { project_id?: string; author?: string; slug?: string }> };
      return (data.hits ?? []).map((hit) => {
        const id = hit.project_id ?? hit.id;
        return {
          id,
          title: hit.title,
          description: hit.description ?? '',
          author: hit.author ?? 'Modrinth author',
          iconUrl: hit.icon_url,
          downloads: hit.downloads ?? 0,
          source: 'modrinth' as const,
          projectUrl: `https://modrinth.com/mod/${hit.slug ?? id}`,
        };
      });
    }

    const apiKey = process.env.CURSEFORGE_API_KEY;
    if (!apiKey) throw new Error('CurseForge browsing requires a CurseForge API key. Set CURSEFORGE_API_KEY before starting Loader. Modrinth is available without a key.');
    const params = new URLSearchParams({ gameId: '432', classId: '6', pageSize: '24', sortField: '2', sortOrder: 'desc' });
    if (cleanQuery) params.set('searchFilter', cleanQuery);
    if (context.gameVersion) params.set('gameVersion', context.gameVersion);
    const loaderId: Partial<Record<LoaderKind, string>> = { forge: '1', fabric: '4', quilt: '5', neoforge: '6' };
    if (loaderId[context.loader]) params.set('modLoaderType', loaderId[context.loader] as string);
    const response = await fetch(`https://api.curseforge.com/v1/mods/search?${params}`, { headers: { 'x-api-key': apiKey } });
    if (!response.ok) throw new Error(`CurseForge search failed (${response.status}).`);
    const data = await response.json() as { data?: Array<{ id: number; name: string; slug: string; summary?: string; downloadCount?: number; authors?: Array<{ name: string }>; logo?: { url?: string }; latestFilesIndexes?: Array<{ fileId: number }> }> };
    return (data.data ?? []).map((mod) => ({
      id: String(mod.id),
      title: mod.name,
      description: mod.summary ?? '',
      author: mod.authors?.[0]?.name ?? 'CurseForge author',
      iconUrl: mod.logo?.url,
      downloads: mod.downloadCount ?? 0,
      source: 'curseforge' as const,
      projectUrl: `https://www.curseforge.com/minecraft/mc-mods/${mod.slug}`,
      latestVersionId: mod.latestFilesIndexes?.[0]?.fileId ? String(mod.latestFilesIndexes[0].fileId) : undefined,
    }));
  }

  async list(profileId: string): Promise<InstalledMod[]> {
    const profile = this.database.getProfile(profileId);
    const modsDir = join(profile.gameDir, 'mods');
    await mkdir(modsDir, { recursive: true });
    const known = new Map(this.database.getMods(profileId).map((mod) => [mod.fileName, mod]));
    const files = await readdir(modsDir, { withFileTypes: true });
    const result: InstalledMod[] = [];
    for (const entry of files) {
      if (!entry.isFile()) continue;
      const isDisabled = entry.name.endsWith('.jar.disabled');
      const canonicalName = isDisabled ? entry.name.slice(0, -'.disabled'.length) : entry.name;
      if (!canonicalName.toLowerCase().endsWith('.jar')) continue;
      const record = known.get(canonicalName);
      result.push(record ? { ...record, fileName: canonicalName, enabled: !isDisabled } : {
        fileName: canonicalName,
        name: canonicalName.replace(/\.jar$/i, '').replace(/[-_]/g, ' '),
        version: 'Local file',
        enabled: !isDisabled,
        source: 'local',
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async install(profileId: string, source: 'modrinth' | 'curseforge', projectId: string, versionId?: string): Promise<void> {
    const profile = this.database.getProfile(profileId);
    if (profile.loader === 'vanilla') throw new Error('Mods require a mod loader. Install Fabric, Forge, Quilt, or NeoForge for this profile first.');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(projectId)) throw new Error('Mod project ID is invalid.');
    const visited = new Set<string>();
    if (source === 'modrinth') {
      await this.installModrinth(profileId, projectId, versionId, visited, 0);
      return;
    }
    await this.installCurseForge(profileId, projectId, versionId);
  }

  async setEnabled(profileId: string, fileName: string, enabled: boolean): Promise<void> {
    if (basename(fileName) !== fileName || !fileName.toLowerCase().endsWith('.jar')) throw new Error('Mod file name is not valid.');
    const profile = this.database.getProfile(profileId);
    const modsDir = join(profile.gameDir, 'mods');
    const originalPath = join(modsDir, fileName);
    const disabledPath = `${originalPath}.disabled`;
    const exists = await this.exists(enabled ? disabledPath : originalPath);
    if (!exists) {
      const alreadyInRequestedState = await this.exists(enabled ? originalPath : disabledPath);
      if (alreadyInRequestedState) return;
      throw new Error(`The mod file ${fileName} was not found.`);
    }
    await rename(enabled ? disabledPath : originalPath, enabled ? originalPath : disabledPath);
    const prior = this.database.getMods(profileId).find((mod) => mod.fileName === fileName);
    this.database.upsertMod(profileId, prior ? { ...prior, enabled } : {
      fileName,
      name: fileName.replace(/\.jar$/i, '').replace(/[-_]/g, ' '),
      version: 'Local file',
      enabled,
      source: 'local',
    });
  }

  private async installModrinth(profileId: string, projectId: string, requestedVersionId: string | undefined, visited: Set<string>, depth: number): Promise<void> {
    if (depth > 8) throw new Error('The mod dependency tree is too deep to install safely.');
    if (visited.has(projectId)) return;
    visited.add(projectId);
    const context = await this.getProfileContext(profileId);
    let version: ModrinthVersion;
    if (requestedVersionId) {
      const response = await fetch(`https://api.modrinth.com/v2/version/${encodeURIComponent(requestedVersionId)}`);
      if (!response.ok) throw new Error(`Modrinth version lookup failed (${response.status}).`);
      version = await response.json() as ModrinthVersion;
    } else {
      const params = new URLSearchParams();
      if (context.gameVersion) params.set('game_versions', JSON.stringify([context.gameVersion]));
      if (context.loader !== 'vanilla') params.set('loaders', JSON.stringify([context.loader]));
      const query = params.size ? `?${params}` : '';
      const response = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version${query}`);
      if (!response.ok) throw new Error(`Could not find a compatible Modrinth version (${response.status}).`);
      const versions = await response.json() as ModrinthVersion[];
      version = versions[0] as ModrinthVersion;
      if (!version) throw new Error('No Modrinth release matches this profile version and loader.');
    }
    const required = version.dependencies?.filter((dependency) => dependency.dependency_type === 'required') ?? [];
    for (const dependency of required) {
      if (dependency.project_id) await this.installModrinth(profileId, dependency.project_id, dependency.version_id, visited, depth + 1);
      else if (dependency.version_id) {
        await this.installModrinthVersionOnly(profileId, dependency.version_id);
      }
    }

    const projectResponse = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}`);
    if (!projectResponse.ok) throw new Error('The selected Modrinth project is unavailable.');
    const project = await projectResponse.json() as ModrinthProject;
    await this.downloadModFile(profileId, {
      source: 'modrinth',
      projectId,
      name: project.title,
      version: version.version_number ?? version.name ?? 'Latest',
      iconUrl: project.icon_url,
      file: this.selectModrinthFile(version.files),
    });
  }

  private async installModrinthVersionOnly(profileId: string, versionId: string): Promise<void> {
    const response = await fetch(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`);
    if (!response.ok) throw new Error('A required Modrinth dependency version could not be fetched.');
    const version = await response.json() as ModrinthVersion;
    await this.downloadModFile(profileId, {
      source: 'modrinth',
      projectId: 'dependency',
      name: version.name ?? 'Required dependency',
      version: version.version_number ?? '',
      file: this.selectModrinthFile(version.files),
    });
  }

  private async installCurseForge(profileId: string, projectId: string, requestedVersionId?: string): Promise<void> {
    const apiKey = process.env.CURSEFORGE_API_KEY;
    if (!apiKey) throw new Error('CurseForge installs require CURSEFORGE_API_KEY.');
    const context = await this.getProfileContext(profileId);
    const loaderTypes: Partial<Record<LoaderKind, number>> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
    const params = new URLSearchParams({ pageSize: '50' });
    if (context.gameVersion) params.set('gameVersion', context.gameVersion);
    if (loaderTypes[context.loader]) params.set('modLoaderType', String(loaderTypes[context.loader]));
    const response = await fetch(`https://api.curseforge.com/v1/mods/${encodeURIComponent(projectId)}/files?${params}`, { headers: { 'x-api-key': apiKey } });
    if (!response.ok) throw new Error(`Could not list CurseForge files (${response.status}).`);
    const result = await response.json() as { data?: Array<{ id: number; displayName: string; fileName: string; downloadUrl?: string; gameVersions?: string[]; modLoader?: number }> };
    const files = result.data ?? [];
    const file = requestedVersionId ? files.find((item) => String(item.id) === requestedVersionId) : files[0];
    if (!file) throw new Error('No CurseForge file matches this Minecraft version and mod loader.');
    let downloadUrl = file.downloadUrl;
    if (!downloadUrl) {
      const linkResponse = await fetch(`https://api.curseforge.com/v1/mods/${encodeURIComponent(projectId)}/files/${file.id}/download-url`, { headers: { 'x-api-key': apiKey } });
      if (linkResponse.ok) downloadUrl = (await linkResponse.json() as { data?: string }).data;
    }
    if (!downloadUrl) throw new Error('CurseForge did not provide a download link for this file.');
    const detailResponse = await fetch(`https://api.curseforge.com/v1/mods/${encodeURIComponent(projectId)}`, { headers: { 'x-api-key': apiKey } });
    const details = detailResponse.ok ? await detailResponse.json() as { data?: { name?: string; logo?: { url?: string } } } : {};
    await this.downloadModFile(profileId, {
      source: 'curseforge',
      projectId,
      name: details.data?.name ?? file.displayName,
      version: file.displayName,
      iconUrl: details.data?.logo?.url,
      file: { url: downloadUrl, filename: file.fileName },
    });
  }

  private selectModrinthFile(files: ModrinthFile[]): ModrinthFile {
    const file = files.find((entry) => entry.primary) ?? files.find((entry) => entry.filename.toLowerCase().endsWith('.jar'));
    if (!file || !file.filename.toLowerCase().endsWith('.jar')) throw new Error('This mod version does not include a client JAR.');
    return file;
  }

  private async downloadModFile(profileId: string, input: {
    source: InstalledMod['source']; projectId: string; name: string; version: string; iconUrl?: string; file: { url: string; filename: string; hashes?: { sha1?: string } };
  }): Promise<void> {
    const profile = this.database.getProfile(profileId);
    const fileName = basename(input.file.filename).replace(/[^A-Za-z0-9._()+ -]/g, '_');
    if (!fileName.toLowerCase().endsWith('.jar')) throw new Error('The selected download is not a .jar mod.');
    const destination = join(profile.gameDir, 'mods', fileName);
    await this.downloads.download({
      url: input.file.url,
      destination,
      sha1: input.file.hashes?.sha1,
      category: 'mod',
      name: input.name,
    });
    this.database.upsertMod(profileId, {
      fileName,
      name: input.name,
      version: input.version,
      enabled: true,
      source: input.source,
      projectId: input.projectId,
      iconUrl: input.iconUrl,
    });
  }

  private async getProfileContext(profileId: string): Promise<{ loader: LoaderKind; gameVersion: string }> {
    const profile = this.database.getProfile(profileId);
    let gameVersion = profile.versionId;
    if (gameVersion === 'latest-release' || gameVersion === 'latest-snapshot') {
      const manifest = await this.versions.getManifest();
      gameVersion = gameVersion === 'latest-release' ? manifest.latest.release : manifest.latest.snapshot;
    }
    try {
      const json = await this.versions.loadVersionJson(profile.gameDir, profile.versionId);
      gameVersion = json.inheritsFrom ?? json.id ?? gameVersion;
    } catch {
      // A not-yet-installed profile still benefits from the selected Mojang version ID.
    }
    return { loader: profile.loader, gameVersion };
  }

  private async exists(filePath: string): Promise<boolean> {
    return stat(filePath).then(() => true, () => false);
  }
}
