# AGENTS.md — Vellium contributor and coding-agent guide

This file applies to the entire repository. It is the first technical map an agent
should read before changing Vellium. More specific documentation under `docs/`
explains user-facing behavior; this file focuses on implementation boundaries,
invariants, safe workflows, and verification.

## 1. Product and runtime model

Vellium is a local-first AI workbench for:

- character chat and multi-character roleplay;
- branching conversations, personas, LoreBooks, RAG, attachments, tool calls,
  reasoning traces, translation, TTS, and chat export;
- long-form writing with projects, chapters, scenes, summaries, and DOCX/Markdown;
- OpenAI-compatible, KoboldCpp, local, and custom provider adapters;
- plugins, MCP tools, endpoint extensions, and an optional desktop pet;
- a deprecated Agents workspace that remains available through Settings > Legacy.

The application has four cooperating runtimes:

1. React + TypeScript renderer in `src/`.
2. Express API in `server/`.
3. SQLite persistence through `better-sqlite3`.
4. Electron desktop shell in `electron/`.

The browser development topology is:

```text
React/Vite http://127.0.0.1:1420
        │ /api proxy
        ▼
Express   http://127.0.0.1:3002
        │
        ▼
SQLite + providers + MCP + local files
```

In packaged Electron and headless static mode, Express serves both `dist/` and
`/api`, normally from `http://127.0.0.1:3001`. Electron loads that HTTP URL; it
does not normally load the production UI directly from `file://`.

## 2. Start every task safely

Before editing:

1. Run `git status --short` and preserve unrelated user changes.
2. Identify the smallest owning subsystem and read its route, service/repository,
   client, contract, UI, and existing tests before introducing a second path.
3. Search with `rg`; do not assume a feature is absent from a large screen.
4. Treat `data/`, `output/`, `release/`, `dist/`, `dist-electron/`, generated
   bundles, and user-imported assets as user or generated state. Do not modify,
   delete, or commit them unless the task explicitly requires it.
5. Do not create commits, tags, releases, or pushes unless explicitly requested.
6. If asked to checkpoint before risky work, make the checkpoint first and keep
   the later hardening/refactor in a separate commit.

Use focused patches and avoid broad mechanical rewrites of dirty files. Existing
uncommitted changes belong to the user unless their provenance is certain.

## 3. Repository map

### Renderer: `src/`

- `src/App.tsx` — app shell, lazy screen loading, navigation groups, plugin tabs,
  Settings/Legacy routing, global display settings, and persistent Chat mounting.
- `src/features/chat/` — chat/RP UI, hooks, derived state, message rendering,
  attachments, branches, streaming, and chat export.
- `src/features/writer/` — books, character forge, projects, chapters, scenes,
  writing tasks, exports, and writing-side context.
- `src/features/characters/` — character library, import/editing, and manual order.
- `src/features/lorebooks/` — LoreBook and world-info editing/import/export.
- `src/features/knowledge/` — RAG collections and documents.
- `src/features/settings/` — providers, runtime behavior, appearance, security,
  tools, plugins, and the embedded Legacy section.
- `src/features/legacy/` — deprecated interface/Agents controls. Agents are not a
  normal top-level core tab; they are opened from Settings > Legacy when enabled.
- `src/features/agents/` — deprecated Agents implementation retained behind the
  Legacy surface. Its API/runtime still has tests and must remain functional.
- `src/features/pets/` — desktop pet configuration and renderer-side integration.
- `src/features/plugins/` — plugin frames, slots, actions, and renderer security.
- `src/components/` — reusable UI primitives and the global task manager.
- `src/shared/api/` — typed API clients split by domain. `src/shared/api.ts`
  combines them into the `api` object.
- `src/shared/types/contracts.ts` — main renderer/server JSON contracts.
- `src/shared/types/chatExport.ts` — stable chat export contract.
- `src/shared/backgroundTasks.ts` — long-running task registry used by global UI.
- `src/shared/i18n.ts` and `src/shared/locales/` — localization infrastructure and
  dictionaries for English, Russian, Chinese, and Japanese.
- `src/styles.css` — theme tokens, app chrome, responsive behavior, glass/fallback
  surfaces, and feature-specific styling beyond utility classes.

### API and persistence: `server/`

- `server/index.ts` — parses runtime options and starts the server with short
  retry handling for an occupied port.
