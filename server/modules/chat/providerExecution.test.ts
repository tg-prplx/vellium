import { describe, expect, it } from "vitest";
import {
  consumeSseEventBlocks,
  extractOpenAiStreamErrorMessage,
  extractOpenAiStreamTextDelta,
  extractSseEventType
} from "./openAiStream.js";

describe("extractOpenAiStreamTextDelta", () => {
  it("reads plain string deltas", () => {
    expect(extractOpenAiStreamTextDelta({
      choices: [{ delta: { content: "hello" } }]
    })).toBe("hello");
  });

  it("reads text parts from array-based multimodal deltas", () => {
    expect(extractOpenAiStreamTextDelta({
      choices: [{
        delta: {
          content: [
            { type: "output_text_delta", text: "hello" },
            { type: "output_text_delta", text: " world" }
          ]
        }
      }]
    })).toBe("hello world");
  });

  it("preserves leading spaces in streamed deltas", () => {
    expect(extractOpenAiStreamTextDelta({
      choices: [{ delta: { content: " world" } }]
    })).toBe(" world");
  });

  it("falls back to message content shapes used by some openai-compatible servers", () => {
    expect(extractOpenAiStreamTextDelta({
      choices: [{
        message: {
          content: [{ type: "text", text: "vision reply" }]
        }
      }]
    })).toBe("vision reply");
  });
});

describe("consumeSseEventBlocks", () => {
  it("emits strict SSE events separated by blank lines", () => {
    expect(consumeSseEventBlocks(
      'data: {"type":"delta","delta":"hello"}\n\ndata: {"type":"done"}\n\n'
    )).toEqual({
      events: [
        'data: {"type":"delta","delta":"hello"}',
        'data: {"type":"done"}'
      ],
      rest: ""
    });
  });

  it("emits standalone data lines from tolerant openai-compatible streams", () => {
    expect(consumeSseEventBlocks(
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n' +
      'data: {"choices":[{"delta":{"content":" world"}}]}\n'
    )).toEqual({
      events: [
        'data: {"choices":[{"delta":{"content":"hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}'
      ],
      rest: ""
    });
  });
});

describe("SSE error helpers", () => {
  it("extracts named SSE event types", () => {
    expect(extractSseEventType('event: error\ndata: {"message":"Model reloaded."}\n\n')).toBe("error");
    expect(extractSseEventType('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n')).toBe("message");
  });

  it("extracts error messages from openai-compatible stream payloads", () => {
    expect(extractOpenAiStreamErrorMessage({
      error: {
        message: "The model has crashed."
      }
    })).toBe("The model has crashed.");
    expect(extractOpenAiStreamErrorMessage({
      message: "Model reloaded."
    })).toBe("Model reloaded.");
  });
});
