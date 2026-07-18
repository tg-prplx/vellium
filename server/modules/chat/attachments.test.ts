import { describe, expect, it } from "vitest";
import { selectTimelineForPrompt } from "./attachments.js";

describe("selectTimelineForPrompt", () => {
  const timeline = Array.from({ length: 6 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message-${index + 1}`,
    tokenCount: 1
  }));

  it("keeps the newest configured number of messages", () => {
    expect(selectTimelineForPrompt(timeline, "", 8192, 35, 75, 3).map((item) => item.content))
      .toEqual(["message-4", "message-5", "message-6"]);
  });

  it("treats zero as unlimited and still applies the token budget", () => {
    expect(selectTimelineForPrompt(timeline, "", 8192, 35, 75, 0)).toHaveLength(6);
  });
});
