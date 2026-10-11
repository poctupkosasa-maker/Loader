import { copyFile, link, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { release as osRelease } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { InstalledVersion, LoaderKind, VersionManifest } from '../../shared/types';
import { DatabaseService } from './DatabaseService';
import { DownloadService, type DownloadRequest } from './DownloadService';
import { extractNativeArchive } from './ArchiveService';

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const RESOURCES_URL = 'https://resources.download.minecraft.net';

type Rule = { action: 'allow' | 'disallow'; os?: { name?: string; arch?: string; version?: string }; features?: Record<string, boolean> };
type MavenArtifact = { path: string; url?: string; sha1?: string; size?: number };
type VersionLibrary = {
  name: string;
  url?: string;
  rules?: Rule[];
  downloads?: { artifact?: MavenArtifact; classifiers?: Record<string, MavenArtifact> };
  natives?: Record<string, string>;
};
export type VersionJson = {
  id: string;
  type?: string;
  assets?: string;
  assetIndex?: { id: string; url: string; sha1?: string; size?: number; totalSize?: number };
  libraries?: VersionLibrary[];
  downloads?: { client?: MavenArtifact };
  arguments?: { game?: unknown[]; jvm?: unknown[] };
  minecraftArguments?: string;
  mainClass?: string;
  inheritsFrom?: string;
  javaVersion?: { majorVersion?: number };
  [key: string]: unknown;
};

function safeChild(root: string, relativePath: string): string {
  const absolute = resolve(root, relativePath);
  if (absolute !== resolve(root) && !absolute.startsWith(resolve(root) + sep)) {
    throw new Error('A server-provided path escaped the game directory.');
  }
  return absolute;
}

/** Downloads Mojang metadata and installs vanilla game files into a profile's isolated game directory. */
export class VersionService {
  private manifestCache: VersionManifest | null = null;

  constructor(private readonly database: DatabaseService, private readonly downloads: DownloadService) {}

  async getManifest(forceRefresh = false): Promise<VersionManifest> {
    if (this.manifestCache && !forceRefresh) return this.manifestCache;
    const response = await fetch(MANIFEST_URL, { headers: { 'User-Agent': 'Loader-Minecraft-Launcher/1.0' } });
    if (!response.ok) throw new Error(`Mojang version manifest could not be fetched (${response.status}).`);
    const manifest = await response.json() as VersionManifest;
    if (!Array.isArray(manifest.versions) || !manifest.latest?.release) throw new Error('Mojang returned an invalid version manifest.');
    this.manifestCache = manifest;
    return manifest;
  }

  async installVersion(profileId: string, requestedVersionId: string, activate = true): Promise<{ versionId: string; message: string }> {
    const profile = this.database.getProfile(profileId);
    const manifest = await this.getManifest();
    const versionId = requestedVersionId === 'latest-release' ? manifest.latest.release : requestedVersionId === 'latest-snapshot' ? manifest.latest.snapshot : requestedVersionId;
    if (!/^[A-Za-z0-9._+-]{1,100}$/.test(versionId)) throw new Error('That Minecraft version ID is not valid.');
    const entry = manifest.versions.find((version) => version.id === versionId);
    if (!entry) throw new Error(`Minecraft version ${versionId} is not in Mojang's official manifest.`);

    const gameDir = profile.gameDir;
    const versionDir = join(gameDir, 'versions', versionId);
    await mkdir(versionDir, { recursive: true });
    const metadataResponse = await fetch(entry.url);
    if (!metadataResponse.ok) throw new Error(`Could not download metadata for ${versionId} (${metadataResponse.status}).`);
    const versionJson = await metadataResponse.json() as VersionJson;
    if (!versionJson.id) versionJson.id = versionId;
    const metadataPath = join(versionDir, `${versionId}.json`);
    await writeFile(metadataPath, `${JSON.stringify(versionJson, null, 2)}\n`, 'utf8');

    const tasks: DownloadRequest[] = [];
    const client = versionJson.downloads?.client;
    if (client?.url) {
      tasks.push({
        url: client.url,
        destination: join(versionDir, `${versionId}.jar`),
        sha1: client.sha1,
        size: client.size,
        category: 'version',
        name: `${versionId} client`,
      });
    } else if (!await stat(join(versionDir, `${versionId}.jar`)).catch(() => null)) {
      throw new Error(`Mojang did not publish a client JAR for ${versionId}.`);
    }

    const osName = this.getMojangOs();
    const classifierEntries: Array<{ library: VersionLibrary; archive: MavenArtifact }> = [];
    for (const library of versionJson.libraries ?? []) {
      if (!this.rulesAllow(library.rules)) continue;
      const artifact = library.downloads?.artifact ?? this.fallbackArtifact(library);
      if (artifact) tasks.push(this.toLibraryRequest(gameDir, artifact, library.name));
      const nativePattern = library.natives?.[osName];
      if (nativePattern) {
        const classifier = nativePattern.replace(/\$\{arch\}/g, process.arch === 'ia32' ? '32' : '64');
        const nativeArtifact = library.downloads?.classifiers?.[classifier];
        if (nativeArtifact) {
          tasks.push(this.toLibraryRequest(gameDir, nativeArtifact, `${library.name} natives`));
          classifierEntries.push({ library, archive: nativeArtifact });
        }
      }
    }
    await this.downloadUnique(tasks);

    const nativesDir = join(versionDir, `${versionId}-natives`);
    await mkdir(nativesDir, { recursive: true });
    for (const { archive } of classifierEntries) {
      const archivePath = safeChild(join(gameDir, 'libraries'), archive.path);
      await extractNativeArchive(archivePath, nativesDir);
    }

    if (versionJson.assetIndex?.url) {
      await this.installAssets(gameDir, versionJson.assetIndex, versionJson.assets ?? versionJson.assetIndex.id);
    }
    if (activate) this.database.setProfileVersion(profileId, versionId, 'vanilla');
    return { versionId, message: `Minecraft ${versionId} is installed and ready.` };
  }

  /** Ensures the client JAR, libraries, natives, and asset objects referenced by a resolved version JSON are present. */
  async prepareRuntime(gameDir: string, versionJson: VersionJson): Promise<void> {
    const clientVersionId = typeof versionJson.jar === 'string' ? versionJson.jar : versionJson.inheritsFrom ?? versionJson.id;
    const clientDir = join(gameDir, 'versions', clientVersionId);
    const clientJarPath = join(clientDir, `${clientVersionId}.jar`);
    const tasks: DownloadRequest[] = [];
    const client = versionJson.downloads?.client;
    if (client?.url) {
      tasks.push({ url: client.url, destination: clientJarPath, sha1: client.sha1, size: client.size, category: 'version', name: `${clientVersionId} client` });
    } else if (!await stat(clientJarPath).catch(() => null)) {
      throw new Error(`The client JAR for ${clientVersionId} is missing and Mojang did not provide a download URL.`);
    }

    const classifierEntries: MavenArtifact[] = [];
    const osName = this.getMojangOs();
    for (const library of versionJson.libraries ?? []) {
      if (!this.rulesAllow(library.rules)) continue;
      const artifact = library.downloads?.artifact ?? this.fallbackArtifact(library);
      if (artifact) tasks.push(this.toLibraryRequest(gameDir, artifact, library.name));
      const nativePattern = library.natives?.[osName];
      if (nativePattern) {
        const classifier = nativePattern.replace(/\$\{arch\}/g, process.arch === 'ia32' ? '32' : '64');
        const nativeArtifact = library.downloads?.classifiers?.[classifier];
        if (nativeArtifact) {
          tasks.push(this.toLibraryRequest(gameDir, nativeArtifact, `${library.name} natives`));
          classifierEntries.push(nativeArtifact);
        }
      }
    }
    await this.downloadUnique(tasks);
    const nativesDir = join(gameDir, 'versions', versionJson.id, `${versionJson.id}-natives`);
    await mkdir(nativesDir, { recursive: true });
    for (const archive of classifierEntries) {
      await extractNativeArchive(safeChild(join(gameDir, 'libraries'), archive.path), nativesDir);
    }
    if (versionJson.assetIndex?.url) {
      await this.installAssets(gameDir, versionJson.assetIndex, versionJson.assets ?? versionJson.assetIndex.id);
    }
  }

  async getInstalledVersions(profileId: string): Promise<InstalledVersion[]> {
    const profile = this.database.getProfile(profileId);
    const root = join(profile.gameDir, 'versions');
    const directories = await readdir(root, { withFileTypes: true }).catch(() => []);
    const versions: InstalledVersion[] = [];
    for (const entry of directories) {
      if (!entry.isDirectory()) continue;
      const jsonPath = join(root, entry.name, `${entry.name}.json`);
      try {
        const content = await readFile(jsonPath, 'utf8');
        const json = JSON.parse(content) as VersionJson;
        const loader = this.detectLoader(entry.name);
        const info = await stat(jsonPath);
        versions.push({
          id: entry.name,
          type: json.type ?? loader,
          loader,
          gameVersion: json.inheritsFrom ?? this.inferGameVersion(entry.name),
          installedAt: info.mtimeMs,
        });
      } catch {
        // Ignore incomplete installer artifacts; they are not launchable versions.
      }
    }
    return versions.sort((a, b) => b.installedAt - a.installedAt);
  }

  async loadVersionJson(gameDir: string, versionId: string): Promise<VersionJson> {
    const jsonPath = join(gameDir, 'versions', versionId, `${versionId}.json`);
    const child = JSON.parse(await readFile(jsonPath, 'utf8')) as VersionJson;
    if (!child.inheritsFrom) return child;
    const parent = await this.loadVersionJson(gameDir, child.inheritsFrom);
    const libraries = new Map<string, VersionLibrary>();
    for (const library of [...(parent.libraries ?? []), ...(child.libraries ?? [])]) libraries.set(library.name, library);
    const argumentsParent = parent.arguments ?? {};
    const argumentsChild = child.arguments ?? {};
    return {
      ...parent,
      ...child,
      libraries: [...libraries.values()],
      arguments: {
        game: [...(argumentsParent.game ?? []), ...(argumentsChild.game ?? [])],
        jvm: [...(argumentsParent.jvm ?? []), ...(argumentsChild.jvm ?? [])],
      },
      downloads: child.downloads ?? parent.downloads,
      assetIndex: child.assetIndex ?? parent.assetIndex,
      assets: child.assets ?? parent.assets,
      mainClass: child.mainClass ?? parent.mainClass,
      javaVersion: child.javaVersion ?? parent.javaVersion,
      minecraftArguments: child.minecraftArguments ?? parent.minecraftArguments,
    };
  }

  getMojangOs(): string {
    if (process.platform === 'win32') return 'windows';
    if (process.platform === 'darwin') return 'osx';
    return 'linux';
  }

  rulesAllow(rules?: Rule[], features: Record<string, boolean> = {}): boolean {
    if (!rules?.length) return true;
    let allowed = false;
    for (const rule of rules) {
      if (!this.ruleMatches(rule, features)) continue;
      allowed = rule.action === 'allow';
    }
    return allowed;
  }

  private ruleMatches(rule: Rule, features: Record<string, boolean>): boolean {
    if (rule.os?.name && rule.os.name !== this.getMojangOs()) return false;
    if (rule.os?.arch) {
      const arch = process.arch === 'x64' ? 'x86_64' : process.arch;
      const normalizedArch = arch === 'arm64' ? 'aarch64' : arch;
      if (rule.os.arch !== normalizedArch) return false;
    }
    if (rule.os?.version) {
      try {
        if (!new RegExp(rule.os.version).test(osRelease())) return false;
      } catch {
        return false;
      }
    }
    if (rule.features && Object.entries(rule.features).some(([key, value]) => features[key] !== value)) return false;
    return true;
  }

  private async installAssets(gameDir: string, assetIndex: NonNullable<VersionJson['assetIndex']>, assetIndexName: string): Promise<void> {
    const indexPath = join(gameDir, 'assets', 'indexes', `${assetIndex.id}.json`);
    await this.downloads.download({
      url: assetIndex.url,
      destination: indexPath,
      sha1: assetIndex.sha1,
      size: assetIndex.size,
      category: 'asset',
      name: `${assetIndex.id} asset index`,
    });
    const index = JSON.parse(await readFile(indexPath, 'utf8')) as {
      virtual?: boolean;
      map_to_resources?: boolean;
      objects?: Record<string, { hash: string; size: number }>;
    };
    const objects = Object.values(index.objects ?? {});
    const unique = new Map(objects.map((object) => [object.hash, object]));
    const requests: DownloadRequest[] = [...unique.values()].map((object) => {
      const relative = `${object.hash.slice(0, 2)}/${object.hash}`;
      return {
        url: `${RESOURCES_URL}/${relative}`,
        destination: join(gameDir, 'assets', 'objects', relative),
        sha1: object.hash,
        size: object.size,
        category: 'asset',
        name: `Asset ${object.hash.slice(0, 8)}`,
      };
    });
    await this.downloadUnique(requests);

    // Old asset indexes expect named virtual/resource trees in addition to the content-addressed objects.
    for (const [assetName, object] of Object.entries(index.objects ?? {})) {
      const source = join(gameDir, 'assets', 'objects', object.hash.slice(0, 2), object.hash);
      const targets: string[] = [];
      if (index.virtual) targets.push(join(gameDir, 'assets', 'virtual', assetIndexName, assetName));
      if (index.map_to_resources) targets.push(join(gameDir, 'resources', assetName));
      for (const target of targets) {
        await mkdir(dirname(target), { recursive: true });
        await link(source, target).catch(async () => copyFile(source, target).catch(() => undefined));
      }
    }
  }

  private async downloadUnique(tasks: DownloadRequest[]): Promise<void> {
    const unique = new Map<string, DownloadRequest>();
    for (const task of tasks) unique.set(task.destination, task);
    await this.downloads.downloadMany([...unique.values()]);
  }

  private toLibraryRequest(gameDir: string, artifact: MavenArtifact, name: string): DownloadRequest {
    const destination = safeChild(join(gameDir, 'libraries'), artifact.path);
    const baseUrl = 'https://libraries.minecraft.net/';
    const url = artifact.url ?? `${baseUrl}${artifact.path}`;
    return { url, destination, sha1: artifact.sha1, size: artifact.size, category: 'library', name: basename(artifact.path) || name };
  }

  private fallbackArtifact(library: VersionLibrary): MavenArtifact | null {
    const coordinate = library.name.split('@')[0]?.split(':');
    if (!coordinate || coordinate.length < 3) return null;
    const [group, artifact, version, classifier] = coordinate;
    const extension = library.name.includes('@') ? library.name.split('@').at(-1) : 'jar';
    const relative = `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ''}.${extension}`;
    const baseUrl = library.url ?? 'https://libraries.minecraft.net/';
    return { path: relative, url: `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}${relative}` };
  }

  private detectLoader(id: string): LoaderKind {
    const lower = id.toLowerCase();
    if (lower.startsWith('fabric-loader-')) return 'fabric';
    if (lower.startsWith('quilt-loader-')) return 'quilt';
    if (lower.startsWith('neoforge-') || /(?:^|-)neoforge-/.test(lower)) return 'neoforge';
    if (lower.startsWith('forge-') || /(?:^|-)forge-/.test(lower)) return 'forge';
    return 'vanilla';
  }

  private inferGameVersion(id: string): string {
    const loaderMatch = id.match(/^(?:fabric-loader-[^-]+-|quilt-loader-[^-]+-)(.+)$/i);
    if (loaderMatch?.[1]) return loaderMatch[1];
    const forgeMatch = id.match(/^(\d+\.\d+(?:\.\d+)?)-(?:neo)?forge-/i);
    return forgeMatch?.[1] ?? id;
  }
}
