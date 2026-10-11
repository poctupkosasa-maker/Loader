import { lazy, Suspense } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Blocks, Check, ChevronRight, CirclePlay, Cpu, Download, Gamepad2, HardDrive, Layers3, Pause, Sparkles } from 'lucide-react';
import type { Account, AppSettings, DownloadProgress, InstalledVersion, LauncherProfile, LanguageCode } from '../../shared/types';
import type { PageId } from '../components/Sidebar';
import { t } from '../i18n';

const SkinPreview = lazy(() => import('../components/SkinPreview').then((module) => ({ default: module.SkinPreview })));

interface HomePageProps {
  profile: LauncherProfile;
  installedVersions: InstalledVersion[];
  settings: AppSettings;
  account: Account | null;
  progress: DownloadProgress[];
  running: boolean;
  launchMessage: string;
  language: LanguageCode;
  modCount: number;
  onLaunch: () => void;
  onStop: () => void;
  onNavigate: (page: PageId) => void;
  onSelectVersion: (versionId: string, loader: InstalledVersion['loader']) => void;
}

const byteLabel = (size: number) => size >= 1_000_000_000 ? `${(size / 1_000_000_000).toFixed(1)} GB` : `${(size / 1_000_000).toFixed(0)} MB`;
const prettyType = (type: string) => type.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function HomePage({ profile, installedVersions, settings, account, progress, running, launchMessage, language, modCount, onLaunch, onStop, onNavigate, onSelectVersion }: HomePageProps) {
  const activeDownloads = progress.filter((item) => item.status === 'downloading' || item.status === 'queued');
  const topDownload = activeDownloads.find((item) => item.status === 'downloading');
  const latest = installedVersions[0];
  const launchTitle = running ? t(language, 'stop') : t(language, 'play');
  return (
    <div className="page-content home-page">
      <div className="page-heading home-heading">
        <div><div className="eyebrow">YOUR LAUNCHER / YOUR WORLD</div><h1>{t(language, 'session')}</h1><p>{t(language, 'sessionSubtitle')}</p></div>
        <button className="profile-pill" onClick={() => onNavigate('settings')}><div className="tiny-profile-icon"><Gamepad2 size={14} /></div><span>{profile.name}</span><ChevronRight size={15} /></button>
      </div>

      <section className="home-hero">
        <div className="hero-backdrop-grid" />
        <div className="hero-orbit hero-orbit-one" /><div className="hero-orbit hero-orbit-two" />
        <div className="hero-content">
          <div className="hero-chip"><Sparkles size={13} /> MINECRAFT, YOUR WAY</div>
          <h2>Make room<br />for <em>adventure.</em></h2>
          <p>One click from your next world. Pick a version, tune your setup, and go.</p>
          <div className="hero-actions">
            <button className={`button button-primary play-button ${running ? 'button-stop' : ''}`} onClick={running ? onStop : onLaunch}>
              {running ? <Pause size={17} fill="currentColor" /> : <CirclePlay size={19} />}
              {launchTitle}
              {!running && <ArrowRight size={16} className="play-arrow" />}
            </button>
            <button className="hero-link" onClick={() => onNavigate('versions')}>Browse versions <ArrowUpRight size={15} /></button>
          </div>
          <div className="hero-footnote"><span className="live-indicator" />{running ? launchMessage : latest ? `${latest.id} · ${prettyType(latest.type)}` : t(language, 'configure')}</div>
        </div>
        <div className="hero-illustration" aria-hidden="true">
          <div className="pixel-sun" /><div className="pixel-mountain mountain-back" /><div className="pixel-mountain mountain-front" />
          <div className="pixel-cloud cloud-one" /><div className="pixel-cloud cloud-two" />
          <div className="pixel-grass" />
          <div className="pixel-tree tree-one"><span /><i /></div><div className="pixel-tree tree-two"><span /><i /></div>
          <div className="pixel-block"><span className="block-glow" /></div>
          <div className="hero-spark spark-a">✳</div><div className="hero-spark spark-b">·</div>
        </div>
        <div className="hero-corner">LOADER <span>01</span></div>
      </section>

      {topDownload && <section className="download-banner">
        <div className="download-banner-icon"><Download size={18} /></div>
        <div className="download-banner-copy"><strong>{topDownload.name}</strong><span>{byteLabel(topDownload.downloaded)} of {topDownload.total ? byteLabel(topDownload.total) : '…'} · {topDownload.speed > 0 ? `${byteLabel(topDownload.speed)}/s` : 'Starting download'}</span></div>
        <div className="download-banner-progress"><div className="progress-track"><span style={{ width: `${topDownload.total ? Math.min(100, (topDownload.downloaded / topDownload.total) * 100) : 14}%` }} /></div><span>{topDownload.etaSeconds ? `${topDownload.etaSeconds}s left` : 'Preparing'}</span></div>
      </section>}

      <div className="home-grid">
        <section className="panel launch-panel">
          <div className="panel-heading"><div><div className="eyebrow">READY WHEN YOU ARE</div><h3>{t(language, 'quickLaunch')}</h3></div><button className="icon-button subtle" onClick={() => onNavigate('versions')} aria-label="Manage versions"><ArrowUpRight size={17} /></button></div>
          <div className="launch-version-row">
            <div className="version-emblem"><Layers3 size={19} /></div>
            <div className="launch-version-info"><span className="muted-label">{t(language, 'gameVersion')}</span><strong>{profile.versionId === 'latest-release' ? t(language, 'latestRelease') : profile.versionId}</strong><span>{profile.loader === 'vanilla' ? 'Vanilla' : profile.loader} · {profile.name}</span></div>
            <div className="version-ready"><Check size={14} />{latest ? 'READY' : 'SETUP'}</div>
          </div>
          <div className="launch-divider" />
          <div className="launch-settings-row">
            <span><Cpu size={15} /> {settings.maxRam} GB RAM</span><span><HardDrive size={15} /> {settings.javaPath ? 'Custom Java' : 'Auto Java'}</span>
            <button className="text-button" onClick={() => onNavigate('settings')}>Tune setup <ChevronRight size={14} /></button>
          </div>
        </section>

        <section className="panel player-panel">
          <div className="panel-heading player-panel-heading"><div><div className="eyebrow">{t(language, 'personalize')}</div><h3>{account?.username ?? 'Your player'}</h3></div><span className={`account-type-tag ${account?.kind === 'microsoft' ? 'tag-online' : ''}`}>{account ? (account.kind === 'microsoft' ? 'MICROSOFT' : 'OFFLINE') : 'NOT CONNECTED'}</span></div>
          <div className="player-content">
            <Suspense fallback={<div className="skin-stage skin-loading-stage"><span className="spinner" /></div>}><SkinPreview skinUrl={account?.skinUrl} username={account?.username} /></Suspense>
            <div className="player-copy"><span className="player-level">PLAYER PROFILE</span><p>{account ? `Playing as ${account.username}.` : 'Connect a profile to see your player model and launch Minecraft.'}</p><button className="text-button" onClick={() => onNavigate('settings')}>Manage profile <ArrowUpRight size={14} /></button></div>
          </div>
        </section>

        <section className="panel versions-panel">
          <div className="panel-heading"><div><div className="eyebrow">{t(language, 'recentVersions')}</div><h3>Your installations</h3></div><button className="text-button" onClick={() => onNavigate('versions')}>Manage <ArrowUpRight size={14} /></button></div>
          {installedVersions.length ? <div className="installed-list">
            {installedVersions.slice(0, 3).map((version) => <button className="installed-row" key={version.id} onClick={() => onSelectVersion(version.id, version.loader)}>
              <span className={`version-type-icon ${version.loader !== 'vanilla' ? 'modded' : ''}`}><Layers3 size={16} /></span>
              <span className="installed-meta"><strong>{version.id}</strong><span>{version.loader === 'vanilla' ? 'Vanilla' : `${version.loader} · ${version.gameVersion}`}</span></span>
              {profile.versionId === version.id && <span className="current-tag">ACTIVE</span>}<ChevronRight size={15} className="row-chevron" />
            </button>)}
          </div> : <div className="empty-inline"><Layers3 size={20} /><span>No versions installed yet.</span><button onClick={() => onNavigate('versions')}>Browse versions <ArrowRight size={14} /></button></div>}
        </section>

        <section className="stats-panel">
          <div className="stat-cell"><div className="stat-icon stat-green"><Layers3 size={17} /></div><div><span>VERSIONS</span><strong>{installedVersions.length.toString().padStart(2, '0')}</strong></div><ArrowDownRight size={14} className="stat-arrow" /></div>
          <div className="stat-cell"><div className="stat-icon stat-purple"><Blocks size={17} /></div><div><span>ACTIVE MODS</span><strong>{modCount.toString().padStart(2, '0')}</strong></div><ArrowDownRight size={14} className="stat-arrow" /></div>
          <button className="stat-cell storage-stat" onClick={() => onNavigate('settings')}><div className="stat-icon stat-orange"><HardDrive size={17} /></div><div><span>GAME DIRECTORY</span><strong className="storage-value">{settings.gameDir.split(/[\\/]/).filter(Boolean).at(-1) || 'Choose folder'}</strong></div><ArrowUpRight size={14} className="stat-arrow" /></button>
          <div className="stat-corner"><span>LOADER</span><i>✳</i></div>
        </section>
      </div>

      <div className="home-bottom-note"><span><span className="note-dot" />All systems operational</span><span>Vanilla, Forge, Fabric, Quilt & NeoForge <ArrowUpRight size={12} /></span></div>
    </div>
  );
}
