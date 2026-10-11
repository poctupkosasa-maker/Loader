#!/usr/bin/env node
/*
 * Generates src/themes.css from the theme catalogue below.
 *
 * The launcher's stylesheet only refers to tokens (--tone-*, --ink-*, --accent*,
 * --art-*), and every theme is produced by re-hueing the same base ramp. Because
 * the base ramp carries the original palette's lightness steps, contrast
 * relationships survive the transformation.
 *
 *   node scripts/themes/generate-themes.mjs           # write src/themes.css
 *   node scripts/themes/generate-themes.mjs --check   # verify tokens, no write
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const STYLES = join(ROOT, 'src/styles.css');
const OUTPUT = join(ROOT, 'src/themes.css');

// --------------------------------------------------------------- base ramp
// Neutral surface ramp, lightest step first. Values come from the palette the
// original stylesheet was built on.
const BASE_TONES = [
  ['tone-00', 'neutral', '#0c100d'],
  ['tone-01', 'neutral', '#101511'],
  ['tone-02', 'neutral', '#121713'],
  ['tone-03', 'neutral', '#151a16'],
  ['tone-04', 'neutral', '#171d19'],
  ['tone-05', 'neutral', '#1c241e'],
  ['tone-06', 'neutral', '#212920'],
  ['tone-07', 'neutral', '#202a21'],
  ['tone-08', 'neutral', '#252f26'],
  ['tone-09', 'neutral', '#263626'],
  ['tone-10', 'neutral', '#293629'],
  ['tone-11', 'neutral', '#2b392b'],
  ['tone-12', 'neutral', '#303a31'],
  ['tone-13', 'neutral', '#30412f'],
  ['tone-14', 'neutral', '#384339'],
  ['tone-15', 'neutral', '#3a4a39'],
  ['tone-16', 'neutral', '#455348'],
  ['tone-17', 'neutral', '#52684b'],
  ['tone-18', 'neutral', '#53664e'],
  ['tone-19', 'neutral', '#54734c'],
  ['tone-01-violet', 'violet', '#19191e'],
  ['tone-02-violet', 'violet', '#211e29'],
  ['tone-03-violet', 'violet', '#2b2637'],
  ['tone-04-violet', 'violet', '#302b3b'],
  ['tone-05-violet', 'violet', '#39304b'],
  ['tone-01-info', 'info', '#243438'],
  ['tone-01-warm', 'warm', '#392f24'],
];
// Text/line ramp, darkest step first.
const BASE_INKS = [
  ['ink-01', 'neutral', '#1d241e'],
  ['ink-02', 'neutral', '#3f4b41'],
  ['ink-03', 'neutral', '#4e5d51'],
  ['ink-04', 'neutral', '#57645a'],
  ['ink-05', 'neutral', '#59665d'],
  ['ink-06', 'neutral', '#67746a'],
  ['ink-07', 'neutral', '#6c786f'],
  ['ink-08', 'neutral', '#728075'],
  ['ink-09', 'neutral', '#77847a'],
  ['ink-10', 'neutral', '#7d897f'],
  ['ink-11', 'neutral', '#809082'],
  ['ink-12', 'neutral', '#899789'],
  ['ink-13', 'neutral', '#91a486'],
  ['ink-14', 'neutral', '#94a095'],
  ['ink-15', 'neutral', '#9ca99e'],
  ['ink-16', 'neutral', '#a3afa3'],
  ['ink-17', 'neutral', '#a7b3a7'],
  ['ink-18', 'neutral', '#aab7aa'],
  ['ink-19', 'neutral', '#b9c7b9'],
  ['ink-20', 'neutral', '#c4cdc3'],
  ['ink-21', 'neutral', '#c8d5c6'],
  ['ink-22', 'neutral', '#ced8ce'],
  ['ink-23', 'neutral', '#d4dfd3'],
  ['ink-24', 'neutral', '#dae4d9'],
  ['ink-25', 'neutral', '#e0e9df'],
  ['ink-26', 'neutral', '#e7eee6'],
];

// ---------------------------------------------------------------- the themes
const THEMES = [
  {
    id: 'loader',
    name: { en: 'Loader', ru: 'Loader' },
    blurb: { en: 'The original lime-on-moss look', ru: 'Классический лаймовый на мху' },
    swatch: ['#0c100d', '#171d19', '#b8f27b'],
    tones: 130, inks: 128, accent: '#b8f27b',
    art: { terrain: 140, sun: 100, block: 88, trunk: 28 },
  },
  {
    id: 'nether',
    name: { en: 'Nether', ru: 'Нижний мир' },
    blurb: { en: 'Lava glow over netherrack', ru: 'Свечение лавы над незерраком' },
    swatch: ['#170a08', '#2a120c', '#ff8a4e'],
    tones: 12, inks: 22, accent: '#ff8a4e', satScale: 2.6, inkSat: 1.5,
    art: { terrain: 6, sun: 30, block: 22, trunk: 18 }, artSat: 1.9,
  },
  {
    id: 'end',
    name: { en: 'The End', ru: 'Энд' },
    blurb: { en: 'Void violet and ender eyes', ru: 'Фиолетовая пустота и глаза эндермена' },
    swatch: ['#0e0b18', '#1d1730', '#a98bff'],
    tones: 268, inks: 276, accent: '#a98bff', satScale: 2.3, inkSat: 1.35,
    art: { terrain: 288, sun: 262, block: 276, trunk: 250 }, artSat: 1.6,
  },
  {
    id: 'ocean',
    name: { en: 'Ocean', ru: 'Океан' },
    blurb: { en: 'Deep water and turtle teal', ru: 'Глубина и бирюза черепах' },
    swatch: ['#08131a', '#13252e', '#5fd3e8'],
    tones: 205, inks: 198, accent: '#5fd3e8', satScale: 2.4, inkSat: 1.4,
    art: { terrain: 196, sun: 188, block: 186, trunk: 26 }, artSat: 1.5,
  },
  {
    id: 'bastion',
    name: { en: 'Bastion', ru: 'Бастион' },
    blurb: { en: 'Gold blocks and gilded blackstone', ru: 'Золотые блоки и позолоченный чернокамень' },
    swatch: ['#14100a', '#241c11', '#f5c542'],
    tones: 42, inks: 40, accent: '#f5c542', satScale: 2.0, inkSat: 1.2,
    art: { terrain: 40, sun: 48, block: 45, trunk: 30 }, artSat: 1.6,
  },
  {
    id: 'cherry',
    name: { en: 'Cherry Grove', ru: 'Вишнёвая роща' },
    blurb: { en: 'Blossom pink and soft dusk', ru: 'Розовое цветение в сумерках' },
    swatch: ['#180a12', '#2a1420', '#ff9ecf'],
    tones: 330, inks: 336, accent: '#ff9ecf', satScale: 2.2, inkSat: 1.3,
    art: { terrain: 336, sun: 320, block: 330, trunk: 24 }, artSat: 1.6,
  },
  {
    id: 'sculk',
    name: { en: 'Deep Dark', ru: 'Глубокая тьма' },
    blurb: { en: 'Sculk sensors and silence', ru: 'Скалк-сенсоры и тишина' },
    swatch: ['#05100f', '#0d1f1e', '#54e0c8'],
    tones: 186, inks: 190, accent: '#54e0c8', satScale: 2.6, inkSat: 1.4,
    art: { terrain: 190, sun: 172, block: 178, trunk: 200 }, artSat: 1.5,
  },
  {
    id: 'redstone',
    name: { en: 'Redstone', ru: 'Редстоун' },
    blurb: { en: 'Slate machinery and signal red', ru: 'Сланцевые механизмы и красный сигнал' },
    swatch: ['#100e0e', '#1f1c1c', '#ff5a52'],
    tones: 356, inks: 8, accent: '#ff5a52', satScale: 1.3, inkSat: 0.9,
    art: { terrain: 356, sun: 12, block: 0, trunk: 20 }, artSat: 1.2,
  },
  {
    id: 'daylight',
    name: { en: 'Daylight', ru: 'Дневной свет' },
    blurb: { en: 'Bright overworld for sunny desks', ru: 'Светлый оверворлд для солнечных дней' },
    swatch: ['#f4f6f1', '#ffffff', '#2f7420'],
    mode: 'light', tones: 120, inks: 140, accent: '#2f7420', satScale: 0.8, inkSat: 0.9,
    art: { terrain: 130, sun: 52, block: 100, trunk: 28 }, artSat: 1.25,
  },
];

// ------------------------------------------------------------------ helpers
const hexToRgb = (hex) => {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
};
const rgbToHsl = ([r, g, b]) => {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return [h * 360, s, l];
};
const hslToHex = ([h, s, l]) => {
  const hue = ((((h % 360) + 360) % 360) / 360);
  const sat = Math.min(1, Math.max(0, s));
  const light = Math.min(1, Math.max(0, l));
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const toHex = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${toHex(channel(hue + 1 / 3))}${toHex(channel(hue))}${toHex(channel(hue - 1 / 3))}`;
};
const shift = (hex, { h = 0, s = 1, l = 0 } = {}) => {
  const [hh, ss, ll] = rgbToHsl(hexToRgb(hex));
  return hslToHex([hh + h, ss * s, ll + l]);
};
const meanHue = (entries) => {
  const hues = entries.map(([, , value]) => rgbToHsl(hexToRgb(value))).filter(([, s]) => s > 0.02).map(([h]) => h);
  return hues.reduce((sum, h) => sum + h, 0) / Math.max(1, hues.length);
};
const NEUTRAL_TONE_HUE = meanHue(BASE_TONES.filter(([, family]) => family === 'neutral'));
const NEUTRAL_INK_HUE = meanHue(BASE_INKS);
const INK_MIN = Math.min(...BASE_INKS.map(([, , value]) => rgbToHsl(hexToRgb(value))[2]));
const INK_MAX = Math.max(...BASE_INKS.map(([, , value]) => rgbToHsl(hexToRgb(value))[2]));

const FAMILY_BASE_HUE = {
  neutral: NEUTRAL_TONE_HUE,
  violet: meanHue(BASE_TONES.filter(([, family]) => family === 'violet')),
  warm: meanHue(BASE_TONES.filter(([, family]) => family === 'warm')),
  info: meanHue(BASE_TONES.filter(([, family]) => family === 'info')),
};
const familyTarget = (theme, family) => {
  if (family === 'violet') return theme.violetHue ?? 272;
  if (family === 'warm') return theme.warmHue ?? 32;
  if (family === 'info') return theme.infoHue ?? 192;
  return theme.tones;
};

/** Re-hue one step of the base ramp. */
function transformStep(theme, family, value, kind) {
  const [h, s, l] = rgbToHsl(hexToRgb(value));
  const satScale = theme.satScale ?? 1;
  const baseHue = kind === 'tone' ? FAMILY_BASE_HUE[family] : NEUTRAL_INK_HUE;
  const targetHue = kind === 'tone' ? familyTarget(theme, family) : (theme.inks ?? 130);
  const rotated = h + (targetHue - baseHue);
  const saturation = Math.min(1, s * satScale * (theme[`${kind}Sat`] ?? 1));
  if (theme.mode === 'light') {
    if (kind === 'tone') {
      // Surfaces flip to light greys; the ramp keeps its ordering.
      const light = Math.min(0.985, 1 - l * 0.9);
      return hslToHex([rotated, saturation * 0.55, light]);
    }
    // Text flips to dark. The source ramp is dense around the muted values, so
    // it is remapped onto a monotone span instead of inverted step by step.
    const span = (l - INK_MIN) / (INK_MAX - INK_MIN);
    return hslToHex([rotated, saturation * 0.85, 0.66 - 0.52 * span]);
  }
  return hslToHex([rotated, saturation, l]);
}

