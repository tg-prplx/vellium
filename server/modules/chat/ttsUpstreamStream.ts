export interface OpenAiTtsStreamChunk {
  audioBase64: string;
  format: "pcm";
  sampleRate: number;
}

interface StreamOpenAiTtsParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  input: string;
  signal: AbortSignal;
}

const STREAM_UNSUPPORTED_STATUSES = new Set([400, 404, 405, 406, 415, 422, 501]);
const MAX_SSE_BUFFER_CHARS = 16 * 1024 * 1024;
const MAX_AUDIO_CHUNK_CHARS = 12 * 1024 * 1024;

function parseAudioDelta(block: string): OpenAiTtsStreamChunk | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return null;

  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const event = payload as { type?: unknown; audio?: unknown; format?: unknown; sample_rate?: unknown };
  if (event.type !== "audio.delta" || typeof event.audio !== "string" || !event.audio) return null;
  if (event.audio.length > MAX_AUDIO_CHUNK_CHARS) {
    throw new Error("Streaming TTS audio chunk is too large");
  }
  const sampleRate = Number(event.sample_rate);
  return {
    audioBase64: event.audio,
    format: "pcm",
    sampleRate: Number.isFinite(sampleRate) && sampleRate >= 8_000 && sampleRate <= 192_000
      ? Math.floor(sampleRate)
      : 24_000
  };
}

async function consumeSseAudio(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: OpenAiTtsStreamChunk) => void
): Promise<number> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let count = 0;

  const consumeBlocks = (flush = false) => {
    buffer = buffer.replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const chunk = parseAudioDelta(block);
      if (chunk) {
        onChunk(chunk);
        count += 1;
      }
      boundary = buffer.indexOf("\n\n");
    }
    if (flush && buffer.trim()) {
      const chunk = parseAudioDelta(buffer);
      if (chunk) {
        onChunk(chunk);
        count += 1;
      }
      buffer = "";
    }
    if (buffer.length > MAX_SSE_BUFFER_CHARS) {
      throw new Error("Streaming TTS event buffer is too large");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    consumeBlocks();
  }
  buffer += decoder.decode();
  consumeBlocks(true);
  return count;
}

export async function streamOpenAiCompatibleTts(
  params: StreamOpenAiTtsParams,
  onChunk: (chunk: OpenAiTtsStreamChunk) => void
): Promise<number | null> {
  const response = await fetch(`${params.baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: params.model,
      voice: params.voice,
      input: params.input,
      response_format: "pcm",
      stream_format: "sse"
    }),
    signal: params.signal
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    if (STREAM_UNSUPPORTED_STATUSES.has(response.status)) return null;
    throw new Error(`Streaming TTS failed: ${details.slice(0, 500) || response.statusText}`);
  }
  if (!response.body || !/text\/event-stream/i.test(response.headers.get("content-type") || "")) {
    await response.body?.cancel().catch(() => {});
    return null;
  }

  return consumeSseAudio(response.body, onChunk);
}
