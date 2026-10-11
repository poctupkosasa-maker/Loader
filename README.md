# Loader — Minecraft Launcher

A cross-platform desktop launcher built with Electron, React, TypeScript, Node.js, and SQLite. The renderer is sandboxed and communicates with the main process through a narrow, typed IPC bridge.

## Features

- Microsoft device-code OAuth through Xbox Live and Minecraft Services, plus validated offline usernames.
- OAuth session secrets encrypted with Electron `safeStorage` (Windows DPAPI, macOS Keychain, or the platform's secure backend). If OS encryption is unavailable, premium credentials are not written in plaintext.
- Official Mojang version manifest, release/snapshot/old beta/old alpha browsing, SHA-1-checked client/library/asset downloads, streamed progress, HTTP Range resume, and a bounded download queue.
- Client installation with vanilla, Fabric, Forge, Quilt, and NeoForge installer flows.
- Java detection and selection, Mojang argument/rule resolution, profile-specific game directories, process output, and stop controls.
- SQLite-backed profiles, preferences, accounts (non-secret metadata), and mod state.
- Modrinth search/install with required dependency handling, local enable/disable, and optional CurseForge API integration.
- Dark React UI, a skinview3d player preview for Microsoft skins, live console/download views, and English/Russian labels.

## Requirements

- Node.js 20.19+ or 22.12+ (Vite 8 requirement).
- Java 8 for legacy Minecraft where necessary, and Java 17/21 for modern versions and installers.
- A Microsoft Entra public-client application ID for Microsoft sign-in. Offline profiles work without it.

## Run locally

```bash
npm install
cp .env.example .env
# Set MICROSOFT_CLIENT_ID in .env if you want Microsoft sign-in.
npm run dev
```

`npm run dev` compiles the Electron main process, runs Vite, and opens the desktop window. `npm run dev:ui` starts a renderer-only browser preview with sample data; it does not download files or start a Java process.

## Microsoft device-code setup

1. Create an application in Microsoft Entra ID for a public desktop client.
2. Enable public-client/device-code flow and add the Xbox Live sign-in delegated permission as required by your tenant.
3. Put the **application (client) ID** in `MICROSOFT_CLIENT_ID` in `.env` before starting Loader. Do not ship a client secret in a desktop app.
4. The user approves the device code in Microsoft's browser. Loader exchanges it through Xbox Live and Minecraft Services and checks for a Java Edition profile/entitlement.

The exact permission and publisher-verification settings depend on the app registration and Microsoft account setup. Microsoft can reject accounts without an Xbox profile, a Minecraft Java profile, or the required entitlement.

## Optional CurseForge support

CurseForge's official API requires a key. Set `CURSEFORGE_API_KEY` in `.env`; the key remains in the main process and is never exposed through the renderer bridge. Modrinth discovery/install works without an API key.

## Build installers

```bash
npm run build
npm run dist:win
npm run dist:mac
npm run dist:linux
```

`electron-builder` is configured for Windows NSIS/portable, macOS DMG/ZIP, and Linux AppImage/DEB. Build each target on a supported native runner (macOS signing/notarization is a separate release step). The SQLite native addon is rebuilt for Electron during `postinstall` and unpacked from ASAR at packaging time.

A GitHub Actions workflow (`.github/workflows/build.yml`) builds all three platform targets on pushes to `main` and on pull requests to `main`. Installer files are published as downloadable workflow artifacts for 14 days.

## Project map

```text
electron/
  main.ts                 Electron main process / service wiring
  preload.ts              context-isolated, typed renderer API
  ipc.ts                  validated IPC handlers
  services/
    AuthService.ts        Microsoft/Xbox/Minecraft and offline auth
    SecureStore.ts        OS-encrypted OAuth credential storage
    DatabaseService.ts    better-sqlite3 schema and persistence
    DownloadService.ts   concurrency, streaming, progress, resume, SHA-1
    VersionService.ts    Mojang manifest and vanilla asset/runtime setup
    LoaderService.ts     official Fabric/Forge/Quilt/NeoForge installers
    JavaService.ts       local Java discovery / compatibility checks
    LaunchService.ts     classpath and argument resolution / process logs
    ModService.ts        Modrinth and CurseForge integration
    ProfileService.ts    profile validation and lifecycle
src/
  App.tsx                 React shell, app state, toast/events
  components/             navigation, auth modal, 3D skin preview
  pages/                  home, versions, mods, settings, console
  lib/api.ts              Electron bridge / browser-preview adapter
  i18n.ts                 English and Russian UI strings
shared/types.ts           Shared IPC/data contract
```

## Security and implementation notes

- Electron runs with `contextIsolation`, `sandbox`, and `webSecurity` enabled; Node integration is disabled. The renderer receives only explicit API methods, never raw `ipcRenderer` or filesystem access.
- Network calls for authentication, downloads, installers, and APIs run in the main process. Paths derived from remote archives/metadata are constrained to their intended directories, and native ZIP extraction rejects traversal entries.
- Mojang-provided SHA-1 values are checked for clients, libraries, asset indexes, and asset objects. Modrinth file hashes are checked when the API returns one. Loader installer JARs and CurseForge files may not provide a verifiable SHA-1 in the available metadata.
- Offline mode is for local/offline use and does not bypass premium authentication requirements on servers.
