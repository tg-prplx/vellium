import { describe, expect, it, vi } from "vitest";
import { transcribeDesktopPetAudio } from "./live";

describe("desktop pet Live audio", () => {
  it("validates and forwards bounded microphone audio to the shared Live STT route", async () => {
    const request = vi.fn(async (_pathName: string, _init?: RequestInit) => ({ text: "  hello pet  " }));
    const result = await transcribeDesktopPetAudio({
      audioBase64: Buffer.from("voice").toString("base64"),
      mimeType: "audio/webm;codecs=opus"
    }, request);

    expect(result).toEqual({ ok: true, text: "hello pet" });
    expect(request).toHaveBeenCalledWith("/api/live/transcribe", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ mimeType: "audio/webm", filename: "desktop-pet-recording.webm" });
  });

  it("rejects unsupported or malformed audio before making a request", async () => {
    const request = vi.fn();
    await expect(transcribeDesktopPetAudio({ audioBase64: "abcd", mimeType: "text/plain" }, request))
      .resolves.toMatchObject({ ok: false, error: "Unsupported microphone audio format" });
    expect(request).not.toHaveBeenCalled();
  });
});
