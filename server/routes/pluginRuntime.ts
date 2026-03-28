import { Router } from "express";
import { db, DEFAULT_SETTINGS, isLocalhostUrl } from "../db.js";
import { normalizeApiParamPolicy } from "../services/apiParamPolicy.js";
import {
  sanitizePluginRuntimeId,
  sanitizePluginRuntimeMessages,
  sanitizePluginRuntimePrompt,
  sanitizePluginRuntimeSamplerConfig
} from "../services/requestSecurity.js";
import { unifiedGenerateText, type UnifiedGenerateMessage } from "../services/unifiedGeneration.js";

const router = Router();

interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  api_key_cipher: string;
  proxy_url: string | null;
  full_local_only: number;
  provider_type: string | null;
  adapter_id: string | null;
}

function getSettings() {
  const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
  if (!row) {
    return {
      ...DEFAULT_SETTINGS,
      samplerConfig: { ...DEFAULT_SETTINGS.samplerConfig },
      apiParamPolicy: normalizeApiParamPolicy(DEFAULT_SETTINGS.apiParamPolicy)
    };
  }
  try {
    const stored = JSON.parse(row.payload) as Record<string, unknown>;
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      samplerConfig: { ...DEFAULT_SETTINGS.samplerConfig, ...((stored.samplerConfig as Record<string, unknown>) ?? {}) },
      apiParamPolicy: normalizeApiParamPolicy(stored.apiParamPolicy)
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      samplerConfig: { ...DEFAULT_SETTINGS.samplerConfig },
      apiParamPolicy: normalizeApiParamPolicy(DEFAULT_SETTINGS.apiParamPolicy)
    };
  }
}

router.post("/generate", async (req, res) => {
  const settings = getSettings();
  let providerId = "";
  let modelId = "";
  let messages: UnifiedGenerateMessage[] = [];
  let systemPrompt = "";
  let userPrompt = "";
  let samplerConfig: Record<string, unknown> = {};
  try {
    providerId = sanitizePluginRuntimeId(req.body?.providerId || settings.activeProviderId || "", "providerId");
    modelId = sanitizePluginRuntimeId(req.body?.modelId || settings.activeModel || "", "modelId");
    messages = sanitizePluginRuntimeMessages(req.body?.messages);
    systemPrompt = sanitizePluginRuntimePrompt(req.body?.systemPrompt, "systemPrompt");
    userPrompt = sanitizePluginRuntimePrompt(req.body?.userPrompt, "userPrompt");
    samplerConfig = sanitizePluginRuntimeSamplerConfig(req.body?.samplerConfig);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid plugin runtime payload" });
    return;
  }
  if (!providerId || !modelId) {
    res.status(400).json({ error: "providerId and modelId are required (or set active provider/model first)" });
    return;
  }
  const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId) as ProviderRow | undefined;
  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  if (settings.fullLocalMode && !isLocalhostUrl(provider.base_url)) {
    res.status(403).json({ error: "Provider blocked by Full Local Mode" });
    return;
  }
  if (provider.full_local_only && !isLocalhostUrl(provider.base_url)) {
    res.status(403).json({ error: "Provider is set to Local-only. Disable Local-only for external URLs." });
    return;
  }

  const payloadMessages = messages.length > 0
    ? messages
    : [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...(userPrompt ? [{ role: "user", content: userPrompt }] : [])
    ];
  if (payloadMessages.length === 0) {
    res.status(400).json({ error: "messages or systemPrompt/userPrompt are required" });
    return;
  }

  try {
    const result = await unifiedGenerateText({
      provider,
      modelId,
      messages: payloadMessages,
      samplerConfig: {
        ...settings.samplerConfig,
        ...samplerConfig
      },
      apiParamPolicy: settings.apiParamPolicy
    });
    res.json({
      ok: true,
      providerId,
      modelId,
      providerType: result.providerType,
      content: result.content,
      reasoning: result.reasoning
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unified generation failed" });
  }
});

export default router;
