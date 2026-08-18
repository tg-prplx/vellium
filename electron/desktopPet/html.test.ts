import { describe, expect, it } from "vitest";
import { buildDesktopPetHtml } from "./html";
import type { DesktopPetConfig } from "./types";

const config: DesktopPetConfig = {
  name: "Vellium",
  locale: "ru",
  spriteUrl: "",
  spriteSheetUrl: "",
  scale: 1,
  voice: "soft",
  ttsEnabled: false,
  autonomyEnabled: false,
  actions: [],
  emotions: [],
  assistantInstructions: "",
  persistentMemory: "",
  chatContextTokenLimit: 2400,
  description: "",
  personality: "",
  scenario: "",
  greeting: "Привет",
  systemPrompt: ""
};

describe("desktop pet Live panel", () => {
  it("renders hover controls and a syntactically valid runtime script", () => {
    const html = buildDesktopPetHtml(config);

    expect(html).toContain('id="liveMic"');
    expect(html).toContain('id="addressToggle"');
    expect(html).toContain('id="voiceToggle"');
    expect(html).toContain('id="visionToggle"');
    expect(html).toContain('id="screenToggle"');
    expect(html).toContain('placeholder="Сообщение…"');
    expect(html).toContain("convertMicrophoneAudioToWhisperWav(audio)");
    expect(html).toContain('mimeType: wav.type || "audio/wav"');
    expect(html).not.toContain('mimeType: audio.type || "audio/webm"');

    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script || "")).not.toThrow();
  });

  it("escapes character content before embedding it in executable markup", () => {
    const html = buildDesktopPetHtml({ ...config, name: "</script><script>throw 1</script>" });
    expect(html).not.toContain("</script><script>throw 1</script>");
    expect(html).toContain("\\u003c/script>");
  });
});
