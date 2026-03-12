import { Router } from "express";
import { existsSync } from "fs";
import { extname } from "path";
import { buildPluginAssetHeaders, sanitizePluginSettingsPatch } from "../services/pluginSecurity.js";
import {
  discoverPlugins,
  exportPluginfile,
  getPluginData,
  getPluginDescriptor,
  getPluginPermissionGrants,
  installPluginfile,
  patchPluginData,
  PLUGIN_SDK_SOURCE,
  reloadPluginCatalog,
  resolvePluginAssetPath,
  setPluginPermissionGrants,
  setPluginEnabledState
} from "../services/plugins.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json(discoverPlugins());
});

router.post("/reload", (_req, res) => {
  res.json(reloadPluginCatalog());
});

router.post("/install-pluginfile", (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body as { data?: unknown; rawJson?: unknown }
      : {};
    const installed = installPluginfile(body.data ?? body.rawJson);
    res.json({ ok: true, plugin: installed, catalog: reloadPluginCatalog() });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to install Pluginfile" });
  }
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

router.get("/:id/pluginfile", (req, res) => {
  const pluginId = String(req.params.id || "").trim();
  const plugin = getPluginDescriptor(pluginId);
  if (!plugin) {
    res.status(404).json({ error: "Plugin not found" });
    return;
  }
  const pluginfile = exportPluginfile(plugin.id);
  if (!pluginfile) {
    res.status(404).json({ error: "Pluginfile export not available" });
    return;
  }
  res.setHeader("Content-Disposition", `attachment; filename="${plugin.id}.pluginfile.json"`);
  res.json(pluginfile);
});

router.get("/:id/permissions", (req, res) => {
  const pluginId = String(req.params.id || "").trim();
  const plugin = getPluginDescriptor(pluginId);
  if (!plugin) {
    res.status(404).json({ error: "Plugin not found" });
    return;
  }
  res.json({
    requested: plugin.requestedPermissions,
    granted: plugin.grantedPermissions,
    configured: plugin.permissionsConfigured,
    grants: getPluginPermissionGrants(plugin.id)
  });
});

router.patch("/:id/permissions", (req, res) => {
  const pluginId = String(req.params.id || "").trim();
  const plugin = getPluginDescriptor(pluginId);
  if (!plugin) {
    res.status(404).json({ error: "Plugin not found" });
    return;
  }
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as { grants?: unknown }
    : {};
  const grants = setPluginPermissionGrants(plugin.id, body.grants);
  const updated = getPluginDescriptor(plugin.id);
  res.json({
    ok: true,
    requested: updated?.requestedPermissions ?? plugin.requestedPermissions,
    granted: updated?.grantedPermissions ?? plugin.grantedPermissions,
    configured: updated?.permissionsConfigured ?? true,
    grants
  });
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
