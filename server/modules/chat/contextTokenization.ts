import { isLocalhostUrl } from "../../db/utils.js";
import { buildKoboldSamplerConfig, buildLlamaCppSamplingPayload, normalizeApiParamPolicy } from "../../services/apiParamPolicy.js";
import { countKoboldTokens, normalizeProviderType } from "../../services/providerApi.js";
import { buildKoboldPromptFromMessages } from "./tooling.js";
import type { ProviderRow } from "./routeHelpers.js";

export function koboldContext(messages: Array<{ role: string; content: unknown }>, samplerConfig: Record<string, unknown>, apiParamPolicy: unknown) {
  const config = buildKoboldSamplerConfig({ samplerConfig, apiParamPolicy });
  const result = buildKoboldPromptFromMessages(messages, config);
  return { prompt: result.prompt, memory: normalizeApiParamPolicy(apiParamPolicy).kobold.memory ? result.memory : "" };
}

/** No inference. Only explicitly supported local tokenizers, with a short deadline. */
export async function tokenizeContext(provider: ProviderRow, messages: Array<{ role: string; content: unknown }>, samplerConfig: Record<string, unknown>, apiParamPolicy: unknown): Promise<number | null> {
  if (!isLocalhostUrl(provider.base_url)) return null;
  try {
    if (normalizeProviderType(provider.provider_type) === "koboldcpp") {
      const { prompt, memory } = koboldContext(messages, samplerConfig, apiParamPolicy);
      return countKoboldTokens(provider, [memory, prompt].filter(Boolean).join("\n\n"));
    }
    if (!provider.llama_cpp_management_enabled || normalizeProviderType(provider.provider_type) !== "openai") return null;
    const base = provider.base_url.replace(/\/+$/, "").replace(/\/v1$/, "");
    const signal = AbortSignal.timeout(3000);
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.api_key_cipher}` }, body: JSON.stringify(body), signal });
    const sampling = buildLlamaCppSamplingPayload({ samplerConfig, apiParamPolicy });
    const formatted = await post("/apply-template", { messages, add_generation_prompt: true, ...(sampling.chat_template_kwargs ? { chat_template_kwargs: sampling.chat_template_kwargs } : {}) });
    if (!formatted.ok) return null;
    const template = await formatted.json() as { prompt?: unknown };
    if (typeof template.prompt !== "string") return null;
    const response = await post("/tokenize", { content: template.prompt, add_special: true, parse_special: true });
    if (!response.ok) return null;
    const result = await response.json() as { tokens?: unknown };
    return Array.isArray(result.tokens) ? result.tokens.length : null;
  } catch { return null; }
}
