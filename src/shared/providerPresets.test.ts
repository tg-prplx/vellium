import { describe, expect, it } from "vitest";
import { PROVIDER_PRESETS } from "./providerPresets";

describe("provider presets", () => {
  it("includes the optional A2Agent OpenAI-compatible profile", () => {
    expect(PROVIDER_PRESETS).toContainEqual({
      key: "a2agent",
      label: "A2Agent",
      description: "A2Agent OpenAI-compatible API gateway",
      baseUrl: "https://api.a2agent.me/v1",
      defaultId: "a2agent",
      defaultName: "A2Agent",
      apiKeyHint: "A2Agent API key",
      localOnly: false,
      providerType: "openai"
    });
  });
});
