import { describe, expect, it } from "vitest";
import { parseReplySuggestions } from "./replySuggestions.js";

describe("parseReplySuggestions", () => {
  it("reads a JSON array, drops reasoning, duplicates and extras", () => {
    expect(parseReplySuggestions('<think>hmm</think>Sure: ["A", "b", "a", "C", "D"]')).toEqual(["A", "b", "C"]);
  });

  it("falls back to a numbered or bulleted list", () => {
    expect(parseReplySuggestions('1. "Run!"\n- Hide behind the door\n\n• Ask who is there')).toEqual(["Run!", "Hide behind the door", "Ask who is there"]);
  });

  it("ignores non-string items and bounds long suggestions", () => {
    const result = parseReplySuggestions(JSON.stringify([42, null, "x".repeat(400)]));
    expect(result).toHaveLength(1);
    expect(result[0].length).toBeLessThanOrEqual(280);
  });
});
