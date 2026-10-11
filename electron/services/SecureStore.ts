import { app, safeStorage } from 'electron';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SessionSecrets {
  microsoftAccessToken: string;
  refreshToken: string;
  minecraftAccessToken: string;
  expiresAt: number;
}

/** Stores OAuth credentials only as OS-encrypted bytes via Electron safeStorage. */
export class SecureStore {
  private readonly filePath = join(app.getPath('userData'), 'session.enc');

  async saveSession(session: SessionSecrets): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS credential encryption is unavailable. Sign-in is active for this run but cannot be persisted securely.');
    }
    await mkdir(app.getPath('userData'), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(session));
    await writeFile(this.filePath, encrypted, { mode: 0o600 });
    // chmod is best-effort on Windows; encryption itself is handled by the OS keychain.
    await chmod(this.filePath, 0o600).catch(() => undefined);
  }

  async readSession(): Promise<SessionSecrets | null> {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const encrypted = await readFile(this.filePath);
      const value = JSON.parse(safeStorage.decryptString(encrypted)) as SessionSecrets;
      if (!value.microsoftAccessToken || !value.minecraftAccessToken || !value.refreshToken) return null;
      return value;
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}
