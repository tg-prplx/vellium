import { post } from "./core";

export const liveClient = {
  liveTranscribe: (
    audioBase64: string,
    mimeType: string,
    filename: string,
    signal?: AbortSignal
  ) => post<{ text: string }>(
    "/live/transcribe",
    { audioBase64, mimeType, filename },
    { signal }
  )
};
