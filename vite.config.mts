import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  // Electron loads the production renderer from a local origin (app://) rather
  // than an HTTP server. Relative asset URLs keep the bundle independent of the
  // origin it is served from; absolute "/assets/..." URLs resolve against the
  // filesystem root when the HTML is opened through file:// and leave the
  // window blank.
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    chunkSizeWarningLimit: 600,
  },
});
