import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, Check, ChevronRight, Clock3, DownloadCloud, Layers3, RefreshCw, Search, Sparkles, Tag } from 'lucide-react';
import type { DownloadProgress, InstalledVersion, LauncherProfile, LoaderKind, MojangVersion, VersionManifest } from '../../shared/types';
import { api } from '../lib/api';
import { t } from '../i18n';

interface VersionsPageProps {
  profile: LauncherProfile;
  installedVersions: InstalledVersion[];
  progress: DownloadProgress[];
  language: 'en' | 'ru';
  onRefresh: () => Promise<void>;
  onNotify: (message: string, kind?: 'success' | 'error') => void;
}

type Filter = 'all' | 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
const loaderChoices: Array<{ id: Exclude<LoaderKind, 'vanilla'>; color: string; summary: string }> = [
  { id: 'fabric', color: 'fabric', summary: 'Lightweight, fast, and made for modern modpacks.' },
  { id: 'forge', color: 'forge', summary: 'The classic modding platform with a massive ecosystem.' },
  { id: 'quilt', color: 'quilt', summary: 'Community-driven, modular, and compatible with many Fabric mods.' },
  { id: 'neoforge', color: 'neoforge', summary: 'A modern continuation of Forge for the latest releases.' },
];

function versionLabel(version: MojangVersion) {
  return version.type.replace('_', ' ').toUpperCase();
}
function formatRelease(value: string) {
  if (!value) return 'Mojang official';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Mojang official' : new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(parsed);
}

