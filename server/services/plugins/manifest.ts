import {
  ALL_PLUGIN_PERMISSIONS,
  PLUGIN_ACTION_LOCATIONS,
  PLUGIN_SLOT_IDS,
  type PluginActionLocation,
  type PluginActionManifest,
  type PluginManifest,
  type PluginPermission,
  type PluginSettingsFieldManifest,
  type PluginSettingsFieldOption,
  type PluginSlotId,
  type PluginSlotManifest,
  type PluginTabManifest,
  type PluginThemeManifest,
  type PluginfileDocument
} from "./types.js";

const THEME_VARIABLE_PREFIXES = ["--color-", "--scrollbar-", "--range-", "--checkbox-", "--prose-", "--shadow-"] as const;
const MAX_PLUGINFILE_FILES = 64;
const MAX_PLUGINFILE_FILE_BYTES = 256 * 1024;
const MAX_PLUGINFILE_TOTAL_BYTES = 2 * 1024 * 1024;

export function encodeAssetPath(assetPath: string): string {
  return assetPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function sanitizeRelativeAssetPath(raw: unknown): string | null {
  const trimmed = String(raw || "").trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("../") || trimmed === "..") {
    return null;
  }
  return trimmed.replace(/^\.\//, "");
}

export function sanitizePluginDirSegment(raw: unknown): string {
  const value = String(raw || "").trim().toLowerCase();
  return value.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "plugin";
}

export function normalizePluginId(raw: unknown, fallback: string): string {
  const value = String(raw || fallback).trim().toLowerCase();
  return value.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || fallback.toLowerCase();
}

export function normalizePluginTabs(raw: unknown): PluginTabManifest[] {
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

export function normalizePluginSlots(raw: unknown): PluginSlotManifest[] {
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

export function normalizePluginActions(raw: unknown): PluginActionManifest[] {
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

export function normalizePluginPermissions(raw: unknown): PluginPermission[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out = new Set<PluginPermission>();
  for (const item of raw) {
    const value = String(item || "").trim() as PluginPermission;
    if (ALL_PLUGIN_PERMISSIONS.includes(value)) out.add(value);
  }
  return out.size > 0 ? Array.from(out) : [];
}

export function normalizePluginThemes(raw: unknown): PluginThemeManifest[] {
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

export function normalizePluginSettingsFields(raw: unknown): PluginSettingsFieldManifest[] {
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

export function normalizeManifest(raw: unknown, fallbackDirName: string): PluginManifest | null {
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

export function collectManifestAssetPaths(manifest: PluginManifest): string[] {
  const out = new Set<string>();
  for (const tab of manifest.tabs) out.add(tab.path);
  for (const slot of manifest.slots) out.add(slot.path);
  for (const action of manifest.actions) {
    if (action.path) out.add(action.path);
  }
  return Array.from(out).sort();
}

export function normalizePluginfile(raw: unknown): PluginfileDocument | null {
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
