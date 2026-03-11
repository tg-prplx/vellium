import { Router } from "express";
import { existsSync } from "fs";
import { extname } from "path";
import { buildPluginAssetHeaders, sanitizePluginSettingsPatch } from "../services/pluginSecurity.js";
import {
  discoverPlugins,
  getPluginData,
  getPluginDescriptor,
  patchPluginData,
  PLUGIN_SDK_SOURCE,
  reloadPluginCatalog,
  resolvePluginAssetPath,
  setPluginEnabledState
} from "../services/plugins.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json(discoverPlugins());
});

router.post("/reload", (_req, res) => {
  res.json(reloadPluginCatalog());
});

router.patch("/:id/state", (req, res) => {
  const pluginId = String(req.params.id || "").trim();
  const plugin = getPluginDescriptor(pluginId);
  if (!plugin) {
    res.status(404).json({ error: "Plugin not found" });
    return;
  }
  const enabled = req.body?.enabled === true;
  setPluginEnabledState(plugin.id, enabled);
  const updated = getPluginDescriptor(plugin.id);
  res.json({ ok: true, enabled, plugin: updated ?? plugin });
});

router.get("/:id/settings", (req, res) => {
  const pluginId = String(req.params.id || "").trim();
  const plugin = getPluginDescriptor(pluginId);
  if (!plugin) {
    res.status(404).json({ error: "Plugin not found" });
    return;
  }
  res.json(getPluginData(plugin.id));
});

router.patch("/:id/settings", (req, res) => {
  const pluginId = String(req.params.id || "").trim();
  const plugin = getPluginDescriptor(pluginId);
  if (!plugin) {
    res.status(404).json({ error: "Plugin not found" });
    return;
  }
  try {
    const data = patchPluginData(plugin.id, sanitizePluginSettingsPatch(req.body));
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid plugin settings patch" });
  }
});

router.get("/sdk.js", (_req, res) => {
  res.type("application/javascript");
  for (const [key, value] of Object.entries(buildPluginAssetHeaders("js"))) {
    res.setHeader(key, value);
  }
  res.send(PLUGIN_SDK_SOURCE);
});

router.get("/:id/assets/*", (req, res) => {
  const pluginId = String(req.params.id || "").trim();
  const assetPath = String(req.params[0] || "").trim();
  const resolved = resolvePluginAssetPath(pluginId, assetPath);
  if (!resolved || !existsSync(resolved)) {
    res.status(404).json({ error: "Plugin asset not found" });
    return;
  }
  const ext = extname(resolved).slice(1).toLowerCase();
  for (const [key, value] of Object.entries(buildPluginAssetHeaders(ext))) {
    res.setHeader(key, value);
  }
  res.sendFile(resolved);
});

export default router;
