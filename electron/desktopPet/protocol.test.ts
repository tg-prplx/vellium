import { describe, expect, it } from "vitest";
import { buildDesktopPetPageUrl, isDesktopPetPageUrl } from "./protocol";

describe("desktop pet protocol", () => {
  it("recognizes only the private secure desktop pet document", () => {
    expect(isDesktopPetPageUrl(buildDesktopPetPageUrl("token"))).toBe(true);
    expect(isDesktopPetPageUrl("vellium-pet://other/index.html?token=token")).toBe(false);
    expect(isDesktopPetPageUrl("vellium-pet://desktop/other.html?token=token")).toBe(false);
    expect(isDesktopPetPageUrl("data:text/html,pet")).toBe(false);
    expect(isDesktopPetPageUrl("https://example.com/index.html")).toBe(false);
  });
});
