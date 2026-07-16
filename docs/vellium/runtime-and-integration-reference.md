# Runtime and Integration Reference

This page documents the repository-level runtime and integration functions that are
not part of the normal desktop onboarding flow. It is intended for maintainers,
plugin authors, and users running Vellium as a local web service.

## Headless mode

Headless mode runs the Express API and the already-built Vellium frontend in one
Node.js process. It does not open Electron or create a desktop window.

### Recommended command

From the repository root:

```bash
npm run headless
```

The script performs the following sequence:

1. `npm run build` validates the frontend and creates `dist/`.
2. `npm run build:server` creates `server-bundle.mjs`.
3. `node server-bundle.mjs --headless` starts the server with static frontend serving enabled.

The default URL is:

```text
http://127.0.0.1:3001
```

The process stays in the foreground. Stop it with `Ctrl-C`. The API remains under
`/api`, including the health endpoint at `/api/health`.

If the bundle is started directly without a current `dist/` directory, the API can
still start, but the static frontend cannot be served until the frontend is built.

### Direct invocation and options

After building the frontend and server, the bundle can be started directly:

```bash
node server-bundle.mjs --headless --port 3100
```

Supported options:

| Option | Effect |
| --- | --- |
| `--headless` | Marks the process as headless and enables static frontend serving. |
| `--serve-static` | Serves the built `dist/` frontend without changing the headless flag. |
| `--host HOST` or `--host=HOST` | Selects the bind host. The default is `127.0.0.1`. |
| `--port PORT` or `--port=PORT` | Selects the HTTP port. Static-serving mode defaults to `3001`; API-only mode defaults to `3002`. |
| `--allow-remote` / `--public` | Allows binding to a non-loopback host. |
| `--basic-auth USER:PASSWORD` / `--auth USER:PASSWORD` | Enables HTTP Basic Authentication. |

Public binding requires both `--allow-remote` and `--basic-auth USER:PASSWORD`.
The server refuses to bind to a non-loopback host without the explicit remote
flag, and refuses public mode without credentials.

Environment variables provide the same runtime settings:

| Variable | Equivalent setting |
| --- | --- |
| `SLV_HEADLESS=1` | Headless mode. |
| `SLV_SERVE_STATIC=1` or `ELECTRON_SERVE_STATIC=1` | Serve the built frontend. |
| `SLV_SERVER_HOST=HOST` | Bind host. |
| `SLV_SERVER_PORT=PORT` | HTTP port. |
| `SLV_SERVER_PUBLIC=1` | Allow remote/public mode. |
| `SLV_BASIC_AUTH=USER:PASSWORD` | Basic Authentication credentials. |
| `SLV_SERVER_AUTOSTART=1` | Starts the server when `server/index.ts` is imported by another process. |

Command-line options are applied after environment defaults, so an explicit CLI
option overrides the corresponding environment value.

### Runtime functions

The runtime option handling lives in [`server/runtimeConfig.ts`](../../server/runtimeConfig.ts):

| Function | Responsibility |
| --- | --- |
| `parseServerRuntimeOptions(argv, env)` | Reads CLI arguments and environment variables, applies defaults, validates host/auth combinations, and returns one normalized runtime object. |
| `applyServerRuntimeEnv(options, env)` | Publishes the normalized runtime object back into `SLV_*` variables so the app and Express layer use the same mode. |
| `formatServerUrl({ host, port })` | Produces the display/request URL and maps wildcard bind hosts such as `0.0.0.0` to a loopback URL for local access. |

`server/index.ts` contains `startServer(port, host)`. It starts the Express app,
logs the effective URL, and makes a short series of retries when the selected port
is already in use. Importing the module does not automatically start a server
unless it is the direct entry point or `SLV_SERVER_AUTOSTART=1` is set.

`createApp()` in [`server/app/createApp.ts`](../../server/app/createApp.ts) wires
the API, uploads, static frontend, origin checks, security headers, and optional
Basic Authentication together. Static serving is enabled only when the normalized
runtime state sets `SLV_SERVE_STATIC=1` or `ELECTRON_SERVE_STATIC=1`.

## MCP server lifecycle

MCP servers are launched as child processes over stdio. The implementation in
[`server/services/mcp.ts`](../../server/services/mcp.ts) performs this lifecycle:

