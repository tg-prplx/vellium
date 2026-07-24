import { post } from "./core";

const TRANSCRIPTION_REQUEST_OPTIONS = { timeoutMs: 90_000 };

export const liveClient = {
  liveTranscribe: (
    audioBase64: string,
    mimeType: string,
    filename: string,
    signal?: AbortSignal
  ) => post<{ text: string }>(
    "/live/transcribe",
    { audioBase64, mimeType, filename },
    { ...TRANSCRIPTION_REQUEST_OPTIONS, signal }
  )
};
