import { createHash } from 'node:crypto';
import type { Account, AuthEvent } from '../../shared/types';
import { DatabaseService } from './DatabaseService';
import { SecureStore, type SessionSecrets } from './SecureStore';

const DEVICE_CODE_ENDPOINT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID ?? '';

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  interval?: number;
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  message?: string;
}

/** Implements Microsoft's public-client device flow through Xbox Live and Minecraft Services. */
export class AuthService {
  private controller: AbortController | null = null;
  private volatileSession: SessionSecrets | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly secureStore: SecureStore,
    private readonly emit: (event: AuthEvent) => void,
  ) {}

  get isConfigured(): boolean {
    return Boolean(CLIENT_ID);
  }

  async loginOffline(input: string): Promise<Account> {
    const username = input.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      throw new Error('Offline usernames must be 3–16 characters using letters, numbers, or underscores.');
    }
    await this.cancelMicrosoftLogin();
    this.volatileSession = null;
    await this.secureStore.clear();
    const digest = createHash('md5').update(`OfflinePlayer:${username}`).digest();
    digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x30;
    digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
    const hex = digest.toString('hex');
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    const account: Account = { username, uuid, kind: 'offline' };
    this.database.saveAccount(account);
    return account;
  }

  async beginMicrosoftLogin(): Promise<void> {
    if (!CLIENT_ID) {
      throw new Error('Microsoft sign-in is not configured. Set MICROSOFT_CLIENT_ID in the environment and register a public client with device-code flow enabled.');
    }
    if (this.controller) throw new Error('A Microsoft sign-in is already in progress.');
    this.controller = new AbortController();
    const signal = this.controller.signal;
    try {
      const body = new URLSearchParams({
        client_id: CLIENT_ID,
        scope: 'XboxLive.signin offline_access',
      });
      const response = await fetch(DEVICE_CODE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal,
      });
      const device = await response.json() as OAuthTokenResponse;
      if (!response.ok || !device.device_code) throw new Error(device.error_description ?? 'Could not start Microsoft device-code sign-in.');
      const interval = Math.max(5, device.interval ?? 5);
      this.emit({
        type: 'device-code',
        message: device.message,
        userCode: device.user_code,
        verificationUri: device.verification_uri ?? 'https://microsoft.com/link',
        expiresIn: device.expires_in,
        interval,
      });
      void this.pollDeviceCode(device.device_code, interval, device.expires_in ?? 900, signal);
    } catch (error) {
      this.controller = null;
      if (signal.aborted) return;
      const message = this.errorMessage(error);
      this.emit({ type: 'error', message });
      throw error;
    }
  }

  async cancelMicrosoftLogin(): Promise<void> {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
      this.emit({ type: 'cancelled', message: 'Microsoft sign-in cancelled.' });
    }
  }

  async logout(): Promise<void> {
    await this.cancelMicrosoftLogin();
    this.volatileSession = null;
    await this.secureStore.clear();
    this.database.clearAccount();
  }

  async getLaunchSession(): Promise<{ account: Account; accessToken: string; userType: 'msa' | 'legacy' }> {
    const account = this.database.getAccount();
    if (!account) throw new Error('Sign in or choose an offline username before launching the game.');
    if (account.kind === 'offline') return { account, accessToken: '0', userType: 'legacy' };

    let session = this.volatileSession ?? await this.secureStore.readSession();
    if (!session) throw new Error('Your Microsoft session is unavailable. Sign in again to continue.');
    if (session.expiresAt < Date.now() + 60_000) {
      session = await this.refreshSession(session);
    }
    this.volatileSession = session;
    return { account, accessToken: session.minecraftAccessToken, userType: 'msa' };
  }

  private async pollDeviceCode(deviceCode: string, interval: number, expiresIn: number, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + expiresIn * 1000;
    let waitSeconds = interval;
    try {
      while (Date.now() < deadline && !signal.aborted) {
        await this.delay(waitSeconds * 1000, signal);
        if (signal.aborted) return;
        const body = new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: CLIENT_ID,
          device_code: deviceCode,
        });
        const response = await fetch(TOKEN_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal,
        });
        const result = await response.json() as OAuthTokenResponse;
        if (result.error === 'authorization_pending') continue;
        if (result.error === 'slow_down') {
          waitSeconds += 5;
          continue;
        }
        if (!response.ok || !result.access_token || !result.refresh_token) {
          throw new Error(result.error_description ?? 'Microsoft sign-in was not completed.');
        }
        const session = await this.exchangeForMinecraft(result.access_token, result.refresh_token, result.expires_in ?? 3600);
        this.volatileSession = session;
        let persistenceNote = '';
        try {
          await this.secureStore.saveSession(session);
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes('OS credential encryption is unavailable')) throw error;
          persistenceNote = ' Secure credential storage is unavailable, so this session will last until Loader closes.';
        }
        const account = this.database.getAccount();
        if (!account) throw new Error('Microsoft sign-in finished without a Minecraft profile.');
        this.emit({ type: 'complete', account, message: `Signed in as ${account.username}.${persistenceNote}` });
        this.controller = null;
        return;
      }
      if (!signal.aborted) throw new Error('The Microsoft device code expired. Start sign-in again.');
    } catch (error) {
      if (!signal.aborted) this.emit({ type: 'error', message: this.errorMessage(error) });
    } finally {
      if (this.controller?.signal === signal) this.controller = null;
    }
  }

  private async refreshSession(session: SessionSecrets): Promise<SessionSecrets> {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
        scope: 'XboxLive.signin offline_access',
      }),
    });
    const tokens = await response.json() as OAuthTokenResponse;
    if (!response.ok || !tokens.access_token || !tokens.refresh_token) {
      throw new Error('Your Microsoft session expired. Sign in again.');
    }
    const refreshed = await this.exchangeForMinecraft(tokens.access_token, tokens.refresh_token, tokens.expires_in ?? 3600);
    await this.secureStore.saveSession(refreshed);
    return refreshed;
  }

  private async exchangeForMinecraft(msAccessToken: string, refreshToken: string, expiresIn: number): Promise<SessionSecrets> {
    const xboxResponse = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT',
      }),
    });
    const xbox = await xboxResponse.json() as { Token?: string; DisplayClaims?: { xui?: Array<{ uhs?: string }> }; XErr?: number };
    if (!xboxResponse.ok || !xbox.Token) throw new Error('Xbox Live authentication failed. Check that this Microsoft account can sign in to Xbox Live.');

    const xstsResponse = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        Properties: { SandboxId: 'RETAIL', UserTokens: [xbox.Token] },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT',
      }),
    });
    const xsts = await xstsResponse.json() as { Token?: string; DisplayClaims?: { xui?: Array<{ uhs?: string }> }; XErr?: number };
    if (!xstsResponse.ok || !xsts.Token) {
      if (xsts.XErr === 2148916233) throw new Error('This Microsoft account does not have an Xbox profile. Create one and try again.');
      if (xsts.XErr === 2148916238) throw new Error('Xbox Live requires a parent or guardian to finish setting up this account.');
      throw new Error('Xbox security authentication failed.');
    }
    const userHash = xsts.DisplayClaims?.xui?.[0]?.uhs;
    if (!userHash) throw new Error('Xbox Live did not return a user identity.');

    const minecraftResponse = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityToken: `XBL3.0 x=${userHash};${xsts.Token}` }),
    });
    const minecraft = await minecraftResponse.json() as { access_token?: string; expires_in?: number };
    if (!minecraftResponse.ok || !minecraft.access_token) throw new Error('Minecraft Services rejected this Xbox account. Verify it owns Minecraft Java Edition.');

    const profileResponse = await fetch('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${minecraft.access_token}` },
    });
    const profile = await profileResponse.json() as { id?: string; name?: string; skins?: Array<{ url?: string }> };
    if (!profileResponse.ok || !profile.id || !profile.name) {
      throw new Error('No Minecraft Java profile was found for this Microsoft account.');
    }
    const account: Account = {
      username: profile.name,
      uuid: profile.id,
      kind: 'microsoft',
      skinUrl: profile.skins?.find((skin) => skin.url)?.url,
    };
    const entitlementResponse = await fetch('https://api.minecraftservices.com/entitlements/mcstore', {
      headers: { Authorization: `Bearer ${minecraft.access_token}` },
    });
    if (entitlementResponse.ok) {
      const entitlements = await entitlementResponse.json() as { items?: unknown[] };
      if (!entitlements.items?.length) throw new Error('This account does not have a Minecraft Java Edition entitlement.');
    }
    this.database.saveAccount(account);
    return {
      microsoftAccessToken: msAccessToken,
      refreshToken,
      minecraftAccessToken: minecraft.access_token,
      expiresAt: Date.now() + Math.min(expiresIn, minecraft.expires_in ?? expiresIn) * 1000,
    };
  }

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('Sign-in cancelled.'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Microsoft sign-in failed unexpectedly.';
  }
}
