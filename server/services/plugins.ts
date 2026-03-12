import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join, normalize, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { db, BUNDLED_PLUGINS_DIR, DEFAULT_SETTINGS, PLUGINS_DIR } from "../db.js";

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
const THEME_VARIABLE_PREFIXES = ["--color-", "--scrollbar-", "--range-", "--checkbox-", "--prose-", "--shadow-"] as const;
const MAX_PLUGINFILE_FILES = 64;
const MAX_PLUGINFILE_FILE_BYTES = 256 * 1024;
const MAX_PLUGINFILE_TOTAL_BYTES = 2 * 1024 * 1024;

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

export interface PluginSettingsFieldOption {
  value: string;
  label: string;
}

export interface PluginSettingsFieldManifest {
  id: string;
  key: string;
  label: string;
  type: "text" | "textarea" | "toggle" | "select" | "number" | "range" | "secret";
  description?: string;
  placeholder?: string;
  options?: PluginSettingsFieldOption[];
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
  order: number;
  required: boolean;
}

export interface PluginThemeManifest {
  id: string;
  label: string;
  description?: string;
  base: "dark" | "light";
  order: number;
  variables: Record<string, string>;
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
  settingsFields: PluginSettingsFieldManifest[];
  themes: PluginThemeManifest[];
  tabs: PluginTabManifest[];
  slots: PluginSlotManifest[];
  actions: PluginActionManifest[];
}

export interface PluginDescriptor extends PluginManifest {
  enabled: boolean;
  source: "user" | "bundled";
  assetBaseUrl: string;
  requestedPermissions: PluginPermission[];
  grantedPermissions: PluginPermission[];
  permissionsConfigured: boolean;
  tabs: Array<PluginTabManifest & { url: string }>;
  slots: Array<PluginSlotManifest & { url: string }>;
  actions: Array<PluginActionManifest & { url: string }>;
}

export interface PluginCatalog {
  pluginsDir: string;
  bundledPluginsDir: string;
  sdkUrl: string;
  slotIds: PluginSlotId[];
  plugins: PluginDescriptor[];
}

interface PluginfileDocument {
  format: "vellium-pluginfile@1";
  manifest: Record<string, unknown>;
  files: Record<string, string>;
}

interface PluginDiscoveryCache {
  signature: string;
  catalog: PluginCatalog;
  rootDirs: Record<string, string>;
}

let pluginDiscoveryCache: PluginDiscoveryCache | null = null;

function invalidatePluginDiscoveryCache() {
  pluginDiscoveryCache = null;
}

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

function sanitizePluginDirSegment(raw: unknown): string {
  const value = String(raw || "").trim().toLowerCase();
  return value.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "plugin";
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
    const requestMethod = ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(requestMethodRaw)
      ? requestMethodRaw as "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
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
  if (!Array.isArray(raw)) return [];
  if (raw.length === 0) return [];
  const out = new Set<PluginPermission>();
  for (const item of raw) {
    const value = String(item || "").trim() as PluginPermission;
    if (ALL_PLUGIN_PERMISSIONS.includes(value)) out.add(value);
  }
  return out.size > 0 ? Array.from(out) : [];
}

