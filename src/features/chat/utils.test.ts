import { afterEach, describe, expect, it } from "vitest";
import type { FileAttachment } from "../../shared/types/contracts";
import { imageSourceFromAttachment, normalizeReasoningDisplayText, parseToolCallContent, parseToolResultDisplay, renderContentWithFallback } from "./utils";

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }
  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    configurable: true
  });
});

describe("reasoning display normalization", () => {
  it("collapses token-stream reasoning that was stored one fragment per line", () => {
    expect(normalizeReasoningDisplayText("User\n\n asks\n\n what\n\n's\n\n in\n\n the\n\n directory\n\n.")).toBe(
      "User asks what's in the directory."
    );
  });

  it("keeps structured reasoning blocks intact", () => {
    const structured = "- inspect files\n- run tests\n- summarize result";
    expect(normalizeReasoningDisplayText(structured)).toBe(structured);
  });
});

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

  it("resolves relative API image attachments in desktop mode", () => {
    Object.defineProperty(globalThis, "window", {
      value: {
        location: { protocol: "file:" }
      },
      configurable: true
    });

    const attachment: FileAttachment = {
      id: "attachment-1",
      filename: "preview.png",
      type: "image",
      url: "/api/uploads/preview.png",
      mimeType: "image/png"
    };

    expect(imageSourceFromAttachment(attachment)).toBe("http://127.0.0.1:3001/api/uploads/preview.png");
  });
});

describe("chat content rendering", () => {
  it("falls back to escaped plain text when sanitized markdown renders empty", () => {
    const html = renderContentWithFallback("![generated](data:image/png;base64,abc)", undefined, undefined, {
      sanitizeMarkdown: true,
      allowExternalLinks: false,
      allowRemoteImages: false,
      allowUnsafeUploads: false
    });

    expect(html).toContain("![generated]");
    expect(html).not.toBe("");
  });
});
