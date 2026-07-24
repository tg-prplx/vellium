import { describe, expect, it } from "vitest";
import { chooseWhisperRecorderMimeType, encodeMonoPcmWav, extensionForAudioMimeType } from "./whisperRecorder";

describe("Whisper recorder format selection", () => {
  it("prefers Opus WebM and falls back to another supported recording format", () => {
    expect(chooseWhisperRecorderMimeType((value) => value === "audio/webm;codecs=opus"))
      .toBe("audio/webm;codecs=opus");
    expect(chooseWhisperRecorderMimeType((value) => value === "audio/mp4")).toBe("audio/mp4");
    expect(chooseWhisperRecorderMimeType(() => false)).toBe("");
  });

  it("uses an extension accepted by transcription endpoints", () => {
    expect(extensionForAudioMimeType("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionForAudioMimeType("audio/ogg")).toBe("ogg");
    expect(extensionForAudioMimeType("audio/mp4")).toBe("mp4");
  });

  it("encodes local Whisper input as mono 16-bit PCM WAV", async () => {
    const blob = encodeMonoPcmWav(new Float32Array([-1, 0, 1]), 16_000);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(blob.type).toBe("audio/wav");
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(bytes.byteLength).toBe(50);
  });
});
