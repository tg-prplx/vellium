import { describe, expect, it } from "vitest";
import { describeChatGenerationError, isLegacyChatFailure } from "./chatGenerationError";

describe("chat generation failures", () => {
  it("extracts a readable endpoint and timeout without exposing the protocol in the summary", () => {
    expect(describeChatGenerationError("[Error] Provider request failed: POST http://10.12.17.1:1234/v1/chat/completions (fetch failed: UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error (attempted address: 10.12.17.1:1234, timeout: 10000ms))"))
      .toMatchObject({ endpoint: "10.12.17.1:1234", timeoutSeconds: 10, timedOut: true });
  });

  it("surfaces the provider's own message from a JSON error body", () => {
    expect(describeChatGenerationError('Error: [API Error: 503] {"error":{"message":"Provider temporarily unavailable","type":"server_error"}}'))
      .toMatchObject({ providerMessage: "Provider temporarily unavailable", authFailed: false, modelMissing: false });
    expect(describeChatGenerationError("Error: Provider request failed").providerMessage).toBe("");
  });

  it("classifies rejected keys and missing models so the UI can point to provider settings", () => {
    expect(describeChatGenerationError('[API Error: 401] {"error":{"message":"Invalid API key","type":"authentication_error","code":"invalid_api_key"}}'))
      .toMatchObject({ authFailed: true, providerMessage: "Invalid API key" });
    expect(describeChatGenerationError('[API Error: 404] {"error":{"message":"The model `gpt-x` does not exist","code":"model_not_found"}}'))
      .toMatchObject({ modelMissing: true, authFailed: false });
    expect(describeChatGenerationError('[API Error: 500] {"error":{"message":"Internal error"}}').authFailed).toBe(false);
  });

  it("recognizes legacy failure rows only on assistant messages", () => {
    expect(isLegacyChatFailure({ role: "assistant", content: "[Error] Provider request failed" })).toBe(true);
    expect(isLegacyChatFailure({ role: "user", content: "[Error] Help me debug this" })).toBe(false);
    expect(isLegacyChatFailure({ role: "assistant", content: "The log contains [Error] somewhere." })).toBe(false);
  });
});
