import { describe, expect, it } from "vitest";
import { liveAvatarOwnerKey, parseLiveAvatarOverrides } from "./avatarState";

describe("live avatar state", () => {
  it("keeps only valid persisted avatar URLs", () => {
    expect(parseLiveAvatarOverrides('{"a":"/api/files/a.png","bad":4}')).toEqual({
      a: "/api/files/a.png"
    });
    expect(parseLiveAvatarOverrides("not-json")).toEqual({});
  });

  it("uses a stable owner for characterless chats", () => {
    expect(liveAvatarOwnerKey("")).toBe("__assistant__");
    expect(liveAvatarOwnerKey("char-1")).toBe("char-1");
  });
});
