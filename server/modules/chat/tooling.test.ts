import { afterEach, describe, expect, it, vi } from "vitest";
import * as mcpService from "../../services/mcp.js";
import {
  appendMissingToolImageMarkdown,
  extractOpenAiStreamToolCallDeltas,
  extractTextToolCalls,
  runToolCallingCompletion,
  type ToolCallTrace
} from "./tooling.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("appendMissingToolImageMarkdown", () => {
  it("appends exact markdown images from tool results when the assistant rewrites them as plain links", () => {
    const toolTraces: ToolCallTrace[] = [{
      callId: "tool-1",
      name: "mcp_comfyui__generate_image",
      args: "{\"prompt\":\"test\"}",
      result: [
        "Return the following Markdown image link(s) to the user exactly as written:",
        "![generated image 1](http://127.0.0.1:8188/view?filename=test.png&type=output)"
      ].join("\n")
    }];

    const augmented = appendMissingToolImageMarkdown(
      "See [generated image 1](http://127.0.0.1:8188/view?filename=test.png&type=output)",
      toolTraces
    );

    expect(augmented.content).toContain("See [generated image 1]");
    expect(augmented.content).toContain("![generated image 1](http://127.0.0.1:8188/view?filename=test.png&type=output)");
    expect(augmented.appended).toBe("\n\n![generated image 1](http://127.0.0.1:8188/view?filename=test.png&type=output)");
  });

  it("does not duplicate markdown images already present in the assistant answer", () => {
    const toolTraces: ToolCallTrace[] = [{
      callId: "tool-1",
      name: "mcp_comfyui__generate_image",
      args: "{\"prompt\":\"test\"}",
      result: "![generated image 1](http://127.0.0.1:8188/view?filename=test.png&type=output)"
    }];

    const augmented = appendMissingToolImageMarkdown(
      "![generated image 1](http://127.0.0.1:8188/view?filename=test.png&type=output)",
      toolTraces
    );

    expect(augmented.content).toBe("![generated image 1](http://127.0.0.1:8188/view?filename=test.png&type=output)");
    expect(augmented.appended).toBe("");
  });

  it("extracts markdown images from structured vellium media results", () => {
    const toolTraces: ToolCallTrace[] = [{
      callId: "tool-1",
      name: "mcp_comfyui__generate_image",
      args: "{\"prompt\":\"test\"}",
      result: JSON.stringify({
        kind: "vellium_media_result",
        summary: "Image created and shown to the user.",
        media: [{
          type: "image",
          url: "http://127.0.0.1:8188/view?filename=test.png&type=output",
          markdown: "![generated image 1](http://127.0.0.1:8188/view?filename=test.png&type=output)"
        }]
      })
    }];

    const augmented = appendMissingToolImageMarkdown("Image created and shown to the user.", toolTraces);

    expect(augmented.content).toContain("![generated image 1](http://127.0.0.1:8188/view?filename=test.png&type=output)");
    expect(augmented.appended).toBe("\n\n![generated image 1](http://127.0.0.1:8188/view?filename=test.png&type=output)");
  });
});

describe("extractTextToolCalls", () => {
  const toolName = "mcp_comfyui-prompt-only__generate_image";
  const availableNames = [toolName];

  it("parses tagged tool request blocks", () => {
    const extracted = extractTextToolCalls(
      `[TOOL_REQUEST]\n{"name":"mcp_comfyui_prompt_only_generate_image","arguments":{"prompt":"test"}}\n[END_TOOL_REQUEST]`,
      availableNames
    );

    expect(extracted.toolCalls).toHaveLength(1);
    expect(extracted.toolCalls[0]?.function?.name).toBe(toolName);
    expect(extracted.toolCalls[0]?.function?.arguments).toContain("\"prompt\":\"test\"");
    expect(extracted.visibleContent).toBe("");
  });

  it("parses fenced json tool calls embedded in assistant text", () => {
    const extracted = extractTextToolCalls(
      `I'll generate it now.\n\n\`\`\`json\n{"name":"mcp_comfyui_prompt_only_generate_image","arguments":{"prompt":"anime portrait"}}\n\`\`\``,
      availableNames
    );

    expect(extracted.toolCalls).toHaveLength(1);
    expect(extracted.toolCalls[0]?.function?.name).toBe(toolName);
    expect(extracted.visibleContent).toBe("I'll generate it now.");
  });

  it("parses tool_name({...}) style calls", () => {
    const extracted = extractTextToolCalls(
      `mcp_comfyui_prompt_only_generate_image({"prompt":"cinematic city lights"})`,
      availableNames
    );

    expect(extracted.toolCalls).toHaveLength(1);
    expect(extracted.toolCalls[0]?.function?.name).toBe(toolName);
    expect(extracted.toolCalls[0]?.function?.arguments).toContain("\"prompt\":\"cinematic city lights\"");
    expect(extracted.visibleContent).toBe("");
  });
});

