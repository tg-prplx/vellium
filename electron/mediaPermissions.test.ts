import { describe, expect, it } from "vitest";
import {
  canGrantLiveAudioPermission,
  decideMicrophonePermission,
  isTrustedMainMediaRequest
} from "./mediaPermissions";

describe("Electron Live media permissions", () => {
  it("allows microphone access only for the trusted main renderer", () => {
    const allowed = {
      trustedMainRenderer: true,
      allowedOrigin: true,
      permission: "media",
      mediaTypes: ["audio"]
    };
    expect(canGrantLiveAudioPermission(allowed)).toBe(true);
    expect(canGrantLiveAudioPermission({ ...allowed, trustedMainRenderer: false })).toBe(false);
    expect(canGrantLiveAudioPermission({ ...allowed, allowedOrigin: false })).toBe(false);
    expect(canGrantLiveAudioPermission({ ...allowed, mediaTypes: ["audio", "video"] })).toBe(false);
    expect(canGrantLiveAudioPermission({ ...allowed, permission: "notifications" })).toBe(false);
    expect(canGrantLiveAudioPermission({ ...allowed, mediaTypes: ["unknown"] })).toBe(false);
    expect(canGrantLiveAudioPermission({ ...allowed, mediaTypes: ["unknown"], allowUnknownMediaType: true })).toBe(true);
  });

  it("accepts a media request from the main document without relying on a missing isMainFrame field", () => {
    const allowed = {
      sameWebContents: true,
      mainDocumentUrl: "http://localhost:1420/",
      requestingUrl: "http://localhost:1420/"
    };
    expect(isTrustedMainMediaRequest(allowed)).toBe(true);
    expect(isTrustedMainMediaRequest({ ...allowed, sameWebContents: false })).toBe(false);
    expect(isTrustedMainMediaRequest({ ...allowed, requestingUrl: "http://localhost:1420/plugin-frame" })).toBe(false);
    expect(isTrustedMainMediaRequest({ ...allowed, requestingUrl: "https://evil.example/" })).toBe(false);
  });

  it("prompts only when macOS can still ask for microphone access", () => {
    expect(decideMicrophonePermission("granted")).toBe("granted");
    expect(decideMicrophonePermission("denied")).toBe("denied");
    expect(decideMicrophonePermission("restricted")).toBe("denied");
    expect(decideMicrophonePermission("not-determined")).toBe("prompt");
    expect(decideMicrophonePermission("unknown")).toBe("prompt");
  });
});
