import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConsoleLine, LoaderKind } from '../../shared/types';
import { DatabaseService } from './DatabaseService';
import { DownloadService } from './DownloadService';
import { JavaService } from './JavaService';
import { VersionService } from './VersionService';

interface LoaderVersionEntry {
  version?: string;
  stable?: boolean;
  url?: string;
  loader?: { version?: string; stable?: boolean };
}

/** Uses the official loader metadata and installer JARs for Fabric, Forge, Quilt, and NeoForge. */
export class LoaderService {
  constructor(
    private readonly database: DatabaseService,
    private readonly downloads: DownloadService,
    private readonly versions: VersionService,
    private readonly java: JavaService,
    private readonly emitConsole: (line: ConsoleLine) => void,
  ) {}

  async install(profileId: string, loader: Exclude<LoaderKind, 'vanilla'>, gameVersion: string): Promise<{ versionId: string; message: string }> {
    if (!/^[0-9A-Za-z._+-]{1,80}$/.test(gameVersion)) throw new Error('Minecraft version is invalid.');
    const profile = this.database.getProfile(profileId);
    // The base game files and assets are in place before an official installer adds its libraries/profile.
    await this.versions.installVersion(profileId, gameVersion);
    const installer = await this.prepareInstaller(loader, gameVersion, profile.gameDir);
    const java = await this.java.detect(this.database.getSettings().javaPath);
    if (!java) throw new Error('A Java runtime is needed to run the mod-loader installer. Install Java 17 or 21, or select it in Settings.');
    const args = this.installerArguments(loader, installer.path, gameVersion, installer.loaderVersion, profile.gameDir);
    this.emitSystem(`Installing ${loader} for Minecraft ${gameVersion}…`);
    await this.runProcess(java.path, args, profile.gameDir);

    const installed = await this.versions.getInstalledVersions(profileId);
    const candidate = installed.find((version) => version.loader === loader && version.gameVersion === gameVersion);
    if (!candidate) {
      throw new Error(`${loader} installer finished, but no launchable ${loader} profile was found. Check the Console for installer output.`);
    }
    this.database.setProfileVersion(profileId, candidate.id, loader);
    this.emitSystem(`${loader} ${candidate.id} is installed.`);
    return { versionId: candidate.id, message: `${loader} is installed for Minecraft ${gameVersion}.` };
  }

