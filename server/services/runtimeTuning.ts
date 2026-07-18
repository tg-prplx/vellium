export interface RuntimeTuningSettings {
  contextMaxMessages: number;
  reasoningMaxChars: number;
  translationTimeoutSeconds: number;
  translationTemperature: number;
  translationMaxTokens: number;
  compressionTemperature: number;
  compressionMaxTokens: number;
  compressionFallbackMessages: number;
  autoConversationDelayMs: number;
  autoConversationDefaultTurns: number;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function decimal(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function normalizeRuntimeTuningSettings(raw: Record<string, unknown>): RuntimeTuningSettings {
  return {
    contextMaxMessages: integer(raw.contextMaxMessages, 0, 0, 1000),
    reasoningMaxChars: integer(raw.reasoningMaxChars, 12000, 1000, 100000),
    translationTimeoutSeconds: integer(raw.translationTimeoutSeconds, 120, 5, 600),
    translationTemperature: decimal(raw.translationTemperature, 0.2, 0, 2),
    translationMaxTokens: integer(raw.translationMaxTokens, 2048, 64, 32768),
    compressionTemperature: decimal(raw.compressionTemperature, 0.3, 0, 2),
    compressionMaxTokens: integer(raw.compressionMaxTokens, 1024, 128, 32768),
    compressionFallbackMessages: integer(raw.compressionFallbackMessages, 8, 1, 100),
    autoConversationDelayMs: integer(raw.autoConversationDelayMs, 500, 0, 10000),
    autoConversationDefaultTurns: integer(raw.autoConversationDefaultTurns, 5, 1, 50)
  };
}