1. Validate the configured command and reject blocked inline execution forms.
2. Parse arguments and `KEY=VALUE` environment lines.
3. Build a process environment with the shell/system executable paths included.
4. Detect or probe the stdio framing format.
5. Send MCP `initialize`, then `notifications/initialized`.
6. Request `tools/list` and expose the tools as OpenAI function definitions.
7. Send model calls back as MCP `tools/call` requests.
8. Reconnect once for recoverable process/timeout failures, then retry the call.

### MCP configuration behavior

The settings object uses these fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier used in generated function names. |
| `name` | Human-readable server name. |
| `command` | Executable to launch. |
| `args` | Shell-like argument string; quoted tokens are supported. |
| `cwd` | Optional working directory for the child process. |
| `env` | One `KEY=VALUE` entry per line; blank lines and `#` comments are ignored. |
| `enabled` | Disabled servers are skipped during discovery and preparation. |
| `timeoutMs` | Connection timeout is normalized to 1,000–120,000 ms; `mcp-remote` uses at least 45,000 ms. Tool calls use the positive configured value, or 15,000 ms when it is missing/invalid. |

Allowed executable names are `npx`, `node`, `bunx`, `uvx`, `python`, `python3`,
`deno`, `cmd`, `powershell`, and `pwsh`. Inline evaluation and package-management
forms are blocked for the supported shells/interpreters: Node/Deno `-e` or
`--eval`, Python `-c` and `-m pip`, PowerShell command/encoded-command flags, and
`cmd /c` or `/k`.

The stdio framing detector prefers JSONL for `mcp-remote` and JavaScript/TypeScript
launches through Node-compatible runners. It also probes both JSONL and
Content-Length framing before using the full initialize timeout, because a regular
JavaScript file can still speak Content-Length MCP.

### MCP functions

| Function | Responsibility |
| --- | --- |
| `isAllowedMcpCommand(raw)` | Checks whether the executable basename is in the MCP allowlist. |
| `describeBlockedMcpLaunch(command, args)` | Returns a user-facing reason when a command or argument form is rejected; an empty string means allowed. |
| `prepareMcpTools(servers, options)` | Connects enabled servers, discovers their tools, creates unique OpenAI-compatible names, returns diagnostics, and exposes `executeToolCall` plus `close`. Failed servers are reported in diagnostics without preventing other servers from loading. |
| `discoverMcpToolCatalog(servers, options)` | Performs best-effort tool discovery for the Settings catalog and closes each temporary client. |
| `testMcpServerConnection(server, signal)` | Connects to one server, lists its tools, and returns `{ ok, tools, error? }` for the Settings test action. |
| `McpStdioClient.initialize()` | Performs the MCP handshake using protocol version `2024-11-05`. |
| `McpStdioClient.listTools()` | Requests `tools/list` and returns the server's tool descriptors. |
| `McpStdioClient.callTool(name, args, timeoutMs)` | Sends `tools/call` with an object-valued `arguments` payload. |

Generated model-facing names use the form
`mcp_<sanitized-server-id>__<sanitized-tool-name>`. Names are capped at 64
characters; collisions receive a numeric suffix.

## MCP image results

The public payload contract and UI states are documented in
[Tool Calls and Generated Images](./tool-calls-and-media.md). The source-level
normalization functions behave as follows:

| Function | Behavior |
| --- | --- |
| `normalizeToolMediaItems(raw)` | Accepts an array, keeps only objects with `type: "image"` and a non-empty `url`, and normalizes optional `markdown` and `alt` fields. `alt` falls back to `text`. |
| `extractSpecialToolExecutionResult(result)` | Reads `structuredContent.vellium.media`, then `structuredContent.media`, then `structuredContent.images`; returns a short model summary plus a `vellium_media_result` trace when at least one image is valid. |
| `normalizeToolExecutionResult(result)` | Uses the special media path when recognized; otherwise converts the regular MCP content into text and caps the returned model/trace text at 24,000 characters. |
| `appendMissingToolImageMarkdown(content, toolTraces)` | Adds image Markdown omitted by the model, deduplicating by the exact image URL. |
| `parseToolResultDisplay(rawResult)` | Converts a serialized `vellium_media_result` trace into the chat preview model; malformed or ordinary tool results remain text-only. |

For the accepted JSON shape, precedence rules, URL behavior, and troubleshooting,
use the [MCP response contract](./tool-calls-and-media.md#mcp-response-contract).
