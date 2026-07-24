import { afterEach, describe, expect, it, vi } from "vitest";
import { streamOpenAiCompatibleTts } from "./ttsUpstreamStream";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI-compatible TTS streaming", () => {
  it("parses fragmented SSE PCM deltas", async () => {
    const encoder = new TextEncoder();
    const payload = [
      `event: audio.delta\r\ndata: ${JSON.stringify({
        type: "audio.delta",
        audio: "AQID",
        format: "pcm",
        sample_rate: 24_000
      })}\r\n\r\n`,
      "event: audio.done\r\ndata: {\"type\":\"audio.done\"}\r\n\r\ndata: [DONE]\r\n\r\n"
    ].join("");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload.slice(0, 37)));
        controller.enqueue(encoder.encode(payload.slice(37)));
        controller.close();
      }
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const chunks: unknown[] = [];

    const count = await streamOpenAiCompatibleTts({
      baseUrl: "http://127.0.0.1:7860/v1",
      apiKey: "",
      model: "qwen3-tts-voice-design",
      voice: "nova",
      input: "Hello",
      signal: new AbortController().signal
    }, (chunk) => chunks.push(chunk));

    expect(count).toBe(1);
    expect(chunks).toEqual([{ audioBase64: "AQID", format: "pcm", sampleRate: 24_000 }]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      response_format: "pcm",
      stream_format: "sse"
    });
  });

  it("returns null when the provider rejects streaming parameters", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unsupported", { status: 400 })));

    await expect(streamOpenAiCompatibleTts({
      baseUrl: "http://127.0.0.1:7860/v1",
      apiKey: "",
      model: "tts-1",
      voice: "alloy",
      input: "Hello",
      signal: new AbortController().signal
    }, () => {})).resolves.toBeNull();
  });
});
