# Vellium

[![Latest release](https://img.shields.io/github/v/release/tg-prplx/vellium?display_name=tag&sort=semver)](https://github.com/tg-prplx/vellium/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/tg-prplx/vellium/total)](https://github.com/tg-prplx/vellium/releases)
[![Stars](https://img.shields.io/github/stars/tg-prplx/vellium?style=flat)](https://github.com/tg-prplx/vellium/stargazers)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

<img width="1440" height="913" alt="Vellium chat interface" src="https://github.com/user-attachments/assets/b81aeaa9-7f40-44e0-b739-deb6d91b8edf" />

Vellium is a local-first desktop workbench for AI chat, character roleplay, live
voice conversations, and long-form writing. It connects to OpenAI-compatible
APIs, OpenRouter, LM Studio, Ollama, KoboldCpp, and configurable custom
endpoints. Chats, characters, projects, settings, and knowledge collections are
stored locally in SQLite.

<p align="center">
  <a href="https://github.com/tg-prplx/vellium/releases/latest"><strong>Download for macOS, Windows, or Linux</strong></a>
  ·
  <a href="./docs/vellium/getting-started.md">Quick start</a>
  ·
  <a href="./docs/vellium/README.md">User guide</a>
</p>

> [!IMPORTANT]
> **Agents is deprecated.** It is disabled by default and is not a primary
> Vellium workspace. Existing agent threads and the implementation are retained
> for compatibility under **Settings → Legacy → Agents**. New workflows should
> use Chat, Writing, MCP tools, or plugins. See the
> [Legacy and Agents policy](./docs/vellium/legacy-and-agents.md).

## What Vellium includes

- **Chat and roleplay:** branching timelines, message editing, multiple
  characters, personas, LoreBooks, author notes, scene state, prompt blocks,
  translation, attachments, export, and controllable automatic turns.
- **Reasoning-aware context:** provider reasoning fields and `<think>` traces can
  be displayed, bounded, persisted, and optionally returned to the model as
  context. RP Reasoning is a separate simulated prompt mode.
- **Live voice:** microphone input, Whisper-compatible STT, streaming TTS, model
  and RP controls, attachments, screen context, and chat tools in Live mode.
- **Writing:** projects, chapters, scenes, Character Forge, summaries, rewrite
  and expansion actions, RAG context, DOCX import, and DOCX/Markdown export.
- **Characters and world data:** character-card import/editing, manual character
  ordering, multi-character participation, LoreBooks, and world-info import.
- **Knowledge and RAG:** collections, bounded ingestion, embeddings, optional
  reranking, and explicit bindings for Chat and Writing.
- **Providers:** OpenAI-compatible APIs, KoboldCpp, custom endpoint adapters,
  manual model fallbacks, job-specific model routing, and API parameter policy.
- **Tools and extensions:** MCP tool calls, structured image results, local
  plugins, themes, widgets, custom inspector fields, and desktop pets.
- **Local control:** SQLite persistence, Full Local Mode, provider URL checks,
  permission-gated plugins, and separate security gates for powerful legacy
  workspace tools.

The interface is translated into English, Russian, Chinese, and Japanese.

## Install a desktop build

Download the current artifacts from
[GitHub Releases](https://github.com/tg-prplx/vellium/releases/latest):

- macOS: Apple Silicon (`arm64`) and Intel (`x64`);
- Windows: `x64`;
- Linux: `x64` AppImage.

Release builds are currently unsigned. The operating system may require manual
confirmation on first launch. The release badge above is the source of truth;
this README deliberately does not hardcode a version number.

## Run from source

Requirements:

- Node.js 20 or newer;
- npm;
- Python 3 and Pillow only when regenerating application icons.

```bash
npm install
npm run dev
```

The development renderer runs at `http://127.0.0.1:1420` and proxies `/api` to
the Express server at `http://127.0.0.1:3002`.

Use the real desktop shell when testing Electron behavior:

```bash
npm run dev:electron
```

`better-sqlite3` is a native dependency. If Node or Electron reports an ABI
mismatch, rebuild it for the runtime you are about to use:

```bash
npm run rebuild:native
npm run rebuild:native:electron
```

## Build and package

```bash
npm run build:desktop
npm run dist:mac
npm run dist:win
npm run dist:linux
```

`build:desktop` compiles the renderer, server bundle, Electron main process, and
preload. Platform packages are written to `release/`. Pushing a `v*` tag starts
the multi-platform workflow in `.github/workflows/build-desktop.yml` and
publishes GitHub Release assets; do not use release tags as a local test command.

## Headless local web mode

```bash
npm run headless
```

This builds and serves the frontend and API at `http://127.0.0.1:3001` without
opening Electron. Public binding is opt-in and requires Basic Authentication.
See the [runtime and integration reference](./docs/vellium/runtime-and-integration-reference.md)
for flags and environment variables.

## Data and privacy

- Development data: `data/`.
- Packaged desktop data: `<Electron userData>/data` through `SLV_DATA_DIR`.
- Primary database: `vellum.db` (`sillytauri.db` remains a legacy fallback).
- API keys are masked at response boundaries, but local application data is not
  an encrypted vault by default. Protect the operating-system account and data
  directory accordingly.
- Full Local Mode blocks configured public provider endpoints; it does not turn
  untrusted plugins, MCP commands, or legacy workspace tools into safe code.

Do not commit `data/`, `output/`, `release/`, generated bundles, or imported user
assets.

## Settings and timeouts

Press `Ctrl+Shift+P` (`Cmd+Shift+P` on macOS) to search settings, jump to the
owning section, and highlight the target control.

Long operations do not share a hidden renderer-wide timeout. Endpoint discovery,
speech transcription, translation, MCP servers, and other bounded operations
have settings at the layer that owns them. Endpoint discovery and speech limits
are under **Settings → Generation → Runtime tuning**; each managed backend has
its own startup timeout under **Settings → Backends**.

## Plugins and MCP

Plugins are local extensions, not packages from a trusted marketplace. Review
their declared permissions before enabling them. Plugin management and
`Pluginfile` import/export live under **Settings → Tools & MCP → Plugins**.

MCP child processes are allowlisted and reject inline-eval launch forms. MCP can
still expose powerful tools, so enable only the servers and individual functions
you intend to use.

- [Plugin author guide](./docs/plugins/README.md)
- [Tool calls and generated media](./docs/vellium/tool-calls-and-media.md)
- [Plugins and security](./docs/vellium/plugins-and-security.md)

## Documentation

- [User guide and documentation map](./docs/vellium/README.md)
- [Getting started](./docs/vellium/getting-started.md)
- [Chat and roleplay](./docs/vellium/chat-and-rp.md)
- [Characters and LoreBooks](./docs/vellium/characters-and-lorebooks.md)
- [Writing](./docs/vellium/writing.md)
- [Knowledge and RAG](./docs/vellium/knowledge-and-rag.md)
- [Settings and providers](./docs/vellium/settings-and-providers.md)
- [Legacy and Agents](./docs/vellium/legacy-and-agents.md)
- [Troubleshooting](./docs/vellium/troubleshooting.md)

## Repository map

```text
src/       React renderer and shared contracts
server/    Express API, SQLite repositories, provider and MCP services
electron/  Desktop main process, preload bridge, managed backends, pets
scripts/   Development, architecture, native rebuild, and packaging helpers
docs/      User, runtime, security, and plugin documentation
```

The main verification commands are:

```bash
npm test
npm run check:architecture
npm run typecheck
npm run build
npm audit --audit-level=low
```

See [AGENTS.md](./AGENTS.md) for repository boundaries, invariants, and the
maintainer verification matrix.

## License

[MIT](./LICENSE)
