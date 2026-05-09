import type { Request, Response } from "express";
import { db, isLocalhostUrl } from "../../db.js";
import { synthesizeCustomAdapterSpeech } from "../../services/customProviderAdapters.js";
import { completeProviderOnce, normalizeOpenAiBaseUrl } from "./providerExecution.js";
import { getSettings, getTimeline, resolveBranch, type MessageRow, type ProviderRow } from "./routeHelpers.js";

export async function compressChat(req: Request, res: Response) {
  const chatId = req.params.id;
  const { branchId: reqBranchId } = req.body ?? {};
  const branchId = resolveBranch(chatId, reqBranchId);

  const settings = getSettings();
  const providerId = settings.compressProviderId || settings.activeProviderId;
  const modelId = settings.compressModel || settings.activeModel;
  const timeline = getTimeline(chatId, branchId);

  if (!providerId || !modelId || timeline.length === 0) {
    const summary = timeline.slice(-8).map((message) => `${message.role}: ${message.content.split("\n")[0].slice(0, 80)}`).join("\n");
    db.prepare("UPDATE chats SET context_summary = ? WHERE id = ?").run(summary, chatId);
    res.json({ summary });
    return;
  }

  const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId) as ProviderRow | undefined;
  if (!provider) {
    res.json({ summary: "" });
    return;
  }

  const messagesToSummarize = timeline.map((message) => `[${message.role}]: ${message.content}`).join("\n\n");
  const compressTemplate = settings.promptTemplates?.compressSummary
    || "Summarize the following roleplay conversation. Preserve key plot points, character details, relationships, and important events. Be concise but thorough.";

  try {
    const summary = await completeProviderOnce({
      provider,
      modelId,
      systemPrompt: compressTemplate,
      userPrompt: messagesToSummarize,
      samplerConfig: { temperature: 0.3, maxTokens: 1024 },
      apiParamPolicy: settings.apiParamPolicy
    });

    db.prepare("UPDATE chats SET context_summary = ? WHERE id = ?").run(summary, chatId);
    res.json({ summary });
  } catch {
    res.json({ summary: "" });
  }
}

export async function translateMessage(req: Request, res: Response) {
  const messageId = req.params.id;
  const { targetLanguage } = req.body ?? {};

  const message = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId) as MessageRow | undefined;
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  const settings = getSettings();
  const providerId = settings.translateProviderId || settings.activeProviderId;
  let modelId = settings.translateModel || settings.activeModel;
  if (settings.translateProviderId && !settings.translateModel && settings.translateProviderId !== settings.activeProviderId) {
    modelId = null;
  }

  if (!providerId || !modelId) {
    res.json({ translation: `[No model configured] ${message.content}` });
    return;
  }

  const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId) as ProviderRow | undefined;
  if (!provider) {
    res.json({ translation: message.content });
    return;
  }
  if (settings.fullLocalMode && !isLocalhostUrl(provider.base_url)) {
    res.json({ translation: message.content });
    return;
  }
  if (provider.full_local_only && !isLocalhostUrl(provider.base_url)) {
    res.json({ translation: message.content });
    return;
  }

  const language = targetLanguage || settings.translateLanguage || settings.responseLanguage || "English";

  try {
    const translation = await completeProviderOnce({
      provider,
      modelId,
      systemPrompt: `Translate the following message to ${language}. Output ONLY the translation, nothing else. Preserve formatting, line breaks, and markdown.`,
      userPrompt: message.content,
      samplerConfig: { temperature: 0.2, maxTokens: 2048 },
      apiParamPolicy: settings.apiParamPolicy
    });
    res.json({ translation });
  } catch {
    res.json({ translation: message.content });
  }
}

export async function ttsMessage(req: Request, res: Response) {
  const messageId = req.params.id;
  const message = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId) as MessageRow | undefined;
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  await synthesizeTtsText(String(message.content || ""), res);
}

export async function ttsText(req: Request, res: Response) {
  const input = String(req.body?.input || "").trim().slice(0, 4000);
  if (!input) {
    res.status(400).json({ error: "TTS input is empty" });
    return;
  }
  await synthesizeTtsText(input, res);
}

async function synthesizeTtsText(input: string, res: Response) {
  const settings = getSettings();
  const rawBaseUrl = String(settings.ttsBaseUrl || "").trim();
  const apiKey = String(settings.ttsApiKey || "").trim();
  const adapterId = String(settings.ttsAdapterId || "").trim();
  const baseUrl = adapterId ? rawBaseUrl : normalizeOpenAiBaseUrl(rawBaseUrl);
  const model = String(settings.ttsModel || "").trim();
  const voice = String(settings.ttsVoice || "alloy").trim() || "alloy";
  if (!baseUrl || !model) {
    res.status(400).json({ error: "TTS endpoint/model not configured" });
    return;
  }

  if (settings.fullLocalMode && !isLocalhostUrl(baseUrl)) {
    res.status(403).json({ error: "TTS endpoint blocked by Full Local Mode" });
    return;
  }

  try {
    if (adapterId) {
      const result = await synthesizeCustomAdapterSpeech({
        provider: {
          base_url: String(settings.ttsBaseUrl || "").trim(),
          api_key_cipher: apiKey,
          adapter_id: adapterId
        },
        modelId: model,
        voice,
        input
      });
      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Cache-Control", "no-store");
      res.send(result.buffer);
      return;
    }

    const response = await fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        voice,
        input
      })
    });
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      res.status(response.status).json({ error: `TTS failed: ${details.slice(0, 500) || response.statusText}` });
      return;
    }

    const contentType = response.headers.get("content-type") || "audio/mpeg";
    const arrayBuffer = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "TTS request failed" });
  }
}
