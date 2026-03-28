import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { normalize, resolve, sep, join } from "path";
import { BUNDLED_PLUGINS_DIR, PLUGINS_DIR } from "../../db.js";
import { collectManifestAssetPaths, encodeAssetPath, normalizeManifest, normalizePluginfile, sanitizeRelativeAssetPath } from "./manifest.js";
import { readPluginPermissionGrants, readPluginStateConfigured, readPluginStates } from "./settingsStore.js";
import type { PluginCatalog, PluginDescriptor, PluginDiscoveryCache } from "./types.js";
import { PLUGIN_SLOT_IDS } from "./types.js";

let pluginDiscoveryCache: PluginDiscoveryCache | null = null;

export function invalidatePluginDiscoveryCache() {
  pluginDiscoveryCache = null;
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

  const plugins = Array.from(pluginsById.values()).sort((a, b) => a.name.localeCompare(b.name));
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

export function discoverPlugins(): PluginCatalog {
  return discoverPluginsWithCache(false).catalog;
}

export function reloadPluginCatalog(): PluginCatalog {
  return discoverPluginsWithCache(true).catalog;
}

export function getPluginDescriptor(pluginId: string): PluginDescriptor | undefined {
  return discoverPlugins().plugins.find((plugin) => plugin.id === pluginId);
}

export function resolvePluginRootDir(pluginId: string): string | null {
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

export function listPluginAssetPaths(pluginId: string): string[] {
  const plugin = getPluginDescriptor(pluginId);
  return plugin ? collectManifestAssetPaths(plugin) : [];
}
