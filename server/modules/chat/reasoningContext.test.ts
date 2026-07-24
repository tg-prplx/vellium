import { describe, expect, it } from "vitest";
import {
  buildReasoningAwareTimeline,
  extractStoredMediaReferences,
  extractStoredReasoning,
  stripStoredMediaLinks
} from "./reasoningContext.js";

const storedReasoning = JSON.stringify({
  kind: "tool_call",
  callId: "reasoning-1",
  name: "__reasoning__",
  args: "{}",
  result: "Compare the two choices."
});

const generatedImageUrl = "http://127.0.0.1:8188/view?filename=portrait.png&type=output";
const generatedImageMarkdown = `![Generated portrait](${generatedImageUrl})`;
const storedMedia = JSON.stringify({
  kind: "tool_call",
  callId: "image-1",
  name: "mcp_comfyui__generate_image",
  args: "{}",
  result: JSON.stringify({
    kind: "vellium_media_result",
    summary: "Image created and shown to the user.",
    media: [{
      type: "image",
      url: generatedImageUrl,
      markdown: generatedImageMarkdown,
      alt: "Generated portrait"
    }]
  })
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

  it("removes only tool-generated display links from assistant provider context", () => {
    const timeline = buildReasoningAwareTimeline([{
      id: "user-1",
      role: "user",
      content: `Keep my reference: ${generatedImageMarkdown}`,
      tokenCount: 10
    }, {
      id: "assistant-1",
      role: "assistant",
      content: `Here is the result.\n\n${generatedImageMarkdown}\n\n[Ordinary link](https://example.com/reference)`,
      tokenCount: 20
    }, {
      id: "tool-1",
      role: "tool",
      content: storedMedia,
      parentId: "assistant-1",
      tokenCount: 10
    }], false);

    expect(timeline).toHaveLength(2);
    expect(timeline[0]?.content).toContain(generatedImageMarkdown);
    expect(timeline[1]?.content).toBe("Here is the result.\n\n[Ordinary link](https://example.com/reference)");
    expect(timeline[1]?.tokenCount).toBeLessThan(20);
  });

  it("parses and strips equivalent Markdown for a stored media URL", () => {
    const media = extractStoredMediaReferences(storedMedia);
    expect(media).toEqual([{
      url: generatedImageUrl,
      markdown: generatedImageMarkdown
    }]);
    expect(stripStoredMediaLinks(
      `Done\n\n![Different label](${generatedImageUrl})`,
      media
    )).toBe("Done");
    expect(stripStoredMediaLinks(generatedImageMarkdown, media))
      .toBe("[Generated image shown to the user.]");
  });
});
