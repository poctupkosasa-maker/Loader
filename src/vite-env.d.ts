/// <reference types="vite/client" />

import type { LauncherAPI } from '../shared/types';

declare global {
  interface Window {
    launcher: LauncherAPI;
  }
}

export {};
