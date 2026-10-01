import type { RagContextSource } from "../../services/rag.js";
import type { GenerationStats } from "../../../src/shared/types/chatContext.js";
import { buildChatContext } from "./buildChatContext.js";
import type { Response } from "express";
import { db, newId, now, roughTokenCount, isLocalhostUrl, nextSortOrder } from "../../db.js";
import { normalizeProviderType } from "../../services/providerApi.js";
import {
  countProviderTokensDetailed,
  streamProviderCompletion
} from "./providerExecution.js";
import {
  getTimeline,
  type ProviderRow,
  type UserPersonaPayload
} from "./routeHelpers.js";
import {
  appendMissingToolImageMarkdown,
  OpenAICompletionMessage,
  REASONING_CALL_NAME,
  runToolCallingCompletion,
  serializeToolTrace,
  type ToolCallTrace
} from "./tooling.js";
import {
  stripLiveAvatarControlMarkup
} from "../../../src/shared/liveAvatarControl.js";
import type { LiveAvatarControlCapabilities } from "../../../src/shared/types/inochiAvatar.js";

export const activeAbortControllers = new Map<string, AbortController>();

async function sendSseText(res: Response, chatId: string, text: string, paceMs = 0) {
  const chunks = text.match(/[\s\S]{1,140}/g) ?? [];
  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify({ type: "delta", chatId, delta: chunk })}\n\n`);
    if (typeof (res as Response & { flush?: () => void }).flush === "function") {
      (res as Response & { flush?: () => void }).flush?.();
    }
    if (paceMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, paceMs));
    }
  }
}

function insertFallbackAssistantMessage(params: {
  chatId: string;
  branchId: string;
  parentMsgId: string | null;
  content: string;
  characterName?: string;
}) {
  const assistantId = newId();
  db.prepare(
    "INSERT INTO messages (id, chat_id, branch_id, role, content, token_count, parent_id, deleted, created_at, character_name, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)"
  ).run(
    assistantId,
    params.chatId,
    params.branchId,
    "assistant",
    params.content,
    roughTokenCount(params.content),
    params.parentMsgId,
    now(),
    params.characterName || null,
    nextSortOrder(params.chatId, params.branchId)
  );
}

async function persistAssistantTurn(params: {
  provider: ProviderRow;
  chatId: string;
  branchId: string;
  parentMsgId: string | null;
  content: string;
  overrideCharacterName?: string;
  ragSources: RagContextSource[];
  toolTraces: ToolCallTrace[];
  reasoningMaxChars: number;
  generationMeta: {
    generationStartedAt: string | null;
    generationCompletedAt: string | null;
    generationDurationMs: number | null;
    generationStats?: GenerationStats;
  };
  liveAvatarControls?: boolean;
}) {
  const content = params.liveAvatarControls ? stripLiveAvatarControlMarkup(params.content) : params.content;
  if (!content && params.toolTraces.length === 0) return;

  const assistantId = newId();
  const stats = params.generationMeta.generationStats;
  const counted = stats?.tokenSource === "provider" && !stats.reasoningTokens && !params.toolTraces.length && !params.liveAvatarControls
    ? { tokens: stats.outputTokens, source: "tokenizer" as const }
    : await countProviderTokensDetailed(params.provider, content);
  db.prepare(
    "INSERT INTO messages (id, chat_id, branch_id, role, content, token_count, parent_id, deleted, created_at, generation_started_at, generation_completed_at, generation_duration_ms, character_name, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)"
  ).run(
    assistantId,
    params.chatId,
    params.branchId,
    "assistant",
    content,
    counted.tokens,
    params.parentMsgId,
    now(),
    params.generationMeta.generationStartedAt,
    params.generationMeta.generationCompletedAt,
    params.generationMeta.generationDurationMs,
    params.overrideCharacterName || null,
    nextSortOrder(params.chatId, params.branchId)
  );

  db.prepare("UPDATE messages SET token_count_source = ? WHERE id = ?").run(counted.source, assistantId);
  if (params.generationMeta.generationStats) {
    db.prepare("UPDATE messages SET generation_stats = ? WHERE id = ?").run(JSON.stringify(params.generationMeta.generationStats), assistantId);
  }

  if (params.ragSources.length > 0) {
    db.prepare("UPDATE messages SET rag_sources = ? WHERE id = ?")
      .run(JSON.stringify(params.ragSources), assistantId);
  }

  for (const trace of params.toolTraces) {
    const toolText = serializeToolTrace(trace, trace.name === REASONING_CALL_NAME ? params.reasoningMaxChars : undefined);
    db.prepare(
      "INSERT INTO messages (id, chat_id, branch_id, role, content, token_count, parent_id, deleted, created_at, generation_started_at, generation_completed_at, generation_duration_ms, character_name, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)"
    ).run(
      newId(),
      params.chatId,
      params.branchId,
      "tool",
      toolText,
      roughTokenCount(toolText),
      assistantId,
      now(),
      params.generationMeta.generationStartedAt,
      params.generationMeta.generationCompletedAt,
      params.generationMeta.generationDurationMs,
      null,
      nextSortOrder(params.chatId, params.branchId)
    );
  }
}

export async function streamLlmResponse(params: {
  chatId: string;
  branchId: string;
  res: Response;
  parentMsgId: string | null;
  overrideCharacterName?: string;
  isAutoConvo?: boolean;
  userPersona?: UserPersonaPayload;
  runtimeSystemPrompt?: string;
  liveAvatar?: LiveAvatarControlCapabilities;
}) {
  const { settings, providerId, modelId, samplerConfig, liveAvatar, timeline, ragSourcesForAssistant, apiMessages, config, inputTokens, contextWindowBudget, reservedOutputTokens } = await buildChatContext(params);

  if (!providerId || !modelId) {
    const lastUser = timeline.filter((message) => message.role === "user").pop();
    const assistantText = `[No provider configured] Echo: ${lastUser?.content || "..."}`;
    insertFallbackAssistantMessage({
      chatId: params.chatId,
      branchId: params.branchId,
      parentMsgId: params.parentMsgId,
      content: assistantText,
      characterName: params.overrideCharacterName
    });
    params.res.json(getTimeline(params.chatId, params.branchId));
    return;
  }

  const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId) as ProviderRow | undefined;
  if (!provider) {
    insertFallbackAssistantMessage({
      chatId: params.chatId,
      branchId: params.branchId,
      parentMsgId: params.parentMsgId,
      content: "[Provider not found] Configure a provider in Settings.",
      characterName: params.overrideCharacterName
    });
    params.res.json(getTimeline(params.chatId, params.branchId));
    return;
  }

  if (settings.fullLocalMode && !isLocalhostUrl(provider.base_url)) {
    params.res.status(400).json({ error: "Provider blocked by Full Local Mode" });
    return;
  }

  if (config.contextWindowSize !== undefined && inputTokens + reservedOutputTokens > contextWindowBudget) {
    params.res.status(400).json({ error: "Context budget exceeded. Open Context to increase the window, reduce reply reserve or shorten instructions." });
    return;
  }

  params.res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  params.res.flushHeaders?.();

  const abortController = new AbortController();
  activeAbortControllers.set(params.chatId, abortController);
  let responseSettled = false;

  params.res.on("finish", () => {
    responseSettled = true;
    activeAbortControllers.delete(params.chatId);
  });
  params.res.on("close", () => {
    if (!responseSettled) {
      abortController.abort();
    }
    activeAbortControllers.delete(params.chatId);
  });

  try {
    const sc = samplerConfig as Record<string, unknown>;
    const toolCallingEnabled = settings.toolCallingEnabled === true
      && normalizeProviderType(provider.provider_type) === "openai";

    if (toolCallingEnabled) {
      const toolResult = await runToolCallingCompletion({
        provider,
        modelId,
        samplerConfig: sc,
        apiMessages: apiMessages as unknown as OpenAICompletionMessage[],
        settings: settings as Record<string, unknown>,
        signal: abortController.signal,
        onAssistantDelta: (delta) => {
          if (!delta) return;
          params.res.write(`data: ${JSON.stringify({ type: "delta", chatId: params.chatId, delta })}\n\n`);
          if (typeof (params.res as Response & { flush?: () => void }).flush === "function") {
            (params.res as Response & { flush?: () => void }).flush?.();
          }
        },
        onToolEvent: (event) => {
          const safeArgs = String(event.args || "").slice(0, 2000);
          const safeResult = typeof event.result === "string" ? event.result.slice(0, 4000) : undefined;
          params.res.write(`data: ${JSON.stringify({
            type: "tool",
            chatId: params.chatId,
            phase: event.phase,
            callId: event.callId,
            name: event.name,
            args: safeArgs,
            result: safeResult
          })}\n\n`);
          if (typeof (params.res as Response & { flush?: () => void }).flush === "function") {
            (params.res as Response & { flush?: () => void }).flush?.();
          }
        }
      });

      if (toolResult) {
        let fullContent = toolResult.content || "";
        let reasoningTraces: ToolCallTrace[] = [];
        const finalAssistantStreamed = toolResult.assistantWasStreamed === true
          || (Array.isArray(toolResult.streamMessages) && toolResult.streamMessages.length > 0);
        let generationMeta: {
          generationStartedAt: string | null;
          generationCompletedAt: string | null;
          generationDurationMs: number | null;
          generationStats?: GenerationStats;
        } = {
          generationStartedAt: null,
          generationCompletedAt: null,
          generationDurationMs: null,
          generationStats: toolResult.generationStats
        };

        if (Array.isArray(toolResult.streamMessages) && toolResult.streamMessages.length > 0) {
          const streamResult = await streamProviderCompletion({
            provider,
            modelId,
            messages: toolResult.streamMessages as Array<{ role: string; content: unknown }>,
            samplerConfig: sc,
            apiParamPolicy: settings.apiParamPolicy,
            reasoningMaxChars: settings.reasoningMaxChars,
            chatId: params.chatId,
            res: params.res,
            signal: abortController.signal
          });
          fullContent = streamResult.content;
          reasoningTraces = streamResult.toolTraces;
          generationMeta = {
            generationStartedAt: streamResult.generationStartedAt,
            generationCompletedAt: streamResult.generationCompletedAt,
            generationDurationMs: streamResult.generationDurationMs,
            generationStats: {
              ...streamResult.generationStats,
              requests: (toolResult.generationStats?.requests || 0) + 1,
              totalInputTokens: toolResult.generationStats?.totalInputTokens !== undefined && streamResult.generationStats.inputTokens !== undefined ? toolResult.generationStats.totalInputTokens + streamResult.generationStats.inputTokens : undefined,
              totalOutputTokens: toolResult.generationStats?.totalOutputTokens !== undefined && streamResult.generationStats.tokenSource === "provider" ? toolResult.generationStats.totalOutputTokens + streamResult.generationStats.outputTokens : undefined,
              totalMs: (toolResult.generationStats?.totalMs || 0) + streamResult.generationStats.totalMs,
              firstTokenMs: streamResult.generationStats.firstTokenMs === undefined ? undefined : (toolResult.generationStats?.totalMs || 0) + streamResult.generationStats.firstTokenMs
            }
          };
        }

        const combinedToolTraces = [...toolResult.toolCalls, ...reasoningTraces];
        const imageAugmentation = appendMissingToolImageMarkdown(fullContent, combinedToolTraces);
        if (imageAugmentation.appended) {
          fullContent = imageAugmentation.content;
          await sendSseText(
            params.res,
            params.chatId,
            finalAssistantStreamed ? imageAugmentation.appended : fullContent,
            12
          );
        } else if (!finalAssistantStreamed) {
          if (fullContent) {
            await sendSseText(params.res, params.chatId, fullContent, 12);
          }
        }

        if (generationMeta.generationStats) {
          generationMeta.generationDurationMs = generationMeta.generationStats.totalMs;
          generationMeta.generationCompletedAt = now();
          generationMeta.generationStartedAt = new Date(Date.now() - generationMeta.generationStats.totalMs).toISOString();
        }
        await persistAssistantTurn({
          provider,
          chatId: params.chatId,
          branchId: params.branchId,
          parentMsgId: params.parentMsgId,
          content: fullContent,
          overrideCharacterName: params.overrideCharacterName,
          ragSources: ragSourcesForAssistant,
          toolTraces: combinedToolTraces,
          reasoningMaxChars: settings.reasoningMaxChars,
          generationMeta,
          liveAvatarControls: Boolean(liveAvatar)
        });

        params.res.write(`data: ${JSON.stringify({ type: "done", chatId: params.chatId })}\n\n`);
        if (typeof (params.res as Response & { flush?: () => void }).flush === "function") {
          (params.res as Response & { flush?: () => void }).flush?.();
        }
        params.res.end();
        return;
      }
    }

    const streamResult = await streamProviderCompletion({
      provider,
      modelId,
      messages: apiMessages,
      samplerConfig: sc,
      apiParamPolicy: settings.apiParamPolicy,
      reasoningMaxChars: settings.reasoningMaxChars,
      chatId: params.chatId,
      res: params.res,
      signal: abortController.signal
    });

    await persistAssistantTurn({
      provider,
      chatId: params.chatId,
      branchId: params.branchId,
      parentMsgId: params.parentMsgId,
      content: streamResult.content,
      overrideCharacterName: params.overrideCharacterName,
      ragSources: ragSourcesForAssistant,
      toolTraces: streamResult.toolTraces,
      reasoningMaxChars: settings.reasoningMaxChars,
      generationMeta: {
        generationStartedAt: streamResult.generationStartedAt,
        generationCompletedAt: streamResult.generationCompletedAt,
        generationDurationMs: streamResult.generationDurationMs,
        generationStats: streamResult.generationStats
      },
      liveAvatarControls: Boolean(liveAvatar)
    });

    params.res.write(`data: ${JSON.stringify({ type: "done", chatId: params.chatId })}\n\n`);
    if (typeof (params.res as Response & { flush?: () => void }).flush === "function") {
      (params.res as Response & { flush?: () => void }).flush?.();
    }
    params.res.end();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      if (!params.res.writableEnded) {
        params.res.write(`data: ${JSON.stringify({ type: "done", chatId: params.chatId, interrupted: true })}\n\n`);
        params.res.end();
      }
    } else {
      const errMsg = err instanceof Error ? err.message : "Network error";
      if (!params.res.writableEnded) {
        params.res.write(`data: ${JSON.stringify({ type: "error", chatId: params.chatId, error: errMsg })}\n\n`);
        params.res.end();
      }
    }
  } finally {
    activeAbortControllers.delete(params.chatId);
  }
}