function accentFamily(accent, mode) {
  const toward = mode === 'light' ? -1 : 1;
  return {
    '--accent': accent,
    '--accent-hover': shift(accent, { l: 0.05 * toward }),
    '--accent-border': shift(accent, { l: 0.09 * toward }),
    '--accent-bright': shift(accent, { l: 0.22 * toward, s: 0.7 }),
    '--accent-progress-a': shift(accent, { l: -0.12 * toward, s: 0.8 }),
    '--accent-progress-b': shift(accent, { l: 0.1 * toward }),
    '--accent-ink-1': shift(accent, { l: 0.2 * toward, s: 0.8 }),
    '--accent-ink-2': shift(accent, { l: 0.1 * toward, s: 0.9 }),
    '--accent-ink-3': accent,
    '--accent-ink-4': shift(accent, { l: -0.1 * toward }),
    '--accent-ink-5': shift(accent, { l: -0.18 * toward, s: 0.9 }),
  };
}

const ART_BASE = [
  ['--art-sun', '#8ab86b', 'sun'],
  ['--art-mountain-back-a', '#354b3a', 'terrain'],
  ['--art-mountain-back-b', '#233929', 'terrain'],
  ['--art-mountain-front-a', '#2c4733', 'terrain'],
  ['--art-mountain-front-b', '#172b20', 'terrain'],
  ['--art-grass-a', '#203726', 'terrain'],
  ['--art-grass-b', '#243b29', 'terrain'],
  ['--art-grass-top', '#4f7544', 'terrain'],
  ['--art-leaf', '#416347', 'terrain'],
  ['--art-trunk', '#674b32', 'trunk'],
  ['--art-block-a', '#8fbd5f', 'block'],
  ['--art-block-b', '#6d9e4e', 'block'],
  ['--art-block-shadow', '#182c1d', 'block'],
  ['--art-spark', '#b5ed87', 'block'],
  ['--art-hero-a', '#19241d', 'terrain'],
  ['--art-hero-b', '#1d2b21', 'terrain'],
  ['--art-hero-c', '#15221b', 'terrain'],
  ['--art-hero-border', '#28352a', 'terrain'],
];
const ART_BASE_HUE = {};
for (const family of ['sun', 'terrain', 'trunk', 'block']) {
  const items = ART_BASE.filter(([, , itemFamily]) => itemFamily === family);
  ART_BASE_HUE[family] = meanHue(items.map(([token, value]) => [token, 'neutral', value]));
}

