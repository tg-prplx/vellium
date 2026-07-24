import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeTtsPlayer } from "./realtimeTts";

class FakeAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
  play = vi.fn(async () => undefined);
  pause = vi.fn();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RealtimeTtsPlayer", () => {
  it("starts on the first chunk and plays later chunks in order", async () => {
    const audioInstances: FakeAudio[] = [];
    vi.stubGlobal("window", { atob: globalThis.atob });
    vi.stubGlobal("Audio", class extends FakeAudio {
      constructor() {
        super();
        audioInstances.push(this);
      }
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const onStart = vi.fn();
    const player = new RealtimeTtsPlayer({ onPlaybackStart: onStart });
    const playback = player.play(async (onEvent) => {
      onEvent({ type: "audio", index: 0, contentType: "audio/mpeg", audioBase64: globalThis.btoa("one") });
      onEvent({ type: "audio", index: 1, contentType: "audio/mpeg", audioBase64: globalThis.btoa("two") });
      onEvent({ type: "done", count: 2 });
    });
    await Promise.resolve();
    expect(audioInstances).toHaveLength(1);
    expect(onStart).toHaveBeenCalledTimes(1);
    audioInstances[0].onended?.();
    expect(audioInstances).toHaveLength(2);
    audioInstances[1].onended?.();
    await playback;
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
