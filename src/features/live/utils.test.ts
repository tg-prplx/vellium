import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../shared/types/contracts";
import {
  isAddressedToCharacter,
  latestAssistantText,
  makeLiveScreenAttachment,
  makeLiveSessionTitle,
  normalizeLiveSttSource,
  normalizeLiveTtsSource,
  resolveLiveTtsSource
} from "./utils";

describe("live mode utilities", () => {
  it("creates a bounded image attachment shape for screen context", () => {
    expect(makeLiveScreenAttachment("data:text/plain,nope", 42)).toBeNull();
    expect(makeLiveScreenAttachment("data:image/jpeg;base64,abc", 42)).toEqual({
      id: "live-screen-42",
      filename: "live-screen-42.jpg",
      type: "image",
      url: "",
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,abc"
    });
  });

  it("selects the latest non-empty assistant response", () => {
    const messages = [
      { role: "assistant", content: "First" },
      { role: "user", content: "Question" },
      { role: "assistant", content: "  Latest  " }
    ] as ChatMessage[];
    expect(latestAssistantText(messages)).toBe("Latest");
  });

  it("builds a stable Live session prefix", () => {
    expect(makeLiveSessionTitle(new Date("2026-07-24T10:30:00Z"))).toMatch(/^Live · /);
    expect(makeLiveSessionTitle(new Date("2026-07-24T10:30:00Z"), "Alice")).toMatch(/^Live · Alice · /);
  });

  it("detects a direct address by full or first character name", () => {
    expect(isAddressedToCharacter("Эй, Алиса, посмотри на экран", "Алиса Лидделл")).toBe(true);
    expect(isAddressedToCharacter("Лидделл ничего не сказала", "Алиса Лидделл")).toBe(false);
    expect(isAddressedToCharacter("Alice Liddell, are you there?", "Alice Liddell")).toBe(true);
    expect(isAddressedToCharacter("просто фоновая речь", "Алиса")).toBe(false);
  });

  it("uses configured custom TTS by default but preserves an explicit choice", () => {
    expect(resolveLiveTtsSource(null, true)).toBe("custom");
    expect(resolveLiveTtsSource(null, false)).toBe("system");
    expect(resolveLiveTtsSource("system", true)).toBe("system");
    expect(resolveLiveTtsSource("custom", false)).toBe("custom");
    expect(normalizeLiveTtsSource("system")).toBe("system");
    expect(normalizeLiveTtsSource("other")).toBeNull();
  });

  it("normalizes persisted STT source safely", () => {
    expect(normalizeLiveSttSource("whisper")).toBe("whisper");
    expect(normalizeLiveSttSource("system")).toBe("system");
    expect(normalizeLiveSttSource("unexpected")).toBe("system");
  });
});
