import { describe, expect, it } from "vitest";
import { maskSettingsSecrets, resolveDiscoverySecret, resolveSettingsSecretPatch } from "./settingsSecrets.js";

describe("settings secret masking", () => {
  it("masks TTS and STT keys in outgoing payloads", () => {
    const masked = maskSettingsSecrets({ ttsApiKey: "sk-tts-secret-123456", sttApiKey: "", theme: "dark" });
    expect(masked.ttsApiKey).toBe("sk-t***3456");
    expect(masked.sttApiKey).toBe("");
    expect(masked.theme).toBe("dark");
  });

  it("keeps the stored secret when a client echoes the masked value", () => {
    expect(resolveSettingsSecretPatch("sk-t***3456", "sk-tts-secret-123456")).toBe("sk-tts-secret-123456");
    expect(resolveSettingsSecretPatch(undefined, "sk-tts-secret-123456")).toBe("sk-tts-secret-123456");
    expect(resolveSettingsSecretPatch("sk-new", "sk-tts-secret-123456")).toBe("sk-new");
    expect(resolveSettingsSecretPatch("", "sk-tts-secret-123456")).toBe("");
  });

  it("reuses a stored discovery key only for the endpoint it was saved for", () => {
    const stored = { storedKey: "sk-tts-secret-123456", storedBaseUrl: "https://tts.example/v1" };
    expect(resolveDiscoverySecret({ ...stored, requestedKey: undefined, requestedBaseUrl: "https://tts.example/v1" }))
      .toBe("sk-tts-secret-123456");
    expect(resolveDiscoverySecret({ ...stored, requestedKey: "sk-t***3456", requestedBaseUrl: "https://tts.example/v1" }))
      .toBe("sk-tts-secret-123456");
    expect(resolveDiscoverySecret({ ...stored, requestedKey: undefined, requestedBaseUrl: "https://attacker.example" }))
      .toBe("");
    expect(resolveDiscoverySecret({ ...stored, requestedKey: "sk-t***3456", requestedBaseUrl: "https://attacker.example" }))
      .toBe("");
    expect(resolveDiscoverySecret({ ...stored, requestedKey: "sk-explicit", requestedBaseUrl: "https://attacker.example" }))
      .toBe("sk-explicit");
  });
});
