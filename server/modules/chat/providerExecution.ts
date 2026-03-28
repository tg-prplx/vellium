import type { Response } from "express";
import { roughTokenCount } from "../../db.js";
import { buildKoboldSamplerConfig, buildOpenAiSamplingPayload, normalizeApiParamPolicy } from "../../services/apiParamPolicy.js";
import { completeCustomAdapter } from "../../services/customProviderAdapters.js";
import {
  buildKoboldGenerateBody,
  countKoboldTokens,
  extractKoboldGeneratedText,
  extractKoboldStreamDelta,
  normalizeProviderType,
  requestKoboldGenerate,
  requestKoboldGenerateStream
} from "../../services/providerApi.js";
import { consumeThinkChunk, createThinkStreamState, flushThinkState, splitThinkContent } from "./reasoning.js";
import type { ProviderRow } from "./routeHelpers.js";
import {
  buildKoboldPromptFromMessages,
  extractOpenAIReasoningDelta,
  KOBOLD_TAGS,
  REASONING_CALL_NAME,
  type ToolCallTrace
} from "./tooling.js";

export interface StreamProviderCompletionParams {
  provider: ProviderRow;
  modelId: string;
  messages: Array<{ role: string; content: unknown }>;
  samplerConfig: Record<string, unknown>;
  apiParamPolicy?: unknown;
  chatId: string;
  res: Response;
  signal: AbortSignal;
}

export interface StreamProviderCompletionResult {
  content: string;
  toolTraces: ToolCallTrace[];
  generationStartedAt: string;
  generationCompletedAt: string;
  generationDurationMs: number;
}

export interface CompleteProviderOnceParams {
  provider: ProviderRow;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  samplerConfig?: Record<string, unknown>;
  apiParamPolicy?: unknown;
  signal?: AbortSignal;
}

export async function countProviderTokens(provider: ProviderRow | null | undefined, content: string): Promise<number> {
  const text = String(content || "");
  if (!text) return 0;
  if (!provider || normalizeProviderType(provider.provider_type) !== "koboldcpp") {
    return roughTokenCount(text);
  }
  const counted = await countKoboldTokens(provider, text);
  return counted ?? roughTokenCount(text);
}

