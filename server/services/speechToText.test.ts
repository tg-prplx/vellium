import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_STT_AUDIO_BYTES,
  decodeSpeechAudio,
  normalizeSpeechToTextEndpoint,
  transcribeSpeech
} from "./speechToText";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("speech-to-text transport", () => {
  it("normalizes OpenAI-compatible base URLs without duplicating the API path", () => {
    expect(normalizeSpeechToTextEndpoint("http://127.0.0.1:1234"))
      .toBe("http://127.0.0.1:1234/v1/audio/transcriptions");
    expect(normalizeSpeechToTextEndpoint("https://example.com/v1/"))
      .toBe("https://example.com/v1/audio/transcriptions");
    expect(normalizeSpeechToTextEndpoint("https://example.com/v1/audio/transcriptions"))
      .toBe("https://example.com/v1/audio/transcriptions");
    expect(() => normalizeSpeechToTextEndpoint("file:///tmp/audio")).toThrow(/HTTP or HTTPS/);
  });

  it("rejects malformed and oversized audio before making an outbound request", () => {
    expect(() => decodeSpeechAudio("not base64!")).toThrow(/valid base64/);
    expect(() => decodeSpeechAudio("A".repeat(Math.ceil(MAX_STT_AUDIO_BYTES * 4 / 3) + 20)))
      .toThrow(/too large/);
  });

  it("sends a multipart Whisper-compatible transcription request", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect(form.get("model")).toBe("whisper-1");
      expect(form.get("language")).toBe("ru");
      expect(form.get("response_format")).toBe("json");
      const audio = form.get("file");
      expect(audio).toBeInstanceOf(Blob);
      expect((audio as Blob).type).toBe("audio/webm");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
      return new Response(JSON.stringify({ text: "  Привет, мир.  " }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeSpeech({
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: "secret",
      model: "whisper-1",
      language: "ru",
      audioBase64: Buffer.from("test audio").toString("base64"),
      mimeType: "audio/webm;codecs=opus",
      filename: "../../unsafe.webm"
    })).resolves.toBe("Привет, мир.");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/v1/audio/transcriptions",
      expect.any(Object)
    );
  });
});
