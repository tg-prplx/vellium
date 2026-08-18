import { decodeBoundedBase64 } from "../security";

const MAX_DESKTOP_PET_AUDIO_BYTES = 8 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav"
]);

type PetApiRequest = (pathName: string, init?: RequestInit) => Promise<{ text?: unknown }>;

export async function transcribeDesktopPetAudio(
  rawPayload: unknown,
  request: PetApiRequest
): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const payload = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
      ? rawPayload as Record<string, unknown>
      : {};
    const mimeType = String(payload.mimeType || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_AUDIO_TYPES.has(mimeType)) throw new Error("Unsupported microphone audio format");
    const audio = decodeBoundedBase64(String(payload.audioBase64 || ""), MAX_DESKTOP_PET_AUDIO_BYTES);
    const extension = mimeType === "audio/ogg" ? "ogg"
      : mimeType === "audio/mp4" ? "mp4"
        : mimeType === "audio/mpeg" ? "mp3"
          : mimeType === "audio/wav" || mimeType === "audio/x-wav" ? "wav" : "webm";
    const result = await request("/api/live/transcribe", {
      method: "POST",
      body: JSON.stringify({
        audioBase64: audio.toString("base64"),
        mimeType,
        filename: `desktop-pet-recording.${extension}`
      })
    });
    const text = String(result?.text || "").trim().slice(0, 4000);
    return text ? { ok: true, text } : { ok: false, error: "Speech was not recognized" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Speech transcription failed" };
  }
}
