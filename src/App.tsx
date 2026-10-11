import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Bell, ChevronDown, CircleCheck, Download, Gamepad2, LoaderCircle } from 'lucide-react';
import type { AuthEvent, BootstrapData, ConsoleLine, DownloadProgress, LauncherProfile, LoaderKind } from '../shared/types';
import { AuthModal } from './components/AuthModal';
import { Sidebar, type PageId } from './components/Sidebar';
import { ConsolePage } from './pages/ConsolePage';
import { HomePage } from './pages/HomePage';
import { ModsPage } from './pages/ModsPage';
import { SettingsPage } from './pages/SettingsPage';
import { VersionsPage } from './pages/VersionsPage';
import { api, isDesktop } from './lib/api';
import { t } from './i18n';

interface ToastState { message: string; kind: 'success' | 'error' }
const pageTitle: Record<PageId, string> = { home: 'Home', versions: 'Version library', mods: 'Mod library', settings: 'Preferences', console: 'Activity console' };

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [page, setPage] = useState<PageId>('home');
  const [progress, setProgress] = useState<DownloadProgress[]>([]);
  const [logs, setLogs] = useState<ConsoleLine[]>([]);
  const [launchState, setLaunchState] = useState({ running: false, message: 'Ready to play' });
  const [authModal, setAuthModal] = useState(false);
  const [authEvent, setAuthEvent] = useState<AuthEvent | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [modCount, setModCount] = useState(0);
  const language = bootstrap?.settings.language ?? 'en';

  const notify = useCallback((message: string, kind: ToastState['kind'] = 'success') => {
    setToast({ message, kind });
  }, []);

  const reloadBootstrap = useCallback(async () => {
    const value = await api.getBootstrap();
    setBootstrap(value);
  }, []);
  const openAuthModal = useCallback(() => { setAuthEvent(null); setAuthModal(true); }, []);
  const closeAuthModal = useCallback(() => setAuthModal(false), []);
  const authChanged = useCallback(() => { void reloadBootstrap(); }, [reloadBootstrap]);

  useEffect(() => {
    void reloadBootstrap().catch((error) => notify(error instanceof Error ? error.message : 'Could not initialize Loader.', 'error'));
    const unsubscribers = [
      api.onDownloadProgress((event) => setProgress((current) => {
        const next = current.filter((item) => item.id !== event.id);
        next.push(event);
        return next.slice(-80);
      })),
      api.onConsoleLine((line) => setLogs((current) => [...current.slice(-799), line])),
      api.onAuthEvent((event) => {
        setAuthEvent(event);
        if (event.type === 'complete' || event.type === 'error' || event.type === 'cancelled') {
          void reloadBootstrap().catch(() => undefined);
        }
      }),
      api.onLaunchState(setLaunchState),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [reloadBootstrap, notify]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const profiles = bootstrap?.profiles ?? [];
  const activeProfile: LauncherProfile | undefined = profiles.find((item) => item.id === bootstrap?.activeProfileId) ?? profiles[0];
  const activeProgress = progress.filter((item) => item.status === 'downloading' || item.status === 'queued');
  useEffect(() => {
    if (!activeProfile) return;
    void api.listMods(activeProfile.id).then((items) => setModCount(items.filter((item) => item.enabled).length)).catch(() => setModCount(0));
  }, [activeProfile?.id, page]);

  const refreshInstalled = useCallback(async () => {
    await reloadBootstrap();
  }, [reloadBootstrap]);

  const changeProfile = async (profileId: string) => {
    try {
      await api.setActiveProfile(profileId);
      await reloadBootstrap();
      notify(`Switched to ${profiles.find((item) => item.id === profileId)?.name ?? 'profile'}.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not switch profiles.', 'error'); }
  };

  const activateVersion = async (versionId: string, loader: LoaderKind) => {
    if (!activeProfile) return;
    try {
      await api.updateProfile(activeProfile.id, { versionId, loader });
      await reloadBootstrap();
      notify(`${versionId} is now selected.`, 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not select this version.', 'error'); }
  };

  const launch = async () => {
    if (!activeProfile) return;
    if (!bootstrap?.account) {
      setAuthEvent(null);
      setAuthModal(true);
      notify('Connect an account or choose an offline username first.', 'error');
      return;
    }
    try { await api.launch(activeProfile.id); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not launch Minecraft.', 'error'); }
  };

  if (!bootstrap || !activeProfile) {
    return <div className="app-loading"><div className="loader-mark-large"><Gamepad2 size={23} /></div><LoaderCircle className="loading-spinner" size={18} /><span>Preparing your launcher…</span></div>;
  }

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        onNavigate={setPage}
        profiles={profiles}
        activeProfileId={bootstrap.activeProfileId}
        account={bootstrap.account}
        language={language}
        progress={progress}
        onProfileChange={(id) => void changeProfile(id)}
        onAuth={openAuthModal}
      />
      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumb"><span>LOADER</span><span className="breadcrumb-slash">/</span><strong>{pageTitle[page]}</strong>{!isDesktop && <span className="preview-badge">PREVIEW MODE</span>}</div>
          <div className="topbar-actions">
            <button className="status-pill" onClick={() => setPage('console')}><span className="status-pulse" />{activeProgress.length ? `${activeProgress.length} ${t(language, 'downloads').toLowerCase()}` : 'All systems go'}<ChevronDown size={13} /></button>
            <button className="topbar-account" onClick={openAuthModal}>
              <div className={`topbar-avatar ${bootstrap.account?.kind === 'microsoft' ? 'avatar-online' : ''}`}>{bootstrap.account?.username.slice(0, 1).toUpperCase() ?? <Gamepad2 size={14} />}</div>
              <span>{bootstrap.account?.username ?? t(language, 'signIn')}</span><ChevronDown size={13} />
            </button>
            <button className="topbar-notification" onClick={() => setPage('console')} aria-label="Open activity"><Bell size={17} />{activeProgress.length > 0 && <i />}</button>
          </div>
        </header>
        <div className="content-scroll">
          {page === 'home' && <HomePage
            profile={activeProfile}
            installedVersions={bootstrap.installedVersions}
            settings={bootstrap.settings}
            account={bootstrap.account}
            progress={progress}
            running={launchState.running}
            launchMessage={launchState.message}
            language={language}
            modCount={modCount}
            onLaunch={() => void launch()}
            onStop={() => void api.stopGame()}
            onNavigate={setPage}
            onSelectVersion={(id, loader) => void activateVersion(id, loader)}
          />}
          {page === 'versions' && <VersionsPage key={activeProfile.id} profile={activeProfile} installedVersions={bootstrap.installedVersions} progress={progress} language={language} onRefresh={refreshInstalled} onNotify={notify} />}
          {page === 'mods' && <ModsPage key={activeProfile.id} profile={activeProfile} language={language} curseForgeConfigured={bootstrap.settings.curseForgeApiKeyConfigured} onNotify={notify} />}
          {page === 'settings' && <SettingsPage key={activeProfile.id} profile={activeProfile} profiles={profiles} settings={bootstrap.settings} language={language} onRefresh={refreshInstalled} onNotify={notify} />}
          {page === 'console' && <ConsolePage logs={logs} progress={progress} running={launchState.running} language={language} onClear={() => setLogs([])} />}
        </div>
        <footer className="bottom-bar"><div><span className="bottom-live-dot" />{launchState.running ? launchState.message : t(language, 'ready')}</div><div><span>{activeProfile.name}</span><span className="bottom-separator">·</span><span>{activeProfile.versionId === 'latest-release' ? t(language, 'latestRelease') : activeProfile.versionId}</span><button onClick={() => setPage('settings')}>Manage <ArrowUpRight size={11} /></button></div></footer>
      </main>

      {authModal && <AuthModal account={bootstrap.account} language={language} microsoftConfigured={bootstrap.microsoftConfigured} authEvent={authEvent} onClose={closeAuthModal} onChanged={authChanged} />}
      {toast && <div className={`toast toast-${toast.kind}`} role="status"><span className="toast-icon">{toast.kind === 'success' ? <CircleCheck size={17} /> : <Download size={16} />}</span><span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss">×</button></div>}
    </div>
  );
}
