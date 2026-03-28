import { DEFAULT_SETTINGS, db } from "../../db.js";
import { buildKoboldSamplerConfig, buildOpenAiSamplingPayload, normalizeApiParamPolicy } from "../../services/apiParamPolicy.js";
import { completeCustomAdapter } from "../../services/customProviderAdapters.js";
import { buildKoboldGenerateBody, extractKoboldGeneratedText, normalizeProviderType, requestKoboldGenerate } from "../../services/providerApi.js";
import {
  KOBOLD_TAGS,
  type ProviderRow,
  type WriterSampler
} from "./defs.js";

export function getWriterSettings() {
  const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string };
  const stored = JSON.parse(row.payload);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    samplerConfig: { ...DEFAULT_SETTINGS.samplerConfig, ...(stored.samplerConfig ?? {}) },
    apiParamPolicy: normalizeApiParamPolicy(stored.apiParamPolicy),
    promptTemplates: { ...DEFAULT_SETTINGS.promptTemplates, ...(stored.promptTemplates ?? {}) }
  };
}

export async function callWriterLlm(systemPrompt: string, userPrompt: string, sampler?: WriterSampler): Promise<string> {
  const settings = getWriterSettings();
  const providerId = settings.activeProviderId;
  const modelId = settings.activeModel;

  if (!providerId || !modelId) {
    return `[No LLM configured] Placeholder for: ${userPrompt.slice(0, 100)}`;
  }

  const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId) as ProviderRow | undefined;
  if (!provider) return "[Provider not found]";

  try {
    const providerType = normalizeProviderType(provider.provider_type);
    if (providerType === "koboldcpp") {
      const koboldPolicy = normalizeApiParamPolicy(settings.apiParamPolicy).kobold;
      const customMemory = String(settings.samplerConfig.koboldMemory || "").trim();
      const memory = [
        customMemory,
        systemPrompt
          ? `${KOBOLD_TAGS.systemOpen}\n${systemPrompt}\n${KOBOLD_TAGS.systemClose}`
          : ""
      ].filter(Boolean).join("\n\n");
      const koboldSamplerConfig = buildKoboldSamplerConfig({
        samplerConfig: {
          temperature: sampler?.temperature ?? settings.samplerConfig.temperature ?? 0.9,
          maxTokens: sampler?.maxTokens ?? settings.samplerConfig.maxTokens ?? 2048,
          topP: settings.samplerConfig.topP,
          stop: settings.samplerConfig.stop,
          topK: settings.samplerConfig.topK,
          topA: settings.samplerConfig.topA,
          minP: settings.samplerConfig.minP,
          typical: settings.samplerConfig.typical,
          tfs: settings.samplerConfig.tfs,
          nSigma: settings.samplerConfig.nSigma,
          repetitionPenalty: settings.samplerConfig.repetitionPenalty,
          repetitionPenaltyRange: settings.samplerConfig.repetitionPenaltyRange,
          repetitionPenaltySlope: settings.samplerConfig.repetitionPenaltySlope,
          samplerOrder: settings.samplerConfig.samplerOrder,
          koboldMemory: settings.samplerConfig.koboldMemory,
          koboldUseDefaultBadwords: settings.samplerConfig.koboldUseDefaultBadwords,
          koboldBannedPhrases: settings.samplerConfig.koboldBannedPhrases
        },
        apiParamPolicy: settings.apiParamPolicy
      });
      const body = buildKoboldGenerateBody({
        prompt: `${KOBOLD_TAGS.inputOpen}\n${userPrompt}\n${KOBOLD_TAGS.inputClose}\n\n${KOBOLD_TAGS.outputOpen}`,
        memory,
        samplerConfig: koboldSamplerConfig,
        includeMemory: koboldPolicy.memory
      });
      const response = await requestKoboldGenerate(provider, body);
      if (!response.ok) {
        const errText = await response.text().catch(() => "KoboldCpp error");
        return `[KoboldCpp Error] ${errText.slice(0, 500)}`;
      }
      const payload = await response.json().catch(() => ({}));
      return extractKoboldGeneratedText(payload) || "[Empty response]";
    }

    if (providerType === "custom") {
      return completeCustomAdapter({
        provider,
        modelId,
        systemPrompt,
        userPrompt,
        samplerConfig: settings.samplerConfig as Record<string, unknown>
      });
    }

    const openAiSampling = buildOpenAiSamplingPayload({
      samplerConfig: {
        temperature: sampler?.temperature ?? settings.samplerConfig.temperature ?? 0.9,
        maxTokens: sampler?.maxTokens ?? settings.samplerConfig.maxTokens ?? 2048
      },
      apiParamPolicy: settings.apiParamPolicy,
      fields: ["temperature", "maxTokens"],
      defaults: {
        temperature: 0.9,
        maxTokens: 2048
      }
    });
    const response = await fetch(`${provider.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.api_key_cipher}`
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        ...openAiSampling
      })
    });

    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? "[Empty response]";
  } catch (err) {
    return `[LLM Error] ${err instanceof Error ? err.message : "Unknown error"}`;
  }
}
