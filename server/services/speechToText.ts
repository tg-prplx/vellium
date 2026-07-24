import { fetchProviderResponse } from "./providerHttp.js";
import { LOCAL_INFERENCE_URL, transcribeLocalWhisper } from "./localInference.js";

export const MAX_STT_AUDIO_BYTES = 18 * 1024 * 1024;
const TRANSCRIPTION_TIMEOUT_MS = 75_000;
const ALLOWED_AUDIO_MIME_TYPES = new Map([
  ["audio/flac", "flac"],
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/mp4", "mp4"],
  ["audio/x-m4a", "m4a"],
  ["audio/m4a", "m4a"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/webm", "webm"]
]);

export interface SpeechToTextRequest {
  baseUrl: string;
  apiKey?: string;
  model: string;
  language?: string;
  audioBase64: string;
  mimeType: string;
  filename?: string;
}

export function normalizeSpeechToTextEndpoint(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) throw new Error("STT endpoint is not configured");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("STT endpoint must use HTTP or HTTPS");
  }
  if (url.username || url.password) throw new Error("STT endpoint must not contain credentials");
  url.search = "";
  url.hash = "";
  let pathname = url.pathname.replace(/\/+$/, "");
  if (/\/audio\/transcriptions$/i.test(pathname)) {
    url.pathname = pathname;
    return url.toString();
  }
  if (!/\/v1$/i.test(pathname)) pathname += "/v1";
  url.pathname = `${pathname}/audio/transcriptions`;
  return url.toString();
}

function normalizeMimeType(raw: string): { mimeType: string; extension: string } {
  const mimeType = String(raw || "").split(";")[0].trim().toLowerCase();
  const extension = ALLOWED_AUDIO_MIME_TYPES.get(mimeType);
  if (!extension) throw new Error(`Unsupported STT audio type: ${mimeType || "unknown"}`);
  return { mimeType, extension };
}

export function decodeSpeechAudio(raw: string): Buffer {
  const value = String(raw || "").trim();
  if (!value) throw new Error("Audio payload is missing");
  if (value.length > Math.ceil(MAX_STT_AUDIO_BYTES * 4 / 3) + 8) {
    throw new Error("Audio payload is too large");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Audio payload is not valid base64");
  const audio = Buffer.from(value, "base64");
  if (!audio.length) throw new Error("Audio payload is empty");
  if (audio.length > MAX_STT_AUDIO_BYTES) throw new Error("Audio payload is too large");
  return audio;
}

function safeAudioFilename(raw: string | undefined, extension: string): string {
  const stem = String(raw || "live-recording")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "live-recording";
  return `${stem}.${extension}`;
}

export async function transcribeSpeech(request: SpeechToTextRequest): Promise<string> {
  if (String(request.baseUrl || "").trim() === LOCAL_INFERENCE_URL) {
    const { mimeType } = normalizeMimeType(request.mimeType);
    return transcribeLocalWhisper(decodeSpeechAudio(request.audioBase64), mimeType);
  }
  const endpoint = normalizeSpeechToTextEndpoint(request.baseUrl);
  const model = String(request.model || "").trim();
  if (!model) throw new Error("STT model is not configured");
  const { mimeType, extension } = normalizeMimeType(request.mimeType);
  const audio = decodeSpeechAudio(request.audioBase64);
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(audio)], { type: mimeType }), safeAudioFilename(request.filename, extension));
  form.append("model", model);
  form.append("response_format", "json");
  const language = String(request.language || "").trim();
  if (language) form.append("language", language.slice(0, 24));

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`STT request timed out after ${TRANSCRIPTION_TIMEOUT_MS}ms`)),
    TRANSCRIPTION_TIMEOUT_MS
  );
  timeout.unref?.();
  try {
    const response = await fetchProviderResponse(endpoint, {
      method: "POST",
      headers: request.apiKey?.trim()
        ? { Authorization: `Bearer ${request.apiKey.trim()}` }
        : undefined,
      body: form,
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = (await response.text()).trim().slice(0, 500);
      throw new Error(`STT endpoint returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const contentType = String(response.headers.get("content-type") || "");
    if (contentType.includes("application/json")) {
      const body = await response.json() as { text?: unknown };
      const text = String(body?.text || "").trim();
      if (!text) throw new Error("STT endpoint returned an empty transcript");
      return text.slice(0, 100_000);
    }
    const text = (await response.text()).trim();
    if (!text) throw new Error("STT endpoint returned an empty transcript");
    return text.slice(0, 100_000);
  } finally {
    clearTimeout(timeout);
  }
}
