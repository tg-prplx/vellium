# Vellium

<p align="center">
  <img src="docs/vellium-icon.png" alt="Vellium icon" width="120" />
</p>
<p align="center"><strong>Desktop AI chat, RP, writing, lorebook, RAG, and plugin workbench.</strong></p>

Desktop app built with Electron, React, a local Express API, and SQLite.

<img width="1709" height="1028" alt="Vellium chat" src="https://github.com/user-attachments/assets/35bb7ba6-7e01-4e56-9055-7fe823b92541" />

## Important
- Use `npm run dev` for day-to-day development.
- Use `npm run dev:electron` when testing the real desktop shell.
- Use `npm run dist:mac` / `npm run dist:win` for desktop bundles.
- CI desktop builds are unsigned. macOS and Windows may require manual confirmation.
- Desktop packaging works, but it still has rough edges. It is usable, not polished.

## Stack
- Electron
- React + TypeScript + Vite
- Express
- SQLite + `better-sqlite3`
- Tailwind CSS

## Core Features

### Chat / RP
- Branching chat history.
- Edit, delete, resend, regenerate.
- Multi-character chats with auto-turns.
- RP controls: prompt stack, author note, scene state, presets, personas.
- LoreBook / World Info support, including SillyTavern-compatible world info import/export.
- Reasoning support, including `<think>...</think>` parsing.
- Vision attachments and chat attachments.

### Writing
- Projects, chapters, scenes, outlines.
- Summaries, rewrite/expand flows, consistency tools.
- Character-aware writing workflows.
- DOCX import and DOCX / Markdown export.
- Writing-side RAG support.

### Knowledge / RAG
- Knowledge collections and ingestion.
- RAG bindings for chat and writing.
- Embedding and reranker model settings.
- Hybrid retrieval-oriented foundation.

### Providers
- OpenAI-compatible providers.
- KoboldCpp support.
- Custom endpoint adapters for non-OpenAI / non-Kobold backends.
- Separate models for translate / compress / TTS / RAG.

### Plugins / Extensions
- Toolbar tabs from plugins.
- Plugin widgets in chat, writing, and settings slots.
- Plugin actions in toolbar, messages, composer, and writing.
- Plugin settings, permissions, plugin-local storage.
- `Pluginfile` install/export.
- Plugin themes.
- Custom inspector fields.
- Custom endpoint adapters.

## Requirements
- Node.js + npm.
- Python 3 + Pillow for icon generation:

```bash
pip install pillow
```

Notes:
- `better-sqlite3` is native. Keep dev/build Node versions consistent.
- If native ABI breaks, run `npm run rebuild:native`.

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Start frontend + local API:

```bash
npm run dev
```

3. Open:

`http://localhost:1420`

## Electron Dev

```bash
npm run dev:electron
```

This builds Electron entrypoints, starts the local server, starts Vite, waits for health checks, then launches Electron.

## One-Click Bootstrap

macOS:

```bash
./setup-and-run-dev.sh
```

Windows:

```bat
setup-and-run-dev.bat
```

These scripts try to:
- install Node.js LTS,
- run `npm install`,
- start `npm run dev`.

## Build Desktop App

All desktop targets:

```bash
npm run dist
```

macOS only:

```bash
npm run dist:mac
```

Windows only:

```bash
npm run dist:win
```

Build output goes to `release/`.

## GitHub Actions

Workflow:
- `.github/workflows/build-desktop.yml`

What it does:
- builds macOS (`x64`, `arm64`) and Windows (`x64`) bundles,
- uploads artifacts,
- publishes GitHub Release assets on `v*` tag pushes.

## Plugins

Vellium now has a real plugin system.

Plugin capabilities:
- toolbar tabs,
- slot widgets,
- modal and inline actions,
- plugin-local settings,
- permission-gated API access,
- plugin themes,
- `Pluginfile` import/export.

Useful docs:
- `/Users/prplx/Documents/slv/docs/plugins/README.md`

Runtime plugin locations:
- user plugins: `/Users/prplx/Documents/slv/data/plugins`
- bundled plugins: `/Users/prplx/Documents/slv/data/bundled-plugins`

Important:
- plugins are local extensions, not a trusted public plugin marketplace model,
- plugin permissions should be reviewed before enabling write access,
- plugin settings and permissions are managed in `Settings -> Plugins`.

### Pluginfile

`Pluginfile` is the portable single-file plugin package format.

You can:
- install a plugin from `Settings -> Plugins -> Install Pluginfile`,
- export an existing plugin from `Settings -> Plugins -> Export Pluginfile`.

Bundled plugins can also be exported as `Pluginfile`.

## Themes

Vellium supports:
- built-in dark/light themes,
- plugin-provided themes.

Bundled theme pack:
- Catppuccin
  - Latte
  - Frappe
  - Macchiato
  - Mocha

Theme plugins also propagate into plugin UI kit styling.

## Extensions API

Vellium includes an extensions layer beyond normal plugins:
- custom inspector fields,
- custom endpoint adapters,
- unified plugin-side backend access through `vellium.generate(...)` and related SDK namespaces.

This makes it possible to:
- add inspector controls,
- integrate non-OpenAI / non-Kobold backends,
- build workflow plugins against a stable host-side contract.

## TTS

Vellium supports OpenAI-compatible TTS:
- configurable endpoint,
- model selection,
- voice selection,
- per-message TTS actions.

## App Icons

Generate icons:

```bash
npm run build:icons
```

Generated files:
- `build/icon.png`
- `build/icon.icns`
- `build/icon.ico`

## Useful Scripts
- `npm run dev` — frontend + server.
- `npm run dev:frontend` — Vite only.
- `npm run dev:server` — Express API only.
- `npm run dev:electron` — Electron + frontend + server.
- `npm run build` — frontend production build.
- `npm run build:server` — bundled server build.
- `npm run build:desktop` — full desktop build pipeline without publishing.
- `npm run rebuild:native` — rebuild `better-sqlite3`.
- `npm run test` — Vitest.

## Data Storage
- In dev: local `data/`
- In packaged app: `SLV_DATA_DIR` maps to Electron `userData/data`

## Troubleshooting

### `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION ...`
Cause: `better-sqlite3` was built against a different Node ABI.

Fix:

```bash
npm run rebuild:native
```

If needed, remove `node_modules` and reinstall.

### `EADDRINUSE: address already in use :::3001`
Cause: an old server process is still alive.

Fix:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
kill -TERM <pid>
```

### Blank window or long startup in packaged builds
Check:
- full desktop build was used,
- `server-bundle.mjs` is present,
- the bundled server reaches `/api/health`.

### Plugins do not load
Check:
- plugin is enabled in `Settings -> Plugins`,
- required permissions were granted,
- after changing plugin files, use `Reload Plugins`,
- after SDK/runtime changes, restart `npm run dev:electron`.

## Project Structure
- `src/` — React frontend
- `server/` — Express API
- `electron/` — Electron main + preload
- `scripts/` — build/dev helper scripts
- `docs/` — docs, plugin docs, assets
- `data/` — runtime data, user plugins, bundled plugins
- `build/` — electron-builder resources
- `release/` — packaged desktop output
