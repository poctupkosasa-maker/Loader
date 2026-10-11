import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { api, isDesktop } from './lib/api';
import './themes.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root container is missing.');

async function start(): Promise<void> {
  // Read the saved theme before the first paint so the launcher never flashes
  // the default palette on its way to the one the player picked.
  if (isDesktop) {
    try {
      const settings = await api.getSettings();
      if (settings?.theme) document.documentElement.dataset.theme = settings.theme;
    } catch {
      // Keep the default theme; the app applies the stored one once it boots.
    }
  }
  createRoot(root as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();
