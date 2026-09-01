import { describe, expect, it } from "vitest";
import { buildLlamaCppEndpointStatus, normalizeLlamaCppServerBaseUrl } from "./llamaCppApi";
import { buildLlamaCppSamplingPayload } from "./apiParamPolicy";

describe("llama.cpp native API integration", () => {
  it("normalizes OpenAI-compatible base URLs to the native server root", () => {
    expect(normalizeLlamaCppServerBaseUrl("http://10.0.0.8:8080/v1/")).toBe("http://10.0.0.8:8080");
    expect(normalizeLlamaCppServerBaseUrl("https://llama.example/api")).toBe("https://llama.example/api");
  });

  it("reports loading router models, slots, props, and launch args", () => {
    const status = buildLlamaCppEndpointStatus({
      baseUrl: "http://127.0.0.1:8080",
      health: { status: 503, body: { error: { message: "Loading model" } } },
      props: {
        status: 200,
        body: {
          model_path: "/models/gemma.gguf",
          modalities: ["text", "image"],
          default_generation_settings: {
            n_ctx: 32768,
            params: { temperature: 0.7, top_p: 0.9, top_k: 40, min_p: 0.05, repeat_penalty: 1.08 }
          }
        }
      },
      slots: { status: 200, body: [{ id: 0, is_processing: true }, { id: 1, is_processing: false }] },
      models: {
        status: 200,
        body: { data: [{ id: "gemma", status: { value: "loading", args: ["llama-server", "-c", "32768"] } }] }
      }
    });

    expect(status).toMatchObject({
      detected: true,
      state: "loading",
      contextSize: 32768,
      slotCount: 2,
      busySlots: 1,
      supportsModelControl: true
    });
    expect(status.models[0]).toMatchObject({ id: "gemma", state: "loading", args: ["llama-server", "-c", "32768"] });
  });

  it("marks a normal OpenAI-compatible endpoint as not detected", () => {
    const status = buildLlamaCppEndpointStatus({
      baseUrl: "https://api.example/v1",
      health: { status: 404, body: { message: "Not found" } },
      props: { status: 404, body: null },
      slots: null,
      models: { status: 200, body: { data: [{ id: "gpt-example" }] } }
    });
    expect(status.detected).toBe(false);
    expect(status.state).toBe("not-detected");
  });

  it("maps Vellium sampler values to llama.cpp request fields", () => {
    expect(buildLlamaCppSamplingPayload({ samplerConfig: {
      temperature: 0.65,
      topP: 0.92,
      topK: 55,
      minP: 0.08,
      repetitionPenalty: 1.12,
      maxTokens: 4096,
      llamaCppDynatempRange: 0.2,
      llamaCppTopNSigma: 1.5,
      llamaCppDryMultiplier: 0.8,
      llamaCppMirostat: 2,
      llamaCppReasoningEffort: "high",
      llamaCppReasoningFormat: "deepseek",
      llamaCppThinkingMode: "on"
    } })).toMatchObject({
      temperature: 0.65,
      top_p: 0.92,
      top_k: 55,
      min_p: 0.08,
      repeat_penalty: 1.12,
      max_tokens: 4096,
      dynatemp_range: 0.2,
      top_n_sigma: 1.5,
      dry_multiplier: 0.8,
      mirostat: 2,
      reasoning_effort: "high",
      reasoning_format: "deepseek",
      chat_template_kwargs: { enable_thinking: true }
    });
  });

  it("honors per-field llama.cpp request forwarding policy", () => {
    const payload = buildLlamaCppSamplingPayload({
      samplerConfig: { temperature: 0.7, topK: 50, llamaCppReasoningEffort: "high" },
      apiParamPolicy: { llamaCpp: { temperature: false, reasoningEffort: false } }
    });
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("reasoning_effort");
    expect(payload).toHaveProperty("top_k", 50);
  });
});
