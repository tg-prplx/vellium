import { describe, expect, it } from "vitest";
import { parseToolCallContent, parseToolResultDisplay } from "./utils";

describe("tool result display parsing", () => {
  const rawResult = JSON.stringify({
    kind: "vellium_media_result",
    summary: "Image created and shown to the user.",
    media: [{
      type: "image",
      url: "http://127.0.0.1:8188/view?filename=test.png&type=output",
      markdown: "![generated image 1](http://127.0.0.1:8188/view?filename=test.png&type=output)",
      alt: "Generated image 1"
    }]
  });

  it("parses structured media payloads into summary and media", () => {
    const parsed = parseToolResultDisplay(rawResult);
    expect(parsed.resultSummary).toBe("Image created and shown to the user.");
    expect(parsed.media).toHaveLength(1);
    expect(parsed.media[0]?.url).toContain("127.0.0.1:8188");
  });

  it("exposes structured media from serialized tool traces", () => {
    const payload = parseToolCallContent(JSON.stringify({
      kind: "tool_call",
      callId: "call-1",
      name: "mcp_comfyui-prompt-only__generate_image",
      args: "{\"prompt\":\"test\"}",
      result: rawResult
    }));

    expect(payload.resultSummary).toBe("Image created and shown to the user.");
    expect(payload.media).toHaveLength(1);
    expect(payload.media?.[0]?.alt).toBe("Generated image 1");
  });
});
