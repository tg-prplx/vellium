import { describe, expect, it } from "vitest";
import { appendRpReasoningTurnGuard, inlineRpReasoningHistory, RP_REASONING_TURN_GUARD } from "./rpReasoning.js";

describe("inlineRpReasoningHistory", () => {
  it("turns stored simulated reasoning into a provider-independent history example", () => {
    expect(inlineRpReasoningHistory("Actual reply", "  I should answer briefly.  ")).toEqual({
      content: "<think>\nI should answer briefly.\n</think>\n\nActual reply"
    });
  });

  it("leaves content unchanged when no stored reasoning exists", () => {
    expect(inlineRpReasoningHistory("Actual reply")).toEqual({ content: "Actual reply" });
  });
});

describe("appendRpReasoningTurnGuard", () => {
  it("places the per-turn guard at the end of the existing system message", () => {
    const messages = appendRpReasoningTurnGuard([
      { role: "system", content: "Base prompt\n\n[Author's Note: Stay grounded]" },
      { role: "user", content: "Continue the scene" }
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(String(messages[0]?.content)).toBe(`Base prompt\n\n[Author's Note: Stay grounded]\n\n${RP_REASONING_TURN_GUARD}`);
    expect(messages[1]).toEqual({ role: "user", content: "Continue the scene" });
  });

  it("adds one system message without changing user content when none exists", () => {
    const original = [{ role: "user", content: "Do not rewrite this text" }];
    const messages = appendRpReasoningTurnGuard(original);

    expect(messages).toEqual([
      { role: "system", content: RP_REASONING_TURN_GUARD },
      { role: "user", content: "Do not rewrite this text" }
    ]);
    expect(original).toEqual([{ role: "user", content: "Do not rewrite this text" }]);
  });

  it("moves an existing guard behind later tool instructions without duplicating it", () => {
    const messages = appendRpReasoningTurnGuard([{
      role: "system",
      content: `Base prompt\n\n${RP_REASONING_TURN_GUARD}\n\nUse tools only when they clearly help.`
    }, {
      role: "user",
      content: "Continue"
    }]);

    const systemContent = String(messages[0]?.content || "");
    expect(systemContent).toBe(`Base prompt\n\nUse tools only when they clearly help.\n\n${RP_REASONING_TURN_GUARD}`);
    expect(systemContent.split(RP_REASONING_TURN_GUARD)).toHaveLength(2);
  });
});
