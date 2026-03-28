import { dirname, join } from "path";
import { fileURLToPath } from "url";
export {
  ALL_PLUGIN_PERMISSIONS,
  PLUGIN_ACTION_LOCATIONS,
  PLUGIN_SLOT_IDS,
  type PluginActionLocation,
  type PluginActionManifest,
  type PluginCatalog,
  type PluginDescriptor,
  type PluginManifest,
  type PluginPermission,
  type PluginSettingsFieldManifest,
  type PluginSettingsFieldOption,
  type PluginSlotId,
  type PluginSlotManifest,
  type PluginTabManifest,
  type PluginThemeManifest
} from "./plugins/types.js";
export {
  discoverPlugins,
  getPluginDescriptor,
  reloadPluginCatalog,
  resolvePluginAssetPath
} from "./plugins/discovery.js";
export {
  exportPluginfile,
  installPluginfile
} from "./plugins/pluginfile.js";
export {
  getPluginData,
  getPluginPermissionGrants,
  patchPluginData,
  setPluginEnabledState,
  setPluginPermissionGrants
} from "./plugins/state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PLUGIN_SDK_SOURCE = `(() => {
  const UI_STYLE_ID = 'vellium-plugin-ui';
  const PLUGIN_ID = new URLSearchParams(window.location.search).get('pluginId') || '';
  const FRAME_ID = new URLSearchParams(window.location.search).get('frameId') || '';
  const UI_STYLE_SOURCE = ${JSON.stringify(`
:root {
  color-scheme: dark;
  --vp-bg-primary: #1a1a1a;
  --vp-bg-secondary: #222222;
  --vp-bg-tertiary: #2a2a2a;
  --vp-bg-hover: #333333;
  --vp-border: #333333;
  --vp-border-subtle: #2a2a2a;
  --vp-text-primary: #f5f5f5;
  --vp-text-secondary: #a0a0a0;
  --vp-text-tertiary: #707070;
  --vp-text-inverse: #1a1a1a;
  --vp-accent: #d97757;
  --vp-accent-hover: #c4664a;
  --vp-accent-subtle: rgba(217, 119, 87, 0.12);
  --vp-accent-border: rgba(217, 119, 87, 0.3);
  --vp-danger: #f87171;
  --vp-danger-subtle: rgba(248, 113, 113, 0.12);
  --vp-danger-border: rgba(248, 113, 113, 0.3);
  --vp-shadow-panel: 0 14px 34px rgba(0, 0, 0, 0.28);
  --vp-shadow-float: 0 10px 22px rgba(0, 0, 0, 0.26);
  --vp-radius-lg: 16px;
  --vp-radius-md: 12px;
  --vp-radius-sm: 10px;
}

:root[data-vellium-theme="light"] {
  color-scheme: light;
  --vp-bg-primary: #f5f4f2;
  --vp-bg-secondary: #eeede9;
  --vp-bg-tertiary: #e6e4df;
  --vp-bg-hover: #dddbd5;
  --vp-border: #d4d2cc;
  --vp-border-subtle: #dddbd5;
  --vp-text-primary: #1c1a17;
  --vp-text-secondary: #5c5a56;
  --vp-text-tertiary: #8c8a85;
  --vp-text-inverse: #f5f4f2;
  --vp-accent: #c4603e;
  --vp-accent-hover: #b05234;
  --vp-accent-subtle: rgba(196, 96, 62, 0.1);
  --vp-accent-border: rgba(196, 96, 62, 0.25);
  --vp-danger: #d94f4f;
  --vp-danger-subtle: rgba(217, 79, 79, 0.1);
  --vp-danger-border: rgba(217, 79, 79, 0.25);
  --vp-shadow-panel: 0 14px 34px rgba(0, 0, 0, 0.08);
  --vp-shadow-float: 0 10px 22px rgba(0, 0, 0, 0.1);
}

html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  background: transparent;
  color: var(--vp-text-primary);
  font-family: "Manrope", ui-sans-serif, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body.vp-body {
  padding: 16px;
}

.vp-root {
  display: grid;
  gap: 14px;
}

.vp-card,
.vp-hero {
  border: 1px solid var(--vp-border-subtle);
  border-radius: var(--vp-radius-lg);
  background: color-mix(in srgb, var(--vp-bg-secondary) 82%, transparent);
  box-shadow: var(--vp-shadow-panel);
}

.vp-card {
  padding: 14px;
}

.vp-hero {
  padding: 18px;
}

.vp-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.vp-stack {
  display: grid;
  gap: 10px;
}

.vp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.vp-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.vp-title {
  margin: 0;
  font-size: 28px;
  line-height: 1.1;
  font-weight: 700;
}

.vp-subtitle {
  margin: 0;
  color: var(--vp-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.vp-label {
  margin: 0 0 8px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-text-tertiary);
}

.vp-stat {
  font-size: 28px;
  line-height: 1.1;
  font-weight: 700;
}

.vp-muted {
  color: var(--vp-text-secondary);
  font-size: 12px;
  line-height: 1.55;
}

.vp-button {
  appearance: none;
  border: 1px solid var(--vp-border);
  background: var(--vp-bg-tertiary);
  color: var(--vp-text-primary);
  border-radius: var(--vp-radius-sm);
  padding: 8px 12px;
  font: inherit;
  cursor: pointer;
  transition: background-color 180ms ease, border-color 180ms ease, transform 180ms ease, color 180ms ease;
}

.vp-button:hover {
  background: var(--vp-bg-hover);
  transform: translateY(-1px);
}

.vp-button:active {
  transform: translateY(0);
}

.vp-button--accent {
  border-color: var(--vp-accent-border);
  background: var(--vp-accent-subtle);
  color: var(--vp-accent);
}

.vp-button--accent:hover {
  background: color-mix(in srgb, var(--vp-accent-subtle) 82%, var(--vp-accent) 18%);
  color: var(--vp-accent-hover);
}

.vp-button--danger {
  border-color: var(--vp-danger-border);
  background: var(--vp-danger-subtle);
  color: var(--vp-danger);
}

.vp-code {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--vp-text-primary);
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

.vp-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--vp-border);
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--vp-text-secondary);
  background: color-mix(in srgb, var(--vp-bg-tertiary) 88%, transparent);
}

.vp-divider {
  height: 1px;
  background: var(--vp-border-subtle);
}

@media (max-width: 720px) {
  body.vp-body {
    padding: 12px;
  }

  .vp-grid {
    grid-template-columns: 1fr;
  }
}
  `)};
  const pending = new Map();
  const listeners = new Set();
  let seq = 0;
  function ensureUiStyles() {
    if (document.getElementById(UI_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = UI_STYLE_ID;
    style.textContent = UI_STYLE_SOURCE;
    document.head.appendChild(style);
    document.body.classList.add('vp-body');
  }
  let appliedThemeKeys = [];
  function clearAppliedThemeVariables() {
    for (const key of appliedThemeKeys) {
      document.documentElement.style.removeProperty(key);
    }
    appliedThemeKeys = [];
  }
  function applyTheme(theme, variables) {
    const nextTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.velliumTheme = nextTheme;
    clearAppliedThemeVariables();
    if (variables && typeof variables === 'object') {
      for (const [key, value] of Object.entries(variables)) {
        if (!key || !key.startsWith('--')) continue;
        const nextValue = String(value || '').trim();
        if (!nextValue) continue;
        document.documentElement.style.setProperty(key, nextValue);
        appliedThemeKeys.push(key);
      }
    }
  }
  function post(type, payload = {}) {
    window.parent.postMessage({ __velliumPlugin: true, pluginId: PLUGIN_ID, frameId: FRAME_ID, type, ...payload }, '*');
  }
  function request(type, payload = {}) {
    const requestId = 'req-' + (++seq);
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      post(type, { ...payload, requestId });
      setTimeout(() => {
        if (!pending.has(requestId)) return;
        pending.delete(requestId);
        reject(new Error('Plugin host timeout'));
      }, 15000);
    });
  }
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.__velliumHost !== true) return;
    if (msg.type === 'context') {
      applyTheme(msg.context?.theme, msg.context?.themeVariables);
      const pendingRequest = msg.requestId ? pending.get(msg.requestId) : null;
      if (pendingRequest) {
        pending.delete(msg.requestId);
        pendingRequest.resolve(msg.context);
      } else {
        for (const callback of listeners) callback(msg.context);
      }
      return;
    }
    if (msg.requestId) {
      const entry = pending.get(msg.requestId);
      if (!entry) return;
      pending.delete(msg.requestId);
      if (msg.ok === false) {
        entry.reject(new Error(msg.error || 'Plugin host request failed'));
      } else {
        entry.resolve(msg.data);
      }
    }
  });
  const api = {
    request(method, path, body) {
      return request('api-request', { method, path, body });
    },
    get(path) { return api.request('GET', path); },
    post(path, body) { return api.request('POST', path, body); },
    put(path, body) { return api.request('PUT', path, body); },
    patch(path, body) { return api.request('PATCH', path, body); },
    delete(path, body) { return api.request('DELETE', path, body); }
  };
  const host = {
    getContext() { return request('get-context'); },
    async getPermissions() {
      const ctx = await request('get-context');
      return Array.isArray(ctx?.grantedPermissions) ? ctx.grantedPermissions.slice() : [];
    },
    async hasPermission(permission) {
      const permissions = await host.getPermissions();
      return permissions.includes(String(permission || ''));
    },
    onContext(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    resize(height) {
      post('resize', { height: Number(height) || 0 });
    },
    ready() {
      post('ready');
    }
  };
  const settings = {
    async get() {
      const ctx = await host.getContext();
      return api.get('/api/plugins/' + encodeURIComponent(ctx.pluginId) + '/settings');
    },
    async patch(patch) {
      const ctx = await host.getContext();
      return api.patch('/api/plugins/' + encodeURIComponent(ctx.pluginId) + '/settings', patch);
    }
  };
  const permissions = {
    list() { return host.getPermissions(); },
    has(permission) { return host.hasPermission(permission); }
  };
  function buildBlankCharacterCard(input = {}) {
    const name = String(input.name || 'New Character').trim() || 'New Character';
    const description = String(input.description || '').trim();
    const personality = String(input.personality || '').trim();
    const scenario = String(input.scenario || '').trim();
    const greeting = String(input.greeting || '').trim();
    const systemPrompt = String(input.systemPrompt || '').trim();
    const mesExample = String(input.mesExample || '').trim();
    const creatorNotes = String(input.creatorNotes || '').trim();
    const tags = Array.isArray(input.tags)
      ? input.tags.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const alternateGreetings = Array.isArray(input.alternateGreetings)
      ? input.alternateGreetings.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    return JSON.stringify({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name,
        description,
        personality,
        scenario,
        first_mes: greeting,
        system_prompt: systemPrompt,
        mes_example: mesExample,
        creator_notes: creatorNotes,
        tags,
        alternate_greetings: alternateGreetings
      }
    }, null, 2);
  }
  const vellium = {
    generate(input = {}) {
      return api.post('/api/plugin-runtime/generate', input);
    },
    chats: {
      list() { return api.get('/api/chats'); },
      create(input = {}) {
        return api.post('/api/chats', {
          title: String(input.title || 'New Chat'),
          characterId: input.characterId || undefined,
          characterIds: Array.isArray(input.characterIds) ? input.characterIds : undefined,
          lorebookIds: Array.isArray(input.lorebookIds) ? input.lorebookIds : undefined
        });
      },
      rename(chatId, title) {
        return api.patch('/api/chats/' + encodeURIComponent(chatId), { title });
      },
      delete(chatId) {
        return api.delete('/api/chats/' + encodeURIComponent(chatId));
      },
      branches(chatId) {
        return api.get('/api/chats/' + encodeURIComponent(chatId) + '/branches');
      },
      timeline(chatId, branchId) {
        const query = branchId ? ('?branchId=' + encodeURIComponent(branchId)) : '';
        return api.get('/api/chats/' + encodeURIComponent(chatId) + '/timeline' + query);
      },
      send(chatId, input = {}) {
        return api.post('/api/chats/' + encodeURIComponent(chatId) + '/send', {
          content: String(input.content || ''),
          branchId: input.branchId || undefined,
          userPersona: input.userPersona || null,
          attachments: Array.isArray(input.attachments) ? input.attachments : undefined
        });
      },
      regenerate(chatId, input = {}) {
        return api.post('/api/chats/' + encodeURIComponent(chatId) + '/regenerate', {
          branchId: input.branchId || undefined
        });
      },
      nextTurn(chatId, input = {}) {
        return api.post('/api/chats/' + encodeURIComponent(chatId) + '/next-turn', {
          characterName: String(input.characterName || ''),
          branchId: input.branchId || undefined,
          isAutoConvo: input.isAutoConvo === true,
          userPersona: input.userPersona || null
        });
      },
      compress(chatId, input = {}) {
        return api.post('/api/chats/' + encodeURIComponent(chatId) + '/compress', {
          branchId: input.branchId || undefined
        });
      },
      abort(chatId) {
        return api.post('/api/chats/' + encodeURIComponent(chatId) + '/abort', {});
      },
      setCharacters(chatId, characterIds) {
        return api.patch('/api/chats/' + encodeURIComponent(chatId) + '/characters', {
          characterIds: Array.isArray(characterIds) ? characterIds : []
        });
      },
      setLorebooks(chatId, lorebookIds) {
        return api.patch('/api/chats/' + encodeURIComponent(chatId) + '/lorebook', {
          lorebookIds: Array.isArray(lorebookIds) ? lorebookIds : []
        });
      },
      getLorebooks(chatId) {
        return api.get('/api/chats/' + encodeURIComponent(chatId) + '/lorebook');
      },
      getRag(chatId) {
        return api.get('/api/chats/' + encodeURIComponent(chatId) + '/rag');
      },
      setRag(chatId, enabled, collectionIds) {
        return api.patch('/api/chats/' + encodeURIComponent(chatId) + '/rag', {
          enabled: enabled === true,
          collectionIds: Array.isArray(collectionIds) ? collectionIds : []
        });
      }
    },
    characters: {
      list() { return api.get('/api/characters'); },
      get(id) { return api.get('/api/characters/' + encodeURIComponent(id)); },
      importCard(rawJson) {
        return api.post('/api/characters/import', { rawJson: String(rawJson || '') });
      },
      createBlank(input = {}) {
        return vellium.characters.importCard(buildBlankCharacterCard(input));
      },
      update(id, patch) {
        return api.put('/api/characters/' + encodeURIComponent(id), patch || {});
      },
      delete(id) {
        return api.delete('/api/characters/' + encodeURIComponent(id));
      },
      translateCopy(id, targetLanguage) {
        return api.post('/api/characters/' + encodeURIComponent(id) + '/translate-copy', { targetLanguage });
      }
    },
    lorebooks: {
      list() { return api.get('/api/lorebooks'); },
      get(id) { return api.get('/api/lorebooks/' + encodeURIComponent(id)); },
      create(payload = {}) { return api.post('/api/lorebooks', payload); },
      update(id, patch) { return api.put('/api/lorebooks/' + encodeURIComponent(id), patch || {}); },
      delete(id) { return api.delete('/api/lorebooks/' + encodeURIComponent(id)); },
      importWorldInfo(data) { return api.post('/api/lorebooks/import/world-info', { data }); },
      translateCopy(id, targetLanguage) {
        return api.post('/api/lorebooks/' + encodeURIComponent(id) + '/translate-copy', { targetLanguage });
      }
    },
    providers: {
      list() { return api.get('/api/providers'); },
      upsert(profile) { return api.post('/api/providers', profile || {}); },
      models(providerId) { return api.get('/api/providers/' + encodeURIComponent(providerId) + '/models'); },
      test(providerId) { return api.post('/api/providers/' + encodeURIComponent(providerId) + '/test', {}); },
      setActive(providerId, modelId) {
        return api.post('/api/providers/set-active', { providerId, modelId });
      }
    },
    extensions: {
      inspectorFields: {
        list() { return api.get('/api/extensions/inspector-fields'); },
        validate(fields) { return api.post('/api/extensions/inspector-fields/validate', { fields }); },
        save(fields) { return api.put('/api/extensions/inspector-fields', { fields }); }
      },
      adapters: {
        list() { return api.get('/api/extensions/endpoint-adapters'); },
        validate(adapters) { return api.post('/api/extensions/endpoint-adapters/validate', { adapters }); },
        save(adapters) { return api.put('/api/extensions/endpoint-adapters', { adapters }); },
        async upsert(adapter) {
          const current = await api.get('/api/extensions/endpoint-adapters');
          const list = Array.isArray(current) ? current.slice() : [];
          const next = list.filter((item) => item && item.id !== adapter.id);
          next.push(adapter);
          return api.put('/api/extensions/endpoint-adapters', { adapters: next });
        },
        async remove(adapterId) {
          const current = await api.get('/api/extensions/endpoint-adapters');
          const list = Array.isArray(current) ? current.filter((item) => item && item.id !== adapterId) : [];
          return api.put('/api/extensions/endpoint-adapters', { adapters: list });
        }
      }
    }
  };
  const ui = {
    ensureStyles() {
      ensureUiStyles();
    },
    applyTheme,
    classes: {
      root: 'vp-root',
      hero: 'vp-hero',
      card: 'vp-card',
      grid: 'vp-grid',
      stack: 'vp-stack',
      row: 'vp-row',
      actions: 'vp-actions',
      title: 'vp-title',
      subtitle: 'vp-subtitle',
      label: 'vp-label',
      stat: 'vp-stat',
      muted: 'vp-muted',
      button: 'vp-button',
      buttonAccent: 'vp-button vp-button--accent',
      buttonDanger: 'vp-button vp-button--danger',
      code: 'vp-code',
      pill: 'vp-pill',
      divider: 'vp-divider'
    }
  };
  window.VelliumPlugin = { api, host, settings, permissions, ui, vellium };
  ensureUiStyles();
  applyTheme(new URLSearchParams(window.location.search).get('hostTheme'));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => host.ready(), { once: true });
  } else {
    host.ready();
  }
})();`;

export function getPluginDocsExamplePath() {
  return join(__dirname, "..", "..", "docs", "plugins", "hello-world");
}
