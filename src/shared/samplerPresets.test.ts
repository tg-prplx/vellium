import { describe, expect, it } from "vitest";
import type { SamplerConfig } from "./types/contracts";
import {
  findMatchingSamplerPresetId,
  normalizeSamplerPresets,
  resolveModelSamplerPreset
} from "./samplerPresets";

const fallback: SamplerConfig = {
  temperature: 0.9,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  maxTokens: 2048,
  stop: []
};

describe("sampler presets", () => {
  it("normalizes named snapshots and removes unsupported fields", () => {
    const presets = normalizeSamplerPresets([{
      id: "rp",
      name: "  RP model  ",
      providerId: "local",
      modelId: "mistral-nemo",
      samplerConfig: { temperature: 0.72, topP: 0.9, maxTokens: "invalid", rogue: { nested: true } }
    }], fallback);

    expect(presets).toEqual([{
      id: "rp",
      name: "RP model",
      providerId: "local",
      modelId: "mistral-nemo",
      samplerConfig: { ...fallback, temperature: 0.72, topP: 0.9 }
    }]);
  });

  it("resolves the bound model and detects the applied snapshot", () => {
    const presets = normalizeSamplerPresets([{
      id: "nemo",
      name: "Nemo RP",
      providerId: "local",
      modelId: "nemo",
      samplerConfig: { ...fallback, temperature: 1.15 }
    }], fallback);

    expect(resolveModelSamplerPreset(presets, "local", "nemo")?.id).toBe("nemo");
    expect(resolveModelSamplerPreset(presets, "local", "other")).toBeNull();
    expect(findMatchingSamplerPresetId(presets, presets[0].samplerConfig)).toBe("nemo");
  });
});
