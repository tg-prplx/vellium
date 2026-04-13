import { describe, expect, it } from "vitest";
import { buildFilenameBase } from "./download";

describe("buildFilenameBase", () => {
  it("strips invalid filename characters and trims extra separators", () => {
    expect(buildFilenameBase("  hero:/mage?  ", "character")).toBe("hero-mage");
  });

  it("returns the fallback when the sanitized name is empty", () => {
    expect(buildFilenameBase("////", "lorebook")).toBe("lorebook");
  });
});
