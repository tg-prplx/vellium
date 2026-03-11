import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, normalize, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { db, DEFAULT_SETTINGS, PLUGINS_DIR } from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PLUGIN_SLOT_IDS = [
  "chat.sidebar.bottom",
  "chat.inspector.bottom",
  "chat.composer.bottom",
  "chat.message.bottom",
  "writing.sidebar.bottom",
  "writing.editor.bottom",
  "settings.bottom"
] as const;

export type PluginSlotId = typeof PLUGIN_SLOT_IDS[number];
export const PLUGIN_ACTION_LOCATIONS = [
  "app.toolbar",
  "chat.composer",
  "chat.message",
  "writing.toolbar",
  "writing.editor"
] as const;
export type PluginActionLocation = typeof PLUGIN_ACTION_LOCATIONS[number];
const ALL_PLUGIN_PERMISSIONS = [
  "api.read",
  "api.write",
  "pluginSettings.read",
  "pluginSettings.write",
  "host.resize"
] as const;
type PluginPermission = typeof ALL_PLUGIN_PERMISSIONS[number];

export interface PluginTabManifest {
  id: string;
  label: string;
  path: string;
  order: number;
}

export interface PluginSlotManifest {
  id: string;
  slot: PluginSlotId;
  title: string;
  path: string;
  order: number;
  height: number;
}

export interface PluginActionManifest {
  id: string;
  location: PluginActionLocation;
  label: string;
  title: string;
  path: string;
  order: number;
  width: number;
  height: number;
  mode: "modal" | "inline";
  request?: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;
    body?: unknown;
  };
  confirmText?: string;
  successMessage?: string;
  reloadPlugins: boolean;
  variant: "ghost" | "accent";
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  description: string;
  author: string;
  defaultEnabled: boolean;
  permissions: PluginPermission[];
  tabs: PluginTabManifest[];
  slots: PluginSlotManifest[];
  actions: PluginActionManifest[];
}

export interface PluginDescriptor extends PluginManifest {
  enabled: boolean;
  assetBaseUrl: string;
  tabs: Array<PluginTabManifest & { url: string }>;
  slots: Array<PluginSlotManifest & { url: string }>;
  actions: Array<PluginActionManifest & { url: string }>;
}

export interface PluginCatalog {
  pluginsDir: string;
  sdkUrl: string;
  slotIds: PluginSlotId[];
  plugins: PluginDescriptor[];
}

interface PluginDiscoveryCache {
  signature: string;
  catalog: PluginCatalog;
  rootDirs: Record<string, string>;
}

let pluginDiscoveryCache: PluginDiscoveryCache | null = null;

function encodeAssetPath(assetPath: string): string {
  return assetPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function sanitizeRelativeAssetPath(raw: unknown): string | null {
  const trimmed = String(raw || "").trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("../") || trimmed === "..") {
    return null;
  }
  return trimmed.replace(/^\.\//, "");
}

function normalizePluginId(raw: unknown, fallback: string): string {
  const value = String(raw || fallback).trim().toLowerCase();
  return value.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || fallback.toLowerCase();
}

function normalizePluginTabs(raw: unknown): PluginTabManifest[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginTabManifest[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = normalizePluginId(row.id, `tab-${index + 1}`);
    const path = sanitizeRelativeAssetPath(row.path);
    if (!path || seen.has(id)) continue;
    seen.add(id);
    const order = Number(row.order);
    out.push({
      id,
      label: String(row.label || row.title || id).trim() || id,
      path,
      order: Number.isFinite(order) ? Math.max(1, Math.floor(order)) : index + 1
    });
  }
  return out.sort((a, b) => a.order - b.order);
}

function normalizePluginSlots(raw: unknown): PluginSlotManifest[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginSlotManifest[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = normalizePluginId(row.id, `slot-${index + 1}`);
    const path = sanitizeRelativeAssetPath(row.path);
    const slot = String(row.slot || "").trim() as PluginSlotId;
    if (!path || !PLUGIN_SLOT_IDS.includes(slot) || seen.has(id)) continue;
    seen.add(id);
    const order = Number(row.order);
    const height = Number(row.height);
    out.push({
      id,
      slot,
      title: String(row.title || row.label || id).trim() || id,
      path,
      order: Number.isFinite(order) ? Math.max(1, Math.floor(order)) : index + 1,
      height: Number.isFinite(height) ? Math.max(120, Math.min(960, Math.floor(height))) : 280
    });
  }
  return out.sort((a, b) => a.order - b.order);
}

function normalizePluginActions(raw: unknown): PluginActionManifest[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginActionManifest[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = normalizePluginId(row.id, `action-${index + 1}`);
    const mode = row.mode === "inline" ? "inline" : "modal";
    const path = sanitizeRelativeAssetPath(row.path);
    const location = String(row.location || row.target || "").trim() as PluginActionLocation;
    const request = row.request && typeof row.request === "object" && !Array.isArray(row.request)
      ? row.request as Record<string, unknown>
      : null;
    const requestPath = String(request?.path || "").trim();
    const requestMethodRaw = String(request?.method || "POST").trim().toUpperCase();
    const requestMethod = ["GET", "POST", "PATCH", "DELETE"].includes(requestMethodRaw)
      ? requestMethodRaw as "GET" | "POST" | "PATCH" | "DELETE"
      : "POST";
    const hasInlineRequest = mode === "inline" && /^\/api\//.test(requestPath);
    if ((!path && !hasInlineRequest) || !PLUGIN_ACTION_LOCATIONS.includes(location) || seen.has(id)) continue;
    seen.add(id);
    const order = Number(row.order);
    const width = Number(row.width);
    const height = Number(row.height);
    const variant = row.variant === "accent" ? "accent" : "ghost";
    out.push({
      id,
      location,
      label: String(row.label || row.title || id).trim() || id,
      title: String(row.title || row.label || id).trim() || id,
      path: path || "",
      order: Number.isFinite(order) ? Math.max(1, Math.floor(order)) : index + 1,
      width: Number.isFinite(width) ? Math.max(320, Math.min(1400, Math.floor(width))) : 720,
      height: Number.isFinite(height) ? Math.max(220, Math.min(1100, Math.floor(height))) : 560,
      mode,
      request: hasInlineRequest ? {
        method: requestMethod,
        path: requestPath,
        body: request?.body
      } : undefined,
      confirmText: typeof row.confirmText === "string" ? row.confirmText : undefined,
      successMessage: typeof row.successMessage === "string" ? row.successMessage : undefined,
      reloadPlugins: row.reloadPlugins === true,
      variant
    });
  }
  return out.sort((a, b) => a.order - b.order);
}

function normalizePluginPermissions(raw: unknown): PluginPermission[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...ALL_PLUGIN_PERMISSIONS];
  const out = new Set<PluginPermission>();
  for (const item of raw) {
    const value = String(item || "").trim() as PluginPermission;
    if (ALL_PLUGIN_PERMISSIONS.includes(value)) out.add(value);
  }
  return out.size > 0 ? Array.from(out) : [...ALL_PLUGIN_PERMISSIONS];
}