function artFamily(theme) {
  const out = {};
  for (const [token, value, family] of ART_BASE) {
    const [h, sat, l] = rgbToHsl(hexToRgb(value));
    const target = theme.art[family] ?? theme.art.terrain;
    const rotated = h + (target - ART_BASE_HUE[family]);
    const saturation = Math.min(1, sat * (theme.artSat ?? 1.05));
    if (theme.mode === 'light') {
      const lift = family === 'terrain' ? 0.42 : family === 'sun' ? 0.3 : 0.25;
      out[token] = hslToHex([rotated, saturation, l + (1 - l) * lift]);
    } else {
      out[token] = hslToHex([rotated, saturation, l]);
    }
  }
  return out;
}

function themeBlock(theme) {
  const lines = [];
  const push = (token, value) => lines.push(`  ${token}: ${value};`);

  lines.push('  /* surfaces */');
  for (const [token, family, value] of BASE_TONES) push(`--${token}`, transformStep(theme, family, value, 'tone'));
  lines.push('', '  /* text and lines */');
  for (const [token, family, value] of BASE_INKS) push(`--${token}`, transformStep(theme, family, value, 'ink'));

  lines.push('', '  /* accent */');
  for (const [token, value] of Object.entries(accentFamily(theme.accent, theme.mode))) push(token, value);
  push('--on-accent', theme.mode === 'light' ? '#ffffff' : hslToHex([rgbToHsl(hexToRgb(theme.accent))[0], 0.45, 0.08]));
  push('--on-accent-spinner', 'color-mix(in srgb, var(--on-accent) 22%, transparent)');
  push('--wash', theme.mode === 'light' ? '#101511' : '#ffffff');
  push('--hairline', theme.mode === 'light' ? hslToHex([theme.tones, 0.12, 0.28]) : hslToHex([theme.tones, 0.16, 0.84]));

  lines.push('', '  /* semantic */');
  push('--danger', theme.danger ?? (theme.mode === 'light' ? '#c2362f' : '#ff827c'));
  push('--danger-text', shift(theme.danger ?? (theme.mode === 'light' ? '#c2362f' : '#ff827c'), { s: 0.55, l: theme.mode === 'light' ? 0.3 : 0.32 }));
  push('--danger-ink-1', shift(theme.danger ?? (theme.mode === 'light' ? '#c2362f' : '#ff827c'), { s: 0.7, l: 0.06 }));
  push('--danger-ink-2', shift(theme.danger ?? (theme.mode === 'light' ? '#c2362f' : '#ff827c'), { s: 0.6, l: 0.02 }));
  push('--danger-fill', theme.mode === 'light' ? '#c2362f' : '#753d39');
  push('--danger-fill-hover', theme.mode === 'light' ? '#a92c26' : '#914b43');
  push('--danger-border', theme.mode === 'light' ? '#d0594f' : '#87504b');
  push('--danger-surface', theme.mode === 'light' ? '#fbe9e6' : '#2d211f');
  const warnBase = theme.warn ?? (theme.mode === 'light' ? '#a8611a' : '#e9a96d');
  const towardLight = theme.mode === 'light' ? -1 : 1;
  push('--warn', warnBase);
  push('--warn-ink', shift(warnBase, { l: theme.mode === 'light' ? -0.1 : 0.08, s: 0.8 }));
  push('--warn-ink-bright', shift(warnBase, { l: theme.mode === 'light' ? -0.16 : 0.14 }));
  push('--warn-code', shift(warnBase, { l: (theme.mode === 'light' ? -0.06 : 0.16), s: 0.85 }));
  push('--warn-badge', shift(warnBase, { l: 0.06 * towardLight }));
  push('--violet-ink', theme.mode === 'light' ? '#6b46c1' : '#c3b2f2');
  push('--violet-ink-bright', theme.mode === 'light' ? '#553c9a' : '#ede5f5');
  push('--info-ink', theme.mode === 'light' ? '#1f6f75' : '#8ed5ce');
  push('--info-surface', theme.mode === 'light' ? '#dcf1f2' : hslToHex([190, 0.3, 0.18]));
  push('--amber-ink', theme.mode === 'light' ? '#8a5a1f' : '#e7b280');
  push('--amber-surface', theme.mode === 'light' ? '#f6e6d5' : hslToHex([32, 0.35, 0.17]));
  push('--amber-surface-light', theme.mode === 'light' ? '#f0d9bd' : hslToHex([32, 0.35, 0.23]));
  push('--amber-surface-dark', theme.mode === 'light' ? '#f8efe3' : hslToHex([32, 0.3, 0.14]));

  lines.push('', '  /* translucent layers */');
  push('--topbar-surface', 'color-mix(in srgb, var(--tone-02) 88%, transparent)');
  push('--panel-surface-a', 'color-mix(in srgb, var(--tone-03) 96%, transparent)');
  push('--panel-surface-b', 'color-mix(in srgb, var(--tone-04) 98%, transparent)');
  push('--overlay', theme.mode === 'light' ? 'rgba(18, 24, 20, .38)' : 'rgba(3, 7, 4, .72)');

  lines.push('', '  /* hero illustration */');
  const art = artFamily(theme);
  for (const [token, value] of Object.entries(art)) push(token, value);
  push('--art-grid', 'color-mix(in srgb, var(--art-grass-top) 22%, transparent)');
  push('--art-grid-strong', 'color-mix(in srgb, var(--art-grass-top) 30%, transparent)');
  push('--art-orbit-1', 'color-mix(in srgb, var(--art-grass-top) 26%, transparent)');
  push('--art-orbit-2', 'color-mix(in srgb, var(--art-grass-top) 22%, transparent)');
  push('--art-cloud', 'color-mix(in srgb, var(--art-grass-top) 45%, transparent)');
  push('--art-cloud-soft', 'color-mix(in srgb, var(--art-grass-top) 34%, transparent)');
  push('--art-halo', 'color-mix(in srgb, var(--art-grass-top) 30%, transparent)');
  push('--art-halo-2', 'color-mix(in srgb, var(--art-grass-top) 28%, transparent)');
  push('--art-skin-glow', 'color-mix(in srgb, var(--art-grass-top) 40%, transparent)');
  push('--art-sun-glow', 'color-mix(in srgb, var(--art-sun) 55%, transparent)');
  push('--art-sun-ring', 'color-mix(in srgb, var(--art-sun) 12%, transparent)');
  push('--art-grass-shadow', 'color-mix(in srgb, var(--tone-01) 46%, transparent)');
  push('--art-leaf-sheen', 'color-mix(in srgb, var(--accent-bright) 24%, transparent)');
  push('--art-block-speck', 'color-mix(in srgb, var(--accent-bright) 42%, transparent)');
  push('--art-block-speck-soft', 'color-mix(in srgb, var(--accent-bright) 26%, transparent)');
  push('--art-block-speck-mid', 'color-mix(in srgb, var(--accent-bright) 34%, transparent)');
  push('--art-block-edge', 'color-mix(in srgb, var(--accent) 74%, transparent)');
  push('--art-block-base', 'color-mix(in srgb, var(--art-block-shadow) 60%, transparent)');

  return `:root[data-theme='${theme.id}'] {\n${lines.join('\n')}\n}`;
}

