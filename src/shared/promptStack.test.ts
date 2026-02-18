import { describe, expect, it } from "vitest";
import { buildOrderedPrompt } from "./promptStack";

describe("buildOrderedPrompt", () => {
  it("sorts by order and filters disabled blocks", () => {
    const result = buildOrderedPrompt([
      { id: "3", kind: "history", order: 3, enabled: true, content: "h" },
      { id: "1", kind: "system", order: 1, enabled: true, content: "s" },
      { id: "2", kind: "jailbreak", order: 2, enabled: false, content: "j" }
    ]);

    expect(result.map((b) => b.id)).toEqual(["1", "3"]);
  });
});
