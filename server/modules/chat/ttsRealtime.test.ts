import { describe, expect, it } from "vitest";
import { splitRealtimeTtsInput } from "./ttsRealtime";

describe("realtime TTS phrase splitting", () => {
  it("keeps multilingual sentence boundaries and text order", () => {
    const chunks = splitRealtimeTtsInput("First sentence. Вторая фраза! 第三句。 Last?");
    expect(chunks).toEqual(["First sentence. Вторая фраза! 第三句。 Last?"]);
  });

  it("bounds long chunks without dropping content", () => {
    const input = Array.from({ length: 50 }, (_, index) => `word${index}`).join(" ");
    const chunks = splitRealtimeTtsInput(input, 48);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 48)).toBe(true);
    expect(chunks.join(" ")).toBe(input);
  });
});
