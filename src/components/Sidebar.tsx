import { Blocks, Box, CircleHelp, Download, Gamepad2, Home, Layers3, Settings2, Terminal, UserRound, ChevronDown } from 'lucide-react';
import type { Account, DownloadProgress, LauncherProfile, LanguageCode } from '../../shared/types';
import { t } from '../i18n';

export type PageId = 'home' | 'versions' | 'mods' | 'settings' | 'console';

interface SidebarProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
  profiles: LauncherProfile[];
  activeProfileId: string;
  account: Account | null;
  language: LanguageCode;
  progress: DownloadProgress[];
  onProfileChange: (id: string) => void;
  onAuth: () => void;
}

const items = [
  { id: 'home' as const, label: 'home', icon: Home },
  { id: 'versions' as const, label: 'versions', icon: Layers3 },
  { id: 'mods' as const, label: 'mods', icon: Blocks },
  { id: 'settings' as const, label: 'settings', icon: Settings2 },
  { id: 'console' as const, label: 'console', icon: Terminal },
] as const;

export function Sidebar(props: SidebarProps) {
  const { page, onNavigate, profiles, activeProfileId, account, language, progress, onProfileChange, onAuth } = props;
  const activeDownloads = progress.filter((item) => item.status === 'downloading' || item.status === 'queued').length;
  const activeProfile = profiles.find((item) => item.id === activeProfileId);
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand-mark"><Box size={19} strokeWidth={2.5} /></div>
        <span>loader<span className="brand-period">.</span></span>
        <span className="brand-edition">DESKTOP</span>
      </div>

      <label className="profile-select-label" htmlFor="profile-select">WORKSPACE</label>
      <div className="profile-select-wrap">
        <div className="profile-cube"><Gamepad2 size={17} /></div>
        <select id="profile-select" value={activeProfileId} onChange={(event) => onProfileChange(event.target.value)} aria-label="Select profile">
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
        <ChevronDown className="profile-chevron" size={15} />
      </div>
      <div className="profile-version-line">{activeProfile?.versionId === 'latest-release' ? t(language, 'latestRelease') : activeProfile?.versionId ?? 'Minecraft'}</div>

      <div className="sidebar-section-label">LAUNCHER</div>
      <nav className="nav-list" aria-label="Main navigation">
        {items.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => onNavigate(id)}>
            <Icon size={18} strokeWidth={1.8} />
            <span>{t(language, label)}</span>
            {id === 'console' && activeDownloads > 0 && <span className="nav-count">{activeDownloads}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />
      <div className="sidebar-download-card">
        <div className="download-card-head"><span className="download-dot" />{activeDownloads ? `${activeDownloads} ${t(language, 'downloads').toLowerCase()}` : t(language, 'noDownloads')}</div>
        {activeDownloads ? (
          <div className="mini-progress"><span style={{ width: `${Math.max(8, (progress.find((item) => item.status === 'downloading')?.downloaded ?? 0) / Math.max(1, progress.find((item) => item.status === 'downloading')?.total ?? 1) * 100)}%` }} /></div>
        ) : <div className="download-card-icon"><Download size={15} /><span>Ready when you are</span></div>}
      </div>

      <button className="sidebar-help" onClick={() => onNavigate('console')}><CircleHelp size={17} /> Help & activity <span>↗</span></button>
      <button className="account-card" onClick={onAuth}>
        <div className={`account-avatar ${account?.kind === 'microsoft' ? 'online' : ''}`}>
          {account ? account.username.slice(0, 1).toUpperCase() : <UserRound size={17} />}
        </div>
        <div className="account-copy">
          <strong>{account?.username ?? t(language, 'notSignedIn')}</strong>
          <span>{account ? (account.kind === 'microsoft' ? t(language, 'online') : t(language, 'offlineLabel')) : t(language, 'connect')}</span>
        </div>
        <span className="account-status" />
      </button>
      <div className="sidebar-footer">LOADER <span>1.0.0</span></div>
    </aside>
  );
}
