import { afterEach, describe, expect, it, vi } from "vitest";

import { streamPost } from "./core";

afterEach(() => {
  vi.restoreAllMocks();
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
