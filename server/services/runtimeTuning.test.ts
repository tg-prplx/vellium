import { describe, expect, it } from "vitest";
import { normalizeRuntimeTuningSettings } from "./runtimeTuning.js";

describe("runtime tuning settings", () => {
  it("supplies stable defaults for old settings payloads", () => {
    expect(normalizeRuntimeTuningSettings({})).toEqual({
      contextMaxMessages: 0,
      reasoningMaxChars: 12000,
      translationTimeoutSeconds: 120,
      translationTemperature: 0.2,
      translationMaxTokens: 2048,
      compressionTemperature: 0.3,
      compressionMaxTokens: 1024,
      compressionFallbackMessages: 8,
      autoConversationDelayMs: 500,
      autoConversationDefaultTurns: 5
    });
  });

  it("clamps invalid and excessive values", () => {
    expect(normalizeRuntimeTuningSettings({
      contextMaxMessages: 5000,
      reasoningMaxChars: 999999,
      translationTimeoutSeconds: 1,
      translationTemperature: 9,
      translationMaxTokens: 3,
      compressionTemperature: -1,
      compressionMaxTokens: 999999,
      compressionFallbackMessages: 0,
      autoConversationDelayMs: 99999,
      autoConversationDefaultTurns: 80
    })).toEqual({
      contextMaxMessages: 1000,
      reasoningMaxChars: 100000,
      translationTimeoutSeconds: 5,
      translationTemperature: 2,
      translationMaxTokens: 64,
      compressionTemperature: 0,
      compressionMaxTokens: 32768,
      compressionFallbackMessages: 1,
      autoConversationDelayMs: 10000,
      autoConversationDefaultTurns: 50
    });
  });
});
