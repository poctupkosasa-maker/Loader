import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { delimiter, join } from 'node:path';
import { existsSync } from 'node:fs';

const execFileAsync = promisify(execFile);

export interface JavaRuntime {
  path: string;
  majorVersion: number;
  description: string;
}

/** Finds and validates a local Java runtime; Java 8, 17, and 21 are supported. */
export class JavaService {
  async detect(configuredPath = ''): Promise<JavaRuntime | null> {
    const candidates = [configuredPath, process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : ''];
    const names = process.platform === 'win32' ? ['java.exe'] : ['java'];
    for (const name of names) {
      for (const dir of (process.env.PATH ?? '').split(delimiter)) candidates.push(join(dir, name));
    }
    for (const candidate of [...new Set(candidates.filter(Boolean))]) {
      const normalized = candidate.toLowerCase().endsWith(process.platform === 'win32' ? '.exe' : '/java')
        ? candidate
        : join(candidate, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
      if (!existsSync(normalized)) continue;
      try {
        const { stdout, stderr } = await execFileAsync(normalized, ['-version'], { timeout: 8000 });
        const description = `${stdout}${stderr}`.trim().split(/\r?\n/)[0] ?? 'Java runtime';
        const match = description.match(/version "?([0-9]+)(?:\.([0-9]+))?/i);
        if (!match) continue;
        const majorVersion = Number(match[1]) === 1 ? Number(match[2]) : Number(match[1]);
        if (![8, 16, 17, 21, 22, 23, 24, 25].includes(majorVersion)) continue;
        return { path: normalized, majorVersion, description };
      } catch {
        // Keep searching; invalid user paths should not prevent auto-detection.
      }
    }
    return null;
  }

  async resolve(configuredPath: string, requiredVersion: number): Promise<JavaRuntime> {
    const runtime = await this.detect(configuredPath);
    if (!runtime) throw new Error('Java was not found. Install Java 8, 17, or 21, or select java/javaw manually in Settings.');
    const compatible = requiredVersion <= 8
      ? [8, 17, 21, 22, 23, 24, 25].includes(runtime.majorVersion)
      : requiredVersion <= 17
        ? [17, 21, 22, 23, 24, 25].includes(runtime.majorVersion)
        : runtime.majorVersion >= requiredVersion;
    if (!compatible) {
      throw new Error(`Minecraft needs Java ${requiredVersion} or newer, but the selected runtime is Java ${runtime.majorVersion}. Choose a compatible Java runtime in Settings.`);
    }
    return runtime;
  }
}
