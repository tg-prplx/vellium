# Vellium Plugin Base

Plugin folders live in the runtime plugins directory reported by `Settings -> Plugins`.

## Minimum layout

```text
my-plugin/
  plugin.json
  tab.html
  widget.html
```

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
