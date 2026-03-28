import { ALL_PLUGIN_PERMISSIONS, type PluginPermission } from "./types.js";
import { invalidatePluginDiscoveryCache } from "./discovery.js";
import { normalizePluginDataValue, readSettingsPayload, writeSettingsPayload } from "./settingsStore.js";

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
  const payload = readSettingsPayload();
  const current = payload.pluginPermissionGrants && typeof payload.pluginPermissionGrants === "object" && !Array.isArray(payload.pluginPermissionGrants)
    ? payload.pluginPermissionGrants as Record<string, unknown>
    : {};
  const grants = current[pluginId];
  if (!grants || typeof grants !== "object" || Array.isArray(grants)) return {};
  const out: Record<string, boolean> = {};
  for (const [permission, enabled] of Object.entries(grants as Record<string, unknown>)) {
    const key = String(permission || "").trim() as PluginPermission;
    if (!ALL_PLUGIN_PERMISSIONS.includes(key)) continue;
    out[key] = enabled === true;
  }
  return out;
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