function normalizePluginThemes(raw: unknown): PluginThemeManifest[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginThemeManifest[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = normalizePluginId(row.id, `theme-${index + 1}`);
    if (seen.has(id)) continue;
    const variables: Record<string, string> = {};
    if (row.variables && typeof row.variables === "object" && !Array.isArray(row.variables)) {
      for (const [keyRaw, valueRaw] of Object.entries(row.variables as Record<string, unknown>)) {
        const key = String(keyRaw || "").trim();
        const value = String(valueRaw || "").trim();
        if (!key || !value) continue;
        if (!THEME_VARIABLE_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
        variables[key] = value.slice(0, 160);
      }
    }
    if (Object.keys(variables).length === 0) continue;
    seen.add(id);
    const order = Number(row.order);
    out.push({
      id,
      label: String(row.label || id).trim().slice(0, 120) || id,
      description: String(row.description || "").trim().slice(0, 300) || undefined,
      base: String(row.base || "dark").trim() === "light" ? "light" : "dark",
      order: Number.isFinite(order) ? Math.max(1, Math.floor(order)) : index + 1,
      variables
    });
  }
  return out.sort((a, b) => a.order - b.order);
}

function normalizePluginSettingsFields(raw: unknown): PluginSettingsFieldManifest[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginSettingsFieldManifest[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = normalizePluginId(row.id, `setting-${index + 1}`);
    const key = normalizePluginId(row.key, id);
    const type = String(row.type || "text").trim() as PluginSettingsFieldManifest["type"];
    if (seen.has(id) || !["text", "textarea", "toggle", "select", "number", "range", "secret"].includes(type)) continue;
    seen.add(id);
    const options = Array.isArray(row.options)
      ? row.options
        .map((entry, optionIndex) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
          const option = entry as Record<string, unknown>;
          const value = String(option.value || "").trim();
          const label = String(option.label || value || `Option ${optionIndex + 1}`).trim();
          if (!value) return null;
          return { value: value.slice(0, 200), label: label.slice(0, 200) };
        })
        .filter((entry): entry is PluginSettingsFieldOption => entry !== null)
      : [];
    const min = Number(row.min);
    const max = Number(row.max);
    const step = Number(row.step);
    const rows = Number(row.rows);
    const defaultValueRaw = row.defaultValue;
    const defaultValue = typeof defaultValueRaw === "boolean" || typeof defaultValueRaw === "number" || typeof defaultValueRaw === "string"
      ? defaultValueRaw
      : undefined;
    out.push({
      id,
      key,
      label: String(row.label || key).trim().slice(0, 120) || key,
      type,
      description: String(row.description || "").trim().slice(0, 300) || undefined,
      placeholder: String(row.placeholder || "").trim().slice(0, 200) || undefined,
      options: options.length > 0 ? options : undefined,
      defaultValue,
      min: Number.isFinite(min) ? min : undefined,
      max: Number.isFinite(max) ? max : undefined,
      step: Number.isFinite(step) ? step : undefined,
      rows: Number.isFinite(rows) ? Math.max(2, Math.min(16, Math.floor(rows))) : undefined,
      order: Number.isFinite(Number(row.order)) ? Math.max(1, Math.floor(Number(row.order))) : index + 1,
      required: row.required === true
    });
  }
  return out.sort((a, b) => a.order - b.order);
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
    settingsFields: normalizePluginSettingsFields(row.settingsFields),
    themes: normalizePluginThemes(row.themes),
    tabs: normalizePluginTabs(row.tabs),
    slots: normalizePluginSlots(row.slots),
    actions: normalizePluginActions(row.actions)
  };
}

function collectManifestAssetPaths(manifest: PluginManifest): string[] {
  const out = new Set<string>();
  for (const tab of manifest.tabs) out.add(tab.path);
  for (const slot of manifest.slots) out.add(slot.path);
  for (const action of manifest.actions) {
    if (action.path) out.add(action.path);
  }
  return Array.from(out).sort();
}

function normalizePluginfile(raw: unknown): PluginfileDocument | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (String(row.format || "").trim() !== "vellium-pluginfile@1") return null;
  const manifest = row.manifest && typeof row.manifest === "object" && !Array.isArray(row.manifest)
    ? row.manifest as Record<string, unknown>
    : null;
  const filesRaw = row.files && typeof row.files === "object" && !Array.isArray(row.files)
    ? row.files as Record<string, unknown>
    : null;
  if (!manifest || !filesRaw) return null;
  const files: Record<string, string> = {};
  let totalBytes = 0;
  for (const [keyRaw, valueRaw] of Object.entries(filesRaw)) {
    const key = sanitizeRelativeAssetPath(keyRaw);
    if (!key) continue;
    if (Object.keys(files).length >= MAX_PLUGINFILE_FILES) return null;
    const content = String(valueRaw ?? "");
    if (content.length > MAX_PLUGINFILE_FILE_BYTES) return null;
    totalBytes += content.length;
    if (totalBytes > MAX_PLUGINFILE_TOTAL_BYTES) return null;
    files[key] = content;
  }
  return {
    format: "vellium-pluginfile@1",
    manifest,
    files
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

function readPluginStateConfigured(): Record<string, boolean> {
  try {
    const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
    const payload = row ? JSON.parse(row.payload) as {
      pluginStateConfigured?: Record<string, unknown>;
      pluginStates?: Record<string, unknown>;
    } : {};
    const configuredRaw = payload.pluginStateConfigured;
    if (configuredRaw && typeof configuredRaw === "object" && !Array.isArray(configuredRaw)) {
      const out: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(configuredRaw)) {
        out[String(key)] = value === true;
      }
      return out;
    }
    const legacyStates = payload.pluginStates;
    if (legacyStates && typeof legacyStates === "object" && !Array.isArray(legacyStates)) {
      const out: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(legacyStates)) {
        out[String(key)] = value === false;
      }
      return out;
    }
    return { ...DEFAULT_SETTINGS.pluginStateConfigured };
  } catch {
    return { ...DEFAULT_SETTINGS.pluginStateConfigured };
  }
}

