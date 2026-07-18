import { describe, expect, it } from "vitest";
import { buildReasoningAwareTimeline, extractStoredReasoning } from "./reasoningContext.js";

const storedReasoning = JSON.stringify({
  kind: "tool_call",
  callId: "reasoning-1",
  name: "__reasoning__",
  args: "{}",
  result: "Compare the two choices."
});

describe("reasoning context", () => {
  it("attaches stored reasoning to its assistant message and budgets it", () => {
    const timeline = buildReasoningAwareTimeline([
      { id: "user-1", role: "user", content: "Choose", tokenCount: 1 },
      { id: "assistant-1", role: "assistant", content: "The first one.", tokenCount: 1 },
      { id: "reasoning-1", role: "tool", content: storedReasoning, parentId: "assistant-1", tokenCount: 1 }
    ], true);

    expect(timeline).toHaveLength(2);
    expect(timeline[1]?.reasoningContent).toBe("Compare the two choices.");
    expect(timeline[1]?.content).toBe("The first one.");
    expect(timeline[1]?.tokenCount).toBeGreaterThan(1);
  });

  it("omits reasoning when disabled and ignores unrelated or orphan tool rows", () => {
    const timeline = buildReasoningAwareTimeline([
      { id: "assistant-1", role: "assistant", content: "Answer", tokenCount: 2 },
      { id: "tool-1", role: "tool", content: JSON.stringify({ kind: "tool_call", name: "search", result: "data" }), parentId: "assistant-1" },
      { id: "reasoning-1", role: "tool", content: storedReasoning, parentId: "missing-assistant" }
    ], false);

    expect(timeline).toEqual([{ id: "assistant-1", role: "assistant", content: "Answer", tokenCount: 2 }]);
  });

  it("parses only the structured reasoning trace format", () => {
    expect(extractStoredReasoning(storedReasoning)).toBe("Compare the two choices.");
    expect(extractStoredReasoning(JSON.stringify({ kind: "tool_call", name: "search", result: "secret" }))).toBe("");
    expect(extractStoredReasoning("not json")).toBe("");
  });
});
