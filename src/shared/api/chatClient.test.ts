import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  del: vi.fn(),
  get: vi.fn(),
  patchReq: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  requestBlob: vi.fn(),
  streamNdjson: vi.fn(),
  streamPost: vi.fn()
}));

vi.mock("./core", () => core);

import { chatClient } from "./chatClient";

describe("chatClient TTS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not apply the short general API timeout to message synthesis", async () => {
    core.requestBlob.mockResolvedValue(new Blob());

    await chatClient.chatTtsMessage("message-1");

    expect(core.requestBlob).toHaveBeenCalledWith(
      "POST",
      "/chats/messages/message-1/tts",
      undefined,
      { timeoutMs: 0 }
    );
  });
});