// -------------------------------------------------------------------- output
const header = `/*
 * Generated by scripts/themes/generate-themes.mjs — do not edit by hand.
 * Run "npm run themes:build" after changing the theme catalogue.
 */`;

const defaultTheme = THEMES[0];
const css = [
  header,
  '',
  '/* The first theme also backs the bare :root so the app has a palette before',
  '   the renderer sets data-theme. */',
  themeBlock(defaultTheme).replace(`:root[data-theme='${defaultTheme.id}']`, ':root'),
  '',
  ...THEMES.slice(1).map((theme) => `${themeBlock(theme)}\n`),
].join('\n');

// --------------------------------------------------------------------- check
const styles = readFileSync(STYLES, 'utf8');
const referenced = new Set([...styles.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1]));
const definedIn = (block) => new Set([...block.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1]));
const problems = [];
for (const theme of THEMES) {
  const block = themeBlock(theme);
  const defined = definedIn(block);
  for (const token of referenced) {
    // Fonts live in :root and translucent layers are allowed to reference tokens.
    if (token === '--mono' || token === '--display') continue;
    if (!defined.has(token)) problems.push(`${theme.id}: missing ${token}`);
  }
  for (const token of defined) {
    if (!referenced.has(token)) problems.push(`${theme.id}: unused ${token}`);
  }
}