- `server/runtimeConfig.ts` — CLI/env normalization for API-only, headless,
  loopback, public, and Basic Auth modes.
- `server/app/createApp.ts` — Express composition root, request security headers,
  origin policy, uploads, static frontend, health route, and all route mounts.
- `server/app/createApp.integration.test.ts` — broad end-to-end API regression
  suite using an isolated temporary data directory and local mock providers.
- `server/routes/` — HTTP validation and response handling by domain.
- `server/modules/chat/` — prompt/context construction, provider streaming,
  reasoning, MCP tooling, chat repository, branches, attachments, and export.
- `server/modules/writer/` — writing persistence, context, LLM actions, lenses,
  DOCX, and export.
- `server/modules/agents/` — deprecated Agents repository and runtime.
- `server/services/` — provider transport, custom adapters, RAG, MCP, plugins,
  extensions, workspace tools, unified generation, and security policies.
- `server/domain/` — RP, LoreBook, and writer domain logic that should stay less
  coupled to Express.
- `server/db.ts` — database initialization, WAL mode, schema/migrations/defaults,
  backfills, shared DB helpers, IDs, timestamps, and token estimates.
- `server/db/schema.ts` — create-table and index declarations for new databases.
- `server/db/migrations.ts` — idempotent compatibility migrations for existing
  databases.
- `server/db/defaultSettings.ts` — settings defaults and default-prompt migration.
- `server/db/paths.ts` — development/packaged data paths.

### Desktop: `electron/`

- `electron/main.ts` — main window, bundled server startup, IPC, file saves,
  external navigation, screenshots, desktop pet windows, and lifecycle.
- `electron/preload.ts` — narrow renderer bridge exposed as `window.electronAPI`.
- `electron/security.ts` — trusted sender and navigation rules.
- `electron/managedBackends.ts` — managed local backend lifecycle.
- `electron/desktopPet/` — isolated pet HTML and types.

### Build, documentation, and extensions

- `scripts/check-architecture.cjs` — line budgets, cross-feature import rules,
  and cycle detection. This is a required gate, not an advisory linter.
- `scripts/ensure-better-sqlite3.cjs` — native addon readiness for Node runtime.
- `scripts/ensure-dev-port.cjs` — avoids stale development server collisions.
- `scripts/run-dist.cjs` — native rebuild and Electron packaging orchestration.
- `.github/workflows/build-desktop.yml` — Node 20 CI for macOS arm64/x64,
  Windows x64, Linux AppImage, and tag-driven GitHub Releases.
- `docs/vellium/` — user and maintainer documentation.
- `docs/plugins/` — plugin author documentation and example.
- `bundled-plugins/` — plugins packaged under Electron `extraResources`.

## 4. HTTP route ownership

`createApp()` mounts these route families:

| Prefix | Owning file | Responsibility |
| --- | --- | --- |
| `/api/agents` | `routes/agents.ts` | Deprecated Agents threads/runs/tools |
| `/api/account` | `routes/account.ts` | Local account and recovery |
| `/api/settings` | `routes/settings.ts` | Settings payload and normalization |
| `/api/plugins` | `routes/plugins.ts` | Plugin catalog/install/assets |
| `/api/plugin-runtime` | `routes/pluginRuntime.ts` | Permission-gated plugin calls |
| `/api/providers` | `routes/providers.ts` | Providers, models, tests, previews |
| `/api/extensions` | `routes/extensions.ts` | Endpoint adapters/extensions |
| `/api/chats` | `routes/chats.ts` | Chats, branches, streaming, export |
| `/api/messages` | `routes/messages.ts` | Message edit/delete operations |
| `/api/rp` | `routes/rp.ts` | Scene state, author note, prompt blocks |
| `/api/characters` | `routes/characters.ts` | Character CRUD/import/order |
| `/api/lorebooks` | `routes/lorebooks.ts` | LoreBook CRUD/import/export |
| `/api/rag` | `routes/rag.ts` | Collections, ingestion, retrieval |
| `/api/writer` | `routes/writer.ts` | Projects, scenes, generation, export |
| `/api/personas` | `routes/personas.ts` | User persona CRUD/default |

New endpoint work normally needs all of:

1. input normalization in the route;
2. repository/service/domain implementation;
3. typed response/request shape in shared contracts when renderer-visible;
4. a method in the correct `src/shared/api/*Client.ts` file;
5. UI state/error handling;
6. integration or focused unit regression tests.

