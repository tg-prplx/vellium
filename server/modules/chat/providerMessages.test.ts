import { describe, expect, it } from "vitest";
import { isOfficialOpenAiChatEndpoint, prepareOpenAiCompatibleMessages } from "./providerMessages.js";

describe("OpenAI-compatible reasoning messages", () => {
  it("keeps reasoning_content for compatible providers", () => {
    const messages = prepareOpenAiCompatibleMessages("http://localhost:1234/v1", [
      { role: "assistant", content: "Answer", reasoning_content: "Reasoning" }
    ]);
    expect(messages[0]?.reasoning_content).toBe("Reasoning");
  });

  it("removes the unsupported extension from official OpenAI Chat requests", () => {
    const messages = prepareOpenAiCompatibleMessages("https://api.openai.com/v1", [
      { role: "assistant", content: "Answer", reasoning_content: "Reasoning" }
    ]);
    expect(messages[0]).toEqual({ role: "assistant", content: "Answer" });
    expect(isOfficialOpenAiChatEndpoint("https://api.openai.com/v1")).toBe(true);
    expect(isOfficialOpenAiChatEndpoint("https://openai-compatible.example/v1")).toBe(false);
  });
});
