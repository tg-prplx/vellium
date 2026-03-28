import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import { PLUGINS_DIR } from "../../db.js";
import { collectManifestAssetPaths, normalizeManifest, normalizePluginfile, sanitizePluginDirSegment, sanitizeRelativeAssetPath } from "./manifest.js";
import { getPluginDescriptor, invalidatePluginDiscoveryCache, listPluginAssetPaths, resolvePluginAssetPath } from "./discovery.js";
import type { PluginDescriptor, PluginfileDocument } from "./types.js";

export function exportPluginfile(pluginId: string): PluginfileDocument | null {
  const plugin = getPluginDescriptor(pluginId);
  if (!plugin) return null;
  const files: Record<string, string> = {};
  for (const assetPath of listPluginAssetPaths(pluginId)) {
    const resolved = resolvePluginAssetPath(pluginId, assetPath);
    if (!resolved || !existsSync(resolved)) continue;
    files[assetPath] = readFileSync(resolved, "utf-8");
  }
  return {
    format: "vellium-pluginfile@1",
    manifest: buildPluginfileManifest(plugin),
    files
  };
}

function buildPluginfileManifest(plugin: PluginDescriptor): Record<string, unknown> {
  return {
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