function normalizeManifest(raw: unknown, fallbackDirName: string): PluginManifest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = normalizePluginId(row.id, fallbackDirName);
  const name = String(row.name || id).trim() || id;
  const version = String(row.version || "0.1.0").trim() || "0.1.0";
  const apiVersion = Number(row.apiVersion ?? 1);
  return {
    id,
    name,
    version,
    apiVersion: Number.isFinite(apiVersion) ? Math.max(1, Math.floor(apiVersion)) : 1,
    description: String(row.description || "").trim(),
    author: String(row.author || "").trim(),
    defaultEnabled: row.defaultEnabled !== false,
    permissions: normalizePluginPermissions(row.permissions),
    tabs: normalizePluginTabs(row.tabs),
    slots: normalizePluginSlots(row.slots),
    actions: normalizePluginActions(row.actions)
  };
}

function readPluginStates(): Record<string, boolean> {
  try {
    const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
    const payload = row ? JSON.parse(row.payload) as { pluginStates?: Record<string, unknown> } : {};
    const source = payload.pluginStates && typeof payload.pluginStates === "object" && !Array.isArray(payload.pluginStates)
      ? payload.pluginStates
      : DEFAULT_SETTINGS.pluginStates;
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(source)) {
      out[String(key)] = value === true;
    }
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS.pluginStates };
  }
}

function readSettingsPayload(): Record<string, unknown> {
  const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
  return row ? JSON.parse(row.payload) as Record<string, unknown> : {};
}

function writeSettingsPayload(payload: Record<string, unknown>) {
  db.prepare("UPDATE settings SET payload = ? WHERE id = 1").run(JSON.stringify(payload));
}

function normalizePluginDataValue(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, unknown>) };
}

export function setPluginEnabledState(pluginId: string, enabled: boolean) {
  const payload = readSettingsPayload();
  const current = payload.pluginStates && typeof payload.pluginStates === "object" && !Array.isArray(payload.pluginStates)
    ? payload.pluginStates as Record<string, unknown>
    : {};
  payload.pluginStates = {
    ...current,
    [pluginId]: enabled
  };
  writeSettingsPayload(payload);
}

export function getPluginData(pluginId: string): Record<string, unknown> {
  const payload = readSettingsPayload();
  const pluginData = payload.pluginData && typeof payload.pluginData === "object" && !Array.isArray(payload.pluginData)
    ? payload.pluginData as Record<string, unknown>
    : {};
  return normalizePluginDataValue(pluginData[pluginId]);
}