export function VersionsPage({ profile, installedVersions, progress, language, onRefresh, onNotify }: VersionsPageProps) {
  const [manifest, setManifest] = useState<VersionManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('release');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [selectedLoader, setSelectedLoader] = useState<Exclude<LoaderKind, 'vanilla'>>('fabric');
  const [busy, setBusy] = useState('');

  const refreshManifest = async (force = false) => {
    setLoading(true);
    try {
      const value = await api.getManifest(force);
      setManifest(value);
      setSelectedId((current) => current || value.latest.release);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Could not load the Mojang version manifest.', 'error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refreshManifest(); }, []);
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.version-search input')?.focus();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  const visibleVersions = useMemo(() => {
    if (!manifest) return [];
    const query = search.trim().toLowerCase();
    return manifest.versions.filter((version) => {
      const matchesFilter = filter === 'all' || version.type === filter;
      return matchesFilter && (!query || `${version.id} ${version.type}`.toLowerCase().includes(query));
    }).slice(0, 80);
  }, [manifest, filter, search]);
  const selected = manifest?.versions.find((item) => item.id === selectedId) ?? null;
  const selectedInstall = installedVersions.find((item) => item.id === selectedId);
  const active = progress.filter((item) => item.status === 'downloading' || item.status === 'queued');
  const totalProgress = active.length ? active.reduce((sum, item) => sum + (item.total > 0 ? item.downloaded / item.total : 0), 0) / active.length : 0;

  const installVanilla = async () => {
    if (!selected) return;
    setBusy('vanilla');
    try {
      const result = await api.installVersion(profile.id, selected.id);
      await onRefresh();
      onNotify(result.message, 'success');
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Version installation failed.', 'error'); }
    finally { setBusy(''); }
  };
  const installLoader = async () => {
    if (!selected) return;
    setBusy(selectedLoader);
    try {
      const result = await api.installLoader(profile.id, selectedLoader, selected.id);
      await onRefresh();
      onNotify(result.message, 'success');
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Loader installation failed.', 'error'); }
    finally { setBusy(''); }
  };
  const activateVersion = async (versionId: string, loader: LoaderKind) => {
    try {
      await api.updateProfile(profile.id, { versionId, loader });
      await onRefresh();
      onNotify(`${versionId} is now selected for ${profile.name}.`, 'success');
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Could not select that version.', 'error'); }
  };
  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'release', label: t(language, 'release') },
    { id: 'snapshot', label: t(language, 'snapshot') },
    { id: 'old_beta', label: t(language, 'oldBeta') },
    { id: 'old_alpha', label: t(language, 'oldAlpha') },
    { id: 'all', label: t(language, 'all') },
  ];

  return (
    <div className="page-content versions-page">
      <div className="page-heading">
        <div><div className="eyebrow">BUILD YOUR NEXT WORLD</div><h1>{t(language, 'versions')}</h1><p>{t(language, 'browseVanilla')} <span className="heading-dot">·</span> {t(language, 'supported')}</p></div>
        <button className="button button-outline" onClick={() => void refreshManifest(true)} disabled={loading}><RefreshCw size={15} className={loading ? 'spin-icon' : ''} /> Refresh manifest</button>
      </div>

      <div className="versions-toolbar">
        <div className="version-filter-tabs">{filters.map((item) => <button key={item.id} className={filter === item.id ? 'selected' : ''} onClick={() => setFilter(item.id)}>{item.label}{item.id === 'release' && manifest && <span className="filter-count">{manifest.versions.filter((v) => v.type === 'release').length}</span>}</button>)}</div>
        <label className="search-field version-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t(language, 'searchVersions')} /><kbd>⌘ K</kbd></label>
      </div>

      <div className="versions-layout">
        <section className="version-list-panel panel">
          <div className="version-list-header"><span>VERSION</span><span>TYPE</span><span>RELEASED</span></div>
          <div className="version-list-scroll">
            {loading && <div className="loading-state"><span className="spinner" />Loading Mojang version manifest…</div>}
            {!loading && visibleVersions.length === 0 && <div className="empty-state"><Search size={22} /><strong>No versions found</strong><span>Try a different search or filter.</span></div>}
            {!loading && visibleVersions.map((version) => {
              const installed = installedVersions.some((item) => item.id === version.id);
              return <button key={version.id} className={`version-list-row ${selectedId === version.id ? 'selected' : ''}`} onClick={() => setSelectedId(version.id)}>
                <span className="version-row-name"><span className={`type-indicator type-${version.type}`} />{version.id}{installed && <Check size={13} className="installed-check" />}</span>
                <span className={`version-tag type-tag-${version.type}`}>{versionLabel(version)}</span>
                <span className="version-row-date">{formatRelease(version.releaseTime)}</span>
              </button>;
            })}
          </div>
          <div className="version-list-footer"><span>Source: Mojang launcher metadata</span><span>{visibleVersions.length} shown</span></div>
        </section>

        <aside className="version-detail-column">
          <section className="panel selected-version-card">
            <div className="selected-version-art"><div className="selected-orbit" /><div className="version-cube"><Layers3 size={31} /></div><span className="version-art-label">MINECRAFT<br />VERSION</span></div>
            <div className="selected-version-body">
              <div className="selected-version-title"><div><div className="eyebrow">SELECTED BUILD</div><h2>{selected?.id ?? (loading ? 'Loading…' : 'Select a version')}</h2></div>{selected && <span className={`version-tag type-tag-${selected.type}`}>{versionLabel(selected)}</span>}</div>
              <div className="version-facts"><div><Clock3 size={14} /><span>{selected ? formatRelease(selected.releaseTime) : '—'}</span></div><div><Tag size={14} /><span>{selectedInstall ? 'Already on this profile' : 'Official Mojang build'}</span></div></div>
              {active.length > 0 && <div className="install-progress-inline"><div className="progress-track"><span style={{ width: `${Math.round(totalProgress * 100)}%` }} /></div><span>{active.length} task{active.length === 1 ? '' : 's'} downloading</span></div>}
              <div className="selected-version-buttons">
                {selectedInstall && <button className="button button-outline button-wide" onClick={() => void activateVersion(selectedInstall.id, selectedInstall.loader)}><Check size={16} /> Use this installation</button>}
                <button className="button button-primary button-wide" onClick={() => void installVanilla()} disabled={!selected || Boolean(busy)}>
                  {busy === 'vanilla' ? <><span className="spinner" />Installing…</> : selectedInstall?.loader === 'vanilla' ? <><Check size={16} />{t(language, 'installed')}</> : <><ArrowDownToLine size={16} />{t(language, 'install')} vanilla</>}
                </button>
              </div>
            </div>
          </section>

          <section className="panel loader-install-card">
            <div className="loader-card-heading"><div className="loader-heading-icon"><Sparkles size={17} /></div><div><h3>Modded install</h3><p>Official installer · separate profile</p></div></div>
            <div className="loader-choice-grid">
              {loaderChoices.map((choice) => <button key={choice.id} className={`loader-choice ${choice.color} ${selectedLoader === choice.id ? 'selected' : ''}`} onClick={() => setSelectedLoader(choice.id)}>
                <span className="loader-choice-mark">{choice.id === 'fabric' ? 'F' : choice.id === 'forge' ? '✦' : choice.id === 'quilt' ? 'Q' : 'N'}</span><span>{choice.id}</span>{selectedLoader === choice.id && <Check size={13} />}
              </button>)}
            </div>
            <p className="loader-summary">{loaderChoices.find((item) => item.id === selectedLoader)?.summary}</p>
            <button className="button button-secondary button-wide" onClick={() => void installLoader()} disabled={!selected || Boolean(busy)}>
              {busy === selectedLoader ? <><span className="spinner" />Preparing installer…</> : <><DownloadCloud size={16} />Install {selectedLoader} {selected?.id ?? ''}<ChevronRight size={15} /></>}
            </button>
            <div className="loader-footnote">Installers run locally using your configured Java runtime.</div>
          </section>
        </aside>
      </div>
    </div>
  );
}
