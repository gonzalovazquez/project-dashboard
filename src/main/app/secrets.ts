import { readFile, rm } from 'node:fs/promises';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

/** The slice of Electron's safeStorage this app uses. */
export interface SecretBox {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export class SecureStorageUnavailable extends Error {
  constructor() { super('Secure storage is not available on this system, so the token was not saved. Set the NOTION_TOKEN environment variable instead.'); }
}

export type TokenSource = 'env' | 'keychain' | 'none';

/**
 * Keeps the Notion token encrypted with the operating system keychain. The token is never
 * written in plain text: if encryption is unavailable, saving fails instead of falling back.
 * NOTION_TOKEN in the environment takes precedence and is never stored.
 */
export class TokenStore {
  constructor(private path: string, private box: SecretBox, private env: Record<string, string | undefined> = process.env) {}

  get secureStorageAvailable() { return this.box.isAvailable(); }

  async get(): Promise<{ token?: string; source: TokenSource }> {
    const fromEnv = this.env.NOTION_TOKEN?.trim();
    if (fromEnv) return { token: fromEnv, source: 'env' };
    if (!this.box.isAvailable()) return { source: 'none' };
    try {
      const token = this.box.decrypt(await readFile(this.path));
      return token ? { token, source: 'keychain' } : { source: 'none' };
    } catch { return { source: 'none' }; }
  }

  async set(token: string | null): Promise<void> {
    if (token === null || token === '') { await rm(this.path, { force: true }); return; }
    if (!this.box.isAvailable()) throw new SecureStorageUnavailable();
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, this.box.encrypt(token), { mode: 0o600 });
    await rename(tmp, this.path);
  }
}
