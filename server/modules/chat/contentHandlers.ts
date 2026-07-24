import type { Request, Response } from "express";
import { db, isLocalhostUrl } from "../../db.js";
import { synthesizeCustomAdapterSpeech } from "../../services/customProviderAdapters.js";
import { LOCAL_INFERENCE_URL, synthesizeLocalPiper } from "../../services/localInference.js";
import { completeProviderOnce, normalizeOpenAiBaseUrl } from "./providerExecution.js";
import { buildReasoningAwareTimeline } from "./reasoningContext.js";
import { getSettings, getTimeline, resolveBranch, type MessageRow, type ProviderRow } from "./routeHelpers.js";
import { splitRealtimeTtsInput } from "./ttsRealtime.js";
import { streamOpenAiCompatibleTts } from "./ttsUpstreamStream.js";

function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === "AbortError" ||
    /aborted|abort|timed out|timeout/i.test(error.message)
  );
}

async function withServerTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Translation provider timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export async function compressChat(req: Request, res: Response) {
  const chatId = String(req.params.id || "");
  const { branchId: reqBranchId } = req.body ?? {};
  const branchId = resolveBranch(chatId, reqBranchId);

  const settings = getSettings();
  const providerId = settings.compressProviderId || settings.activeProviderId;
  const modelId = settings.compressModel || settings.activeModel;
  const timeline = buildReasoningAwareTimeline(
    getTimeline(chatId, branchId),
    settings.includeReasoningInContext !== false
  );

  if (!providerId || !modelId || timeline.length === 0) {
    const summary = timeline.slice(-settings.compressionFallbackMessages).map((message) => {
      const reasoning = message.reasoningContent ? ` | reasoning: ${message.reasoningContent.split("\n")[0].slice(0, 80)}` : "";
      return `${message.role}: ${message.content.split("\n")[0].slice(0, 80)}${reasoning}`;
    }).join("\n");
    db.prepare("UPDATE chats SET context_summary = ? WHERE id = ?").run(summary, chatId);
    res.json({ summary });
    return;
  }

  const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId) as ProviderRow | undefined;
  if (!provider) {
    res.json({ summary: "" });
    return;
  }

  const messagesToSummarize = timeline.map((message) => {
    const reasoning = message.reasoningContent ? `\n[assistant reasoning]: ${message.reasoningContent}` : "";
    return `[${message.role}]: ${message.content}${reasoning}`;
  }).join("\n\n");
  const compressTemplate = settings.promptTemplates?.compressSummary
    || "Summarize the following roleplay conversation. Preserve key plot points, character details, relationships, and important events. Be concise but thorough.";

  try {
    const summary = await completeProviderOnce({
      provider,
      modelId,
      systemPrompt: compressTemplate,
      userPrompt: messagesToSummarize,
      samplerConfig: {
        temperature: settings.compressionTemperature,
        maxTokens: settings.compressionMaxTokens
      },
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
    const translation = await withServerTimeout(settings.translationTimeoutSeconds * 1000, (signal) => completeProviderOnce({
      provider,
      modelId,
      systemPrompt: `Translate the following message to ${language}. Output ONLY the translation, nothing else. Preserve formatting, line breaks, and markdown.`,
      userPrompt: message.content,
      samplerConfig: {
        temperature: settings.translationTemperature,
        maxTokens: settings.translationMaxTokens
      },
      apiParamPolicy: settings.apiParamPolicy,
      signal
    }));
    res.json({ translation: String(translation || "").trim() || message.content });
  } catch (error) {
    if (!isAbortLikeError(error)) {
      console.warn("Message translation failed", error);
    }
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

export async function ttsMessageRealtime(req: Request, res: Response) {
  const messageId = req.params.id;
  const message = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId) as MessageRow | undefined;
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  await streamTtsText(String(message.content || ""), req, res);
}

export async function ttsText(req: Request, res: Response) {
  const input = String(req.body?.input || "").trim().slice(0, 4000);
  if (!input) {
    res.status(400).json({ error: "TTS input is empty" });
    return;
  }
  await synthesizeTtsText(input, res);
}

export async function ttsTextRealtime(req: Request, res: Response) {
  const input = String(req.body?.input || "").trim().slice(0, 4000);
  if (!input) {
    res.status(400).json({ error: "TTS input is empty" });
    return;
  }
  await streamTtsText(input, req, res);
}

async function streamTtsText(input: string, req: Request, res: Response) {
  const settings = getSettings();
  const rawBaseUrl = String(settings.ttsBaseUrl || "").trim();
  const apiKey = String(settings.ttsApiKey || "").trim();
  const adapterId = String(settings.ttsAdapterId || "").trim();
  const isLocalPiper = rawBaseUrl === LOCAL_INFERENCE_URL;
  const baseUrl = adapterId || isLocalPiper ? rawBaseUrl : normalizeOpenAiBaseUrl(rawBaseUrl);
  const model = String(settings.ttsModel || "").trim();
  const voice = String(settings.ttsVoice || "alloy").trim() || "alloy";
  if (!baseUrl || !model) {
    res.status(400).json({ error: "TTS endpoint/model not configured" });
    return;
  }
  if (settings.fullLocalMode && !isLocalPiper && !isLocalhostUrl(baseUrl)) {
    res.status(403).json({ error: "TTS endpoint blocked by Full Local Mode" });
    return;
  }

  const controller = new AbortController();
  const onClose = () => controller.abort(new Error("TTS client disconnected"));
  res.once("close", onClose);
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  try {
    if (!adapterId && !isLocalPiper) {
      let nativeIndex = 0;
      const nativeCount = await streamOpenAiCompatibleTts({
        baseUrl,
        apiKey,
        model,
        voice,
        input: String(input || "").replace(/\s+/g, " ").trim().slice(0, 4000),
        signal: controller.signal
      }, (chunk) => {
        if (controller.signal.aborted || res.destroyed) return;
        res.write(`${JSON.stringify({
          type: "audio",
          index: nativeIndex,
          contentType: "audio/pcm",
          audioBase64: chunk.audioBase64,
          format: chunk.format,
          sampleRate: chunk.sampleRate
        })}\n`);
        nativeIndex += 1;
      });
      if (nativeCount !== null) {
        if (!res.destroyed) res.end(`${JSON.stringify({ type: "done", count: nativeCount })}\n`);
        return;
      }
    }

    const chunks = splitRealtimeTtsInput(input);
    for (let index = 0; index < chunks.length; index += 1) {
      if (controller.signal.aborted || res.destroyed) break;
      const audio = await synthesizeTtsAudio(chunks[index], controller.signal);
      res.write(`${JSON.stringify({
        type: "audio",
        index,
        contentType: audio.contentType,
        audioBase64: audio.buffer.toString("base64")
      })}\n`);
    }
    if (!res.destroyed) res.end(`${JSON.stringify({ type: "done", count: chunks.length })}\n`);
  } catch (error) {
    if (!controller.signal.aborted && !res.destroyed) {
      res.end(`${JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "TTS request failed" })}\n`);
    }
  } finally {
    res.removeListener("close", onClose);
  }
}

async function synthesizeTtsText(input: string, res: Response) {
  try {
    const audio = await synthesizeTtsAudio(input);
    res.setHeader("Content-Type", audio.contentType);
    res.setHeader("Cache-Control", "no-store");
    res.send(audio.buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS request failed";
    const status = /not configured/i.test(message) ? 400 : /blocked by Full Local Mode/i.test(message) ? 403 : 500;
    res.status(status).json({ error: message });
  }
}

async function synthesizeTtsAudio(input: string, signal?: AbortSignal): Promise<{ contentType: string; buffer: Buffer }> {
  const settings = getSettings();
  const rawBaseUrl = String(settings.ttsBaseUrl || "").trim();
  const apiKey = String(settings.ttsApiKey || "").trim();
  const adapterId = String(settings.ttsAdapterId || "").trim();
  const isLocalPiper = rawBaseUrl === LOCAL_INFERENCE_URL;
  const baseUrl = adapterId || isLocalPiper ? rawBaseUrl : normalizeOpenAiBaseUrl(rawBaseUrl);
  const model = String(settings.ttsModel || "").trim();
  const voice = String(settings.ttsVoice || "alloy").trim() || "alloy";
  if (!baseUrl || !model) {
    throw new Error("TTS endpoint/model not configured");
  }

  if (settings.fullLocalMode && !isLocalPiper && !isLocalhostUrl(baseUrl)) {
    throw new Error("TTS endpoint blocked by Full Local Mode");
  }

  if (isLocalPiper) {
    return { contentType: "audio/wav", buffer: await synthesizeLocalPiper(input) };
  }
  if (adapterId) {
    return synthesizeCustomAdapterSpeech({
      provider: {
        base_url: String(settings.ttsBaseUrl || "").trim(),
        api_key_cipher: apiKey,
        adapter_id: adapterId
      },
      modelId: model,
      voice,
      input,
      signal
    });
  }

  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({ model, voice, input }),
    signal
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`TTS failed: ${details.slice(0, 500) || response.statusText}`);
  }
  return {
    contentType: response.headers.get("content-type") || "audio/mpeg",
    buffer: Buffer.from(await response.arrayBuffer())
  };
}