  private async prepareInstaller(loader: Exclude<LoaderKind, 'vanilla'>, gameVersion: string, gameDir: string): Promise<{ path: string; loaderVersion: string }> {
    const installerDir = join(gameDir, 'loader-installers');
    await mkdir(installerDir, { recursive: true });
    if (loader === 'fabric') {
      const data = await this.fetchJson<LoaderVersionEntry[]>(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(gameVersion)}`);
      const selected = data.find((entry) => entry.loader?.stable) ?? data[0];
      if (!selected?.loader?.version) throw new Error(`Fabric does not publish a loader for Minecraft ${gameVersion}.`);
      const installers = await this.fetchJson<LoaderVersionEntry[]>('https://meta.fabricmc.net/v2/versions/installer');
      const latestInstaller = installers.find((entry) => entry.stable) ?? installers[0];
      const installerVersion = latestInstaller?.version;
      if (!installerVersion) throw new Error('Could not find the Fabric installer version.');
      const url = latestInstaller?.url ?? `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${installerVersion}/fabric-installer-${installerVersion}.jar`;
      const path = join(installerDir, `fabric-installer-${installerVersion}.jar`);
      await this.downloads.download({ url, destination: path, category: 'loader', name: 'Fabric installer' });
      return { path, loaderVersion: selected.loader.version };
    }
    if (loader === 'quilt') {
      const data = await this.fetchJson<LoaderVersionEntry[]>(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(gameVersion)}`);
      const selected = data.find((entry) => entry.loader?.stable) ?? data[0];
      if (!selected?.loader?.version) throw new Error(`Quilt does not publish a loader for Minecraft ${gameVersion}.`);
      const installers = await this.fetchJson<LoaderVersionEntry[]>('https://meta.quiltmc.org/v3/versions/installer');
      const latestInstaller = installers.find((entry) => entry.stable) ?? installers[0];
      const installerVersion = latestInstaller?.version;
      if (!installerVersion) throw new Error('Could not find the Quilt installer version.');
      const url = latestInstaller?.url ?? `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${installerVersion}/quilt-installer-${installerVersion}-cli.jar`;
      const path = join(installerDir, `quilt-installer-${installerVersion}.jar`);
      await this.downloads.download({ url, destination: path, category: 'loader', name: 'Quilt installer' });
      return { path, loaderVersion: selected.loader.version };
    }
    if (loader === 'forge') {
      const promotions = await this.fetchJson<{ promos?: Record<string, string> }>('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
      const forgeVersion = promotions.promos?.[`${gameVersion}-recommended`] ?? promotions.promos?.[`${gameVersion}-latest`];
      if (!forgeVersion) throw new Error(`Forge does not list an installer for Minecraft ${gameVersion}.`);
      const combined = `${gameVersion}-${forgeVersion}`;
      const path = join(installerDir, `forge-${combined}-installer.jar`);
      const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${combined}/forge-${combined}-installer.jar`;
      await this.downloads.download({ url, destination: path, category: 'loader', name: 'Forge installer' });
      return { path, loaderVersion: forgeVersion };
    }

    const metadata = await fetch('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
    if (!metadata.ok) throw new Error('Could not retrieve NeoForge version metadata.');
    const xml = await metadata.text();
    const match = gameVersion.match(/^1\.(\d+)(?:\.(\d+))?/);
    if (!match) throw new Error('NeoForge could not identify this Minecraft version.');
    const family = `${match[1]}.${match[2] ?? '0'}`;
    const allVersions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((entry) => entry[1] ?? '');
    const compatible = allVersions.filter((version) => version.startsWith(`${family}.`) && !version.includes('alpha') && !version.includes('beta'));
    compatible.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    const neoVersion = compatible[0];
    if (!neoVersion) throw new Error(`NeoForge does not list an installer for Minecraft ${gameVersion}.`);
    const path = join(installerDir, `neoforge-${neoVersion}-installer.jar`);
    const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoVersion}/neoforge-${neoVersion}-installer.jar`;
    await this.downloads.download({ url, destination: path, category: 'loader', name: 'NeoForge installer' });
    return { path, loaderVersion: neoVersion };
  }

  private installerArguments(loader: Exclude<LoaderKind, 'vanilla'>, jar: string, gameVersion: string, loaderVersion: string, gameDir: string): string[] {
    if (loader === 'fabric') return ['-jar', jar, 'client', '-mcversion', gameVersion, '-loader', loaderVersion, '-dir', gameDir, '-noprofile'];
    if (loader === 'quilt') return ['-jar', jar, 'install', 'client', gameVersion, '--loader', loaderVersion, '--install-dir', gameDir, '--no-profile'];
    if (loader === 'forge') return ['-jar', jar, '--installClient', gameDir];
    return ['-jar', jar, '--installClient', gameDir];
  }

  private runProcess(executable: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        stdout = this.emitLines(stdout, 'stdout');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        stderr = this.emitLines(stderr, 'stderr');
      });
      child.once('error', reject);
      child.once('close', (code) => {
        this.emitLines(stdout, 'stdout', true);
        this.emitLines(stderr, 'stderr', true);
        if (code === 0) resolvePromise();
        else reject(new Error(`Mod-loader installer exited with status ${code ?? 'unknown'}.`));
      });
    });
  }

  private emitLines(buffer: string, stream: 'stdout' | 'stderr', flush = false): string {
    const lines = buffer.split(/\r?\n/);
    const remainder = flush ? '' : lines.pop() ?? '';
    for (const text of (flush ? lines.concat(remainder) : lines)) {
      if (text.trim()) this.emitConsole({ id: `loader-${Date.now()}-${Math.random()}`, timestamp: Date.now(), stream, text: text.trimEnd() });
    }
    return remainder;
  }

  private emitSystem(text: string): void {
    this.emitConsole({ id: `system-${Date.now()}-${Math.random()}`, timestamp: Date.now(), stream: 'system', text });
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not retrieve mod-loader metadata (${response.status}).`);
    return await response.json() as T;
  }
}
