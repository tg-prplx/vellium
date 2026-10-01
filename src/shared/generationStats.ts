import { estimateTokens } from "./tokenEstimate.js";
import type { GenerationStats } from "./types/chatContext.js";

function nonnegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Tracks provider events, never the artificial UI replay of a buffered answer. */
export function createGenerationTracker(startedAt = Date.now()) {
  let firstAt: number | undefined;
  let lastAt: number | undefined;
  let firstWeight = 0;
  let streamedText = "";
  let usage: Record<string, unknown> = {};
  let timings: Record<string, unknown> = {};
  return {
    observe(payload: unknown) {
      if (!payload || typeof payload !== "object") return;
      const row = payload as { usage?: unknown; timings?: unknown };
      if (row.usage && typeof row.usage === "object") usage = { ...usage, ...row.usage };
      if (row.timings && typeof row.timings === "object") timings = { ...timings, ...row.timings };
    },
    delta(text: string, at = Date.now()) {
      if (!text) return;
      if (firstAt === undefined) { firstAt = at; firstWeight = estimateTokens(text); }
      lastAt = at;
      streamedText += text;
    },
    finish(content: string, completedAt = Date.now()): GenerationStats {
      const providedOutput = nonnegative(usage.completion_tokens) ?? nonnegative(timings.predicted_n);
      const outputTokens = providedOutput ?? estimateTokens(streamedText || content);
      const reasoning = usage.completion_tokens_details as { reasoning_tokens?: unknown } | undefined;
      const cached = usage.prompt_tokens_details as { cached_tokens?: unknown } | undefined;
      const providerMs = nonnegative(timings.predicted_ms);
      const providerN = nonnegative(timings.predicted_n);
      const decodeMs = providerMs && providerMs > 0 ? providerMs : firstAt !== undefined && lastAt !== undefined && lastAt > firstAt ? lastAt - firstAt : undefined;
      const remainingFraction = Math.max(0, 1 - firstWeight / Math.max(1, estimateTokens(streamedText)));
      const speed = providerMs && providerN !== undefined
        ? providerN * 1000 / providerMs
        : decodeMs && remainingFraction > 0 ? outputTokens * remainingFraction * 1000 / decodeMs : undefined;
      return {
        inputTokens: nonnegative(usage.prompt_tokens), outputTokens,
        reasoningTokens: nonnegative(reasoning?.reasoning_tokens), cachedTokens: nonnegative(cached?.cached_tokens),
        tokenSource: providedOutput === undefined ? "estimate" : "provider",
        totalMs: Math.max(0, completedAt - startedAt),
        firstTokenMs: firstAt === undefined ? undefined : Math.max(0, firstAt - startedAt),
        decodeMs, tokensPerSecond: speed && Number.isFinite(speed) ? speed : undefined,
        speedSource: speed ? providerMs && providerN !== undefined ? "provider" : "measured" : undefined
      };
    }
  };
}

export function readGenerationStats(value: unknown): GenerationStats | undefined {
  try {
    const row = typeof value === "string" ? JSON.parse(value) : value;
    if (!row || typeof row !== "object" || nonnegative(row.outputTokens) === undefined || nonnegative(row.totalMs) === undefined) return;
    return {
      inputTokens: nonnegative(row.inputTokens), outputTokens: row.outputTokens,
      reasoningTokens: nonnegative(row.reasoningTokens), cachedTokens: nonnegative(row.cachedTokens),
      tokenSource: row.tokenSource === "provider" ? "provider" : "estimate", totalMs: row.totalMs,
      firstTokenMs: nonnegative(row.firstTokenMs), decodeMs: nonnegative(row.decodeMs),
      tokensPerSecond: nonnegative(row.tokensPerSecond),
      speedSource: row.speedSource === "provider" ? "provider" : row.speedSource === "measured" ? "measured" : undefined,
      requests: nonnegative(row.requests), totalInputTokens: nonnegative(row.totalInputTokens), totalOutputTokens: nonnegative(row.totalOutputTokens)
    };
  } catch { return; }
}
