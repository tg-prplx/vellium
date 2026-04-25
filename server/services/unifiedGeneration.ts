import { splitThinkContent } from "../modules/chat/reasoning.js";
import { buildKoboldSamplerConfig, buildOpenAiSamplingPayload, normalizeApiParamPolicy } from "./apiParamPolicy.js";
import { completeCustomAdapter } from "./customProviderAdapters.js";
import { buildKoboldGenerateBody, extractKoboldGeneratedText, normalizeProviderType, requestKoboldGenerate } from "./providerApi.js";

export interface UnifiedProviderRow {
  id: string;
  name: string;
  base_url: string;
  api_key_cipher: string;
  provider_type: string | null;
  adapter_id?: string | null;
}

export interface UnifiedGenerateMessage {
  role: string;
  content: unknown;
}

const KOBOLD_TAGS = {
  systemOpen: "{{[SYSTEM]}}",
  systemClose: "{{[SYSTEM_END]}}",
  inputOpen: "{{[INPUT]}}",
  inputClose: "{{[INPUT_END]}}",
  outputOpen: "{{[OUTPUT]}}",
  outputClose: "{{[OUTPUT_END]}}"
};

function normalizeOpenAiBaseUrl(raw: string): string {
  const trimmed = String(raw || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function providerSupportsDeveloperRole(provider: UnifiedProviderRow) {
  return /(^https?:\/\/)?([a-z0-9-]+\.)*openai\.com(\/|$)/i.test(String(provider.base_url || "").trim());
}

function normalizeOpenAiMessageRole(role: string, provider: UnifiedProviderRow) {
  if (role === "developer" && !providerSupportsDeveloperRole(provider)) {
    return "system";
  }
  return role;
}

function flattenContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const row = item as { type?: unknown; text?: unknown };
    if (row.type === "text") parts.push(String(row.text ?? ""));
    if (row.type === "image_url") parts.push("[Image attachment]");
  }
  return parts.join("\n").trim();
}

function normalizeAssistantContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const row = item as { type?: unknown; text?: unknown };
        return row.type === "text" ? String(row.text ?? "") : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (content === null || content === undefined) return "";
  return String(content);
}

function flattenReasoningValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => flattenReasoningValue(item))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  if (typeof row.text === "string") return row.text;
  if (typeof row.content === "string") return row.content;
  if (typeof row.summary === "string") return row.summary;
  return [
    row.reasoning,
    row.reasoning_content,
    row.reasoning_text,
    row.reasoningText,
    row.thinking,
    row.thinking_content,
    row.thinking_text,
    row.thinkingText,
    row.output_text
  ]
    .map((item) => flattenReasoningValue(item))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildKoboldPromptFromMessages(
  messages: UnifiedGenerateMessage[],
  samplerConfig: Record<string, unknown>
): { prompt: string; memory: string } {
  const systemParts: string[] = [];
  const convoParts: string[] = [];
  for (const msg of messages) {
    const role = String(msg.role || "user");
    const text = flattenContentToText(msg.content).trim();
    if (!text) continue;
    if (role === "system" || role === "developer") {
      systemParts.push(text);
      continue;
    }
    if (role === "assistant") {
      convoParts.push(`${KOBOLD_TAGS.outputOpen}\n${text}\n${KOBOLD_TAGS.outputClose}`);
      continue;
    }
    if (role === "tool") {
      convoParts.push(`${KOBOLD_TAGS.inputOpen}\n[Tool]\n${text}\n${KOBOLD_TAGS.inputClose}`);
      continue;
    }
    convoParts.push(`${KOBOLD_TAGS.inputOpen}\n${text}\n${KOBOLD_TAGS.inputClose}`);
  }
  const customMemory = String(samplerConfig.koboldMemory || "").trim();
  const memoryBlocks = [
    customMemory,
    ...systemParts.map((part) => `${KOBOLD_TAGS.systemOpen}\n${part}\n${KOBOLD_TAGS.systemClose}`)
  ].filter(Boolean);
  return {
    memory: memoryBlocks.join("\n\n"),
    prompt: [...convoParts, KOBOLD_TAGS.outputOpen].join("\n\n")
  };
}

export async function unifiedGenerateText(params: {
  provider: UnifiedProviderRow;
  modelId: string;
  messages: UnifiedGenerateMessage[];
  samplerConfig?: Record<string, unknown>;
  apiParamPolicy?: unknown;
  signal?: AbortSignal;
}): Promise<{ content: string; reasoning: string; providerType: "openai" | "koboldcpp" | "custom" }> {
  const providerType = normalizeProviderType(params.provider.provider_type);
  const sc = params.samplerConfig || {};

  if (providerType === "koboldcpp") {
    const koboldPolicy = normalizeApiParamPolicy(params.apiParamPolicy).kobold;
    const koboldSamplerConfig = buildKoboldSamplerConfig({
      samplerConfig: {
        ...sc,
        maxTokens: sc.maxTokens ?? 1024
      },
      apiParamPolicy: params.apiParamPolicy
    });
    const { prompt, memory } = buildKoboldPromptFromMessages(params.messages, koboldSamplerConfig);
    const body = buildKoboldGenerateBody({
      prompt,
      memory,
      samplerConfig: koboldSamplerConfig,
      includeMemory: koboldPolicy.memory
    });
    const response = await requestKoboldGenerate(params.provider, body, params.signal);
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(errText || `KoboldCpp request failed (${response.status})`);
    }
    const generated = extractKoboldGeneratedText(await response.json().catch(() => ({})));
    const split = splitThinkContent(generated);
    return { content: split.content, reasoning: split.reasoning, providerType };
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
    return { content: split.content, reasoning: split.reasoning, providerType };
  }

  const baseUrl = normalizeOpenAiBaseUrl(params.provider.base_url);
  const openAiSampling = buildOpenAiSamplingPayload({
    samplerConfig: sc,
    apiParamPolicy: params.apiParamPolicy,
    fields: ["temperature", "topP", "frequencyPenalty", "presencePenalty", "maxTokens", "stop"],
    defaults: {
      temperature: 0.7,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
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
      messages: params.messages.map((message) => ({
        ...message,
        role: normalizeOpenAiMessageRole(String(message.role || "user"), params.provider)
      })),
      ...openAiSampling
    }),
    signal: params.signal
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(errText || `OpenAI-compatible request failed (${response.status})`);
  }
  const body = await response.json().catch(() => ({})) as {
    choices?: Array<{
      message?: {
        content?: unknown;
        reasoning?: unknown;
        reasoning_content?: unknown;
      };
    }>;
    reasoning?: unknown;
    reasoning_content?: unknown;
  };
  const message = body.choices?.[0]?.message;
  const directReasoning = [
    body.reasoning,
    body.reasoning_content,
    body.reasoning_text,
    body.reasoningText,
    body.thinking,
    body.thinking_content,
    body.thinking_text,
    body.thinkingText,
    message?.reasoning,
    message?.reasoning_content,
    message?.reasoning_text,
    message?.reasoningText,
    message?.thinking,
    message?.thinking_content,
    message?.thinking_text,
    message?.thinkingText
  ]
    .map((value) => flattenReasoningValue(value))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const split = splitThinkContent(normalizeAssistantContent(message?.content));
  return {
    content: split.content,
    reasoning: [directReasoning, split.reasoning].filter(Boolean).join("\n\n").trim(),
    providerType
  };
}