Do not bypass server-owned behavior by reconstructing durable data only in the
renderer. Chat JSON export, for example, is server-generated so branches,
attachments, RAG sources, prompt blocks, participants, and scene state agree.

## 5. Database rules

Development data defaults to `data/`. Packaged Electron sets `SLV_DATA_DIR` to
`<userData>/data`. Tests set it to a temporary directory before importing DB code.
The current DB filename is `vellum.db`; `sillytauri.db` is recognized as a legacy
fallback.

Critical rules:

- Never modify a user's SQLite file manually during normal implementation.
- Add new columns/tables to both schema and migrations when old databases need
  them. Migrations must be repeatable and safe on partially upgraded databases.
- Use transactions for multi-row reorder, fork, cascade, and delete operations.
- Preserve deterministic order. Chat messages use `sort_order` per branch;
  characters use manual `sort_order`. Do not fall back to incidental SQL order.
- A chat branch contains copied history through its fork point. Branch deletion
  must not damage remaining branch timelines and the last branch is protected.
- Keep serialized JSON backward-compatible and normalize malformed/old values at
  the boundary instead of assuming the latest shape.
- `foreign_keys = ON` is enabled, but not every historical relationship is backed
  by a database foreign key. Repository-level cleanup still matters.
- Do not silently reset the entire settings payload because one optional field is
  invalid. Merge and normalize field-by-field when possible.

When testing persistence, prefer the isolated integration suite or set a temporary
`SLV_DATA_DIR`. Never point automated tests at the normal development database.

## 6. Chat, prompt, reasoning, and branch invariants

Chat is the most regression-sensitive subsystem. Preserve these invariants:

### Prompt assembly

- Provider chat templates should receive one combined system message at the
  beginning, not multiple adjacent system messages in arbitrary positions.
- Prompt blocks, base system prompt, character/persona information, scene state,
  author note, summaries, RAG, and runtime additions are assembled server-side.
- `{{char}}` and `{{user}}` must be resolved using the active character/speaker and
  active user persona. Multi-character turns may have a different active speaker.
- Provider-specific formatting belongs in provider message/transport helpers, not
  in React components.
- Preserve valid assistant/tool relationships when merging or filtering messages;
  some provider chat templates reject orphaned or incorrectly ordered tool rows.

### Default prompt migration

`server/db/defaultSettings.ts` contains:

- `LEGACY_DEFAULT_SYSTEM_PROMPT`;
- `PREVIOUS_DEFAULT_SYSTEM_PROMPT`;
- `DEFAULT_SYSTEM_PROMPT`;
- `migrateDefaultSystemPrompt()`.

When changing the default prompt, migrate only exact known previous defaults or a
missing/non-string value. Never overwrite a user-edited system prompt during an
upgrade. Add the outgoing default as another recognized value if a future default
is introduced, and cover both migration and custom-value preservation with tests.

### Reasoning

- `includeReasoningInContext` defaults to enabled.
- Reasoning can arrive as provider reasoning fields, streamed reasoning deltas,
  `<think>...</think>`, or the internal `__reasoning__` trace.
- Display normalization and context reconstruction are related but not identical.
  Do not expose raw protocol wrappers in the visible assistant message.
- Bound retained reasoning using `reasoningMaxChars`; do not let it consume the
  whole context window.
- Never assume OpenAI-style reasoning arrives in ordinary `message.content`.

### Branches and message operations

- Branch list/rename/delete/fork persistence lives in
  `server/modules/chat/repository.ts`; branch routes live in `routes/chats.ts`.
- The UI branch manager is in `features/chat/components/BranchManager.tsx`, while
  async state is in `features/chat/hooks/useBranchManagement.ts`.
- Switching branches reloads the selected timeline. Generation actions must use
  the current branch ID.
- Forking copies visible source history through the selected message into a new
  branch with new message IDs.
- Editing or deleting a message must return/reload the affected branch timeline;
  do not mutate another branch by accident.
- Do not allow switching/deleting state to race an active stream. UI controls for
  destructive branch operations should be disabled while generation is busy.

### Multi-character chat

- Preserve ordered participant IDs from the chat, not arbitrary database row order.
- Persist explicit speaker names on user/assistant rows where required.
- Export must include participants, speakers, branches, and messages per branch.
- Auto-conversation is a controllable long-running task: abort, busy state, delay,
  and remaining-turn UI must stay coherent.

## 7. Long-running tasks and stability

