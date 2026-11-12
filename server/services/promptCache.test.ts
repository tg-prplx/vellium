import { describe, expect, it } from "vitest";
import { generationUsage, promptCachePayload } from "./promptCache.js";
describe("opt-in generation caching", () => {
  it("never sends unsupported caching parameters to generic compatible endpoints or other callers", () => {
    expect(promptCachePayload("https://openrouter.ai/api/v1", "anthropic/claude")).toEqual({});
    expect(promptCachePayload("http://localhost:1234/v1", "model", "novel:test")).toEqual({});
    expect(promptCachePayload("https://openrouter.ai.example.com", "anthropic/claude", "test")).toEqual({});
  });
  it("enables supported explicit caching and stable routing without changing message bytes", () => {
    expect(promptCachePayload("https://openrouter.ai/api/v1", "anthropic/claude", "novel:test")).toEqual({session_id:"novel:test",cache_control:{type:"ephemeral"}});
    expect(promptCachePayload("https://openrouter.ai/api/v1", "deepseek/chat", "test")).toEqual({session_id:"test"});
    expect(promptCachePayload("https://api.openai.com/v1", "model", "test")).toEqual({prompt_cache_key:"test"});
  });
  it("reports unknown usage honestly and reads native DeepSeek cache usage", () => {
    expect(generationUsage(undefined)).toBeUndefined();
    expect(generationUsage({prompt_tokens:1000})?.cachedTokensReported).toBe(false);
    expect(generationUsage({prompt_tokens:1000,prompt_cache_hit_tokens:800,completion_tokens:300,completion_tokens_details:{reasoning_tokens:50}})).toEqual({cachedTokensReported:true,inputTokens:1000,cachedTokens:800,outputTokens:300,reasoningTokens:50});
  });
});
