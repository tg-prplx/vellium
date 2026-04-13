# Troubleshooting

This section helps you diagnose the most common Vellium problems quickly.

## Fast triage checklist

Check these first:

1. Is there a saved provider profile?
2. Is an active model assigned?
3. Is `local-only mode` blocking the endpoint?
4. Is the current provider type unsupported for the feature you want?
5. Are the required collections, plugins, or MCP servers configured?

## Common problems

| Symptom | Common cause | What to do |
| --- | --- | --- |
| Chat says no active model is configured | `active provider/model` is missing | Open `Settings`, load models, and assign an active model |
| The provider saves but does not work | Wrong URL, local-only blocks the endpoint, wrong provider type | Check `base URL`, `provider type`, and local-only restrictions |
| The model list is empty | The endpoint does not expose `/models`, or the backend is incompatible | Add `manual fallback models` or verify API compatibility |
| Tool calling will not enable | `KoboldCpp` is active | Use an OpenAI-compatible provider for tool calling |
| An MCP server does not answer | Wrong command, args, env, or timeout | Re-check `Command`, `Arguments`, `Environment`, then use `Test MCP Server` |
| A plugin will not activate | Permissions were not granted, or first-time config is missing | Open `Settings -> Plugins -> Permissions`, grant only the required permissions, and save |
| A plugin is installed but nothing changes | The catalog was not reloaded, the plugin is disabled, or it has no matching extension point | Use `Reload`, verify the toggle, and verify what kind of extension it actually is |
| RAG returns nothing | No collection exists, RAG is disabled, scope is wrong, or ingestion is empty | Create a collection, add documents, enable RAG, and re-check scope |
| A LoreBook does not affect the scene | The LoreBook is not attached, keys do not trigger, or the entry is disabled | Check the selected LoreBook in `Chat`, the `Keys`, `Enabled`, `Constant`, and `Position` |
| TTS does not play | TTS provider / model / voice is not configured | Open the TTS block in `Settings` and assign endpoint, model, and voice |

## If Vellium does not start from the repository

Check:

- whether `npm install` completed
- whether the Node version matches the native `better-sqlite3` build
- whether a native module ABI mismatch has happened

If you suspect a native ABI problem:

```bash
npm run rebuild:native
```

For Electron development:

```bash
npx electron-rebuild -f -w better-sqlite3 -v 40.4.1
```

## If the desktop shell behaves differently from web dev mode

Keep these two flows separate:

- `npm run dev` for frontend + API without Electron
- `npm run dev:electron` for the real desktop shell

If you are testing:

- title bar behavior
- `file://` behavior
- desktop-specific file save / open flows
- plugin iframe and shell integration

then you need `npm run dev:electron`, not just the web dev server.

## If prompt behavior becomes strange

Check:

- `Chat Mode`
- `Prompt Stack`
- `Default system prompt`
- custom prompt templates
- whether `Pure Chat` is enabled

If the root cause is unclear, the safest recovery path is:

1. restore the default prompt stack
2. verify the default system prompt
3. test in a plain chat without a character and without RAG

## If retrieval is too noisy

Do not start by turning every numeric knob at once.

First:

- inspect document quality
- reduce collection noise
- split collections that are too broad
- verify that the scope matches the workflow

Only after that should you tune:

- top-k
- similarity threshold
- candidate pool size
- reranker

## If RP falls apart in long histories

Check:

- context window size
- the compression model and compression flow
- whether multi-character context is too large
- whether the prompt stack is overloaded
- whether some world information should move into a LoreBook or knowledge collection

## If you need to reset everything

`Settings -> Danger Zone` contains a full settings reset.

Use it only if:

- you are ready to lose the current settings configuration
- the problem cannot be localized cleanly
- you need to return the app to a known baseline

Before doing that, it is wise to:

- export important plugins
- export character cards
- save important knowledge text and notes

## Recommended fallback plan

If Vellium behaves unpredictably:

1. Disable plugins.
2. Disable tool calling.
3. Test chat without a character, without RAG, and without a LoreBook.
4. Re-introduce layers one by one: character -> LoreBook -> RAG -> plugins -> MCP.

That isolates the real problem faster than changing everything at once.
