import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, Cpu, FolderOpen, HardDrive, Languages, Plus, RotateCcw, Save, Shield, TerminalSquare, Trash2 } from 'lucide-react';
import type { AppSettings, LauncherProfile } from '../../shared/types';
import { api } from '../lib/api';
import { t } from '../i18n';

interface SettingsPageProps {
  profile: LauncherProfile;
  profiles: LauncherProfile[];
  settings: AppSettings;
  language: 'en' | 'ru';
  onRefresh: () => Promise<void>;
  onNotify: (message: string, kind?: 'success' | 'error') => void;
}

export function SettingsPage({ profile, profiles, settings, language, onRefresh, onNotify }: SettingsPageProps) {
  const [draft, setDraft] = useState(settings);
  const [profileName, setProfileName] = useState(profile.name);
  const [newProfileName, setNewProfileName] = useState('');
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(settings);
    setProfileName(profile.name);
  }, [settings, profile.id, profile.name]);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const pickDirectory = async () => {
    const chosen = await api.choosePath('directory');
    if (chosen) set('gameDir', chosen);
  };
  const pickJava = async () => {
    const chosen = await api.choosePath('java');
    if (chosen) set('javaPath', chosen);
  };
  const save = async () => {
    setSaving(true);
    try {
      if (profileName.trim() !== profile.name) await api.updateProfile(profile.id, { name: profileName.trim() });
      const result = await api.saveSettings(draft);
      setDraft(result);
      await onRefresh();
      setSaved(true);
      onNotify(t(language, 'saved'), 'success');
      window.setTimeout(() => setSaved(false), 2000);
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Settings could not be saved.', 'error'); }
    finally { setSaving(false); }
  };
  const createProfile = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    try {
      await api.createProfile(newProfileName);
      setNewProfileName('');
      await onRefresh();
      onNotify('A fresh isolated profile is ready.', 'success');
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Could not create profile.', 'error'); }
    finally { setCreating(false); }
  };
  const removeProfile = async (profileId: string, name: string) => {
    if (!window.confirm(`Delete profile “${name}”? Its files are kept on disk.`)) return;
    try {
      await api.deleteProfile(profileId);
      await onRefresh();
      onNotify(`${name} removed from the launcher.`, 'success');
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Could not delete profile.', 'error'); }
  };

  const maxSlider = Math.max(2, Math.min(32, draft.maxRam));
  return (
    <div className="page-content settings-page">
      <div className="page-heading">
        <div><div className="eyebrow">MAKE IT FEEL LIKE YOURS</div><h1>{t(language, 'settings')}</h1><p>Fine-tune the runtime and keep each profile in its own game directory.</p></div>
        <button className={`button button-primary save-settings-button ${saved ? 'saved-button' : ''}`} onClick={() => void save()} disabled={saving}>
          {saving ? <><span className="spinner" />Saving…</> : saved ? <><Check size={16} />{t(language, 'saved')}</> : <><Save size={16} />{t(language, 'saveSettings')}</>}
        </button>
      </div>

      <div className="settings-layout">
        <div className="settings-main-column">
          <section className="settings-section panel">
            <div className="settings-section-heading"><div className="settings-section-icon ram-icon"><Cpu size={18} /></div><div><h2>{t(language, 'memory')}</h2><p>Set a comfortable heap size for modpacks and larger worlds.</p></div></div>
            <div className="ram-summary"><div><span>{t(language, 'minRam')}</span><strong>{draft.minRam}<small> GB</small></strong></div><div className="ram-range-line"><span /><i /></div><div><span>{t(language, 'maxRam')}</span><strong>{draft.maxRam}<small> GB</small></strong></div></div>
            <div className="range-control"><label htmlFor="min-ram">{t(language, 'minRam')} <span>{draft.minRam} GB</span></label><input id="min-ram" type="range" min="1" max={maxSlider - 1} step="1" value={Math.min(draft.minRam, maxSlider - 1)} onChange={(event) => set('minRam', Number(event.target.value))} /></div>
            <div className="range-control"><label htmlFor="max-ram">{t(language, 'maxRam')} <span>{draft.maxRam} GB</span></label><input id="max-ram" type="range" min={Math.max(2, draft.minRam + 1)} max="32" step="1" value={Math.max(draft.minRam + 1, maxSlider)} onChange={(event) => set('maxRam', Number(event.target.value))} /></div>
            <div className="settings-tip"><span>i</span>Keep some memory free for your operating system. Most vanilla versions run well with 2–4 GB.</div>
          </section>

          <section className="settings-section panel">
            <div className="settings-section-heading"><div className="settings-section-icon java-icon"><TerminalSquare size={17} /></div><div><h2>{t(language, 'javaRuntime')}</h2><p>Loader detects Java automatically when this field is empty.</p></div><span className="runtime-support">JAVA 8 · 17 · 21</span></div>
            <div className="path-input-row"><div className="path-field"><span className="path-status-dot" /><input value={draft.javaPath} onChange={(event) => set('javaPath', event.target.value)} placeholder={t(language, 'autoDetect')} /><button className="icon-button" onClick={() => set('javaPath', '')} title="Reset to automatic detection"><RotateCcw size={15} /></button></div><button className="button button-outline" onClick={() => void pickJava()}><FolderOpen size={15} />{t(language, 'chooseJava')}</button></div>
            <label className="field-label jvm-label" htmlFor="jvm-args">{t(language, 'jvmArguments')}</label><textarea id="jvm-args" rows={3} value={draft.javaArgs} onChange={(event) => set('javaArgs', event.target.value)} placeholder="-XX:+UseG1GC -XX:+UnlockExperimentalVMOptions" />
            <div className="settings-tip"><span>i</span>Arguments are passed directly to Java (no shell expansion). Separate each flag with a space.</div>
          </section>

          <section className="settings-section panel">
            <div className="settings-section-heading"><div className="settings-section-icon folder-icon"><HardDrive size={17} /></div><div><h2>{t(language, 'gameDirectory')}</h2><p>Worlds, mods, resource packs, and assets for this profile.</p></div></div>
            <div className="path-input-row"><div className="path-field directory-field"><FolderOpen size={15} className="path-folder-icon" /><input value={draft.gameDir} onChange={(event) => set('gameDir', event.target.value)} placeholder="Choose a folder for this profile" /></div><button className="button button-outline" onClick={() => void pickDirectory()}><FolderOpen size={15} />{t(language, 'chooseFolder')}</button></div>
            <div className="directory-note"><Shield size={14} />Separate profile directories keep mods, saves, and configuration isolated.</div>
          </section>
        </div>

        <aside className="settings-side-column">
          <section className="settings-section panel language-section">
            <div className="settings-section-heading"><div className="settings-section-icon language-icon"><Languages size={17} /></div><div><h2>{t(language, 'language')}</h2><p>Interface language</p></div></div>
            <div className="language-options"><button className={draft.language === 'en' ? 'selected' : ''} onClick={() => set('language', 'en')}><span className="language-flag">EN</span><span>English</span>{draft.language === 'en' && <Check size={15} />}</button><button className={draft.language === 'ru' ? 'selected' : ''} onClick={() => set('language', 'ru')}><span className="language-flag russian">RU</span><span>Русский</span>{draft.language === 'ru' && <Check size={15} />}</button></div>
          </section>

          <section className="settings-section panel profile-manager">
            <div className="settings-section-heading"><div className="settings-section-icon profile-icon"><Layers3Icon /></div><div><h2>{t(language, 'profiles')}</h2><p>{profiles.length} isolated game setups</p></div></div>
            <div className="current-profile-edit"><label className="field-label" htmlFor="profile-name">CURRENT PROFILE</label><input id="profile-name" value={profileName} maxLength={40} onChange={(event) => setProfileName(event.target.value)} /><div className="current-profile-path">{profile.gameDir}</div></div>
            <form className="new-profile-form" onSubmit={createProfile}><input value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} placeholder={t(language, 'newProfile')} maxLength={40} required /><button className="icon-button add-profile-button" type="submit" disabled={creating || !newProfileName.trim()} aria-label="Create profile">{creating ? <span className="spinner" /> : <Plus size={17} />}</button></form>
            <div className="other-profiles-list">{profiles.filter((item) => item.id !== profile.id).map((item) => <div className="other-profile-row" key={item.id}><span className="other-profile-dot" /><span>{item.name}</span><button className="icon-button delete-profile-button" onClick={() => void removeProfile(item.id, item.name)} title={t(language, 'deleteProfile')}><Trash2 size={14} /></button></div>)}</div>
            <div className="profile-manager-foot">Switch profiles from the workspace selector.</div>
          </section>

          <section className="settings-side-note"><div className="settings-side-note-icon"><Shield size={16} /></div><div><strong>Privacy first</strong><p>Microsoft session tokens use OS-backed encryption. Offline usernames stay on this device.</p><button onClick={() => void api.openExternal('https://aka.ms/MinecraftPrivacy')}>Account privacy <ArrowUpRight size={12} /></button></div></section>
        </aside>
      </div>
    </div>
  );
}

function Layers3Icon() {
  return <span className="layers-glyph"><HardDrive size={17} /></span>;
}
