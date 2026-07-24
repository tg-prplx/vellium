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

  it("schedules native PCM deltas through Web Audio", async () => {
    const sources: Array<{
      onended: (() => void) | null;
      start: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    const close = vi.fn(async () => undefined);
    class FakeAudioContext {
      currentTime = 1;
      destination = {};
      resume = vi.fn(async () => undefined);
      close = close;
      createBuffer(_channels: number, frames: number, sampleRate: number) {
        const samples = new Float32Array(frames);
        return {
          duration: frames / sampleRate,
          getChannelData: () => samples
        };
      }
      createBufferSource() {
        const source = {
          buffer: null,
          onended: null as (() => void) | null,
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn()
        };
        sources.push(source);
        return source;
      }
    }
    vi.stubGlobal("window", { atob: globalThis.atob, AudioContext: FakeAudioContext });
    const onStart = vi.fn();
    const player = new RealtimeTtsPlayer({ onPlaybackStart: onStart });
    const pcm = new Uint8Array([0, 0, 255, 127, 0, 128]);
    let binary = "";
    for (const byte of pcm) binary += String.fromCharCode(byte);
    const playback = player.play(async (onEvent) => {
      onEvent({
        type: "audio",
        index: 0,
        contentType: "audio/pcm",
        audioBase64: globalThis.btoa(binary),
        format: "pcm",
        sampleRate: 24_000
      });
      onEvent({ type: "done", count: 1 });
    });

    await Promise.resolve();
    expect(sources).toHaveLength(1);
    expect(sources[0].start).toHaveBeenCalledWith(expect.any(Number));
    expect(onStart).toHaveBeenCalledTimes(1);
    sources[0].onended?.();
    await playback;
    expect(close).toHaveBeenCalledTimes(1);
  });
});
