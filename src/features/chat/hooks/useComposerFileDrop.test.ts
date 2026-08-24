import { describe, expect, it } from "vitest";
import { transferContainsFiles } from "./useComposerFileDrop";

describe("transferContainsFiles", () => {
  it("accepts operating-system file drags", () => {
    expect(transferContainsFiles(["text/plain", "Files"])).toBe(true);
  });

  it("ignores text and internal element drags", () => {
    expect(transferContainsFiles(["text/plain", "text/html"])).toBe(false);
    expect(transferContainsFiles(null)).toBe(false);
  });
});
