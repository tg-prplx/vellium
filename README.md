# SillyTauri (Tauri v2 + React + TypeScript)

Desktop MVP scaffold for an RP/NSFW-oriented chat app with a separate Creative Writing mode.

## Stack
- Tauri v2 (Rust backend)
- React + TypeScript (frontend)
- Tailwind CSS
- SQLite (single local DB; schema prepared for encrypted backend integration)

## Implemented in this iteration
- 4 top-level tabs: `Chat`, `Creative Writing`, `Characters`, `Settings`
- 3-panel desktop layout for Chat and Writing
- Rust command surface for account/settings/providers/chat/rp/characters/writer
- Full Local Mode network gate logic (`localhost` only when enabled)
- RP scene state + author note persistence
- Chat operations: create/list/send/edit/delete/regenerate/fork
- Character `chara_card_v2` validate/import/export/upsert
- Creative Writing entities: projects/chapters/scenes + consistency check + export
- Event emissions:
  - `writer.generation.delta`
  - `writer.generation.done`
  - `writer.consistency.report_ready`
- Unit tests:
  - prompt ordering
  - localhost gate
  - sample `chara_card_v2` fixture validation

## Project structure
- `src/` frontend app
- `src/shared/types/contracts.ts` shared frontend contracts
- `src-tauri/src/commands.rs` backend command API
- `src-tauri/src/storage.rs` schema + persistence helpers
- `src-tauri/src/domain/rp_engine` prompt orchestration
- `src-tauri/src/domain/writer_engine` consistency logic

## Current caveats
- API generation in `chat_send` is currently scaffolded text and not yet wired to live OpenAI-compatible streaming transport.
- Database encryption currently uses plain SQLite in this scaffold; SQLCipher integration is the next backend hardening step.
- DOCX export currently writes text payload as `.docx` placeholder.

## Running locally
1. Install JS deps:
   - `npm install`
2. Run web dev:
   - `npm run dev`
3. Run desktop app:
   - `npm run tauri dev`

## Fixture used for character tests
- `/Users/prplx/Documents/slv/main_this-is-our-spot-leave-5070bac83080_spec_v2.json`
