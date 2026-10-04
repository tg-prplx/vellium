import { buildOpenAiSamplingPayload } from "../../services/apiParamPolicy.js";
import { getContextWindowBudget } from "./attachments.js";
import { getContextConfig } from "./contextConfig.js";
import { getChatSamplerConfig } from "./promptContext.js";
import type { getSettings } from "./routeHelpers.js";

/**
 * Window and reply reserve for a branch, without assembling the prompt. Shared by
 * prompt building and the lightweight composer meter so both report the same budget.
 */
export function resolveContextBudget(chatId: string, branchId: string, settings: ReturnType<typeof getSettings>) {
  const config = getContextConfig(chatId, branchId);
  const samplerConfig = { ...getChatSamplerConfig(chatId, settings.samplerConfig), ...(config.maxOutputTokens !== undefined ? { maxTokens: config.maxOutputTokens } : {}) };
  const contextWindowSize = config.contextWindowSize ?? getContextWindowBudget(settings as Record<string, unknown>);
  const reservedOutputTokens = Math.max(1, Number(buildOpenAiSamplingPayload({ samplerConfig, apiParamPolicy: settings.apiParamPolicy, fields: ["maxTokens"], defaults: { maxTokens: 2048 } }).max_tokens) || 2048);
  return { config, samplerConfig, contextWindowSize, reservedOutputTokens };
}
