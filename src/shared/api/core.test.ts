import { afterEach, describe, expect, it, vi } from "vitest";

import { request, resolveApiAssetUrl, streamPost } from "./core";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }
  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    configurable: true
  });
});

describe("resolveApiAssetUrl", () => {
  it("keeps desktop asset URLs on the local backend instead of file://", () => {
    Object.defineProperty(globalThis, "window", {
      value: {
        location: { protocol: "file:" }
      },
      configurable: true
    });

    expect(resolveApiAssetUrl("/api/avatars/example.png")).toBe("http://127.0.0.1:3001/api/avatars/example.png");
  });
});

describe("request", () => {
  it("extracts readable messages from JSON error payloads", async () => {
    Object.defineProperty(globalThis, "window", {
      value: {
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis)
      },
      configurable: true
    });

    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: "Provider blocked by Full Local Mode" }),
      {
        status: 403,
        headers: {
          "Content-Type": "application/json"
        }
      }
    )) as typeof fetch;

    await expect(request("POST", "/providers/preview/models", { baseUrl: "https://example.com/v1" }))
      .rejects
      .toThrow("Provider blocked by Full Local Mode");
  });
});

describe("streamPost", () => {
  it("tolerates terminated streams after a done event", async () => {
    const encoder = new TextEncoder();
    let doneSent = false;
    globalThis.fetch = vi.fn(async () => new Response(
      new ReadableStream({
        pull(controller) {
          if (!doneSent) {
            doneSent = true;
            controller.enqueue(encoder.encode('data: {"type":"done","chatId":"chat-1"}\n\n'));
            return;
          }
          controller.error(new TypeError("terminated"));
        }
      }),
      {
        headers: {
          "Content-Type": "text/event-stream"
        }
      }
    )) as typeof fetch;

    const onDone = vi.fn();
    await expect(streamPost("/chats/chat-1/send", { content: "hi" }, { onDone })).resolves.toBeUndefined();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("tolerates terminated streams after partial delta delivery", async () => {
    const encoder = new TextEncoder();
    let chunkSent = false;
    globalThis.fetch = vi.fn(async () => new Response(
      new ReadableStream({
        pull(controller) {
          if (!chunkSent) {
            chunkSent = true;
            controller.enqueue(encoder.encode('data: {"type":"delta","chatId":"chat-1","delta":"hello"}\n\n'));
            return;
          }
          controller.error(new TypeError("fetch failed"));
        }
      }),
      {
        headers: {
          "Content-Type": "text/event-stream"
        }
      }
    )) as typeof fetch;

    const onDelta = vi.fn();
    const onDone = vi.fn();
    await expect(streamPost("/chats/chat-1/send", { content: "hi" }, { onDelta, onDone })).resolves.toBeUndefined();
    expect(onDelta).toHaveBeenCalledWith("hello");
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