Translation, export, writing generation, auto-conversation, ingestion, provider
loading, and agent runs must not make the application look frozen.

- Register user-visible work through `src/shared/backgroundTasks.ts` when it should
  appear in the global task manager.
- Use stable task IDs/scopes and always finish or fail tasks in `finally` paths.
- Use `AbortController` for cancellable network/provider work and do not swallow an
  abort as a generic failure.
- Prevent duplicate actions while the same operation is active.
- Keep active work tied to its chat/project/message ID, not only to the currently
  visible screen. Navigating away must not corrupt where results are applied.
- Prefer targeted state updates after success; use authoritative server reloads
  after branch/history mutations.
- Clean up timers, object URLs, audio, event listeners, and stream controllers on
  unmount or completion.
- Do not add aggressive polling or animation loops. CPU regressions in Electron
  often come from unbounded effects, repeated state churn, observers, or filters.

## 8. Renderer and UX conventions

- Keep core behavior usable in both the normal and Simple Mode chat layouts.
- Reuse shared components (`IconButton`, `ModalShell`, panel/form primitives) and
  existing theme tokens before creating another component system.
- Use real icons with accessible labels/tooltips for icon-only actions.
- Do not nest buttons or place action controls inside another clickable button.
- Menus/popovers must close on outside click and Escape where appropriate, stay
  above adjacent panels, and avoid being clipped by an overflow ancestor.
- Empty/loading/error/busy/disabled states are part of the feature, not polish to
  defer.
- Lists with large content should own an internal scroll region. Avoid making an
  entire three-panel editor grow without bound.
- Search/filter state should not silently mutate ordering or selection.
- Preserve selection when refreshed entities still exist; choose a deterministic
  fallback when an active entity was deleted.
- Keep semantic labels and keyboard behavior. Do not rely only on color to show an
  active item.

### Localization

All new user-visible strings must be added to:

- `src/shared/locales/en.ts` — canonical key set;
- `src/shared/locales/ru.ts`;
- `src/shared/locales/zh.ts`;
- `src/shared/locales/ja.ts`.

`TranslationKey` is derived from English. Missing non-English values fall back to
English, but shipping an intentionally visible feature with only English strings
is discouraged. Keep placeholders such as `{name}` identical across locales.

### Styling and packaged blur

Vite/browser rendering is not sufficient proof for Electron packaging. For glass
or translucent surfaces:

- provide an opaque/semitransparent background fallback in addition to
  `backdrop-filter` and `-webkit-backdrop-filter`;
- do not make a surface fully transparent when compositor blur is unavailable;
- verify CSS stacking/overflow and the real packaged macOS application when a bug
  is distribution-only;
- keep the main Electron window opaque unless a deliberate, tested shell redesign
  requires transparency. The current main window uses a solid background color;
  the desktop pet window is intentionally transparent.

## 9. Feature boundaries and architecture budget

`npm run check:architecture` enforces import cycles, feature boundaries, and line
budgets. Cross-feature imports must go through the target feature's `public.ts`,
except the plugin host integration explicitly allowed by the checker.

Current production line budgets:

| File | Maximum lines |
| --- | ---: |
| `server/modules/agents/runtime.ts` | 3810 |
| `src/features/chat/ChatScreen.tsx` | 3790 |
| `src/features/settings/SettingsScreen.tsx` | 3020 |
| `src/features/writer/WritingScreen.tsx` | 2780 |
| `src/features/agents/AgentsScreen.tsx` | 2600 |
| `electron/main.ts` | 1480 |
| `src/shared/types/contracts.ts` | 1020 |
| other production TypeScript files | 1800 |

Do not solve a budget failure by raising the budget unless the user explicitly
requests a temporary exception and the architecture genuinely requires it.
Instead:

- extract presentational UI to `components/`;
- extract stateful behavior to hooks;
- move pure calculations to `utils.ts` or `derived.ts`;
- move server persistence to repository modules;
- move provider/protocol behavior to services/modules;
- split Electron helpers by responsibility.

Large existing screens are composition roots, not the preferred home for new
feature implementations.

## 10. Provider and model integration

- Provider CRUD/model discovery is server-owned. The renderer should call
  `providerClient`, not fetch arbitrary endpoints directly.
- Fix flaky model loading in server transport, timeout, retry, and connection
  handling rather than piling retries into UI effects.