describe("extractOpenAiStreamToolCallDeltas", () => {
  it("extracts streamed tool call chunks from delta.tool_calls", () => {
    expect(extractOpenAiStreamToolCallDeltas({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_1",
            type: "function",
            function: {
              name: "mcp_comfyui-prompt-only__generate_image",
              arguments: "{\"prompt\":\"test\"}"
            }
          }]
        }
      }]
    })).toEqual([{
      index: 0,
      id: "call_1",
      type: "function",
      function: {
        name: "mcp_comfyui-prompt-only__generate_image",
        arguments: "{\"prompt\":\"test\"}"
      }
    }]);
  });

  it("supports legacy streamed function_call deltas", () => {
    expect(extractOpenAiStreamToolCallDeltas({
      choices: [{
        delta: {
          function_call: {
            name: "legacy_tool",
            arguments: "{\"query\":\"x\"}"
          }
        }
      }]
    })).toEqual([{
      index: 0,
      type: "function",
      function: {
        name: "legacy_tool",
        arguments: "{\"query\":\"x\"}"
      }
    }]);
  });
});

describe("runToolCallingCompletion", () => {
  it("streams the final assistant answer after a tool call instead of buffering it", async () => {
    vi.spyOn(mcpService, "prepareMcpTools").mockResolvedValue({
      tools: [{
        type: "function",
        function: {
          name: "mcp_mockserver__lookup",
          description: "Lookup mock context",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" }
            }
          }
        }
      }],
      executeToolCall: async () => ({
        modelText: "mock tool context",
        traceText: "mock tool context"
      }),
      close: async () => {}
    });

    const encoder = new TextEncoder();
    const makeSseResponse = (events: string[]) => new Response(
      new ReadableStream({
        start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(event));
          }
          controller.close();
        }
      }),
      {
        headers: {
          "Content-Type": "text/event-stream"
        }
      }
    );

    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as {
        messages?: Array<{ role?: string }>;
        stream?: boolean;
      };
      const toolMessages = (body.messages || []).filter((item) => item.role === "tool");
      if (toolMessages.length > 0) {
        return makeSseResponse([
          `data: ${JSON.stringify({ choices: [{ delta: { content: "FINAL " } }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: "TOOL ANSWER" } }] })}\n\n`,
          "data: [DONE]\n\n"
        ]);
      }
      expect(body.stream).not.toBe(true);
      return Response.json({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "tool-call-1",
              type: "function",
              function: {
                name: "mcp_mockserver__lookup",
                arguments: "{\"query\":\"latest context\"}"
              }
            }]
          }
        }]
      });
    }) as typeof fetch;

    const streamedAssistantDeltas: string[] = [];
    const result = await runToolCallingCompletion({
      provider: {
        id: "provider",
        base_url: "http://mock.local/v1",
        api_key_cipher: "test-key",
        provider_type: "openai"
      } as never,
      modelId: "test-model",
      samplerConfig: {},
      apiMessages: [{
        role: "user",
        content: "Use the tool and answer after it."
      }],
      settings: {
        mcpServers: [{
          id: "mockserver",
          name: "Mock Server",
          command: "node",
          enabled: true
        }],
        toolCallingPolicy: "balanced"
      },
      signal: new AbortController().signal,
      onAssistantDelta: (delta) => {
        streamedAssistantDeltas.push(delta);
      }
    });

    expect(result).toMatchObject({
      content: "FINAL TOOL ANSWER",
      assistantWasStreamed: true
    });
    expect(result?.streamMessages).toBeUndefined();
    expect(streamedAssistantDeltas).toEqual(["FINAL ", "TOOL ANSWER"]);
  });

  it("falls back to a non-stream final assistant answer after tool use when streaming is unsupported", async () => {
    vi.spyOn(mcpService, "prepareMcpTools").mockResolvedValue({
      tools: [{
        type: "function",
        function: {
          name: "mcp_mockserver__lookup",
          description: "Lookup mock context",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" }
            }
          }
        }
      }],
      executeToolCall: async () => ({
        modelText: "mock tool context",
        traceText: "mock tool context"
      }),
      close: async () => {}
    });

    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as {
        messages?: Array<{ role?: string }>;
        stream?: boolean;
      };
      const toolMessages = (body.messages || []).filter((item) => item.role === "tool");
      if (toolMessages.length === 0) {
        return Response.json({
          choices: [{
            message: {
              content: "",
              tool_calls: [{
                id: "tool-call-1",
                type: "function",
                function: {
                  name: "mcp_mockserver__lookup",
                  arguments: "{\"query\":\"latest context\"}"
                }
              }]
            }
          }]
        });
      }

      if (body.stream === true) {
        return Response.json({
          choices: [{ message: { content: "FINAL TOOL ANSWER" } }]
        });
      }

      return Response.json({
        choices: [{ message: { content: "FINAL TOOL ANSWER" } }]
      });
    }) as typeof fetch;

    const streamedAssistantDeltas: string[] = [];
    const result = await runToolCallingCompletion({
      provider: {
        id: "provider",
        base_url: "http://mock.local/v1",
        api_key_cipher: "test-key",
        provider_type: "openai"
      } as never,
      modelId: "test-model",
      samplerConfig: {},
      apiMessages: [{
        role: "user",
        content: "Use the tool and answer after it."
      }],
      settings: {
        mcpServers: [{
          id: "mockserver",
          name: "Mock Server",
          command: "node",
          enabled: true
        }],
        toolCallingPolicy: "balanced"
      },
      signal: new AbortController().signal,
      onAssistantDelta: (delta) => {
        streamedAssistantDeltas.push(delta);
      }
    });

    expect(result).toMatchObject({
      content: "FINAL TOOL ANSWER",
      assistantWasStreamed: false
    });
    expect(streamedAssistantDeltas).toEqual([]);
  });

  it("surfaces upstream SSE error events instead of returning an empty answer", async () => {
    vi.spyOn(mcpService, "prepareMcpTools").mockResolvedValue({
      tools: [{
        type: "function",
        function: {
          name: "mcp_mockserver__lookup",
          description: "Lookup mock context",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" }
            }
          }
        }
      }],
      executeToolCall: async () => ({
        modelText: "mock tool context",
        traceText: "mock tool context"
      }),
      close: async () => {}
    });

    const encoder = new TextEncoder();
    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as {
        messages?: Array<{ role?: string }>;
        stream?: boolean;
      };
      const toolMessages = (body.messages || []).filter((item) => item.role === "tool");
      if (body.stream === true) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('event: error\ndata: {"message":"Model reloaded."}\n\n'));
              controller.close();
            }
          }),
          {
            headers: {
              "Content-Type": "text/event-stream"
            }
          }
        );
      }
      if (toolMessages.length === 0) {
        return Response.json({
          choices: [{
            message: {
              content: "",
              tool_calls: [{
                id: "tool-call-1",
                type: "function",
                function: {
                  name: "mcp_mockserver__lookup",
                  arguments: "{\"query\":\"latest context\"}"
                }
              }]
            }
          }]
        });
      }
      return Response.json({
        choices: [{ message: { content: "unexpected non-stream fallback" } }]
      });
    }) as typeof fetch;

    await expect(runToolCallingCompletion({
      provider: {
        id: "provider",
        base_url: "http://mock.local/v1",
        api_key_cipher: "test-key",
        provider_type: "openai"
      } as never,
      modelId: "test-model",
      samplerConfig: {},
      apiMessages: [{
        role: "user",
        content: "Try the tool."
      }],
      settings: {
        mcpServers: [{
          id: "mockserver",
          name: "Mock Server",
          command: "node",
          enabled: true
        }],
        toolCallingPolicy: "balanced"
      },
      signal: new AbortController().signal
    })).rejects.toThrow("Model reloaded.");
  });
});
