import { describe, expect, it } from "vitest";
import { consumeThinkChunk, createThinkStreamState, flushThinkState, splitThinkContent } from "../../server/modules/chat/reasoning";

describe("think tag reasoning parsing", () => {
  it("splits inline think blocks into reasoning and visible content", () => {
    const parsed = splitThinkContent("Visible<think>Hidden chain</think>Answer");
    expect(parsed).toEqual({
      content: "VisibleAnswer",
      reasoning: "Hidden chain"
    });
  });

  it("parses streamed think tags across chunk boundaries", () => {
    const state = createThinkStreamState();
    const first = consumeThinkChunk(state, "Hello <thi");
    const second = consumeThinkChunk(state, "nk>plan");
    const third = consumeThinkChunk(state, "</think> world");
    const tail = flushThinkState(state);

    expect(first).toEqual({ content: "Hello ", reasoning: "" });
    expect(second).toEqual({ content: "", reasoning: "plan" });
    expect(third).toEqual({ content: " world", reasoning: "" });
    expect(tail).toEqual({ content: "", reasoning: "" });
  });

  it("treats unterminated think blocks as reasoning on flush", () => {
    const state = createThinkStreamState();
    const first = consumeThinkChunk(state, "<think>partial");
    const tail = flushThinkState(state);
    expect(first).toEqual({ content: "", reasoning: "partial" });
    expect(tail).toEqual({ content: "", reasoning: "" });
  });
});