- Respect Full Local Mode and request-security checks before outbound requests.
- Provider capability differences belong in `providerApi.ts`,
  `customProviderAdapters.ts`, `apiParamPolicy.ts`, `unifiedGeneration.ts`, and
  chat provider helpers.
- Some providers reject unsupported sampling fields. Forward parameters only when
  allowed by the configured API parameter policy.
- Stream parsing must handle partial chunks and termination without losing an
  already-produced assistant response.
- Translation, compression, TTS, RAG, and normal chat may use different selected
  providers/models. Do not substitute the active chat model blindly.
- Use local mock provider servers in tests. Do not make real billable network calls
  from the automated suite.

## 11. RAG, files, MCP, plugins, and workspace tools

### Attachments and RAG

- Uploads are bounded and extension-filtered in `createApp.ts`.
- Unsafe active formats such as HTML/SVG/JS are blocked by default and served as
  downloads when explicitly allowed.
- Preserve `nosniff`, content disposition, and cross-origin resource headers.
- Text extraction is bounded. Do not place unlimited PDF/DOCX/text into prompts.
- RAG collection scope and chat/writer bindings must remain explicit.

### MCP

- MCP child-process command allowlisting and inline-eval blocking are security
  boundaries. Do not weaken them to make one server easier to launch.
- Support both JSONL and Content-Length framing through the existing lifecycle.
- Always close temporary MCP clients after discovery/test/generation.
- Normalize tool results, including media, before sending them back to a model or
  renderer. Bound tool text retained in context.

### Plugins

- Treat plugin manifests, frames, actions, assets, and stored settings as
  untrusted local extension content.
- Enforce declared permissions in server and renderer bridges.
- Do not let plugin frames inherit the main app's unrestricted API surface.
- Bundled plugin packaging must remain covered by `extraResources` and CI checks.

### Agents/workspace tools

- Agents are deprecated but supported through Settings > Legacy and disabled by
  default (`agentsEnabled: false`). Do not remove persisted threads or API behavior
  while merely changing navigation/deprecation UX.
- Workspace roots, path containment, command classes, destructive operations,
  network commands, shell commands, and git writes have separate gates.
- Preserve confirmation semantics and regression tests for dangerous operations.
- Do not broaden a safe tool into an arbitrary shell escape.

## 12. Security boundaries

Changes in these files require adversarial review and focused tests:

- `server/app/requestOrigin.ts`;
- `server/services/requestSecurity.ts`;
- `server/services/pluginSecurity.ts`;
- `server/services/workspaceTools.ts`;
- `server/services/mcp.ts`;
- `electron/security.ts`;
- IPC handlers in `electron/main.ts` and exposure in `electron/preload.ts`.

Preserve these guarantees:

- API requests are restricted to allowed origins in local mode.
- Public/non-loopback binding requires explicit opt-in and Basic Auth.
- CSP, frame restrictions, `nosniff`, permissions policy, and no-store API headers
  are not removed as a convenience workaround.
- Electron IPC validates the sender and bounds/sanitizes file and URL payloads.
- New external navigation is denied unless explicitly allowlisted.
- Provider URLs are validated against local/security mode policies.
- API keys are masked at response boundaries and never logged in tests or errors.
- Uploads, plugin assets, and tool output cannot become silent script execution.

`npm audit` is only the dependency gate. A security review must also inspect trust
boundaries and add proof/regression tests for any demonstrated bypass.

## 13. Development commands

Install and run:

```bash
npm install
npm run dev              # Vite 1420 + API 3002
npm run dev:electron     # real Electron shell in development
```

Core verification:

```bash
npm test
npm run check:architecture
npm run typecheck
npm run build
npm audit --audit-level=low
```

Desktop/headless verification:

```bash
npm run build:desktop
npm run headless
npm run dist:mac
npm run dist:win
npm run dist:linux
```

Native addon recovery:

```bash
npm run rebuild:native
npm run rebuild:native:electron
```

`better-sqlite3` is native. A binary compiled for Electron may fail under the Node
test runtime and vice versa. If tests report an ABI/architecture mismatch, rebuild
for Node with `npm run rebuild:native`; use the Electron rebuild command for the
desktop shell. Do not diagnose this as an application logic regression first.

## 14. Verification matrix

Use the smallest relevant checks during iteration, then the proportional final
gate. Recommended minimums:

| Change type | Minimum focused checks | Final checks |
| --- | --- | --- |
| Pure renderer utility | adjacent unit tests | `npm run build` |
| UI component/state | focused tests + visual interaction | `npm test`, `npm run build` |
| Route/repository/schema | focused integration test | `npm test`, `npm run build` |
| Prompt/provider/streaming | provider/message tests + integration | `npm test`, `npm run build` |
| Security boundary | exploit regression + related tests | full tests, build, audit |
| Electron IPC/window | typecheck + real Electron smoke test | `build:desktop`; package when relevant |
| Packaging-only/macOS visual | real packaged app | `dist:mac` when feasible |
| Release | clean tree review + full build/test | tag-driven CI on all platforms |

For UI work, verify from the user's point of view:

- initial state;
- success state;
- empty/loading/error/disabled state;
- rapid repeated click protection;
- navigation away and back;
- narrow layout/overflow when relevant;
- both Simple and normal mode when the feature appears in both.

For server work, verify status codes and persisted state, not just response shape.

## 15. Testing conventions

- Vitest is the test runner.
- Small pure logic tests live beside the source as `*.test.ts`/`*.test.tsx`.
- Cross-route behavior belongs in `server/app/createApp.integration.test.ts`.
- The integration suite is sequential because it shares one temporary app/server
  fixture and mock services.
- Prefer authoritative assertions on DB/API/UI state over timing-only waits.
- Use local mock HTTP/MCP services for provider and tool behavior.
- Cover old serialized/settings shapes when adding migrations or normalization.
- A bug fix should include a regression test that fails for the original cause,
  not merely a new happy-path test.

## 16. Release and packaging notes

- `npm run build` creates the renderer only.
- `npm run build:desktop` additionally builds icons, server bundle, Electron main,
  and preload.
- `npm run dist:*` packages with electron-builder into `release/`.
- Package contents include `dist/`, `dist-electron/`, `server-bundle.mjs`, and
  bundled plugins as `extraResources`.
- CI uses Node 20 and Python 3.11 + Pillow.
- Pushing a `v*` tag triggers macOS, Windows, and Linux artifacts and publishes a
  GitHub Release. Do not push a tag merely to test a local build.
- Releases are currently unsigned; do not claim notarization/signing that the
  workflow does not perform.

## 17. Common failure modes

- **Characters exist but list is empty:** check derived filtering/profile-type
  logic and stale selection state before suspecting database loss.
- **Ordering changes after refresh:** ensure API queries and writes use explicit
  `sort_order`, and reorder operations are transactional.
- **A task runs but is invisible/uncontrollable:** integrate it with background
  tasks, stable IDs, abort handling, and completion cleanup.
- **One click leaves UI hung:** check duplicate submissions, unresolved promises,
  stream finalization, and disabled/busy state cleanup in `finally`.
- **Provider models intermittently fail:** inspect server request timeout/retry and
  connection handling before adding UI polling.
- **Chat template fails:** inspect the final provider message array for one leading
  combined system message and valid assistant/tool ordering.
- **Reasoning disappears:** inspect provider-specific reasoning fields, stream
  deltas, normalization, persistence, and `includeReasoningInContext` separately.
- **Custom prompt resets after update:** the default-prompt migration matched too
  broadly. Only exact historical defaults may be upgraded.
- **Blur surfaces become transparent in packaged macOS:** add a surface color
  fallback and verify the packaged compositor/window configuration.
- **Tests fail loading `better-sqlite3`:** rebuild the native addon for the runtime
  currently executing tests.
- **Architecture gate fails after a small feature:** extract the new behavior; do
  not increase the large-file budget reflexively.
- **Feature works in browser but not Electron:** test IPC availability, production
  server URL, packaged resources, CSP, and native ABI in the desktop shell.

## 18. Completion checklist

Before reporting a task complete:

- [ ] User-visible acceptance criteria are implemented, not only described.
- [ ] Unrelated dirty files and generated/user data are untouched.
- [ ] API, persistence, types, client, UI, and localization agree.
- [ ] Busy/error/empty/cancel states are handled where applicable.
- [ ] Relevant regression tests were added or updated.
- [ ] `git diff --check` passes.
- [ ] Architecture and type checks pass.
- [ ] Full tests/build were run in proportion to risk.
- [ ] Real UI or packaged behavior was checked when the bug is visual/runtime-only.
- [ ] No security boundary was weakened for convenience.
- [ ] Final report distinguishes code/build success from real end-to-end proof.

