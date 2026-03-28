import { describe, expect, it } from "vitest";
import {
  MAX_PLUGIN_RUNTIME_MESSAGES,
  MAX_PLUGIN_RUNTIME_SAMPLER_BYTES,
  sanitizePluginRuntimeMessages,
  sanitizePluginRuntimePrompt,
  sanitizePluginRuntimeSamplerConfig
} from "./requestSecurity.js";

describe("sanitizePluginRuntimeMessages", () => {
  it("accepts bounded text and multimodal content", () => {
    expect(sanitizePluginRuntimeMessages([
      { role: "system", content: "You are concise." },
      {
        role: "user",
        content: [
          { type: "text", text: "Describe the image." },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }
        ]
      }
    ])).toEqual([
      { role: "system", content: "You are concise." },
      {
        role: "user",
        content: [
          { type: "text", text: "Describe the image." },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }
        ]
      }
    ]);
  });

  it("rejects unsupported roles", () => {
    expect(() => sanitizePluginRuntimeMessages([
      { role: "developer", content: "Nope" }
    ])).toThrow("Unsupported message role: developer");
  });

  it("rejects oversized message lists", () => {
    expect(() => sanitizePluginRuntimeMessages(
      Array.from({ length: MAX_PLUGIN_RUNTIME_MESSAGES + 1 }, () => ({ role: "user", content: "x" }))
    )).toThrow(`messages exceed ${MAX_PLUGIN_RUNTIME_MESSAGES} items`);
  });
});

describe("sanitizePluginRuntimePrompt", () => {
  it("normalizes and trims prompts", () => {
    expect(sanitizePluginRuntimePrompt("  Hello\r\nworld  ", "systemPrompt")).toBe("Hello\nworld");
  });
});

describe("sanitizePluginRuntimeSamplerConfig", () => {
  it("drops dangerous keys and enforces payload size", () => {
    expect(sanitizePluginRuntimeSamplerConfig(JSON.parse(`{
      "temperature": 0.7,
      "__proto__": { "polluted": true },
      "nested": {
        "constructor": "blocked",
        "topP": 0.9
      }
    }`))).toEqual({
      temperature: 0.7,
      nested: {
        topP: 0.9
      }
    });
  });

  it("rejects oversized samplerConfig", () => {
    expect(() => sanitizePluginRuntimeSamplerConfig({
      text: "x".repeat(MAX_PLUGIN_RUNTIME_SAMPLER_BYTES + 10)
    })).toThrow(`samplerConfig exceeds ${MAX_PLUGIN_RUNTIME_SAMPLER_BYTES} bytes`);
  });
});