function readPluginPermissionGrants(): Record<string, Record<string, boolean>> {
  try {
    const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
    const payload = row ? JSON.parse(row.payload) as { pluginPermissionGrants?: Record<string, unknown> } : {};
    const source = payload.pluginPermissionGrants && typeof payload.pluginPermissionGrants === "object" && !Array.isArray(payload.pluginPermissionGrants)
      ? payload.pluginPermissionGrants
      : DEFAULT_SETTINGS.pluginPermissionGrants;
    const out: Record<string, Record<string, boolean>> = {};
    for (const [pluginId, value] of Object.entries(source)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const grants: Record<string, boolean> = {};
      for (const [permission, enabled] of Object.entries(value as Record<string, unknown>)) {
        const key = String(permission || "").trim() as PluginPermission;
        if (!ALL_PLUGIN_PERMISSIONS.includes(key)) continue;
        grants[key] = enabled === true;
      }
      out[String(pluginId)] = grants;
    }
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS.pluginPermissionGrants };
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
  const configured = payload.pluginStateConfigured && typeof payload.pluginStateConfigured === "object" && !Array.isArray(payload.pluginStateConfigured)
    ? payload.pluginStateConfigured as Record<string, unknown>
    : {};
  payload.pluginStates = {
    ...current,
    [pluginId]: enabled
  };
  payload.pluginStateConfigured = {
    ...configured,
    [pluginId]: true
  };
  writeSettingsPayload(payload);
  invalidatePluginDiscoveryCache();
}

export function getPluginPermissionGrants(pluginId: string): Record<string, boolean> {
  const grants = readPluginPermissionGrants();
  return { ...(grants[pluginId] ?? {}) };
}

export function setPluginPermissionGrants(pluginId: string, grantsPatch: unknown): Record<string, boolean> {
  const payload = readSettingsPayload();
  const current = payload.pluginPermissionGrants && typeof payload.pluginPermissionGrants === "object" && !Array.isArray(payload.pluginPermissionGrants)
    ? payload.pluginPermissionGrants as Record<string, unknown>
    : {};
  const nextGrants: Record<string, boolean> = {};
  if (grantsPatch && typeof grantsPatch === "object" && !Array.isArray(grantsPatch)) {
    for (const [permission, enabled] of Object.entries(grantsPatch as Record<string, unknown>)) {
      const key = String(permission || "").trim() as PluginPermission;
      if (!ALL_PLUGIN_PERMISSIONS.includes(key)) continue;
      nextGrants[key] = enabled === true;
    }
  }
  payload.pluginPermissionGrants = {
    ...current,
    [pluginId]: nextGrants
  };
  writeSettingsPayload(payload);
  invalidatePluginDiscoveryCache();
  return nextGrants;
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
  const parts: string[] = [];
  const roots: Array<[string, string]> = [
    ["bundled", BUNDLED_PLUGINS_DIR],
    ["user", PLUGINS_DIR]
  ];
  for (const [source, rootDir] of roots) {
    if (!existsSync(rootDir)) continue;
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginDir = join(rootDir, entry.name);
      const manifestPath = existsSync(join(pluginDir, "Pluginfile.json"))
        ? join(pluginDir, "Pluginfile.json")
        : join(pluginDir, "plugin.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const manifestStat = statSync(manifestPath);
        parts.push(`${source}:${entry.name}:${manifestStat.mtimeMs}:${manifestStat.size}`);
      } catch {
        parts.push(`${source}:${entry.name}:missing`);
      }
    }
  }
  return parts.length > 0 ? parts.sort().join("|") : "missing";
}

