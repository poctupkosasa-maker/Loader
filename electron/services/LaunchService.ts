import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { release as osRelease } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import type { ConsoleLine, LauncherProfile } from '../../shared/types';
import { AuthService } from './AuthService';
import { DatabaseService } from './DatabaseService';
import { JavaService } from './JavaService';
import { VersionService, type VersionJson } from './VersionService';

type LaunchRule = { action: 'allow' | 'disallow'; os?: { name?: string; arch?: string; version?: string }; features?: Record<string, boolean> };
type ArgumentEntry = string | { rules?: LaunchRule[]; value: string | string[] };
/** Resolves Mojang's version JSON into a Java process and streams output to the UI. */
export class LaunchService {
  private child: ChildProcess | null = null;
  private launchPending = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly auth: AuthService,
    private readonly versions: VersionService,
    private readonly java: JavaService,
    private readonly emitConsole: (line: ConsoleLine) => void,
    private readonly emitState: (state: { running: boolean; message: string }) => void,
  ) {}

  get isRunning(): boolean {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null);
  }

  async launch(profileId: string): Promise<void> {
    if (this.launchPending || this.isRunning) throw new Error('Minecraft is already running.');
    this.launchPending = true;
    this.emitState({ running: false, message: 'Preparing your game…' });
    try {
      const accountSession = await this.auth.getLaunchSession();
      let profile = this.database.getProfile(profileId);
      if (profile.versionId === 'latest-release' || profile.versionId === 'latest-snapshot') {
        await this.versions.installVersion(profileId, profile.versionId);
        profile = this.database.getProfile(profileId);
      }

      let versionJson = await this.versions.loadVersionJson(profile.gameDir, profile.versionId);
      const baseId = typeof versionJson.jar === 'string' ? versionJson.jar : versionJson.inheritsFrom ?? versionJson.id;
      const baseJsonExists = await access(join(profile.gameDir, 'versions', baseId, `${baseId}.json`)).then(() => true, () => false);
      if (!baseJsonExists) {
        await this.versions.installVersion(profileId, baseId, false);
        profile = this.database.getProfile(profileId);
        versionJson = await this.versions.loadVersionJson(profile.gameDir, profile.versionId);
      }
      await this.versions.prepareRuntime(profile.gameDir, versionJson);

      const settings = this.database.getSettings();
      const requiredJava = this.requiredJavaVersion(versionJson);
      const runtime = await this.java.resolve(settings.javaPath, requiredJava);
      const clientId = typeof versionJson.jar === 'string' ? versionJson.jar : versionJson.inheritsFrom ?? versionJson.id;
      const clientJar = join(profile.gameDir, 'versions', clientId, `${clientId}.jar`);
      const classpath = await this.buildClasspath(profile, versionJson, clientJar);
      const nativesDir = join(profile.gameDir, 'versions', versionJson.id, `${versionJson.id}-natives`);
      const session = accountSession;
      const features = {
        has_custom_resolution: false,
        is_demo_user: false,
        has_quick_plays_support: false,
        is_quick_play_singleplayer: false,
        is_quick_play_multiplayer: false,
        is_quick_play_realms: false,
      };
      const values: Record<string, string> = {
        auth_player_name: session.account.username,
        version_name: versionJson.id,
        game_directory: profile.gameDir,
        assets_root: join(profile.gameDir, 'assets'),
        assets_index_name: versionJson.assetIndex?.id ?? String(versionJson.assets ?? ''),
        auth_uuid: session.account.uuid.replace(/-/g, ''),
        auth_access_token: session.accessToken,
        auth_session: `token:${session.accessToken}:${session.account.uuid.replace(/-/g, '')}`,
        game_assets: String(versionJson.assets ?? versionJson.assetIndex?.id ?? ''),
        clientid: randomUUID(),
        auth_xuid: '',
        user_type: session.userType,
        user_properties: '{}',
        version_type: String(versionJson.type ?? 'release'),
        natives_directory: nativesDir,
        library_directory: join(profile.gameDir, 'libraries'),
        classpath,
        classpath_separator: delimiter,
        launcher_name: 'Loader',
        launcher_version: '1.0.0',
        resolution_width: '1280',
        resolution_height: '720',
      };
      const jvmFromVersion = this.evaluateArguments(versionJson.arguments?.jvm as ArgumentEntry[] | undefined, features, values);
      const gameFromVersion = this.evaluateArguments(versionJson.arguments?.game as ArgumentEntry[] | undefined, features, values);
      const legacyGame = versionJson.minecraftArguments ? this.parseCommandLine(versionJson.minecraftArguments).map((arg) => this.substitute(arg, values)) : [];
      const minRam = Math.max(1, Math.min(32, Math.floor(settings.minRam)));
      const maxRam = Math.max(minRam, Math.min(64, Math.floor(settings.maxRam)));
      const customJvm = this.parseCommandLine(settings.javaArgs);
      const jvmArgs = [...customJvm, `-Xms${minRam}G`, `-Xmx${maxRam}G`];
      const metadataJvm = jvmFromVersion.map((arg) => this.substitute(arg, values));
      if (!metadataJvm.some((arg) => arg.startsWith('-Djava.library.path='))) metadataJvm.unshift(`-Djava.library.path=${nativesDir}`);
      if (!metadataJvm.some((arg) => arg === '-cp' || arg === '-classpath' || arg.includes('${classpath}'))) metadataJvm.push('-cp', classpath);
      jvmArgs.push(...metadataJvm);
      const gameArgs = gameFromVersion.length ? gameFromVersion : legacyGame;
      if (!gameArgs.length) throw new Error(`The ${versionJson.id} metadata does not contain game arguments.`);
      const mainClass = versionJson.mainClass;
      if (!mainClass) throw new Error(`The ${versionJson.id} metadata does not specify a Java main class.`);
      const args = [...jvmArgs, mainClass, ...gameArgs.map((arg) => this.substitute(arg, values))];

      this.emitSystem(`Launching ${versionJson.id} with Java ${runtime.majorVersion} (${runtime.path})`);
      this.emitState({ running: true, message: `Starting ${versionJson.id}…` });
      await this.startProcess(runtime.path, args, profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to launch Minecraft.';
      this.emitSystem(`Launch failed: ${message}`, 'stderr');
      this.emitState({ running: false, message });
      throw error;
    } finally {
      this.launchPending = false;
    }
  }

  stop(): void {
    if (!this.child || this.child.killed) return;
    this.child.kill();
    this.emitSystem('Stop requested.');
  }

  private async buildClasspath(profile: LauncherProfile, version: VersionJson, clientJar: string): Promise<string> {
    const paths = [clientJar];
    for (const library of version.libraries ?? []) {
      if (!this.versions.rulesAllow(library.rules)) continue;
      const artifact = library.downloads?.artifact;
      let relativePath = artifact?.path;
      if (!relativePath) {
        const coordinate = library.name.split('@')[0]?.split(':');
        if (!coordinate || coordinate.length < 3) continue;
        const [group, name, libVersion, classifier] = coordinate;
        const extension = library.name.includes('@') ? library.name.split('@').at(-1) : 'jar';
        relativePath = `${group.replace(/\./g, '/')}/${name}/${libVersion}/${name}-${libVersion}${classifier ? `-${classifier}` : ''}.${extension}`;
      }
      if (!relativePath.toLowerCase().endsWith('.jar')) continue;
      const path = join(profile.gameDir, 'libraries', relativePath);
      await access(path).catch(() => {
        throw new Error(`A required library is missing: ${basename(relativePath)}. Run Install on this version again.`);
      });
      paths.push(path);
    }
    await access(clientJar).catch(() => {
      throw new Error(`The Minecraft client JAR is missing: ${basename(clientJar)}. Reinstall this version.`);
    });
    return paths.join(delimiter);
  }

  private evaluateArguments(entries: ArgumentEntry[] | undefined, features: Record<string, boolean>, values: Record<string, string>): string[] {
    if (!entries) return [];
    const result: string[] = [];
    for (const entry of entries) {
      if (typeof entry === 'string') {
        result.push(this.substitute(entry, values));
        continue;
      }
      if (!this.argumentRulesAllow(entry.rules, features)) continue;
      const value = Array.isArray(entry.value) ? entry.value : [entry.value];
      for (const argument of value) result.push(this.substitute(argument, values));
    }
    return result;
  }

  private argumentRulesAllow(rules: LaunchRule[] | undefined, features: Record<string, boolean>): boolean {
    if (!rules?.length) return true;
    let allowed = false;
    for (const rule of rules) {
      if (rule.os?.name && rule.os.name !== this.versions.getMojangOs()) continue;
      if (rule.os?.arch) {
        const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'ia32' ? 'x86' : process.arch === 'arm64' ? 'aarch64' : process.arch;
        if (rule.os.arch !== arch) continue;
      }
      if (rule.os?.version) {
        try { if (!new RegExp(rule.os.version).test(osRelease())) continue; }
        catch { continue; }
      }
      if (rule.features && Object.entries(rule.features).some(([key, value]) => features[key] !== value)) continue;
      allowed = rule.action === 'allow';
    }
    return allowed;
  }

  private requiredJavaVersion(version: VersionJson): number {
    const declared = version.javaVersion?.majorVersion;
    if (declared) return declared === 16 ? 17 : declared;
    const target = version.inheritsFrom ?? version.id;
    const parts = target.match(/^1\.(\d+)(?:\.(\d+))?/);
    if (!parts) return 17;
    const minor = Number(parts[1]);
    const patch = Number(parts[2] ?? 0);
    if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
    if (minor >= 17) return 17;
    return 8;
  }

  private substitute(value: string, values: Record<string, string>): string {
    return value
      .replace(/\$\{([^}]+)\}/g, (match, key: string) => values[key] ?? match)
      .replace(/%([a-z_]+)%/gi, (match, key: string) => values[key.toLowerCase()] ?? match);
  }

  /** Shell-like tokenizer for custom JVM args and legacy minecraftArguments; no shell is invoked. */
  private parseCommandLine(input: string): string[] {
    const result: string[] = [];
    const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(input)) !== null) result.push((match[1] ?? match[2] ?? match[3] ?? '').replace(/\\(["'\\])/g, '$1'));
    return result;
  }

  private async startProcess(executable: string, args: string[], profile: LauncherProfile): Promise<void> {
    const child = spawn(executable, args, {
      cwd: profile.gameDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, USERPROFILE: process.env.USERPROFILE },
    });
    this.child = child;
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      stdout = this.emitBufferedLines(stdout, 'stdout');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      stderr = this.emitBufferedLines(stderr, 'stderr');
    });
    child.once('error', (error) => {
      this.emitSystem(`Could not start Java: ${error.message}`, 'stderr');
      this.child = null;
      this.emitState({ running: false, message: 'Java failed to start.' });
    });
    child.once('close', (code, signal) => {
      this.emitBufferedLines(stdout, 'stdout', true);
      this.emitBufferedLines(stderr, 'stderr', true);
      if (code !== 0 && code !== null) this.emitSystem(`Minecraft exited with code ${code}${signal ? ` (${signal})` : ''}.`, 'stderr');
      else this.emitSystem('Minecraft closed.');
      this.child = null;
      this.emitState({ running: false, message: 'Game closed.' });
    });
    await new Promise<void>((resolvePromise, reject) => {
      child.once('spawn', () => resolvePromise());
      child.once('error', reject);
    });
  }

  private emitBufferedLines(buffer: string, stream: 'stdout' | 'stderr', flush = false): string {
    const lines = buffer.split(/\r?\n/);
    const remainder = flush ? '' : lines.pop() ?? '';
    for (const text of (flush ? lines.concat(remainder) : lines)) {
      if (text.trim()) this.emitConsole({ id: randomUUID(), timestamp: Date.now(), stream, text: text.trimEnd() });
    }
    return remainder;
  }

  private emitSystem(text: string, stream: ConsoleLine['stream'] = 'system'): void {
    this.emitConsole({ id: randomUUID(), timestamp: Date.now(), stream, text });
  }
}