const sharedTypes = readFileSync(join(ROOT, 'shared/types.ts'), 'utf8');
const declared = [...(sharedTypes.match(/export const THEME_IDS = \[([\s\S]*?)\] as const;/)?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((match) => match[1]);
const catalogueIds = THEMES.map((theme) => theme.id);
if (declared.join(',') !== catalogueIds.join(',')) {
  problems.push(`shared/types.ts declares [${declared.join(', ')}] but the catalogue has [${catalogueIds.join(', ')}]`);
}

if (process.argv.includes('--check')) {
  if (problems.length) {
    console.log(problems.slice(0, 40).join('\n'));
    console.log(`\n${problems.length} theme token problem(s)`);
    process.exit(1);
  }
  console.log(`theme tokens verified for ${THEMES.length} themes (${referenced.size} referenced tokens)`);
  process.exit(0);
}

writeFileSync(OUTPUT, `${css.trimEnd()}\n`);
const catalogue = THEMES.map((theme) => `  { id: '${theme.id}', name: { en: '${theme.name.en}', ru: '${theme.name.ru}' }, blurb: { en: '${theme.blurb.en}', ru: '${theme.blurb.ru}' }, swatch: ['${theme.swatch.join("', '")}'], mode: '${theme.mode ?? 'dark'}' },`).join('\n');
writeFileSync(join(ROOT, 'src/themeCatalogue.ts'), `// Generated by scripts/themes/generate-themes.mjs — do not edit by hand.
import type { ThemeId } from '../shared/types';

export interface ThemeInfo {
  id: ThemeId;
  name: { en: string; ru: string };
  blurb: { en: string; ru: string };
  swatch: string[];
  mode: 'dark' | 'light';
}

export const THEMES: ThemeInfo[] = [
${catalogue}
];
`);
console.log(`wrote src/themes.css (${THEMES.length} themes)`);
console.log(`wrote src/themeCatalogue.ts`);
if (problems.length) {
  console.log(`\nwarning: ${problems.length} token problem(s):`);
  console.log(problems.slice(0, 20).join('\n'));
}
