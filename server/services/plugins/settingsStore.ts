import { db, DEFAULT_SETTINGS } from "../../db.js";
import { ALL_PLUGIN_PERMISSIONS, type PluginPermission } from "./types.js";

export function readPluginStates(): Record<string, boolean> {
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

export function readPluginStateConfigured(): Record<string, boolean> {
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

export function readPluginPermissionGrants(): Record<string, Record<string, boolean>> {
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

export function readSettingsPayload(): Record<string, unknown> {
  const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
  return row ? JSON.parse(row.payload) as Record<string, unknown> : {};
}

export function writeSettingsPayload(payload: Record<string, unknown>) {
  db.prepare("UPDATE settings SET payload = ? WHERE id = 1").run(JSON.stringify(payload));
}

export function normalizePluginDataValue(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, unknown>) };
}