export function patchPluginData(pluginId: string, patch: unknown): Record<string, unknown> {
  const payload = readSettingsPayload();
  const currentData = payload.pluginData && typeof payload.pluginData === "object" && !Array.isArray(payload.pluginData)
    ? payload.pluginData as Record<string, unknown>
    : {};
  const nextPluginData = {
    ...normalizePluginDataValue(currentData[pluginId]),
    ...normalizePluginDataValue(patch)
  };
  payload.pluginData = {
    ...currentData,
    [pluginId]: nextPluginData
  };
  writeSettingsPayload(payload);
  return nextPluginData;
}

export function discoverPlugins(): PluginCatalog {
  return discoverPluginsWithCache(false).catalog;
}

function readDiscoverySignature() {
  if (!existsSync(PLUGINS_DIR)) return "missing";
  const parts: string[] = [];
  for (const entry of readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pluginDir = join(PLUGINS_DIR, entry.name);
    const manifestPath = join(pluginDir, "plugin.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifestStat = statSync(manifestPath);
      parts.push(`${entry.name}:${manifestStat.mtimeMs}:${manifestStat.size}`);
    } catch {
      parts.push(`${entry.name}:missing`);
    }
  }
  return parts.sort().join("|");
}

function discoverPluginsWithCache(force: boolean): PluginDiscoveryCache {
  const signature = readDiscoverySignature();
  if (!force && pluginDiscoveryCache && pluginDiscoveryCache.signature === signature) {
    return pluginDiscoveryCache;
  }

  const states = readPluginStates();
  const plugins: PluginDescriptor[] = [];
  const rootDirs: Record<string, string> = {};
  if (existsSync(PLUGINS_DIR)) {
    for (const entry of readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginDir = join(PLUGINS_DIR, entry.name);
      const manifestPath = join(pluginDir, "plugin.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
        const manifest = normalizeManifest(raw, entry.name);
        if (!manifest) continue;
        const assetBaseUrl = `/api/plugins/${encodeURIComponent(manifest.id)}/assets`;
        const enabled = states[manifest.id] ?? manifest.defaultEnabled;
        rootDirs[manifest.id] = pluginDir;
        plugins.push({
          ...manifest,
          enabled,
          assetBaseUrl,
          tabs: manifest.tabs.map((tab) => ({ ...tab, url: `${assetBaseUrl}/${encodeAssetPath(tab.path)}` })),
          slots: manifest.slots.map((slot) => ({ ...slot, url: `${assetBaseUrl}/${encodeAssetPath(slot.path)}` })),
          actions: manifest.actions.map((action) => ({ ...action, url: `${assetBaseUrl}/${encodeAssetPath(action.path)}` }))
        });
      } catch (error) {
        console.warn(`[plugins] Failed to load plugin manifest from ${manifestPath}:`, error);
      }
    }
  }

  plugins.sort((a, b) => a.name.localeCompare(b.name));
  pluginDiscoveryCache = {
    signature,
    rootDirs,
    catalog: {
      pluginsDir: PLUGINS_DIR,
      sdkUrl: "/api/plugins/sdk.js",
      slotIds: [...PLUGIN_SLOT_IDS],
      plugins
    }
  };
  return pluginDiscoveryCache;
}

export function reloadPluginCatalog(): PluginCatalog {
  return discoverPluginsWithCache(true).catalog;
}

export function getPluginDescriptor(pluginId: string): PluginDescriptor | undefined {
  return discoverPlugins().plugins.find((plugin) => plugin.id === pluginId);
}

function resolvePluginRootDir(pluginId: string): string | null {
  return discoverPluginsWithCache(false).rootDirs[pluginId] || null;
}

export function resolvePluginAssetPath(pluginId: string, assetPathRaw: string): string | null {
  const pluginRoot = resolvePluginRootDir(pluginId);
  if (!pluginRoot) return null;
  const safePath = sanitizeRelativeAssetPath(assetPathRaw);
  if (!safePath) return null;
  const targetPath = resolve(pluginRoot, normalize(safePath));
  const expectedPrefix = `${pluginRoot}${sep}`;
  if (targetPath !== pluginRoot && !targetPath.startsWith(expectedPrefix)) {
    return null;
  }
  return targetPath;
}

export const PLUGIN_SDK_SOURCE = `(() => {
  const UI_STYLE_ID = 'vellium-plugin-ui';
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
  function applyTheme(theme) {
    const nextTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.velliumTheme = nextTheme;
  }
  function post(type, payload = {}) {
    window.parent.postMessage({ __velliumPlugin: true, type, ...payload }, '*');
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
      applyTheme(msg.context?.theme);
      for (const callback of listeners) callback(msg.context);
      const pendingRequest = msg.requestId ? pending.get(msg.requestId) : null;
      if (pendingRequest) {
        pending.delete(msg.requestId);
        pendingRequest.resolve(msg.context);
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
    patch(path, body) { return api.request('PATCH', path, body); },
    delete(path, body) { return api.request('DELETE', path, body); }
  };
  const host = {
    getContext() { return request('get-context'); },
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
  window.VelliumPlugin = { api, host, settings, ui };
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