async function sendSseText(res: Response, chatId: string, text: string, paceMs = 0) {
  const chunks = text.match(/[\s\S]{1,140}/g) ?? [];
  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify({ type: "delta", chatId, delta: chunk })}\n\n`);
    if (paceMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, paceMs));
    }
  }
}

export async function streamProviderCompletion(
  params: StreamProviderCompletionParams
): Promise<StreamProviderCompletionResult> {
  const generationStartedMs = Date.now();
  const generationStartedAt = new Date(generationStartedMs).toISOString();
  const finalizeGenerationMeta = () => {
    const generationCompletedMs = Date.now();
    return {
      generationStartedAt,
      generationCompletedAt: new Date(generationCompletedMs).toISOString(),
      generationDurationMs: Math.max(1, generationCompletedMs - generationStartedMs)
    };
  };
  const providerType = normalizeProviderType(params.provider.provider_type);
  const sc = params.samplerConfig;
  const reasoningTrace: ToolCallTrace = {
    callId: `reasoning_${Date.now()}`,
    name: REASONING_CALL_NAME,
    args: "{}",
    result: ""
  };
  let reasoningStarted = false;
  const thinkState = createThinkStreamState();

  const startReasoning = () => {
    if (reasoningStarted) return;
    reasoningStarted = true;
    params.res.write(`data: ${JSON.stringify({
      type: "tool",
      chatId: params.chatId,
      phase: "start",
      callId: reasoningTrace.callId,
      name: REASONING_CALL_NAME,
      args: "{}"
    })}\n\n`);
  };

  const appendReasoningDelta = (delta: string) => {
    if (!delta) return;
    startReasoning();
    reasoningTrace.result += delta;
    params.res.write(`data: ${JSON.stringify({
      type: "tool",
      chatId: params.chatId,
      phase: "delta",
      callId: reasoningTrace.callId,
      name: REASONING_CALL_NAME,
      result: delta.slice(0, 4000)
    })}\n\n`);
  };

  const finalizeReasoning = (): ToolCallTrace[] => {
    if (!reasoningStarted) return [];
    params.res.write(`data: ${JSON.stringify({
      type: "tool",
      chatId: params.chatId,
      phase: "done",
      callId: reasoningTrace.callId,
      name: REASONING_CALL_NAME,
      result: reasoningTrace.result.slice(0, 12000)
    })}\n\n`);
    if (!reasoningTrace.result.trim()) return [];
    return [reasoningTrace];
  };

  if (providerType === "koboldcpp") {
    const koboldPolicy = normalizeApiParamPolicy(params.apiParamPolicy).kobold;
    const koboldSamplerConfig = buildKoboldSamplerConfig({
      samplerConfig: sc,
      apiParamPolicy: params.apiParamPolicy
    });
    const { prompt, memory } = buildKoboldPromptFromMessages(params.messages, koboldSamplerConfig);
    const body = buildKoboldGenerateBody({
      prompt,
      memory,
      samplerConfig: koboldSamplerConfig,
      includeMemory: koboldPolicy.memory
    });

    const streamResponse = await requestKoboldGenerateStream(params.provider, body, params.signal);
    if (streamResponse.ok && streamResponse.body) {
      let fullContent = "";
      const reader = streamResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (params.signal.aborted) {
            await reader.cancel();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("event:")) continue;
            const data = trimmed.startsWith("data: ")
              ? trimmed.slice(6).trim()
              : trimmed;
            if (!data || data === "[DONE]") continue;

            let delta = "";
            try {
              delta = extractKoboldStreamDelta(JSON.parse(data));
            } catch {
              delta = data;
            }
            if (!delta) continue;
            const split = consumeThinkChunk(thinkState, delta);
            if (split.reasoning) appendReasoningDelta(split.reasoning);
            if (split.content) {
              fullContent += split.content;
              params.res.write(`data: ${JSON.stringify({ type: "delta", chatId: params.chatId, delta: split.content })}\n\n`);
            }
          }
        }
      } catch (readErr) {
        if (!(readErr instanceof Error && readErr.name === "AbortError")) {
          throw readErr;
        }
      }

      const flush = flushThinkState(thinkState);
      if (flush.reasoning) appendReasoningDelta(flush.reasoning);
      if (flush.content) {
        fullContent += flush.content;
        params.res.write(`data: ${JSON.stringify({ type: "delta", chatId: params.chatId, delta: flush.content })}\n\n`);
      }

      if (fullContent.trim() || reasoningTrace.result.trim()) {
        return { content: fullContent, toolTraces: finalizeReasoning(), ...finalizeGenerationMeta() };
      }
    }

    const fallbackResponse = await requestKoboldGenerate(params.provider, body, params.signal);
    if (!fallbackResponse.ok) {
      const errText = await fallbackResponse.text().catch(() => "Unknown error");
      throw new Error(`[KoboldCpp API Error: ${fallbackResponse.status}] ${errText.slice(0, 200)}`);
    }
    const fallbackBody = await fallbackResponse.json().catch(() => ({}));
    const generated = extractKoboldGeneratedText(fallbackBody);
    const split = splitThinkContent(generated);
    if (split.reasoning) appendReasoningDelta(split.reasoning);
    if (split.content) {
      await sendSseText(params.res, params.chatId, split.content, 8);
    }
    return { content: split.content, toolTraces: finalizeReasoning(), ...finalizeGenerationMeta() };
  }

  if (providerType === "custom") {
    const generated = await completeCustomAdapter({
      provider: params.provider,
      modelId: params.modelId,
      systemPrompt: "",
      userPrompt: "",
      samplerConfig: sc,
      messages: params.messages,
      signal: params.signal
    });
    const split = splitThinkContent(generated);
    if (split.reasoning) appendReasoningDelta(split.reasoning);
    if (split.content) {
      await sendSseText(params.res, params.chatId, split.content, 8);
    }
    return { content: split.content, toolTraces: finalizeReasoning(), ...finalizeGenerationMeta() };
  }

  const baseUrl = String(params.provider.base_url || "").replace(/\/+$/, "");
  const openAiSampling = buildOpenAiSamplingPayload({
    samplerConfig: sc,
    apiParamPolicy: params.apiParamPolicy,
    fields: ["temperature", "topP", "frequencyPenalty", "presencePenalty", "maxTokens", "stop"],
    defaults: {
      temperature: 0.9,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      maxTokens: 2048
    }
  });
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.provider.api_key_cipher}`
    },
    body: JSON.stringify({
      model: params.modelId,
      messages: params.messages,
      stream: true,
      ...openAiSampling
    }),
    signal: params.signal
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`[API Error: ${response.status}] ${errText.slice(0, 200)}`);
  }

  let fullContent = "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (params.signal.aborted) {
        await reader.cancel();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
          const reasoningDelta = extractOpenAIReasoningDelta(parsed);
          if (reasoningDelta) appendReasoningDelta(reasoningDelta);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            const split = consumeThinkChunk(thinkState, delta);
            if (split.reasoning) appendReasoningDelta(split.reasoning);
            if (split.content) {
              fullContent += split.content;
              params.res.write(`data: ${JSON.stringify({ type: "delta", chatId: params.chatId, delta: split.content })}\n\n`);
            }
          }
        } catch {
          // Ignore malformed stream chunks.
        }
      }
    }
  } catch (readErr) {
    if (!(readErr instanceof Error && readErr.name === "AbortError")) {
      throw readErr;
    }
  }

  const flush = flushThinkState(thinkState);
  if (flush.reasoning) appendReasoningDelta(flush.reasoning);
  if (flush.content) {
    fullContent += flush.content;
    params.res.write(`data: ${JSON.stringify({ type: "delta", chatId: params.chatId, delta: flush.content })}\n\n`);
  }

  return { content: fullContent, toolTraces: finalizeReasoning(), ...finalizeGenerationMeta() };
}

