import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import { resolveStoredAvatarFile } from "./characterAvatars.js";

describe("resolveStoredAvatarFile", () => {
  const avatarsDir = resolve("/tmp/vellium-avatars");

  it("resolves server-generated avatar filenames inside the avatars directory", () => {
    expect(resolveStoredAvatarFile(avatarsDir, "abc-123.png")).toBe(join(avatarsDir, "abc-123.png"));
  });

  it("rejects traversal, nested, absolute, and remote values", () => {
    expect(resolveStoredAvatarFile(avatarsDir, "../../victim.txt")).toBeNull();
    expect(resolveStoredAvatarFile(avatarsDir, "..")).toBeNull();
    expect(resolveStoredAvatarFile(avatarsDir, "nested/a.png")).toBeNull();
    expect(resolveStoredAvatarFile(avatarsDir, "/etc/passwd")).toBeNull();
    expect(resolveStoredAvatarFile(avatarsDir, "..\\..\\victim.txt")).toBeNull();
    expect(resolveStoredAvatarFile(avatarsDir, "https://cdn.example/a.png")).toBeNull();
    expect(resolveStoredAvatarFile(avatarsDir, null)).toBeNull();
  });
});
