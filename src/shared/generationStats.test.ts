import { describe, expect, it } from "vitest";
import { createGenerationTracker, readGenerationStats } from "./generationStats";
import { estimateTokens } from "./tokenEstimate";

describe("generation telemetry", () => {
  it("uses the terminal usage chunk with empty choices and keeps reasoning/cache separate", () => {
    const tracker = createGenerationTracker(0);
    tracker.observe({ usage: null });
    tracker.delta("aaaa", 8000);
    tracker.delta("bbbbccccdddd", 9000);
    tracker.observe({ choices: [], usage: { prompt_tokens: 412, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 12 }, prompt_tokens_details: { cached_tokens: 100 } } });
    const result = tracker.finish("aaaabbbbccccdddd", 10000);
    expect(result).toMatchObject({ inputTokens: 412, outputTokens: 40, reasoningTokens: 12, cachedTokens: 100, tokenSource: "provider", firstTokenMs: 8000, decodeMs: 1000, totalMs: 10000, tokensPerSecond: 30, speedSource: "measured" });
  });
  it("prefers llama.cpp decode timings and predicted token count over wall time", () => {
    const tracker = createGenerationTracker(0);
    tracker.delta("reply", 8000);
    tracker.observe({ usage: { prompt_tokens: 200, completion_tokens: 100 }, timings: { predicted_n: 100, predicted_ms: 2000 } });
    expect(tracker.finish("reply", 12000)).toMatchObject({ tokensPerSecond: 50, speedSource: "provider", decodeMs: 2000 });
  });
  it("does not fabricate speed for buffered or one-chunk answers", () => {
    const tracker = createGenerationTracker(0);
    expect(tracker.finish("buffered answer", 10000).tokensPerSecond).toBeUndefined();
    tracker.delta("one chunk", 9000);
    expect(tracker.finish("one chunk", 10000).tokensPerSecond).toBeUndefined();
  });
  it("marks interrupted streams without final usage as estimates", () => {
    const tracker = createGenerationTracker(0);
    tracker.delta("Привет", 1000); tracker.delta(" мир", 2000);
    expect(tracker.finish("Привет мир", 2500)).toMatchObject({ outputTokens: estimateTokens("Привет мир"), tokenSource: "estimate", speedSource: "measured" });
  });
  it("ignores malformed persisted metrics and impossible negative/infinite speeds", () => {
    expect(readGenerationStats("bad json")).toBeUndefined();
    expect(readGenerationStats({ outputTokens: -3, totalMs: 1 })).toBeUndefined();
    expect(readGenerationStats({ outputTokens: 3, totalMs: 1000, tokensPerSecond: Infinity })?.tokensPerSecond).toBeUndefined();
  });
  it("does not apply the English character ratio to Cyrillic/CJK or count surrogate halves", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("привет")).toBeGreaterThan(estimateTokens("abcdef"));
    expect(estimateTokens("你好世界")).toBe(6);
    expect(estimateTokens("🙂")).toBe(3);
  });
});
