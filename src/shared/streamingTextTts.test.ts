import { afterEach, describe, expect, it, vi } from "vitest";
import type { TtsStreamEvent } from "./api/chatClient";
import { StreamingTextTtsSession, takeCompletedSpeechSegments } from "./streamingTextTts";

class FakeAudio {
  static instances: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
  play = vi.fn(async () => undefined);
  pause = vi.fn();

  constructor() {
    FakeAudio.instances.push(this);
  }
}

afterEach(() => {
  FakeAudio.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("takeCompletedSpeechSegments", () => {
  it("keeps an unfinished phrase buffered and flushes it at the end", () => {
    expect(takeCompletedSpeechSegments("Первая фраза. Вто"))
      .toEqual({ segments: ["Первая фраза."], remainder: "Вто" });
    expect(takeCompletedSpeechSegments("Вторая фраза", true))
      .toEqual({ segments: ["Вторая фраза"], remainder: "" });
  });

  it("does not wait forever for punctuation in a long response", () => {
    const input = `${"слово ".repeat(60)}хвост`;
    const result = takeCompletedSpeechSegments(input, false, 120);
    expect(result.segments.length).toBeGreaterThan(0);
    expect(`${result.segments.join(" ")} ${result.remainder}`.replace(/\s+/g, " ").trim())
      .toBe(input.replace(/\s+/g, " ").trim());
  });
});

describe("StreamingTextTtsSession", () => {
  it("starts synthesizing completed phrases before the model stream finishes", async () => {
    vi.stubGlobal("window", { atob: globalThis.atob });
    vi.stubGlobal("Audio", FakeAudio);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:audio");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const inputs: string[] = [];
    const transport = vi.fn(async (
      input: string,
      onEvent: (event: TtsStreamEvent) => void
    ) => {
      inputs.push(input);
      onEvent({
        type: "audio",
        index: 0,
        contentType: "audio/mpeg",
        audioBase64: globalThis.btoa("audio")
      });
      onEvent({ type: "done", count: 1 });
    });
    const session = new StreamingTextTtsSession(transport);

    session.push("Первая фраза. ");
    await vi.waitFor(() => expect(inputs).toEqual(["Первая фраза."]));
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));

    session.push("Вторая фраза");
    const finished = session.finish();
    await vi.waitFor(() => expect(inputs).toEqual(["Первая фраза.", "Вторая фраза"]));
    FakeAudio.instances[0].onended?.();
    expect(FakeAudio.instances).toHaveLength(2);
    FakeAudio.instances[1].onended?.();
    await finished;
  });
});