export async function completeProviderOnce(params: CompleteProviderOnceParams): Promise<string> {
  const providerType = normalizeProviderType(params.provider.provider_type);
  const sc = params.samplerConfig || {};

  if (providerType === "koboldcpp") {
    const koboldPolicy = normalizeApiParamPolicy(params.apiParamPolicy).kobold;
    const customMemory = String(sc.koboldMemory || "").trim();
    const memory = [
      customMemory,
      params.systemPrompt
        ? `${KOBOLD_TAGS.systemOpen}\n${params.systemPrompt}\n${KOBOLD_TAGS.systemClose}`
        : ""
    ].filter(Boolean).join("\n\n");
    const koboldSamplerConfig = buildKoboldSamplerConfig({
      samplerConfig: {
        ...sc,
        maxTokens: sc.maxTokens ?? 1024
      },
      apiParamPolicy: params.apiParamPolicy
    });
    const body = buildKoboldGenerateBody({
      prompt: `${KOBOLD_TAGS.inputOpen}\n${params.userPrompt}\n${KOBOLD_TAGS.inputClose}\n\n${KOBOLD_TAGS.outputOpen}`,
      memory,
      samplerConfig: koboldSamplerConfig,
      includeMemory: koboldPolicy.memory
    });
    const response = await requestKoboldGenerate(params.provider, body, params.signal);
    if (!response.ok) return "";
    const parsed = await response.json().catch(() => ({}));
    return extractKoboldGeneratedText(parsed).trim();
  }

  if (providerType === "custom") {
    return completeCustomAdapter({
      provider: params.provider,
      modelId: params.modelId,
      systemPrompt: params.systemPrompt,
      userPrompt: params.userPrompt,
      samplerConfig: sc,
      signal: params.signal
    });
  }

  const baseUrl = String(params.provider.base_url || "").replace(/\/+$/, "");
  const openAiSampling = buildOpenAiSamplingPayload({
    samplerConfig: sc,
    apiParamPolicy: params.apiParamPolicy,
    fields: ["temperature", "maxTokens"],
    defaults: {
      temperature: 0.3,
      maxTokens: 1024
    }
  });
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.provider.api_key_cipher}`
    },
    body: JSON.stringify({
      model: params.modelId,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt }
      ],
      ...openAiSampling
    }),
    signal: params.signal
  });
  if (!response.ok) return "";
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content?.trim() ?? "";
}

export function normalizeOpenAiBaseUrl(raw: string): string {
  const trimmed = String(raw || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}
