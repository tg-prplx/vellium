import { describe, expect, it, vi } from "vitest";
import { LiveAvatarControlStreamParser, buildLiveAvatarControlPrompt, resolveLiveAvatarCue } from "./liveAvatarControl";

const capabilities = {
  parameters: [{ name: "Mouth:: Smile", dimensions: 1 as const, min: [-1, 0] as [number, number], max: [1, 0] as [number, number], defaults: [0, 0] as [number, number] }]
};

describe("Inochi2D response controls", () => {
  it("hides split tags and emits parameter changes at the stream position", () => {
    const onCue = vi.fn();
    const parser = new LiveAvatarControlStreamParser(onCue);
    expect(parser.push("Hello <vellium-ava")).toBe("Hello ");
    expect(parser.push("tar params=\"P0:0.7\"/>world")).toBe("world");
    expect(resolveLiveAvatarCue(onCue.mock.calls[0][0], capabilities)).toEqual({ parameters: [{ name: "Mouth:: Smile", value: 0.7 }] });
  });

  it("describes only the model's available parameter catalog", () => {
    const prompt = buildLiveAvatarControlPrompt(capabilities);
    expect(prompt).toContain("P0=\"Mouth:: Smile\"");
    expect(prompt).toContain("removes these tags");
  });
});
