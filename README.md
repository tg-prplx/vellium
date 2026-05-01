# Vellium

<p align="center">
  <img width="1439" height="854" alt="image" src="https://github.com/user-attachments/assets/b4f68d1a-1c12-4abc-b810-1280f3ef49cb" />
</p>
<p align="center"><strong>Desktop AI chat, RP, writing, RAG, agent, and plugin workbench.</strong></p>

Desktop app built with Electron, React, a local Express API, and SQLite.

<img width="1440" height="857" alt="image" src="https://github.com/user-attachments/assets/03e75de3-5b39-4012-98f8-4c959eb1fc80" />

## Current Release

- Latest release: [`v0.9.7`](https://github.com/tg-prplx/vellium/releases/tag/v0.9.7)
- Desktop builds: macOS (`arm64`, `x64`), Windows (`x64`), Linux (`x64` AppImage).
- Release builds are unsigned. macOS and Windows may require manual confirmation on first launch.
- The app is usable day to day, but still moving quickly. Expect active iteration around Agents, tool calling, and provider compatibility.

## User Documentation

- Detailed user guide: [`docs/vellium/README.md`](./docs/vellium/README.md)


## Important
- Use `npm run dev` for day-to-day development.
- Use `npm run dev:electron` when testing the real desktop shell.
- Use `npm run dist:mac`, `npm run dist:win`, or `npm run dist:linux` for platform bundles.
- CI publishes GitHub Release assets when a `v*` tag is pushed.
- Local data is stored in `data/` during development and in the Electron user-data directory in packaged builds.

## Stack
- Electron
- React + TypeScript + Vite
- Express
- SQLite + `better-sqlite3`
- Tailwind CSS

## Core Features

### Agents
- Dedicated `Agents` workspace with ask, build, and research modes.
- Workspace tools for listing, reading, searching, editing, moving, deleting, and diffing files.
- Optional command execution for tests/builds, with separate security gates for shell-like commands, network commands, destructive file operations, and git writes.
- OpenAI-compatible structured planning with JSON-schema responses when supported.
- Mid-run corrections, abort/resume/retry, event traces, reasoning traces, and partial-response recovery.
- Context management for long agent threads, including auto-compaction, continuation cues, duplicate read-only call guards, and stale-run cleanup after edits/deletes.

### Chat / RP
- Branching chat history.
- Edit, delete, resend, regenerate.
- Multi-character chats with auto-turns.
- RP controls: prompt stack, author note, scene state, presets, personas.
- LoreBook / World Info support, including SillyTavern-compatible world info import/export.
- Reasoning support, including streamed reasoning fields and `<think>...</think>` parsing.
- Vision attachments and chat attachments.
- MCP tool calling for OpenAI-compatible chat/completions providers, with text-tool-call fallback parsing for providers that do not emit native tool calls cleanly.

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
- Presets for OpenAI, LM Studio, Ollama, KoboldCpp, OpenRouter, and custom OpenAI-compatible endpoints.
- Manual fallback models for providers whose `/models` endpoint is missing, empty, or provider-specific.
- Separate models for translate / compress / TTS / RAG.
- API parameter forwarding controls for providers that reject unsupported sampling fields.

### Plugins / Extensions
- Toolbar tabs from plugins.
- Plugin widgets in chat, writing, and settings slots.
- Plugin actions in toolbar, messages, composer, and writing.
- Plugin settings, permissions, plugin-local storage.
- `Pluginfile` install/export.
- Plugin themes.
- Custom inspector fields.
- Custom endpoint adapters.

<img width="1121" height="705" alt="image" src="https://github.com/user-attachments/assets/ec1b69b0-b8b0-4ca7-b3be-54a4c8f7ee03" />


## Requirements
- Node.js + npm. Node.js 20+ is recommended because CI builds with Node 20.
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

Linux AppImage only:

```bash
npm run dist:linux
```

Build output goes to `release/`.

## GitHub Actions

Workflow:
- `.github/workflows/build-desktop.yml`

What it does:
- builds macOS (`x64`, `arm64`), Windows (`x64`), and Linux (`x64` AppImage) bundles,
- uploads workflow artifacts,
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
- [`docs/plugins/README.md`](./docs/plugins/README.md)

Runtime plugin locations:
- user plugins: `data/plugins`
- bundled plugins: `data/bundled-plugins`

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
- `npm run dist` — package all desktop targets supported by the current host/CI runner.
- `npm run dist:mac` / `npm run dist:win` / `npm run dist:linux` — package a specific desktop target.
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
