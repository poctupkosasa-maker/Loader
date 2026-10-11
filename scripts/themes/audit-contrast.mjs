#!/usr/bin/env node
/*
 * Contrast audit for every generated theme.
 *
 * Reads src/themes.css, resolves each theme's tokens and checks the pairs that
 * must stay readable. Catches "invisible text" mistakes without a browser.
 *
 *   node scripts/themes/audit-contrast.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(join(ROOT, 'src/themes.css'), 'utf8');

const hexToRgb = (hex) => {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
};
const luminance = (hex) => {
  const channels = hexToRgb(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

// Resolve one token in the context of a theme block (following var() chains).
function resolve(theme, token, seen = new Set()) {
  if (seen.has(token)) return null;
  seen.add(token);
  const raw = theme.values[token] ?? (token.startsWith('--') ? null : token);
  if (!raw) return null;
  const reference = raw.match(/var\((--[a-z0-9-]+)\)/);
  if (reference) return resolve(theme, reference[1], seen);
  const hex = raw.match(/#[0-9a-fA-F]{3,8}/);
  return hex ? hex[0] : null;
}

const blocks = [...css.matchAll(/:root(?:\[data-theme='([a-z]+)'\])?\s*\{([\s\S]*?)\n\}/g)];
const themes = blocks.map(([, id, body]) => ({
  id: id ?? 'loader',
  values: Object.fromEntries([...body.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)].map(([, token, value]) => [token, value.trim()])),
}));
// The bare :root block backs the default theme.
const defaultTheme = themes.find((theme) => theme.id === 'loader');
if (defaultTheme) themes.unshift({ ...defaultTheme, id: 'root (default)' });

// [foreground, background, minimum ratio, description]
const PAIRS = [
  ['--ink-26', '--tone-01', 9, 'primary text on the page'],
  ['--ink-25', '--tone-04', 7, 'panel headings'],
  ['--ink-15', '--tone-04', 2.6, 'muted labels on panels'],
  ['--ink-10', '--tone-04', 3.4, 'secondary text on panels'],
  ['--ink-09', '--tone-03', 3.2, 'sidebar secondary text'],
  ['--ink-05', '--tone-01', 1.9, 'footer micro text'],
  ['--on-accent', '--accent', 4.6, 'text on accent buttons'],
  ['--accent', '--tone-01', 3.4, 'accent text on the page'],
  ['--accent-ink-3', '--tone-04', 3.2, 'accent icons on panels'],
  ['--danger-ink-2', '--tone-04', 3.5, 'error text'],
  ['--warn-ink', '--tone-04', 3.2, 'warning text'],
  ['--violet-ink', '--tone-04-violet', 3.2, 'violet chip'],
  ['--info-ink', '--tone-01-info', 3.2, 'info chip'],
  ['--amber-ink', '--amber-surface', 3.0, 'amber chip'],
  // Hero banner: the illustration sits behind these lines.
  ['--accent-ink-1', '--art-hero-b', 4.2, 'hero headline'],
  ['--accent', '--art-hero-b', 2.2, 'hero accent word'],
  ['--ink-17', '--art-hero-b', 2.4, 'hero description'],
  ['--ink-20', '--art-hero-b', 2.4, 'hero secondary link'],
  ['--ink-08', '--art-hero-b', 1.5, 'hero footnote'],
  ['--ink-06', '--art-hero-b', 1.4, 'hero corner label'],
];

const problems = [];
for (const theme of themes) {
  for (const [foreground, background, minimum, description] of PAIRS) {
    const fg = resolve(theme, foreground);
    const bg = resolve(theme, background);
    if (!fg || !bg) {
      problems.push(`${theme.id}: could not resolve ${foreground} or ${background} (${description})`);
      continue;
    }
    const ratio = contrast(fg, bg);
    if (ratio < minimum) {
      problems.push(`${theme.id}: ${description} — ${foreground} on ${background} is ${ratio.toFixed(2)}:1, needs ${minimum}:1 (${fg} on ${bg})`);
    }
  }
  // Panels have to be distinguishable from the page background.
  const page = resolve(theme, '--tone-00') ?? resolve(theme, '--tone-01');
  const panel = resolve(theme, '--tone-04');
  const delta = Math.abs(luminance(page) - luminance(panel));
  if (delta < 0.0045) problems.push(`${theme.id}: panel and page background are nearly identical (luminance delta ${delta.toFixed(4)})`);
  // The gutter has to have a light theme that is actually light.
  if (theme.id === 'daylight' && luminance(page) < 0.6) problems.push(`${theme.id}: page background is not light`);
}

if (problems.length) {
  console.log(problems.join('\n'));
  console.log(`\n${problems.length} contrast problem(s)`);
  process.exit(1);
}
console.log(`contrast audit passed for ${themes.length} theme blocks (${PAIRS.length} pairs each)`);