function discoverPluginsWithCache(force: boolean): PluginDiscoveryCache {
  const signature = readDiscoverySignature();
  if (!force && pluginDiscoveryCache && pluginDiscoveryCache.signature === signature) {
    return pluginDiscoveryCache;
  }

  const states = readPluginStates();
  const configuredStates = readPluginStateConfigured();
  const permissionGrants = readPluginPermissionGrants();
  const pluginsById = new Map<string, PluginDescriptor>();
  const rootDirs: Record<string, string> = {};
  const sources: Array<{ type: "bundled" | "user"; dir: string }> = [
    { type: "bundled", dir: BUNDLED_PLUGINS_DIR },
    { type: "user", dir: PLUGINS_DIR }
  ];
  for (const source of sources) {
    if (!existsSync(source.dir)) continue;
    for (const entry of readdirSync(source.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginDir = join(source.dir, entry.name);
      const pluginfilePath = join(pluginDir, "Pluginfile.json");
      const manifestPath = existsSync(pluginfilePath) ? pluginfilePath : join(pluginDir, "plugin.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
        const pluginfile = normalizePluginfile(raw);
        const manifest = normalizeManifest(pluginfile ? pluginfile.manifest : raw, entry.name);
        if (!manifest) continue;
        const assetBaseUrl = `/api/plugins/${encodeURIComponent(manifest.id)}/assets`;
        const enabled = configuredStates[manifest.id] === true && states[manifest.id] === true;
        const requestedPermissions = [...manifest.permissions];
        const storedGrants = permissionGrants[manifest.id];
        const permissionsConfigured = !!storedGrants;
        const grantedPermissions = requestedPermissions.filter((permission) => (
          permissionsConfigured ? storedGrants?.[permission] === true : false
        ));
        rootDirs[manifest.id] = pluginDir;
        pluginsById.set(manifest.id, {
          ...manifest,
          enabled,
          source: source.type,
          assetBaseUrl,
          requestedPermissions,
          grantedPermissions,
          permissionsConfigured,
          permissions: grantedPermissions,
          tabs: manifest.tabs.map((tab) => ({ ...tab, url: `${assetBaseUrl}/${encodeAssetPath(tab.path)}` })),
          slots: manifest.slots.map((slot) => ({ ...slot, url: `${assetBaseUrl}/${encodeAssetPath(slot.path)}` })),
          actions: manifest.actions.map((action) => ({ ...action, url: `${assetBaseUrl}/${encodeAssetPath(action.path)}` }))
        });
      } catch (error) {
        console.warn(`[plugins] Failed to load plugin manifest from ${manifestPath}:`, error);
      }
    }
  }

  const plugins = Array.from(pluginsById.values());
  plugins.sort((a, b) => a.name.localeCompare(b.name));
  pluginDiscoveryCache = {
    signature,
    rootDirs,
    catalog: {
      pluginsDir: PLUGINS_DIR,
      bundledPluginsDir: BUNDLED_PLUGINS_DIR,
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

export function exportPluginfile(pluginId: string): PluginfileDocument | null {
  const plugin = getPluginDescriptor(pluginId);
  const pluginRoot = resolvePluginRootDir(pluginId);
  if (!plugin || !pluginRoot) return null;
  const files: Record<string, string> = {};
  for (const assetPath of collectManifestAssetPaths(plugin)) {
    const resolved = resolvePluginAssetPath(pluginId, assetPath);
    if (!resolved || !existsSync(resolved)) continue;
    files[assetPath] = readFileSync(resolved, "utf-8");
  }
  return {
    format: "vellium-pluginfile@1",
    manifest: {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      apiVersion: plugin.apiVersion,
      description: plugin.description,
      author: plugin.author,
      defaultEnabled: plugin.defaultEnabled,
      permissions: plugin.requestedPermissions,
      settingsFields: plugin.settingsFields,
      themes: plugin.themes,
      tabs: plugin.tabs.map(({ url: _url, ...tab }) => tab),
      slots: plugin.slots.map(({ url: _url, ...slot }) => slot),
      actions: plugin.actions.map(({ url: _url, ...action }) => action)
    },
    files
  };
}

export function installPluginfile(input: unknown): PluginDescriptor {
  const raw = typeof input === "string" ? JSON.parse(input) as unknown : input;
  const pluginfile = normalizePluginfile(raw);
  if (!pluginfile) {
    throw new Error("Invalid Pluginfile");
  }
  const manifest = normalizeManifest(pluginfile.manifest, "plugin");
  if (!manifest) {
    throw new Error("Invalid plugin manifest inside Pluginfile");
  }
  const requiredFiles = collectManifestAssetPaths(manifest);
  for (const assetPath of requiredFiles) {
    if (!(assetPath in pluginfile.files)) {
      throw new Error(`Pluginfile is missing required asset: ${assetPath}`);
    }
  }
  const targetDir = join(PLUGINS_DIR, sanitizePluginDirSegment(manifest.id));
  if (existsSync(targetDir)) {
    throw new Error("A user plugin with this id already exists");
  }
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, "Pluginfile.json"), JSON.stringify(pluginfile, null, 2));
  writeFileSync(join(targetDir, "plugin.json"), JSON.stringify(pluginfile.manifest, null, 2));
  for (const [assetPath, content] of Object.entries(pluginfile.files)) {
    const safePath = sanitizeRelativeAssetPath(assetPath);
    if (!safePath) continue;
    const resolved = resolve(targetDir, safePath);
    const expectedPrefix = `${targetDir}${sep}`;
    if (resolved !== targetDir && !resolved.startsWith(expectedPrefix)) {
      continue;
    }
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, content, "utf-8");
  }
  invalidatePluginDiscoveryCache();
  const plugin = getPluginDescriptor(manifest.id);
  if (!plugin) {
    throw new Error("Installed plugin could not be loaded");
  }
  return plugin;
}

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
