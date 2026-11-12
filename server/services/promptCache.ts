/** Opt-in hints only on endpoints whose protocol declares support. */
export function promptCachePayload(baseUrl: string, modelId: string, key?: string) {
  if (!key) return {};
  const host = new URL(baseUrl).hostname;
  if (host === "openrouter.ai") {
    return { session_id: key, ...(/^anthropic\//i.test(modelId) ? { cache_control: { type: "ephemeral" } } : {}) };
  }
  return host === "api.openai.com" ? { prompt_cache_key: key } : {};
}

export function generationUsage(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const u = value as Record<string, unknown>;
  const details = (u.prompt_tokens_details || {}) as Record<string, unknown>;
  const completion = (u.completion_tokens_details || {}) as Record<string, unknown>;
  const number = (v: unknown) => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
  return {
    cachedTokensReported: details.cached_tokens !== undefined || u.prompt_cache_hit_tokens !== undefined,
    inputTokens: number(u.prompt_tokens), cachedTokens: number(details.cached_tokens ?? u.prompt_cache_hit_tokens),
    ...(u.completion_tokens !== undefined ? { outputTokens: number(u.completion_tokens) } : {}),
    ...(completion.reasoning_tokens !== undefined ? { reasoningTokens: number(completion.reasoning_tokens) } : {}),
    ...(details.cache_write_tokens !== undefined ? { cacheWriteTokens: number(details.cache_write_tokens) } : {})
  };
}
