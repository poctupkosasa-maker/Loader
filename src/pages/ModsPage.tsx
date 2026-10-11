import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Blocks, Check, ExternalLink, Search, SlidersHorizontal, Sparkles, ToggleLeft, ToggleRight, WandSparkles } from 'lucide-react';
import type { InstalledMod, LauncherProfile, ModSearchResult } from '../../shared/types';
import { api } from '../lib/api';
import { t } from '../i18n';

interface ModsPageProps {
  profile: LauncherProfile;
  language: 'en' | 'ru';
  curseForgeConfigured: boolean;
  onNotify: (message: string, kind?: 'success' | 'error') => void;
}

type Tab = 'browse' | 'installed';

const numberLabel = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}m` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : `${value}`;

export function ModsPage({ profile, language, curseForgeConfigured, onNotify }: ModsPageProps) {
  const [tab, setTab] = useState<Tab>('browse');
  const [source, setSource] = useState<'modrinth' | 'curseforge'>('modrinth');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ModSearchResult[]>([]);
  const [installed, setInstalled] = useState<InstalledMod[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [searchError, setSearchError] = useState('');

  const refreshInstalled = useCallback(async () => {
    try { setInstalled(await api.listMods(profile.id)); }
    catch (error) { onNotify(error instanceof Error ? error.message : 'Could not read this profile’s mods.', 'error'); }
  }, [profile.id, onNotify]);

  const searchMods = useCallback(async (search = query) => {
    if (source === 'curseforge' && !curseForgeConfigured) {
      setResults([]);
      setSearchError('CurseForge requires an API key. Add CURSEFORGE_API_KEY to the launcher environment; Modrinth works without a key.');
      return;
    }
    setLoading(true);
    setSearchError('');
    try { setResults(await api.searchMods(search, profile.id, source)); }
    catch (error) { setSearchError(error instanceof Error ? error.message : 'Could not search for mods.'); }
    finally { setLoading(false); }
  }, [query, source, profile.id, curseForgeConfigured]);

  useEffect(() => { void refreshInstalled(); }, [refreshInstalled]);
  useEffect(() => { if (tab === 'browse') void searchMods(''); }, [source, tab, profile.id]);

  const install = async (mod: ModSearchResult) => {
    setBusyId(mod.id);
    try {
      await api.installMod(profile.id, mod.source, mod.id, mod.latestVersionId);
      await refreshInstalled();
      onNotify(`${mod.title} added to ${profile.name}.`, 'success');
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Could not install this mod.', 'error'); }
    finally { setBusyId(''); }
  };
  const toggle = async (mod: InstalledMod) => {
    try {
      await api.setModEnabled(profile.id, mod.fileName, !mod.enabled);
      await refreshInstalled();
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Could not change this mod.', 'error'); }
  };

  return (
    <div className="page-content mods-page">
      <div className="page-heading">
        <div><div className="eyebrow">MAKE IT YOURS</div><h1>{t(language, 'mods')}</h1><p>Find your next favorite. Every profile keeps its own mods, worlds, and settings.</p></div>
        <div className="mod-profile-pill"><div className="mod-profile-mark"><Blocks size={15} /></div><span>{profile.name}</span><span className="pill-separator" />{profile.loader === 'vanilla' ? 'Vanilla' : profile.loader}</div>
      </div>

      <div className="mods-layout">
        <section className="mods-main panel">
          <div className="mods-toolbar">
            <div className="section-tabs"><button className={tab === 'browse' ? 'selected' : ''} onClick={() => setTab('browse')}><WandSparkles size={15} />{t(language, 'browse')}</button><button className={tab === 'installed' ? 'selected' : ''} onClick={() => setTab('installed')}><Blocks size={15} />{t(language, 'myMods')}<span className="tab-count">{installed.length}</span></button></div>
            {tab === 'browse' && <div className="source-tabs"><button className={source === 'modrinth' ? 'selected' : ''} onClick={() => setSource('modrinth')}>Modrinth</button><button className={source === 'curseforge' ? 'selected' : ''} onClick={() => setSource('curseforge')}>CurseForge{!curseForgeConfigured && <span className="key-dot" title="API key required" />}</button></div>}
          </div>

          {tab === 'browse' ? <>
            <div className="mods-search-row"><label className="search-field mods-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchMods(); }} placeholder={t(language, 'searchMods')} /><button onClick={() => void searchMods()} aria-label="Search mods"><ArrowUpRight size={15} /></button></label><button className="icon-button filter-button" title="Compatibility follows this profile"><SlidersHorizontal size={16} /></button></div>
            <div className="mods-context-line"><span><span className="note-dot" />Showing mods compatible with <strong>{profile.versionId}</strong></span><span>{source === 'modrinth' ? 'MODRINTH API' : 'CURSEFORGE API'}</span></div>
            {profile.loader === 'vanilla' && <div className="inline-warning">Mods need a mod loader. Install Fabric, Forge, Quilt, or NeoForge for this profile in Versions, then discovery can filter for the matching loader.</div>}
            {searchError && <div className="inline-warning">{searchError}</div>}
            {loading ? <div className="mods-loading"><span className="spinner" /><span>Finding mods for your profile…</span></div> : results.length ? <div className="mod-result-grid">
              {results.map((mod, index) => <article className="mod-card" key={`${mod.source}-${mod.id}`}>
                <div className="mod-card-top"><div className={`mod-icon ${index % 3 === 1 ? 'mod-icon-purple' : index % 3 === 2 ? 'mod-icon-orange' : ''}`}>{mod.iconUrl ? <img src={mod.iconUrl} alt="" loading="lazy" /> : <Blocks size={21} />}</div><a className="mod-external" href={mod.projectUrl} onClick={(event) => { event.preventDefault(); void api.openExternal(mod.projectUrl).catch(() => undefined); }} aria-label={`Open ${mod.title}`}><ExternalLink size={15} /></a></div>
                <div className="mod-card-author">BY {mod.author.toUpperCase()}</div><h3>{mod.title}</h3><p>{mod.description || 'A community-built mod for your Minecraft setup.'}</p>
                <div className="mod-card-footer"><span className="mod-download-count"><ArrowDownToLine size={13} />{numberLabel(mod.downloads)}</span><span className="mod-compatible"><Check size={12} />{profile.loader === 'vanilla' ? 'LOADER NEEDED' : 'COMPATIBLE'}</span></div>
                <button className="button button-outline mod-install-button" onClick={() => void install(mod)} disabled={Boolean(busyId) || profile.loader === 'vanilla'}>
                  {busyId === mod.id ? <><span className="spinner" />Installing…</> : installed.some((item) => item.projectId === mod.id) ? <><Check size={14} />Installed</> : <><ArrowDownToLine size={14} />{t(language, 'install')}</>}
                </button>
              </article>)}
            </div> : !searchError && <div className="mods-empty"><div className="empty-orbit"><Sparkles size={24} /></div><strong>No mods found</strong><span>Try another search, or check the active game version and loader.</span></div>}
          </> : <div className="installed-mods-view">
            <div className="installed-mods-heading"><div><div className="eyebrow">PROFILE LIBRARY</div><h2>{installed.length} mod{installed.length === 1 ? '' : 's'} in {profile.name}</h2></div><button className="button button-outline" onClick={() => setTab('browse')}><WandSparkles size={15} />Discover mods</button></div>
            {installed.length ? <div className="installed-mod-list">{installed.map((mod) => <div className="installed-mod-row" key={mod.fileName}>
              <div className="installed-mod-icon">{mod.iconUrl ? <img src={mod.iconUrl} alt="" /> : <Blocks size={18} />}</div><div className="installed-mod-info"><strong>{mod.name}</strong><span>{mod.version} <i>·</i> {mod.source} <i>·</i> {mod.fileName}</span></div><span className={`mod-state ${mod.enabled ? 'on' : 'off'}`}>{mod.enabled ? t(language, 'enabled') : t(language, 'disabled')}</span>
              <button className={`toggle-button ${mod.enabled ? 'is-on' : ''}`} onClick={() => void toggle(mod)} aria-label={`${mod.enabled ? 'Disable' : 'Enable'} ${mod.name}`}>{mod.enabled ? <ToggleRight size={25} /> : <ToggleLeft size={25} />}</button>
            </div>)}</div> : <div className="mods-empty installed-empty"><div className="empty-orbit"><Blocks size={23} /></div><strong>{t(language, 'noMods')}</strong><span>Explore the catalog and install a compatible mod.</span><button className="text-button" onClick={() => setTab('browse')}>Browse Modrinth <ArrowUpRight size={14} /></button></div>}
          </div>}
        </section>

        <aside className="mods-sidebar">
          <section className="mod-platform-card panel"><div className="platform-symbol">m</div><div className="eyebrow">POWERED BY MODRINTH</div><h3>Open modding,<br />made easy.</h3><p>Browse community projects and install releases compatible with your selected profile.</p><a href="https://modrinth.com" onClick={(event) => { event.preventDefault(); void api.openExternal('https://modrinth.com'); }}>Explore Modrinth <ArrowUpRight size={14} /></a><div className="platform-decoration">✳</div></section>
          <section className="compatibility-card panel"><div className="compat-heading"><div className="compat-icon"><Check size={15} /></div><span>PROFILE COMPATIBILITY</span></div><h4>{profile.versionId}</h4><div className="compat-row"><span>Game version</span><span className="compat-check"><Check size={12} /> MATCHED</span></div><div className="compat-row"><span>Mod loader</span><strong>{profile.loader === 'vanilla' ? 'Vanilla' : profile.loader}</strong></div><div className="compat-footer"><span className="note-dot" />Installations remain isolated</div></section>
          <div className="mods-help"><span>Need help with a mod?</span><button onClick={() => void api.openExternal('https://support.modrinth.com')}>Visit the Modrinth help center <ArrowUpRight size={12} /></button></div>
        </aside>
      </div>
    </div>
  );
}
