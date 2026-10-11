import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, Copy, Gamepad2, KeyRound, ShieldCheck, X } from 'lucide-react';
import type { Account, AuthEvent, LanguageCode } from '../../shared/types';
import { api } from '../lib/api';
import { t } from '../i18n';

interface AuthModalProps {
  account: Account | null;
  language: LanguageCode;
  microsoftConfigured: boolean;
  authEvent: AuthEvent | null;
  onClose: () => void;
  onChanged: () => void;
}

export function AuthModal({ account, language, microsoftConfigured, authEvent, onClose, onChanged }: AuthModalProps) {
  const [mode, setMode] = useState<'microsoft' | 'offline'>('microsoft');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (authEvent?.type === 'error') { setError(authEvent.message ?? 'Sign-in failed.'); setBusy(false); }
    if (authEvent?.type === 'device-code') setError('');
    if (authEvent?.type === 'complete') {
      setBusy(false);
      onChanged();
      window.setTimeout(onClose, 850);
    }
    if (authEvent?.type === 'cancelled') setBusy(false);
  }, [authEvent, onChanged, onClose]);

  const submitOffline = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.loginOffline(username);
      onChanged();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create this offline profile.');
    } finally {
      setBusy(false);
    }
  };

  const startMicrosoft = async () => {
    setBusy(true);
    setError('');
    try {
      await api.loginMicrosoft();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start Microsoft sign-in.');
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!authEvent?.userCode) return;
    await navigator.clipboard?.writeText(authEvent.userCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const close = () => {
    if (busy) void api.cancelMicrosoftLogin();
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="auth-modal modal-panel" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="modal-close icon-button" onClick={close} aria-label="Close"><X size={19} /></button>
        <div className="modal-emblem"><Gamepad2 size={23} /></div>
        <div className="eyebrow">PLAYER PROFILE</div>
        <h2 id="auth-title">{account ? 'Account settings' : 'Jump into your world'}</h2>
        <p className="modal-lead">Sign in to sync your premium profile, or continue with an offline username.</p>

        {account && (
          <div className="signed-in-box">
            <div className="account-avatar online">{account.username.slice(0, 1).toUpperCase()}</div>
            <div><strong>{account.username}</strong><span>{account.kind === 'microsoft' ? 'Microsoft · Minecraft Java' : 'Offline profile'}</span></div>
            <ShieldCheck size={18} className="signed-shield" />
          </div>
        )}

        <div className="auth-tabs">
          <button className={mode === 'microsoft' ? 'selected' : ''} onClick={() => { setMode('microsoft'); setError(''); }}><ShieldCheck size={15} />{t(language, 'microsoft')}</button>
          <button className={mode === 'offline' ? 'selected' : ''} onClick={() => { setMode('offline'); setError(''); }}><KeyRound size={15} />{t(language, 'offline')}</button>
        </div>

        {mode === 'microsoft' ? (
          <div className="auth-mode-content">
            {authEvent?.type === 'device-code' ? (
              <div className="device-flow">
                <div className="device-code-label">{t(language, 'enterCode')}</div>
                <button className="device-code" onClick={copyCode} title="Copy code"><span>{authEvent.userCode}</span>{copied ? <Check size={18} /> : <Copy size={17} />}</button>
                <button className="button button-primary button-wide" onClick={() => void api.openExternal(authEvent.verificationUri ?? 'https://microsoft.com/link')}>
                  {t(language, 'openMicrosoft')} <ArrowUpRight size={16} />
                </button>
                <div className="waiting-line"><span className="spinner" />Waiting for Microsoft approval…</div>
                <button className="text-button muted" onClick={() => void api.cancelMicrosoftLogin()}>Cancel sign-in</button>
              </div>
            ) : (
              <div className="auth-mode-content">
                <div className="security-note"><ShieldCheck size={17} /><span>Your password is never shared with Loader. Microsoft signs you in using a secure device code.</span></div>
                {!microsoftConfigured && !account && <div className="config-warning">{t(language, 'microsoftSetup')} Add <code>MICROSOFT_CLIENT_ID</code> to the launcher environment.</div>}
                {account?.kind === 'microsoft' && <div className="success-note"><Check size={16} />Connected as {account.username}</div>}
                <button className="button button-primary button-wide" onClick={() => void startMicrosoft()} disabled={!microsoftConfigured || busy}>
                  {busy ? <><span className="spinner" />Connecting…</> : <>{account?.kind === 'microsoft' ? 'Reconnect Microsoft' : 'Continue with Microsoft'}<ArrowUpRight size={16} /></>}
                </button>
              </div>
            )}
          </div>
        ) : (
          <form className="offline-form" onSubmit={submitOffline}>
            <label htmlFor="offline-name">{t(language, 'username')}</label>
            <input id="offline-name" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Steve_" minLength={3} maxLength={16} pattern="[A-Za-z0-9_]{3,16}" autoComplete="off" required />
            <p className="field-hint">3–16 letters, numbers, or underscores. Offline profiles cannot join servers that require premium authentication.</p>
            <button className="button button-primary button-wide" type="submit" disabled={busy || username.length < 3}>
              {busy ? <><span className="spinner" />Connecting…</> : <>{t(language, 'continueOffline')}<ArrowUpRight size={16} /></>}
            </button>
          </form>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}

        {account && <button className="text-button sign-out-button" onClick={async () => { await api.logout(); onChanged(); onClose(); }}>{t(language, 'signOut')}</button>}
        <div className="auth-footnote"><span className="auth-foot-dot" />Tokens are encrypted by your operating system</div>
      </section>
    </div>
  );
}
