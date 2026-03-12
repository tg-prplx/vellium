# Vellium Plugin Base

Plugin folders live in the runtime plugins directory reported by `Settings -> Plugins`.
Bundled plugins ship with the app from the bundled plugins directory and can be enabled/disabled the same way.

## Minimum layout

```text
my-plugin/
  plugin.json
  tab.html
  widget.html
```

## Pluginfile

`Pluginfile` is the portable single-file distribution format for Vellium plugins.

It bundles the manifest and referenced asset files into one JSON document:

```json
{
  "format": "vellium-pluginfile@1",
  "manifest": {
    "id": "my-plugin",
    "name": "My Plugin",
    "version": "0.1.0"
  },
  "files": {
    "tab.html": "<!doctype html>..."
  }
}
```

Use `Settings -> Plugins -> Install Pluginfile` to install one, or export an existing
plugin back into a `.pluginfile.json` package.

## Manifest

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "Custom tab and widget",
  "defaultEnabled": true,
  "permissions": ["api.read", "pluginSettings.read", "pluginSettings.write", "host.resize"],
  "tabs": [
    {
      "id": "dashboard",
      "label": "My Tab",
      "path": "tab.html",
      "order": 100
    }
  ],
  "slots": [
    {
      "id": "chat-widget",
      "slot": "chat.inspector.bottom",
      "title": "My Widget",
      "path": "widget.html",
      "order": 100,
      "height": 240
    }
  ],
  "actions": [
    {
      "id": "composer-tool",
      "location": "chat.composer",
      "label": "My Action",
      "title": "Plugin Action",
      "path": "widget.html",
      "order": 100,
      "width": 720,
      "height": 420,
      "variant": "ghost"
    },
    {
      "id": "quick-sync",
      "location": "app.toolbar",
      "label": "Quick Sync",
      "title": "Quick Sync",
      "mode": "inline",
      "request": {
        "method": "POST",
        "path": "/api/plugins/{{pluginId}}/settings",
        "body": { "lastAction": "{{activeTab}}" }
      },
      "successMessage": "Plugin settings updated",
      "variant": "accent",
      "reloadPlugins": false
    }
  ]
}
```

## Supported extension points

- `chat.sidebar.bottom`
- `chat.inspector.bottom`
- `chat.composer.bottom`
- `chat.message.bottom`
- `writing.sidebar.bottom`
- `writing.editor.bottom`
- `settings.bottom`

## Supported action locations

- `app.toolbar`
- `chat.composer`
- `chat.message`
- `writing.toolbar`
- `writing.editor`

## SDK

Load the host bridge from your plugin page:

```html
<script src="/api/plugins/sdk.js"></script>
```

Then use it from page scripts:

```js
const ctx = await window.VelliumPlugin.host.getContext();
const settings = await window.VelliumPlugin.api.get('/api/settings');
const pluginSettings = await window.VelliumPlugin.settings.get();
window.VelliumPlugin.host.resize(320);
window.VelliumPlugin.ui.ensureStyles();
```

## UI kit

`sdk.js` now injects a shared UI layer automatically.

It provides:

- theme sync with the current app theme
- app-aligned color tokens
- ready-to-use utility classes

Available helpers:

```js
window.VelliumPlugin.ui.ensureStyles();
window.VelliumPlugin.ui.applyTheme('dark');
window.VelliumPlugin.ui.classes;
```

## High-level Vellium API

Plugins do not need to talk to raw backend routes directly anymore. Use the stable
`window.VelliumPlugin.vellium` namespace instead.

```js
const { vellium } = window.VelliumPlugin;

const chats = await vellium.chats.list();
const created = await vellium.chats.create({ title: "Plugin chat" });
await vellium.chats.send(created.id, { content: "Hello from plugin" });

const blankCharacter = await vellium.characters.createBlank({
  name: "Plugin Character",
  description: "Created from plugin"
});

const lorebooks = await vellium.lorebooks.list();
const providers = await vellium.providers.list();
```

### Unified generate

Use `vellium.generate()` when your plugin needs model output without caring whether the
active backend is OpenAI-compatible, KoboldCpp, or a custom adapter.

```js
const result = await window.VelliumPlugin.vellium.generate({
  systemPrompt: "You are a concise assistant.",
  userPrompt: "Summarize this scene in one paragraph."
});

console.log(result.content);
console.log(result.reasoning);
console.log(result.providerType);
```

You can also pass explicit messages/provider/model:

```js
await window.VelliumPlugin.vellium.generate({
  providerId: "local-provider",
  modelId: "my-model",
  messages: [
    { role: "system", content: "Stay concise." },
    { role: "user", content: "Write a short recap." }
  ]
});
```

### Adapter management

Plugins can manage custom endpoint adapters through the unified API:

```js
const adapters = await window.VelliumPlugin.vellium.extensions.adapters.list();

await window.VelliumPlugin.vellium.extensions.adapters.upsert({
  id: "my-backend",
  name: "My Backend",
  description: "Plugin-owned adapter",
  enabled: true,
  authMode: "bearer",
  authHeader: "X-API-Key",
  chat: {
    enabled: true,
    method: "POST",
    path: "/generate",
    resultPath: "output.text",
    bodyTemplate: {
      prompt: "{{userPrompt}}"
    }
  }
});
```

Useful classes:

- `vp-root`
- `vp-hero`
- `vp-card`
- `vp-grid`
- `vp-stack`
- `vp-row`
- `vp-actions`
- `vp-title`
- `vp-subtitle`
- `vp-label`
- `vp-stat`
- `vp-muted`
- `vp-button`
- `vp-button--accent`
- `vp-button--danger`
- `vp-code`
- `vp-pill`

Example:

```html
<script src="/api/plugins/sdk.js"></script>
<div class="vp-root">
  <section class="vp-hero">
    <h1 class="vp-title">My Plugin</h1>
    <p class="vp-subtitle">Uses the shared Vellium plugin UI kit.</p>
    <div class="vp-actions">
      <button class="vp-button vp-button--accent">Run</button>
      <button class="vp-button">Cancel</button>
    </div>
  </section>
</div>
```

`ctx.payload` contains slot-specific host data when the plugin is mounted inside chat or writing surfaces.

The bridge is intentionally limited to `/api/*` requests. This is the current safe base layer.

`inline` actions run directly through the host bridge with template substitution from the current context payload, so simple operations do not need to open an iframe modal.
