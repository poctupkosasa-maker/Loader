import { useEffect, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import type { LanguageCode, ThemeId } from '../../shared/types';
import { THEMES, type ThemeInfo } from '../themeCatalogue';

interface ThemePickerProps {
  theme: ThemeId;
  language: LanguageCode;
  onSelect: (theme: ThemeId) => void;
}

/** Miniature of a theme: page background, a surface card and the accent. */
export function ThemePreview({ info, className = 'theme-preview' }: { info: ThemeInfo; className?: string }) {
  return (
    <span className={className} style={{ background: info.swatch[0] }} aria-hidden="true">
      <span className="theme-preview-card" style={{ background: info.swatch[1] }} />
      <span className="theme-preview-bar" style={{ background: info.swatch[2] }} />
      <span className="theme-preview-dot" style={{ background: info.swatch[2] }} />
    </span>
  );
}

const label = (info: ThemeInfo, language: LanguageCode) => info.name[language] ?? info.name.en;
const blurb = (info: ThemeInfo, language: LanguageCode) => info.blurb[language] ?? info.blurb.en;

/** Topbar popover: switch the look without leaving the current page. */
export function ThemeSwitcher({ theme, language, onSelect }: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = THEMES.find((item) => item.id === theme) ?? THEMES[0];

  return (
    <div className="theme-switcher" ref={container}>
      <button
        className={`theme-trigger ${open ? 'open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={label(current, language)}
      >
        <Palette size={15} />
        <span>{label(current, language)}</span>
      </button>
      {open && (
        <div className="theme-popover" role="listbox" aria-label="Themes">
          <div className="theme-popover-head">
            <span className="muted-label">{language === 'ru' ? 'Оформление' : 'Appearance'}</span>
            <span>{THEMES.length} {language === 'ru' ? 'тем' : 'themes'}</span>
          </div>
          <div className="theme-list">
            {THEMES.map((info) => (
              <button
                key={info.id}
                role="option"
                aria-selected={info.id === theme}
                className={`theme-option ${info.id === theme ? 'active' : ''}`}
                onClick={() => { onSelect(info.id); setOpen(false); }}
              >
                <ThemePreview info={info} className="theme-preview theme-preview-small" />
                <span className="theme-option-copy">
                  <strong>{label(info, language)}</strong>
                  <span>{blurb(info, language)}</span>
                </span>
                {info.id === theme && <Check size={13} className="theme-option-check" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Settings section body: the full gallery with names and descriptions. */
export function ThemeGallery({ theme, language, onSelect }: ThemePickerProps) {
  return (
    <div className="theme-gallery">
      {THEMES.map((info) => (
        <button
          key={info.id}
          className={`theme-card ${info.id === theme ? 'selected' : ''}`}
          onClick={() => onSelect(info.id)}
          aria-pressed={info.id === theme}
        >
          <ThemePreview info={info} className="theme-preview theme-preview-card" />
          <span className="theme-card-copy">
            <strong>{label(info, language)}</strong>
            <span>{blurb(info, language)}</span>
          </span>
          {info.id === theme && <span className="theme-card-check"><Check size={12} /></span>}
          {(info.mode === 'light') && <span className="theme-card-tag">{language === 'ru' ? 'светлая' : 'light'}</span>}
        </button>
      ))}
    </div>
  );
}
