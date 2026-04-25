import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { createServer, type Server as HttpServer } from "http";
import { tmpdir } from "os";
import { join } from "path";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

interface JsonRequestInit extends Omit<RequestInit, "body"> {
  body?: unknown;
}

describe.sequential("createApp integration", () => {
  let dataDir = "";
  let baseUrl = "";
  let appServer: HttpServer;
  let mockProviderServer: HttpServer;
  let mockProviderBaseUrl = "";
  let mockMcpScriptPath = "";
  let lastCompactionPromptText = "";
  let lastAgentPromptStackText = "";
  let lastBuildDirectToolChoice = "";
  let lastPlannerResponseFormat: unknown = null;
  let createApp: typeof import("./createApp.js").createApp;
  let db: typeof import("../db.js").db;
  let newId: typeof import("../db.js").newId;

  function collectSseDeltas(body: string) {
    return String(body || "")
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((payload) => payload && payload !== "[DONE]")
      .map((payload) => {
        try {
          return JSON.parse(payload) as { type?: string; delta?: unknown };
        } catch {
          return null;
        }
      })
      .filter((payload): payload is { type?: string; delta?: unknown } => Boolean(payload))
      .filter((payload) => payload.type === "delta")
      .map((payload) => String(payload.delta || ""))
      .join("");
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "slv-integration-"));
    process.env.SLV_DATA_DIR = dataDir;
    process.env.ELECTRON_SERVE_STATIC = "0";
    vi.resetModules();

    const appModule = await import("./createApp.js");
    const dbModule = await import("../db.js");
    createApp = appModule.createApp;
    db = dbModule.db;
    newId = dbModule.newId;
    mockMcpScriptPath = join(dataDir, "mock-mcp-server.cjs");
    writeFileSync(mockMcpScriptPath, `
const { existsSync, writeFileSync } = require("fs");
const HEADER_DELIMITER = Buffer.from("\\r\\n\\r\\n");
const retryMarkerPath = ${JSON.stringify(join(dataDir, "mock-mcp-retry.marker"))};
let buffer = Buffer.alloc(0);

function sendFrame(payload) {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  process.stdout.write(Buffer.concat([
    Buffer.from(\`Content-Length: \${json.length}\\r\\n\\r\\n\`, "utf8"),
    json
  ]));
}

function handleMessage(message) {
  if (!message || typeof message !== "object") return;
  if (typeof message.id !== "number") return;
  if (message.method === "initialize") {
    sendFrame({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        serverInfo: { name: "mock-mcp", version: "1.0.0" }
      }
    });
    return;
  }
  if (message.method === "tools/list") {
    sendFrame({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [{
          name: "lookup",
          description: "Return mocked context for integration tests.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" }
            },
            required: ["query"],
            additionalProperties: false
          }
        }]
      }
    });
    return;
  }
  if (message.method === "tools/call") {
    const args = message.params && typeof message.params === "object" ? message.params.arguments : {};
    const query = args && typeof args === "object" && typeof args.query === "string" ? args.query : "";
    if (query === "retry context" && !existsSync(retryMarkerPath)) {
      writeFileSync(retryMarkerPath, "1");
      process.exit(1);
      return;
    }
    sendFrame({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{
          type: "text",
          text: \`Tool result for: \${query}\`
        }]
      }
    });
    return;
  }
  sendFrame({
    jsonrpc: "2.0",
    id: message.id,
    result: {}
  });
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf(HEADER_DELIMITER);
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = /content-length:\\s*(\\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.slice(headerEnd + HEADER_DELIMITER.length);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + HEADER_DELIMITER.length;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const raw = buffer.slice(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.slice(bodyEnd);
    try {
      handleMessage(JSON.parse(raw));
    } catch {
      // Ignore malformed frames from tests.
    }
  }
});
`);

    appServer = await listen(createApp());
    baseUrl = toBaseUrl(appServer);

    mockProviderServer = await listen(createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/v1/models") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
          data: [
            { id: "mock-model" },
            { id: "mock-secondary-model" }
          ]
        }));
        return;
      }
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        const body = await readJsonBody(req);
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const toolMessages = messages.filter((message) => {
          if (!message || typeof message !== "object") return false;
          return (message as { role?: unknown }).role === "tool";
        });
        const toolDefinitions = Array.isArray(body.tools) ? body.tools : [];
        const promptText = messages
          .map((message) => {
            if (!message || typeof message !== "object") return "";
            return typeof (message as { content?: unknown }).content === "string"
              ? String((message as { content?: unknown }).content)
              : "";
          })
          .join("\n\n");

        if (promptText.includes("compact-history-agent-task")) {
          lastCompactionPromptText = promptText;
        }
        if (promptText.includes("prompt-stack-agent-task")) {
          lastAgentPromptStackText = promptText;
        }
        if (promptText.includes("Decide the next best action for this agent thread")) {
          lastPlannerResponseFormat = body.response_format ?? null;
        }
        if (promptText.includes("Classify the latest user message in an autonomous agent thread.")) {
          const latestMessage = promptText.match(/Latest user message:\n([\s\S]*)$/)?.[1]?.trim() || "";
          const startsFreshTask = latestMessage.includes("новый") || latestMessage.includes("new ");
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  intent: startsFreshTask ? "new_task" : "continuation",
                  confidence: 0.86,
                  reason: startsFreshTask
                    ? "The latest message introduces a fresh goal."
                    : "The latest message depends on the previous agent task context."
                })
              }
            }]
          }));
          return;
        }

        if (toolDefinitions.length > 0 && body.stream !== true && toolMessages.length === 0) {
          if (promptText.includes("chain-workspace-agent-task")) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const listTool = toolNames.find((name) => name === "workspace_list_files") || toolNames[0] || "";
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{
                message: {
                  content: "",
                  tool_calls: [{
                    id: "tool-call-1",
                    type: "function",
                    function: {
                      name: listTool,
                      arguments: JSON.stringify({ path: ".", depth: 1, limit: 20 })
                    }
                  }]
                }
              }]
            }));
            return;
          }
          if (promptText.includes("workspace-root-agent-task")) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const searchTool = toolNames.find((name) => name === "workspace_search_text") || toolNames[0] || "";
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{
                message: {
                  content: "",
                  tool_calls: [{
                    id: "tool-call-root-1",
                    type: "function",
                    function: {
                      name: searchTool,
                      arguments: JSON.stringify({ query: "agentsEnabled", path: "db", limit: 5 })
                    }
                  }]
                }
              }]
            }));
            return;
          }
          if (promptText.includes("workspace-tool-agent-task")) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const searchTool = toolNames.find((name) => name === "workspace_search_text") || toolNames[0] || "";
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{
                message: {
                  content: "",
                  tool_calls: [{
                    id: "tool-call-workspace-1",
                    type: "function",
                    function: {
                      name: searchTool,
                      arguments: JSON.stringify({
                        query: "agentsEnabled",
                        path: "server/db",
                        limit: 5
                      })
                    }
                  }]
                }
              }]
            }));
            return;
          }
          if (promptText.includes("command-tool-agent-task")) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const commandTool = toolNames.find((name) => name === "workspace_run_command") || toolNames[0] || "";
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{
                message: {
                  content: "",
                  tool_calls: [{
                    id: "tool-call-command-1",
                    type: "function",
                    function: {
                      name: commandTool,
                      arguments: JSON.stringify({
                        command: "node",
                        args: [
                          "-p",
                          "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).name"
                        ],
                        cwd: ".",
                        timeoutMs: 10000
                      })
                    }
                  }]
                }
              }]
            }));
            return;
          }
          if (promptText.includes("dangerous-command-agent-task")) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const commandTool = toolNames.find((name) => name === "workspace_run_command") || toolNames[0] || "";
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{
                message: {
                  content: "",
                  tool_calls: [{
                    id: "tool-call-dangerous-command-1",
                    type: "function",
                    function: {
                      name: commandTool,
                      arguments: JSON.stringify({
                        command: "mkdir",
                        args: ["danger-dir"],
                        cwd: ".",
                        timeoutMs: 4000
                      })
                    }
                  }]
                }
              }]
            }));
            return;
          }
          if (promptText.includes("dangerous-delete-agent-task")) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const deleteTool = toolNames.find((name) => name === "workspace_delete_path") || toolNames[0] || "";
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{
                message: {
                  content: "",
                  tool_calls: [{
                    id: "tool-call-dangerous-delete-1",
                    type: "function",
                    function: {
                      name: deleteTool,
                      arguments: JSON.stringify({
                        path: "trash.txt"
                      })
                    }
                  }]
                }
              }]
            }));
            return;
          }
          if (promptText.includes("edit-tools-agent-task")) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const multiEditTool = toolNames.find((name) => name === "workspace_multi_edit") || toolNames[0] || "";
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{
                message: {
                  content: "",
                  tool_calls: [{
                    id: "tool-call-edit-1",
                    type: "function",
                    function: {
                      name: multiEditTool,
                      arguments: JSON.stringify({
                        path: "note.md",
                        edits: [
                          { search: "Old headline", replace: "New headline" },
                          { search: "Needs polish.", replace: "Sharper copy added." }
                        ]
                      })
                    }
                  }]
                }
              }]
            }));
            return;
          }
          if (promptText.includes("steer-agent-task")) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const commandTool = toolNames.find((name) => name === "workspace_run_command") || toolNames[0] || "";
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{
                message: {
                  content: "",
                  tool_calls: [{
                    id: "tool-call-steer-1",
                    type: "function",
                    function: {
                      name: commandTool,
                      arguments: JSON.stringify({
                        command: "node",
                        args: ["-e", "setTimeout(() => { console.log('scan done'); }, 180)"],
                        cwd: ".",
                        timeoutMs: 4000
                      })
                    }
                  }]
                }
              }]
            }));
            return;
          }
          if (promptText.includes("no-tool-first-pass")) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{ message: { content: "TOOLS WERE VISIBLE ON FIRST PASS" } }]
            }));
            return;
          }
          if (promptText.includes("tagged-tool-request")) {
            const toolName = String((toolDefinitions[0] as {
              function?: { name?: unknown };
            })?.function?.name || "").replace(/[^a-zA-Z0-9]+/g, "_");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{
                message: {
                  content: `[TOOL_REQUEST]\n${JSON.stringify({
                    name: toolName,
                    arguments: { query: "latest context" }
                  })}\n[END_TOOL_REQUEST]`
                }
              }]
            }));
            return;
          }
          if (promptText.includes("fenced-tool-request")) {
            const toolName = String((toolDefinitions[0] as {
              function?: { name?: unknown };
            })?.function?.name || "").replace(/[^a-zA-Z0-9]+/g, "_");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{
                message: {
                  content: `I'll handle that visually.\n\n\`\`\`json\n${JSON.stringify({
                    name: toolName,
                    arguments: { query: "latest context" }
                  })}\n\`\`\``
                }
              }]
            }));
            return;
          }
          const toolName = String((toolDefinitions[0] as {
            function?: { name?: unknown };
          })?.function?.name || "");
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            choices: [{
              message: {
                content: "",
                tool_calls: [{
                  id: "tool-call-1",
                  type: "function",
                  function: {
                    name: toolName,
                    arguments: JSON.stringify({ query: "latest context" })
                  }
                }]
              }
            }]
          }));
          return;
        }

        if (toolDefinitions.length > 0 && body.stream !== true && toolMessages.length > 0) {
          if (promptText.includes("chain-workspace-agent-task")) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const searchTool = toolNames.find((name) => name === "workspace_search_text") || toolNames[0] || "";
            if (toolMessages.length === 1) {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({
                choices: [{
                  message: {
                    content: "",
                    tool_calls: [{
                      id: "tool-call-2",
                      type: "function",
                      function: {
                        name: searchTool,
                        arguments: JSON.stringify({ query: "agentsEnabled", path: "server/db", limit: 5 })
                      }
                    }]
                  }
                }]
              }));
              return;
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{ message: { content: "I inspected the workspace in two passes and verified where the agentsEnabled setting lives." } }]
            }));
            return;
          }
          if (promptText.includes("workspace-root-agent-task")) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{ message: { content: "I searched inside the selected workspace root and found the agentsEnabled setting there." } }]
            }));
            return;
          }
          if (promptText.includes("workspace-tool-agent-task")) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{ message: { content: "I checked the workspace directly and found the setting in the codebase." } }]
            }));
            return;
          }
          if (promptText.includes("command-tool-agent-task")) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{ message: { content: "I ran a workspace command and confirmed the project identity from package.json." } }]
            }));
            return;
          }
          if (promptText.includes("dangerous-command-agent-task")) {
            const blocked = promptText.includes("blocked by agent security policy") || promptText.includes("explicitly enabled for Agents");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{
                message: {
                  content: blocked
                    ? "The dangerous workspace command was blocked by policy."
                    : "The dangerous workspace command ran after the policy was enabled."
                }
              }]
            }));
            return;
          }
          if (promptText.includes("dangerous-delete-agent-task")) {
            const blocked = promptText.includes("blocked by agent security policy") || promptText.includes("explicitly enabled for Agents");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{
                message: {
                  content: blocked
                    ? "The delete request was blocked by policy."
                    : "The delete request ran after the policy was enabled."
                }
              }]
            }));
            return;
          }
          if (promptText.includes("edit-tools-agent-task") && toolMessages.length > 1) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{ message: { content: "I updated the file with grouped edits and an inserted summary line." } }]
            }));
            return;
          }
          if (promptText.includes("steer-agent-task")) {
            const corrected = promptText.includes("Use tighter copy and mention the corrected direction.");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              choices: [{
                message: {
                  content: corrected
                    ? "I applied the correction and continued in the updated direction."
                    : "I continued without any mid-run correction."
                }
              }]
            }));
            return;
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            choices: [{ message: { content: "Tool context prepared." } }]
          }));
          return;
        }

        if (body.stream === true) {
          if (promptText.includes("Abort this stream before output")) {
            await sleep(250);
            if (res.destroyed || res.writableEnded) {
              return;
            }
          }
          if (promptText.includes("partial-error-agent-task")) {
            res.setHeader("Content-Type", "text/event-stream");
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Partial answer that should survive." } }] })}\n\n`);
            res.write(`event: error\ndata: ${JSON.stringify({ message: "Model failed after partial output." })}\n\n`);
            res.end();
            return;
          }
          if (promptText.includes("compact-history-agent-task")) {
            res.setHeader("Content-Type", "text/event-stream");
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "History compacted cleanly." } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("simple-capability-agent-task")) {
            res.setHeader("Content-Type", "text/event-stream");
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "I can answer questions, inspect the workspace when tools are enabled, run bounded task flows, and help with implementation, review, and research." } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("build-no-tool-stream-task")) {
            res.setHeader("Content-Type", "text/event-stream");
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "No-tool " } }] })}\n\n`);
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "agent " } }] })}\n\n`);
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "stream works." } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          res.setHeader("Content-Type", "text/event-stream");
          const streamToolCall = (id: string, name: string, args: Record<string, unknown>) => {
            res.write(`data: ${JSON.stringify({
              choices: [{
                delta: {
                  tool_calls: [{
                    index: 0,
                    id,
                    type: "function",
                    function: {
                      name,
                      arguments: JSON.stringify(args)
                    }
                  }]
                }
              }]
            })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
          };
          if (promptText.includes("no-tool-first-pass")) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "TOOLS WERE VISIBLE ON FIRST PASS" } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("tagged-tool-request") && toolMessages.length === 0) {
            const toolName = String((toolDefinitions[0] as {
              function?: { name?: unknown };
            })?.function?.name || "").replace(/[^a-zA-Z0-9]+/g, "_");
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `[TOOL_REQUEST]\n${JSON.stringify({
              name: toolName,
              arguments: { query: "latest context" }
            })}\n[END_TOOL_REQUEST]` } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("fenced-tool-request") && toolMessages.length === 0) {
            const toolName = String((toolDefinitions[0] as {
              function?: { name?: unknown };
            })?.function?.name || "").replace(/[^a-zA-Z0-9]+/g, "_");
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `I'll handle that visually.\n\n\`\`\`json\n${JSON.stringify({
              name: toolName,
              arguments: { query: "latest context" }
            })}\n\`\`\`` } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("chain-workspace-agent-task") && toolMessages.length === 0) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const listTool = toolNames.find((name) => name === "workspace_list_files") || toolNames[0] || "";
            streamToolCall("tool-call-1", listTool, { path: ".", depth: 1, limit: 20 });
            return;
          }
          if (promptText.includes("workspace-root-agent-task") && toolMessages.length === 0) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const searchTool = toolNames.find((name) => name === "workspace_search_text") || toolNames[0] || "";
            streamToolCall("tool-call-root-1", searchTool, { query: "agentsEnabled", path: "db", limit: 5 });
            return;
          }
          if (promptText.includes("workspace-tool-agent-task") && toolMessages.length === 0) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const searchTool = toolNames.find((name) => name === "workspace_search_text") || toolNames[0] || "";
            streamToolCall("tool-call-workspace-1", searchTool, { query: "agentsEnabled", path: "server/db", limit: 5 });
            return;
          }
          if (promptText.includes("command-tool-agent-task") && toolMessages.length === 0) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const commandTool = toolNames.find((name) => name === "workspace_run_command") || toolNames[0] || "";
            streamToolCall("tool-call-command-1", commandTool, {
              command: "node",
              args: ["-p", "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).name"],
              cwd: ".",
              timeoutMs: 10000
            });
            return;
          }
          if (promptText.includes("dangerous-command-agent-task") && toolMessages.length === 0) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const commandTool = toolNames.find((name) => name === "workspace_run_command") || toolNames[0] || "";
            streamToolCall("tool-call-dangerous-command-1", commandTool, {
              command: "mkdir",
              args: ["danger-dir"],
              cwd: ".",
              timeoutMs: 4000
            });
            return;
          }
          if (promptText.includes("dangerous-delete-agent-task") && toolMessages.length === 0) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const deleteTool = toolNames.find((name) => name === "workspace_delete_path") || toolNames[0] || "";
            streamToolCall("tool-call-dangerous-delete-1", deleteTool, { path: "trash.txt" });
            return;
          }
          if (promptText.includes("edit-tools-agent-task") && toolMessages.length === 0) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const multiEditTool = toolNames.find((name) => name === "workspace_multi_edit") || toolNames[0] || "";
            streamToolCall("tool-call-edit-1", multiEditTool, {
              path: "note.md",
              edits: [
                { search: "Old headline", replace: "New headline" },
                { search: "Needs polish.", replace: "Sharper copy added." }
              ]
            });
            return;
          }
          if (promptText.includes("steer-agent-task") && toolMessages.length === 0) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const commandTool = toolNames.find((name) => name === "workspace_run_command") || toolNames[0] || "";
            streamToolCall("tool-call-steer-1", commandTool, {
              command: "node",
              args: ["-e", "setTimeout(() => { console.log('scan done'); }, 180)"],
              cwd: ".",
              timeoutMs: 4000
            });
            return;
          }
          if (promptText.includes("build-direct-tool-agent-task") && toolMessages.length === 0) {
            lastBuildDirectToolChoice = String(body.tool_choice || "");
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const writeTool = toolNames.find((name) => name === "workspace_write_file") || toolNames[0] || "";
            streamToolCall("tool-call-build-direct-1", writeTool, {
              path: "src/App.tsx",
              mode: "overwrite",
              content: "export default function App() { return <main>Built</main>; }\n"
            });
            return;
          }
          if (promptText.includes("chain-workspace-agent-task") && toolMessages.length === 1) {
            res.write(`data: ${JSON.stringify({
              choices: [{
                delta: {
                  tool_calls: [{
                    index: 0,
                    id: "tool-call-2",
                    type: "function",
                    function: {
                      name: "workspace_search_text",
                      arguments: JSON.stringify({ query: "agentsEnabled", path: "server/db", limit: 5 })
                    }
                  }]
                }
              }]
            })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("chain-workspace-agent-task") && toolMessages.length > 1) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "I inspected the workspace in two passes and verified where the agentsEnabled setting lives." } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("workspace-root-agent-task") && toolMessages.length > 0) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "I searched inside the selected workspace root and found the agentsEnabled setting there." } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("workspace-tool-agent-task") && toolMessages.length > 0) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "I checked the workspace directly and found the setting in the codebase." } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("command-tool-agent-task") && toolMessages.length > 0) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "I ran a workspace command and confirmed the project identity from package.json." } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("dangerous-command-agent-task") && toolMessages.length > 0) {
            const blocked = promptText.includes("blocked by agent security policy") || promptText.includes("explicitly enabled for Agents");
            res.write(`data: ${JSON.stringify({
              choices: [{
                delta: {
                  content: blocked
                    ? "The dangerous workspace command was blocked by policy."
                    : "The dangerous workspace command ran after the policy was enabled."
                }
              }]
            })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("dangerous-delete-agent-task") && toolMessages.length > 0) {
            const blocked = promptText.includes("blocked by agent security policy") || promptText.includes("explicitly enabled for Agents");
            res.write(`data: ${JSON.stringify({
              choices: [{
                delta: {
                  content: blocked
                    ? "The delete request was blocked by policy."
                    : "The delete request ran after the policy was enabled."
                }
              }]
            })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("edit-tools-agent-task") && toolMessages.length === 1) {
            res.write(`data: ${JSON.stringify({
              choices: [{
                delta: {
                  tool_calls: [{
                    index: 0,
                    id: "tool-call-edit-2",
                    type: "function",
                    function: {
                      name: "workspace_insert_text",
                      arguments: JSON.stringify({
                        path: "note.md",
                        after: "# Landing Draft\n",
                        text: "Summary line inserted by the agent.\n"
                      })
                    }
                  }]
                }
              }]
            })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("read-stall-agent-task")) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            if (promptText.includes("Updated index.html")) {
              res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "I updated index.html instead of continuing to read the same file." } }] })}\n\n`);
              res.write("data: [DONE]\n\n");
              res.end();
              return;
            }
            if (promptText.includes("Runtime anti-stall note")) {
              const replaceTool = toolNames.find((name) => name === "workspace_replace_text") || toolNames[0] || "";
              streamToolCall("tool-call-read-stall-edit", replaceTool, {
                path: "index.html",
                search: "Old heading",
                replace: "New heading"
              });
              return;
            }
            const readTool = toolNames.find((name) => name === "workspace_read_file") || toolNames[0] || "";
            streamToolCall("tool-call-read-stall-read", readTool, { path: "index.html", startLine: 1, endLine: 80 });
            return;
          }
          if (promptText.includes("edit-tools-agent-task") && toolMessages.length > 1) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "I updated the file with grouped edits and an inserted summary line." } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("steer-agent-task") && toolMessages.length > 0) {
            const corrected = promptText.includes("Use tighter copy and mention the corrected direction.");
            res.write(`data: ${JSON.stringify({
              choices: [{
                delta: {
                  content: corrected
                    ? "I applied the correction and continued in the updated direction."
                    : "I continued without any mid-run correction."
                }
              }]
            })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("build-direct-tool-agent-task") && toolMessages.length > 0) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "I created the project files through the direct tool loop." } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("continuation-cue-agent-task")
            && promptText.includes("The latest user message is a continuation cue")
            && toolMessages.length === 0) {
            const toolNames = toolDefinitions
              .map((tool) => String((tool as { function?: { name?: unknown } })?.function?.name || ""))
              .filter(Boolean);
            const listTool = toolNames.find((name) => name === "workspace_list_files") || toolNames[0] || "";
            streamToolCall("tool-call-continuation-cue-1", listTool, { path: ".", depth: 1, limit: 6 });
            return;
          }
          if (promptText.includes("continuation-cue-agent-task")
            && promptText.includes("The latest user message is a continuation cue")
            && toolMessages.length > 0) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "I continued the original task instead of treating the continuation cue as a brand-new request." } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (promptText.includes("Write the final user-facing assistant reply for this Vellium agent thread.")) {
            const streamedSynthesis = promptText.includes("repair-loop-agent-task")
              ? "I updated the requested files and stopped the malformed planner loop instead of spinning."
              : promptText.includes("Tool result for: latest context")
                ? "FINAL AGENT TOOL ANSWER"
                : "FINAL AGENT ANSWER";
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: streamedSynthesis } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (toolMessages.length > 0) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "FINAL TOOL ANSWER" } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (toolDefinitions.length > 0 && toolMessages.length === 0) {
            const toolName = String((toolDefinitions[0] as {
              function?: { name?: unknown };
            })?.function?.name || "");
            streamToolCall("tool-call-1", toolName, { query: "latest context" });
            return;
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "MOCK " } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "STREAM RESPONSE" } }] })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
          }

          const content = promptText.includes("Write the final user-facing assistant reply for this Vellium agent thread.")
          ? (promptText.includes("repair-loop-agent-task")
            ? "I updated the requested files and stopped the malformed planner loop instead of spinning."
            : promptText.includes("Tool result for: latest context")
              ? "FINAL AGENT TOOL ANSWER"
              : "FINAL AGENT ANSWER")
          : promptText.includes("Update the durable memory for this Vellium agent thread.")
            ? (promptText.includes("Tool result for: latest context")
              ? "Keep latest context findings, note that tool-backed verification was already completed, and continue from the validated result."
              : "Keep the current user goal, active constraints, and the latest completed result ready for follow-up runs.")
          : promptText.includes("You are the Vellium Agent runtime.")
            ? (() => {
              if (promptText.includes("slow-agent-run")) {
                if (promptText.includes("Resume the previous run")) {
                  return JSON.stringify({
                    summary: "Resumed from the prior aborted run",
                    assistantMessage: "I resumed the previous run and completed the task.",
                    status: "done",
                    skillIds: [],
                    toolCalls: [],
                    subagents: [],
                    updates: ["Resume context applied"]
                  });
                }
                return JSON.stringify({
                  summary: "Still working",
                  assistantMessage: "Long-running agent response",
                  status: "done",
                  skillIds: [],
                  toolCalls: [],
                  subagents: [],
                  updates: ["Running slowly for concurrency test"]
                });
              }
              if (promptText.includes("retry-agent-run")) {
                if (promptText.includes("Retry the previous run")) {
                  return JSON.stringify({
                    summary: "Retry completed with a stronger plan",
                    assistantMessage: "Second attempt answer after retry.",
                    status: "done",
                    skillIds: [],
                    toolCalls: [],
                    subagents: [],
                    updates: ["Retry context applied"]
                  });
                }
                return JSON.stringify({
                  summary: "Initial attempt completed",
                  assistantMessage: "First attempt answer.",
                  status: "done",
                  skillIds: [],
                  toolCalls: [],
                  subagents: [],
                  updates: ["Initial attempt completed"]
                });
              }
              if (promptText.includes("malformed-json-agent-task")) {
                return "{\"summary\":\"Recovered malformed planner output\",\"assistantMessage\":\"Recovered malformed planner output with markdown:\\n\\n- first point\\n- second point\",\"status\":\"done\"";
              }
              if (promptText.includes("simple-capability-agent-task")) {
                return JSON.stringify({
                  summary: "Capability question answered",
                  assistantMessage: "I can answer questions, inspect the workspace when tools are enabled, run bounded task flows, and help with implementation, review, and research.",
                  status: "done",
                  skillIds: [],
                  toolCalls: [],
                  subagents: [],
                  updates: []
                });
              }
              if (promptText.includes("build-no-tool-stream-task")) {
                return JSON.stringify({
                  summary: "Build no-tool answer",
                  assistantMessage: "No-tool agent stream works with multiple chunks even when no workspace tool is needed for the final answer.",
                  status: "done",
                  skillIds: [],
                  toolCalls: [],
                  subagents: [],
                  updates: []
                });
              }
              if (promptText.includes("prompt-stack-agent-task")) {
                return JSON.stringify({
                  summary: "Prompt stack processed",
                  assistantMessage: "Prompt stack was processed.",
                  status: "done",
                  skillIds: [],
                  toolCalls: [],
                  subagents: [],
                  updates: []
                });
              }
              if (promptText.includes("premature-stop-agent-task")) {
                if (promptText.includes("Workspace directory: .")) {
                  return JSON.stringify({
                    summary: "Workspace inspected after progress note",
                    assistantMessage: "I inspected the workspace and continued the run instead of stopping after the intermediate note.",
                    status: "done",
                    skillIds: [],
                    toolCalls: [],
                    subagents: [],
                    updates: ["Inspection completed after continuation recovery"]
                  });
                }
                if (promptText.includes("Runtime note: previous assistant draft looked like an intermediate progress update")) {
                  const listToolMatch = promptText.match(/- (workspace_list_files):/i);
                  return JSON.stringify({
                    summary: "Need actual inspection after the progress note",
                    assistantMessage: "",
                    status: "continue",
                    skillIds: [],
                    toolCalls: [{
                      tool: listToolMatch?.[1] || "workspace_list_files",
                      arguments: {
                        path: ".",
                        depth: 1,
                        limit: 6
                      },
                      reason: "Inspect the workspace before making changes."
                    }],
                    subagents: [],
                    updates: ["Turn the progress note into a real inspection step"]
                  });
                }
                return "{\"summary\":\"Planning inspection\",\"assistantMessage\":\"Сначала быстро посмотрю текущие index.html и styles.css, затем внесу конкретные правки для более насыщенного лендинга.\",\"status\":\"done\"";
              }
              if (promptText.includes("repair-loop-agent-task")) {
                if (promptText.includes("Wrote 11 characters to index.html using overwrite mode.") && promptText.includes("Wrote 16 characters to styles.css using overwrite mode.")) {
                  return "{\"summary\":\"Repair loop after edits\",\"assistantMessage\":\"Нужно продолжить: я уже почти закончил и сейчас еще раз проверю результат.\",\"status\":\"continue\"";
                }
                return JSON.stringify({
                  summary: "Create the requested MVP files",
                  assistantMessage: "",
                  status: "continue",
                  skillIds: [],
                  toolCalls: [
                    {
                      tool: "workspace_write_file",
                      arguments: {
                        path: "index.html",
                        mode: "overwrite",
                        content: "hello world"
                      },
                      reason: "Create the initial UI entry file."
                    },
                    {
                      tool: "workspace_write_file",
                      arguments: {
                        path: "styles.css",
                        mode: "overwrite",
                        content: "body{color:#fff}"
                      },
                      reason: "Create the initial stylesheet."
                    }
                  ],
                  subagents: [],
                  updates: ["Write the first version of the requested files"]
                });
              }
              if (promptText.includes("continuation-cue-agent-task")) {
                if (promptText.includes("The latest user message is a continuation cue")) {
                  if (promptText.includes("Workspace directory: .")) {
                    return JSON.stringify({
                      summary: "Continued the prior task from the latest checkpoint",
                      assistantMessage: "I continued the original task instead of treating the continuation cue as a brand-new request.",
                      status: "done",
                      skillIds: [],
                      toolCalls: [],
                      subagents: [],
                      updates: ["Continuation cue was resolved into concrete execution"]
                    });
                  }
                  const listToolMatch = promptText.match(/- (workspace_list_files):/i);
                  return JSON.stringify({
                    summary: "Continue the earlier task from the existing checkpoint",
                    assistantMessage: "",
                    status: "continue",
                    skillIds: [],
                    toolCalls: [{
                      tool: listToolMatch?.[1] || "workspace_list_files",
                      arguments: {
                        path: ".",
                        depth: 1,
                        limit: 6
                      },
                      reason: "Resume from the last checkpoint and inspect the current workspace state before continuing."
                    }],
                    subagents: [],
                    updates: ["Turn the continuation cue into concrete execution"]
                  });
                }
                if (promptText.includes("продолжай")) {
                  return JSON.stringify({
                    summary: "Misread continuation cue",
                    assistantMessage: "Привет! Я ещё не успел реально продолжить работу и пока только могу описать следующий шаг.",
                    status: "done",
                    skillIds: [],
                    toolCalls: [],
                    subagents: [],
                    updates: []
                  });
                }
                return JSON.stringify({
                  summary: "Recorded the initial task checkpoint",
                  assistantMessage: "Initial checkpoint saved for the continuation-cue task.",
                  status: "done",
                  skillIds: [],
                  toolCalls: [],
                  subagents: [],
                  updates: ["Initial task stored"]
                });
              }
              if (promptText.includes("malformed-continue-agent-task")) {
                if (promptText.includes("Workspace directory: .")) {
                  return JSON.stringify({
                    summary: "Workspace inspected after malformed continue recovery",
                    assistantMessage: "I kept going after the malformed continue step, inspected the workspace, and only then finished the run.",
                    status: "done",
                    skillIds: [],
                    toolCalls: [],
                    subagents: [],
                    updates: ["Malformed continue status was recovered and executed"]
                  });
                }
                if (promptText.includes("Continue after malformed continue status")) {
                  const listToolMatch = promptText.match(/- (workspace_list_files):/i);
                  return JSON.stringify({
                    summary: "Inspect workspace after malformed continue recovery",
                    assistantMessage: "",
                    status: "continue",
                    skillIds: [],
                    toolCalls: [{
                      tool: listToolMatch?.[1] || "workspace_list_files",
                      arguments: {
                        path: ".",
                        depth: 1,
                        limit: 6
                      },
                      reason: "Inspect the workspace before creating files."
                    }],
                    subagents: [],
                    updates: ["Recovered the malformed continue step and executed the inspection"]
                  });
                }
                return "{\"summary\":\"Continue after malformed continue status\",\"assistantMessage\":\"Нужно начать выполнение: осмотреть workspace и затем создать UI-only структуру проекта.\",\"status\":\"continue\"";
              }
              if (promptText.includes("planner loop task")) {
                if (promptText.includes("Duplicate workspace_read_file skipped")) {
                  return JSON.stringify({
                    summary: "Stopped duplicate context gathering",
                    assistantMessage: "I reused the first read result instead of reading the same file again.",
                    status: "done",
                    skillIds: [],
                    toolCalls: [],
                    subagents: [],
                    updates: ["Duplicate read was skipped"]
                  });
                }
                const readToolMatch = promptText.match(/- (workspace_read_file):/i);
                return JSON.stringify({
                  summary: "Need to inspect the same file",
                  assistantMessage: "",
                  status: "continue",
                  skillIds: [],
                  toolCalls: [{
                    tool: readToolMatch?.[1] || "workspace_read_file",
                    arguments: {
                      path: "note.md",
                      startLine: 1,
                      endLine: 40
                    },
                    reason: "Inspect the file context."
                  }],
                  subagents: [],
                  updates: ["Read the file context"]
                });
              }
              if (promptText.includes("tool-driven agent task")) {
                if (promptText.includes("Tool result for: latest context")) {
                  return JSON.stringify({
                    summary: "Tool result reviewed",
                    assistantMessage: "I used the tool and captured the latest context.",
                    status: "done",
                    skillIds: [],
                    toolCalls: [],
                    subagents: [],
                    updates: ["Tool output incorporated"]
                  });
                }
                const toolNameMatch = promptText.match(/- (mcp_[a-z0-9_]+__lookup):/i);
                return JSON.stringify({
                  summary: "Need fresh context before answering",
                  assistantMessage: "",
                  status: "continue",
                  skillIds: [],
                  toolCalls: [{
                    tool: toolNameMatch?.[1] || "mcp_mockserver__lookup",
                    arguments: { query: "latest context" },
                    reason: "Fetch the latest context."
                  }],
                  subagents: [],
                  updates: ["Call the lookup tool"]
                });
              }
              if (promptText.includes("retrying-tool-agent-task")) {
                if (promptText.includes("Tool result for: retry context")) {
                  return JSON.stringify({
                    summary: "Recovered tool result reviewed",
                    assistantMessage: "I recovered from the MCP disconnect and still got the context.",
                    status: "done",
                    skillIds: [],
                    toolCalls: [],
                    subagents: [],
                    updates: ["Recovered after MCP reconnect"]
                  });
                }
                const toolNameMatch = promptText.match(/- (mcp_[a-z0-9_]+__lookup):/i);
                return JSON.stringify({
                  summary: "Need retried tool context before answering",
                  assistantMessage: "",
                  status: "continue",
                  skillIds: [],
                  toolCalls: [{
                    tool: toolNameMatch?.[1] || "mcp_mockserver__lookup",
                    arguments: { query: "retry context" },
                    reason: "Fetch context even if the MCP server needs a reconnect."
                  }],
                  subagents: [],
                  updates: ["Call the lookup tool with reconnect recovery"]
                });
              }
              if (promptText.includes("workspace-tool-agent-task")) {
                if (promptText.includes("Query: agentsEnabled")) {
                  return JSON.stringify({
                    summary: "Workspace search result reviewed",
                    assistantMessage: "I checked the workspace directly and found the setting in the codebase.",
                    status: "done",
                    skillIds: [],
                    toolCalls: [],
                    subagents: [],
                    updates: ["Workspace search results incorporated"]
                  });
                }
                const workspaceToolMatch = promptText.match(/- (workspace_search_text):/i);
                if (!workspaceToolMatch) {
                  return JSON.stringify({
                    summary: "Workspace tools unavailable",
                    assistantMessage: "Workspace tools are unavailable right now.",
                    status: "done",
                    skillIds: [],
                    toolCalls: [],
                    subagents: [],
                    updates: ["No first-party workspace tools were attached"]
                  });
                }
                return JSON.stringify({
                  summary: "Need to inspect the workspace setting directly",
                  assistantMessage: "",
                  status: "continue",
                  skillIds: [],
                  toolCalls: [{
                    tool: workspaceToolMatch[1],
                    arguments: {
                      query: "agentsEnabled",
                      path: "server/db",
                      limit: 5
                    },
                    reason: "Search the workspace for the settings definition."
                  }],
                  subagents: [],
                  updates: ["Use the first-party workspace search tool"]
                });
              }
              if (promptText.includes("command-tool-agent-task")) {
                if (promptText.includes("Command: node -p JSON.parse(require('fs').readFileSync('package.json', 'utf8')).name")) {
                  return JSON.stringify({
                    summary: "Command output reviewed",
                    assistantMessage: "I ran a workspace command and confirmed the project identity from package.json.",
                    status: "done",
                    skillIds: [],
                    toolCalls: [],
                    subagents: [],
                    updates: ["Command output incorporated"]
                  });
                }
                const commandToolMatch = promptText.match(/- (workspace_run_command):/i);
                if (!commandToolMatch) {
                  return JSON.stringify({
                    summary: "Command tool unavailable",
                    assistantMessage: "The workspace command tool is unavailable right now.",
                    status: "done",
                    skillIds: [],
                    toolCalls: [],
                    subagents: [],
                    updates: ["No first-party command tool was attached"]
                  });
                }
                return JSON.stringify({
                  summary: "Need to run a workspace command",
                  assistantMessage: "",
                  status: "continue",
                  skillIds: [],
                  toolCalls: [{
                    tool: commandToolMatch[1],
                    arguments: {
                      command: "node",
                      args: [
                        "-p",
                        "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).name"
                      ],
                      cwd: ".",
                      timeoutMs: 10000
                    },
                    reason: "Run a direct workspace command to inspect package.json."
                  }],
                  subagents: [],
                  updates: ["Use the first-party command tool"]
                });
              }
              if (promptText.includes("nested-subagent-task")) {
                if (promptText.includes("Subagent title: Second Layer Scout")) {
                  return JSON.stringify({
                    summary: "Deep nested subagent completed",
                    assistantMessage: "Second layer finished the deep check.",
                    status: "done",
                    skillIds: [],
                    toolCalls: [],
                    subagents: [],
                    updates: ["Deep side task completed"]
                  });
                }
                if (promptText.includes("Subagent title: First Layer Scout")) {
                  return JSON.stringify({
                    summary: "Need one more nested review",
                    assistantMessage: "",
                    status: "done",
                    skillIds: [],
                    toolCalls: [],
                    subagents: [{
                      title: "Second Layer Scout",
                      goal: "Check the final nested edge case",
                      role: "research",
                      instructions: "Return a concise nested finding."
                    }],
                    updates: ["Delegate a nested check"]
                  });
                }
                return JSON.stringify({
                  summary: "Delegate the first side task",
                  assistantMessage: "",
                  status: "done",
                  skillIds: [],
                  toolCalls: [],
                  subagents: [{
                    title: "First Layer Scout",
                    goal: "Investigate the first side question",
                    role: "reviewer",
                    instructions: "Be strict and concise."
                  }],
                  updates: ["Delegate the first layer subagent"]
                });
              }
              return JSON.stringify({
                summary: "Ready to answer directly",
                assistantMessage: "AGENT MOCK RESPONSE",
                status: "done",
                skillIds: [],
                toolCalls: [],
                subagents: [],
                updates: ["No extra work needed"]
              });
            })()
          : promptText.includes("compact-history-agent-task")
            ? "History compacted cleanly."
          : promptText.includes("simple-capability-agent-task")
            ? "I can answer questions, inspect the workspace when tools are enabled, run bounded task flows, and help with implementation, review, and research."
          : promptText.includes("Required JSON keys:")
          ? JSON.stringify({
            name: "Mock Character",
            description: "Generated description",
            personality: "Calm and observant",
            scenario: "Appears in a mock scenario",
            greeting: "Hello from the mock provider.",
            systemPrompt: "Stay in character.",
            mesExample: "<START>\nMock example",
            creatorNotes: "Generated in integration test.",
            tags: ["mock", "integration"]
          })
          : promptText.includes("Include ONLY fields that should be changed.")
            ? JSON.stringify({
              personality: "Updated personality from patch."
            })
            : "MOCK RESPONSE";

        res.setHeader("Content-Type", "application/json");
        if (promptText.includes("slow-agent-run")) {
          await sleep(250);
        }
        res.end(JSON.stringify({
          choices: [{ message: { content } }]
        }));
        return;
      }
      if (req.method === "POST" && req.url === "/v1/audio/speech") {
        res.setHeader("Content-Type", "audio/mpeg");
        res.end(Buffer.from("FAKE_MP3_DATA"));
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    }));
    mockProviderBaseUrl = toBaseUrl(mockProviderServer);

    db.prepare(`
      INSERT INTO providers (id, name, base_url, api_key_cipher, proxy_url, full_local_only, provider_type, adapter_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("mock-openai", "Mock OpenAI", `${mockProviderBaseUrl}/v1`, "test-key", null, 0, "openai", null);
  });

  afterAll(async () => {
    await closeServer(appServer);
    await closeServer(mockProviderServer);
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.SLV_DATA_DIR;
    delete process.env.ELECTRON_SERVE_STATIC;
  });

  it("supports fallback chat send, regenerate, and compress flows without an active provider", async () => {
    await updateSettings({
      activeProviderId: null,
      activeModel: null,
      compressProviderId: null,
      compressModel: null
    });

    const created = await postJson("/api/chats", { title: "Integration Chat" });
    expect(created.id).toEqual(expect.any(String));

    const timeline = await postJson(`/api/chats/${created.id}/send`, {
      content: "Hello integration"
    });
    expect(Array.isArray(timeline)).toBe(true);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ role: "user", content: "Hello integration" });
    expect(timeline[1]).toMatchObject({
      role: "assistant",
      content: "[No provider configured] Echo: Hello integration"
    });

    const compressed = await postJson(`/api/chats/${created.id}/compress`, {});
    expect(compressed.summary).toContain("user: Hello integration");
    expect(compressed.summary).toContain("assistant: [No provider configured] Echo: Hello integration");

    const regenerated = await postJson(`/api/chats/${created.id}/regenerate`, {});
    expect(regenerated).toHaveLength(2);
    expect(regenerated[1]).toMatchObject({
      role: "assistant",
      content: "[No provider configured] Echo: Hello integration"
    });
  });

  it("translates messages and synthesizes TTS against a local mock provider", async () => {
    await updateSettings({
      activeProviderId: null,
      activeModel: null,
      translateProviderId: "mock-openai",
      translateModel: "mock-model",
      ttsBaseUrl: mockProviderBaseUrl,
      ttsApiKey: "test-key",
      ttsModel: "tts-1",
      ttsVoice: "alloy"
    });

    const created = await postJson("/api/chats", { title: "Media Chat" });
    const timeline = await postJson(`/api/chats/${created.id}/send`, {
      content: "Need media handlers"
    });
    const userMessageId = timeline[0]?.id;
    expect(userMessageId).toEqual(expect.any(String));

    const translated = await postJson(`/api/chats/messages/${userMessageId}/translate`, {
      targetLanguage: "German"
    });
    expect(translated).toEqual({ translation: "MOCK RESPONSE" });

    const audioResponse = await fetch(`${baseUrl}/api/chats/messages/${userMessageId}/tts`, {
      method: "POST"
    });
    expect(audioResponse.ok).toBe(true);
    expect(audioResponse.headers.get("content-type")).toContain("audio/mpeg");
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    expect(audioBuffer.toString("utf-8")).toBe("FAKE_MP3_DATA");
  });

  it("generates writer drafts through the mock provider and exports markdown", async () => {
    await updateSettings({
      activeProviderId: "mock-openai",
      activeModel: "mock-model"
    });

    const project = await postJson("/api/writer/projects", {
      name: "Mock Novel",
      description: "Integration project"
    });
    const chapter = await postJson("/api/writer/chapters", {
      projectId: project.id,
      title: "Chapter One"
    });

    const draft = await postJson(`/api/writer/chapters/${chapter.id}/generate-draft`, {
      prompt: "Write the opening scene"
    });
    expect(draft.content).toBe("MOCK RESPONSE");

    const markdownResponse = await fetch(`${baseUrl}/api/writer/projects/${project.id}/export/markdown/download`, {
      method: "POST"
    });
    expect(markdownResponse.ok).toBe(true);
    expect(markdownResponse.headers.get("content-type")).toContain("text/markdown");
    const markdown = await markdownResponse.text();
    expect(markdown).toContain("# Mock Novel");
    expect(markdown).toContain("## Chapter One");
    expect(markdown).toContain("MOCK RESPONSE");
  });

  it("runs writer summary lenses end-to-end and reuses the cached result", async () => {
    await updateSettings({
      activeProviderId: "mock-openai",
      activeModel: "mock-model"
    });

    const project = await postJson("/api/writer/projects", {
      name: "Lens Novel",
      description: "Lens project"
    });
    const chapter = await postJson("/api/writer/chapters", {
      projectId: project.id,
      title: "Lens Chapter"
    });
    await postJson(`/api/writer/chapters/${chapter.id}/generate-draft`, {
      prompt: "Generate source material for lenses"
    });

    const lens = await postJson(`/api/writer/projects/${project.id}/lenses`, {
      scope: "project",
      name: "Arc Lens",
      prompt: "Summarize open arcs"
    });
    expect(lens.id).toEqual(expect.any(String));

    const firstRun = await postJson(`/api/writer/projects/${project.id}/lenses/${lens.id}/run`, {});
    expect(firstRun.cached).toBe(false);
    expect(firstRun.lens.output).toBe("MOCK RESPONSE");

    const secondRun = await postJson(`/api/writer/projects/${project.id}/lenses/${lens.id}/run`, {});
    expect(secondRun.cached).toBe(true);
    expect(secondRun.lens.output).toBe("MOCK RESPONSE");
  });

  it("streams chat completions with an active provider and persists regenerated assistant output", async () => {
    await updateSettings({
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      toolCallingEnabled: false
    });

    const created = await postJson("/api/chats", { title: "Streaming Chat" });

    const sendResponse = await requestJson(`/api/chats/${created.id}/send`, {
      method: "POST",
      body: { content: "Stream this reply" }
    });
    expect(sendResponse.ok).toBe(true);
    expect(sendResponse.headers.get("content-type")).toContain("text/event-stream");
    const sendBody = await sendResponse.text();
    expect(sendBody).toContain("\"type\":\"delta\"");
    expect(sendBody).toContain("MOCK ");
    expect(sendBody).toContain("STREAM RESPONSE");
    expect(sendBody).toContain("\"type\":\"done\"");

    const timelineAfterSend = await parseJsonResponse(
      `/api/chats/${created.id}/timeline`,
      await fetch(`${baseUrl}/api/chats/${created.id}/timeline`)
    );
    expect(timelineAfterSend).toHaveLength(2);
    expect(timelineAfterSend[1]).toMatchObject({
      role: "assistant",
      content: "MOCK STREAM RESPONSE"
    });

    const regenerateResponse = await requestJson(`/api/chats/${created.id}/regenerate`, {
      method: "POST",
      body: {}
    });
    expect(regenerateResponse.ok).toBe(true);
    const regenerateBody = await regenerateResponse.text();
    expect(regenerateBody).toContain("\"type\":\"delta\"");
    expect(regenerateBody).toContain("MOCK ");
    expect(regenerateBody).toContain("STREAM RESPONSE");
    expect(regenerateBody).toContain("\"type\":\"done\"");

    const timelineAfterRegenerate = await parseJsonResponse(
      `/api/chats/${created.id}/timeline`,
      await fetch(`${baseUrl}/api/chats/${created.id}/timeline`)
    );
    expect(timelineAfterRegenerate).toHaveLength(2);
    expect(timelineAfterRegenerate[1]).toMatchObject({
      role: "assistant",
      content: "MOCK STREAM RESPONSE"
    });
  });

  it("keeps agent routes disabled until the feature flag is enabled", async () => {
    await updateSettings({
      agentsEnabled: false
    });

    const response = await fetch(`${baseUrl}/api/agents/threads`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Agents feature is disabled in Settings"
    });
  });

  it("creates agent threads and streams tool-backed agent runs with event traces", async () => {
    await updateSettings({
      agentsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: [{
        id: "mockserver",
        name: "Mock MCP",
        command: process.execPath,
        args: mockMcpScriptPath,
        env: "",
        enabled: true,
        timeoutMs: 5000
      }]
    });

    const thread = await postJson("/api/agents/threads", {
      title: "Agent Workspace",
      description: "Integration test thread"
    });
    expect(thread.id).toEqual(expect.any(String));

    const initialState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(initialState.thread.title).toBe("Agent Workspace");
    expect(initialState.skills.length).toBeGreaterThanOrEqual(3);

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "tool-driven agent task" }
    });
    expect(runResponse.ok).toBe(true);
    expect(runResponse.headers.get("content-type")).toContain("text/event-stream");
    const runBody = await runResponse.text();
    expect(runBody).toContain("\"type\":\"agent_event\"");
    expect(runBody).toContain("\"type\":\"tool_call\"");
    expect(runBody).toContain("\"type\":\"tool_result\"");
    expect(collectSseDeltas(runBody)).toContain("I used the tool and captured the latest context.");

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(finalState.messages[0]).toMatchObject({
      role: "user",
      content: "tool-driven agent task",
      runId: expect.any(String)
    });
    expect(finalState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "I used the tool and captured the latest context."
    });
    expect(finalState.thread.memorySummary).toBe("");
    expect(finalState.events.some((event: { type: string }) => event.type === "tool_call")).toBe(true);
    expect(finalState.events.some((event: { type: string }) => event.type === "tool_result")).toBe(true);
    expect(finalState.events.some((event: { type: string }) => event.type === "memory")).toBe(false);
  });

  it("repairs malformed planner JSON instead of storing raw structured output in the chat", async () => {
    await updateSettings({
      agentsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      agentWorkspaceToolsEnabled: false,
      agentCommandToolEnabled: false,
      mcpServers: []
    });

    const thread = await postJson("/api/agents/threads", {
      title: "Malformed Planner Output"
    });
    lastPlannerResponseFormat = null;

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "malformed-json-agent-task" }
    });
    expect(runResponse.ok).toBe(true);
    const runBody = await runResponse.text();

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(finalState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Recovered malformed planner output with markdown:\n\n- first point\n- second point"
    });
    expect(lastPlannerResponseFormat).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "agent_step",
        strict: true
      }
    });
    expect(String(finalState.messages.at(-1)?.content || "")).not.toContain("\"summary\"");
    expect(finalState.events.some((event: { type: string; title: string }) => (
      event.type === "warning" && event.title === "Planner output repaired"
    ))).toBe(true);
  });

  it("keeps simple ask-mode replies as a single clean answer without plan or memory trace noise", async () => {
    await updateSettings({
      agentsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const thread = await postJson("/api/agents/threads", {
      title: "Simple Ask",
      mode: "ask"
    });

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "simple-capability-agent-task" }
    });
    expect(runResponse.ok).toBe(true);
    const runBody = await runResponse.text();
    expect(runBody).toContain("\"type\":\"delta\"");
    expect(runBody).not.toContain("\"title\":\"Step 1\"");
    expect(runBody).not.toContain("\"type\":\"plan\"");
    expect(runBody).not.toContain("\"type\":\"memory\"");

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(finalState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "I can answer questions, inspect the workspace when tools are enabled, run bounded task flows, and help with implementation, review, and research."
    });
    expect(finalState.events).toHaveLength(0);
    expect(finalState.thread.memorySummary).toBe("");
  });

  it("streams build-mode agent replies even when the model does not call a tool", async () => {
    await updateSettings({
      agentsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      agentWorkspaceToolsEnabled: true,
      agentCommandToolEnabled: false,
      mcpServers: []
    });

    const thread = await postJson("/api/agents/threads", {
      title: "Build No Tool Stream",
      mode: "build"
    });

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "build-no-tool-stream-task answer without tools" }
    });
    expect(runResponse.ok).toBe(true);
    const runBody = await runResponse.text();
    expect((runBody.match(/"type":"delta"/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(runBody).not.toContain("\"type\":\"tool_call\"");
    expect(collectSseDeltas(runBody)).toContain("No-tool agent stream works with multiple chunks");
    expect(collectSseDeltas(runBody)).toContain("workspace tool is needed");

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(finalState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "No-tool agent stream works with multiple chunks even when no workspace tool is needed for the final answer."
    });
    expect(finalState.events.some((event: { type: string }) => event.type === "tool_call")).toBe(false);
  });

  it("persists partial streamed agent replies when the provider errors mid-response", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      agentCommandToolEnabled: false,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const thread = await postJson("/api/agents/threads", {
      title: "Partial Error Thread",
      mode: "build"
    });

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "partial-error-agent-task fix code in the workspace" }
    });
    expect(runResponse.ok).toBe(true);
    const runBody = await runResponse.text();
    expect(runBody).toContain("\"type\":\"agent_message\"");
    expect(runBody).toContain("Partial answer that should survive.");
    expect(runBody).toContain("\"type\":\"error\"");

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(finalState.thread.status).toBe("error");
    expect(finalState.messages.some((message: { role: string; content: string; metadata?: Record<string, unknown> }) => (
      message.role === "assistant"
      && message.content === "Partial answer that should survive."
      && message.metadata?.interrupted === true
    ))).toBe(true);
  });

  it("builds a codex-like prompt stack with developer guidance, AGENTS instructions, and environment context", async () => {
    lastAgentPromptStackText = "";
    await updateSettings({
      agentsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      agentWorkspaceToolsEnabled: false,
      agentCommandToolEnabled: false,
      mcpServers: []
    });

    const workspaceDir = mkdtempSync(join(dataDir, "agent-prompt-stack-"));
    writeFileSync(join(workspaceDir, "AGENTS.md"), "Use concise repo-aware answers and prefer targeted edits.\n", "utf8");

    const thread = await postJson("/api/agents/threads", {
      title: "Prompt Stack Thread",
      workspaceRoot: workspaceDir,
      developerPrompt: "DEVELOPER_MARKER: honor the workspace operating rules."
    });

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "prompt-stack-agent-task" }
    });
    expect(runResponse.ok).toBe(true);
    await runResponse.text();

    expect(lastAgentPromptStackText).toContain("DEVELOPER_MARKER: honor the workspace operating rules.");
    expect(lastAgentPromptStackText).toContain("Project instructions collected from scoped AGENTS files.");
    expect(lastAgentPromptStackText).toContain("Use concise repo-aware answers and prefer targeted edits.");
    expect(lastAgentPromptStackText).toContain("<environment_context>");
    expect(lastAgentPromptStackText).toContain(`<cwd>${workspaceDir}</cwd>`);
  });

  it("auto-compacts older agent history when the prompt budget gets tight", async () => {
    lastCompactionPromptText = "";
    await updateSettings({
      agentsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: [],
      contextWindowSize: 1024,
      agentAutoCompactEnabled: true,
      agentReplyReserveTokens: 900
    });
    try {
      const thread = await postJson("/api/agents/threads", {
        title: "Compacted Ask",
        mode: "ask"
      });

      const historyTurns = [
        `simple-capability-agent-task oldest-marker ${"OLDEST ".repeat(90)} UNIQUE_END_OLDEST`,
        `simple-capability-agent-task second-marker ${"SECOND ".repeat(90)} UNIQUE_END_SECOND`,
        `simple-capability-agent-task third-marker ${"THIRD ".repeat(90)} UNIQUE_END_THIRD`,
        `simple-capability-agent-task fourth-marker ${"FOURTH ".repeat(90)} UNIQUE_END_FOURTH`
      ];

      for (const content of historyTurns) {
        const historyRun = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
          method: "POST",
          body: { content }
        });
        expect(historyRun.ok).toBe(true);
        await historyRun.text();
      }

      const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
        method: "POST",
        body: { content: `simple-capability-agent-task compact-history-agent-task latest-marker ${"LATEST ".repeat(60)} UNIQUE_END_LATEST` }
      });
      expect(runResponse.ok).toBe(true);
      await runResponse.text();

      expect(lastCompactionPromptText).toContain("Compacted earlier thread context:");
      expect(lastCompactionPromptText).toContain("latest-marker");
      expect(lastCompactionPromptText).not.toContain("UNIQUE_END_OLDEST");
      expect(lastCompactionPromptText).not.toContain("UNIQUE_END_SECOND");

      const finalState = await parseJsonResponse(
        `/api/agents/threads/${thread.id}/state`,
        await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
      );
      expect(finalState.messages.at(-1)).toMatchObject({
        role: "assistant"
      });
      expect(String(finalState.messages.at(-1)?.content || "").length).toBeGreaterThan(0);
    } finally {
      await updateSettings({
        contextWindowSize: 8192,
        agentReplyReserveTokens: 1400
      });
    }
  });

  it("chains multiple workspace tool calls in one direct agent run", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const thread = await postJson("/api/agents/threads", {
      title: "Chain Tool Loop",
      mode: "build"
    });

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "chain-workspace-agent-task" }
    });
    expect(runResponse.ok).toBe(true);
    const runBody = await runResponse.text();
    expect((runBody.match(/"type":"tool_call"/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(runBody).toContain("I inspected the workspace in two passes and verified where the agentsEnabled setting lives.");

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(finalState.events.filter((event: { type: string }) => event.type === "tool_call")).toHaveLength(2);
    expect(finalState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "I inspected the workspace in two passes and verified where the agentsEnabled setting lives."
    });
  });

  it("respects the selected workspace root for first-party workspace tools", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const thread = await postJson("/api/agents/threads", {
      title: "Scoped Workspace Root",
      mode: "build",
      workspaceRoot: join(process.cwd(), "server")
    });

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "workspace-root-agent-task" }
    });
    expect(runResponse.ok).toBe(true);
    await runResponse.text();

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(finalState.thread.workspaceRoot).toBe(join(process.cwd(), "server"));
    expect(finalState.events.some((event: { type: string; content: string }) => (
      event.type === "tool_result"
      && String(event.content || "").includes("db/defaultSettings.ts")
    ))).toBe(true);
    expect(finalState.events.some((event: { type: string; content: string }) => (
      event.type === "tool_result"
      && String(event.content || "").includes("server/db/defaultSettings.ts")
    ))).toBe(false);
  });

  it("uses first-party workspace tools when enabled and removes them when disabled", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      agentCommandToolEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const enabledThread = await postJson("/api/agents/threads", {
      title: "Workspace Tools On"
    });
    const enabledRun = await requestJson(`/api/agents/threads/${enabledThread.id}/respond`, {
      method: "POST",
      body: { content: "workspace-tool-agent-task" }
    });
    expect(enabledRun.ok).toBe(true);
    const enabledBody = await enabledRun.text();
    expect(enabledBody).toContain("\"type\":\"tool_call\"");
    expect(enabledBody).toContain("workspace_search_text");
    expect(enabledBody).toContain("I checked the workspace directly and found the setting in the codebase.");

    const enabledState = await parseJsonResponse(
      `/api/agents/threads/${enabledThread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${enabledThread.id}/state`)
    );
    expect(enabledState.events.some((event: { type: string; title: string }) => (
      event.type === "tool_call" && event.title === "workspace_search_text"
    ))).toBe(true);
    expect(enabledState.events.some((event: { type: string; content: string }) => (
      event.type === "tool_result"
      && String(event.content || "").includes("server/db/defaultSettings.ts")
      && String(event.content || "").includes("agentsEnabled")
    ))).toBe(true);

    await updateSettings({
      agentWorkspaceToolsEnabled: false
    });

    const disabledThread = await postJson("/api/agents/threads", {
      title: "Workspace Tools Off"
    });
    const disabledRun = await requestJson(`/api/agents/threads/${disabledThread.id}/respond`, {
      method: "POST",
      body: { content: "workspace-tool-agent-task" }
    });
    expect(disabledRun.ok).toBe(true);
    const disabledBody = await disabledRun.text();
    expect(disabledBody).not.toContain("workspace_search_text");
    expect(collectSseDeltas(disabledBody)).toContain("Workspace tools are unavailable right now.");

    const disabledState = await parseJsonResponse(
      `/api/agents/threads/${disabledThread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${disabledThread.id}/state`)
    );
    expect(disabledState.events.some((event: { type: string; title: string }) => (
      event.type === "tool_call" && event.title === "workspace_search_text"
    ))).toBe(false);
  });

  it("applies richer workspace edit tools for grouped file changes", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      agentCommandToolEnabled: false,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const workspaceDir = mkdtempSync(join(dataDir, "agent-edit-tools-"));
    writeFileSync(join(workspaceDir, "note.md"), "# Landing Draft\nOld headline\nNeeds polish.\n", "utf8");

    const thread = await postJson("/api/agents/threads", {
      title: "Edit Tool Thread",
      workspaceRoot: workspaceDir
    });

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "edit-tools-agent-task update the workspace file" }
    });
    expect(runResponse.ok).toBe(true);
    const runBody = await runResponse.text();
    expect(runBody).toContain("workspace_multi_edit");
    expect(runBody).toContain("workspace_insert_text");
    expect(runBody).toContain("I updated the file with grouped edits and an inserted summary line.");

    const fileContent = readFileSync(join(workspaceDir, "note.md"), "utf8");
    expect(fileContent).toContain("# Landing Draft\nSummary line inserted by the agent.\n");
    expect(fileContent).toContain("New headline");
    expect(fileContent).toContain("Sharper copy added.");

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(finalState.events.some((event: { type: string; title: string }) => (
      event.type === "tool_call" && event.title === "workspace_multi_edit"
    ))).toBe(true);
    expect(finalState.events.some((event: { type: string; title: string }) => (
      event.type === "tool_call" && event.title === "workspace_insert_text"
    ))).toBe(true);
  });

  it("nudges coding agents out of repeated read-only loops and into workspace edits", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      agentCommandToolEnabled: false,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const workspaceDir = mkdtempSync(join(dataDir, "agent-read-stall-"));
    writeFileSync(join(workspaceDir, "index.html"), "<h1>Old heading</h1>\n", "utf8");

    const thread = await postJson("/api/agents/threads", {
      title: "Read Stall Guard Thread",
      mode: "build",
      workspaceRoot: workspaceDir
    });

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "read-stall-agent-task fix the page heading in the workspace file" }
    });
    expect(runResponse.ok).toBe(true);
    const runBody = await runResponse.text();
    expect(runBody).toContain("Duplicate read skipped");
    expect(runBody).toContain("Read-only loop guard");
    expect(runBody).toContain("workspace_replace_text");
    expect(runBody).toContain("I updated index.html instead of continuing to read the same file.");

    const fileContent = readFileSync(join(workspaceDir, "index.html"), "utf8");
    expect(fileContent).toContain("<h1>New heading</h1>");

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(finalState.events.some((event: { type: string; title: string }) => (
      event.type === "warning" && event.title === "Read-only loop guard"
    ))).toBe(true);
    expect(finalState.events.some((event: { type: string; title: string }) => (
      event.type === "tool_call" && event.title === "workspace_replace_text"
    ))).toBe(true);
  });

  it("accepts steering updates while the agent run is still active", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      agentCommandToolEnabled: true,
      agentShellCommandsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const workspaceDir = mkdtempSync(join(dataDir, "agent-steer-"));
    writeFileSync(join(workspaceDir, "notes.txt"), "Initial direction\n", "utf8");

    const thread = await postJson("/api/agents/threads", {
      title: "Steerable Thread",
      workspaceRoot: workspaceDir
    });

    const activeRun = requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "steer-agent-task inspect the workspace and keep going" }
    });
    await sleep(40);

    const steerResponse = await requestJson(`/api/agents/threads/${thread.id}/steer`, {
      method: "POST",
      body: { content: "Use tighter copy and mention the corrected direction." }
    });
    expect(steerResponse.ok).toBe(true);
    const steerPayload = await steerResponse.json();
    expect(steerPayload.ok).toBe(true);

    const runResponse = await activeRun;
    expect(runResponse.ok).toBe(true);
    const runBody = await runResponse.text();
    expect(runBody).toContain("I applied the correction and continued in the updated direction.");

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(finalState.messages.some((message: { metadata?: { steering?: boolean }; content: string }) => (
      message.metadata?.steering === true
      && message.content === "Use tighter copy and mention the corrected direction."
    ))).toBe(true);
    expect(finalState.events.some((event: { type: string; title: string }) => (
      event.type === "status" && event.title === "User correction received"
    ))).toBe(true);
    expect(finalState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "I applied the correction and continued in the updated direction."
    });
  });

  it("stores attachments, lets the user edit a message, and forks a new agent branch from a message", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: false,
      agentCommandToolEnabled: false,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const thread = await postJson("/api/agents/threads", {
      title: "Editable Attachment Thread",
      mode: "ask"
    });

    const attachment = {
      id: "attachment-note-1",
      filename: "note.md",
      type: "text",
      url: "/mock-upload/note.md",
      mimeType: "text/markdown",
      content: "# Context\nNeed a concise answer."
    };

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: {
        content: "simple-capability-agent-task",
        attachments: [attachment]
      }
    });
    expect(runResponse.ok).toBe(true);
    await runResponse.text();

    const initialState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    const userMessage = initialState.messages.find((message: { role: string }) => message.role === "user");
    const assistantMessage = initialState.messages.find((message: { role: string }) => message.role === "assistant");
    expect(userMessage).toMatchObject({
      content: "simple-capability-agent-task"
    });
    expect(userMessage.attachments).toMatchObject([{
      filename: "note.md",
      type: "text",
      content: "# Context\nNeed a concise answer."
    }]);
    expect(assistantMessage).toMatchObject({
      content: "I can answer questions, inspect the workspace when tools are enabled, run bounded task flows, and help with implementation, review, and research."
    });

    const forkedThread = await postJson(`/api/agents/messages/${assistantMessage.id}/fork`, {
      name: "Forked Attachment Thread"
    });
    expect(forkedThread).toMatchObject({
      title: "Forked Attachment Thread"
    });

    const forkedState = await parseJsonResponse(
      `/api/agents/threads/${forkedThread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${forkedThread.id}/state`)
    );
    expect(forkedState.messages).toHaveLength(2);
    expect(forkedState.runs).toHaveLength(0);
    expect(forkedState.messages[0].attachments).toMatchObject([{
      filename: "note.md"
    }]);

    const editResponse = await requestJson(`/api/agents/messages/${userMessage.id}`, {
      method: "PATCH",
      body: {
        content: "simple-capability-agent-task edited"
      }
    });
    expect(editResponse.ok).toBe(true);
    const editedPayload = await editResponse.json();
    expect(editedPayload.state.messages).toHaveLength(1);
    expect(editedPayload.state.runs).toHaveLength(0);
    expect(editedPayload.state.thread.memorySummary).toBe("");
    expect(editedPayload.state.messages[0]).toMatchObject({
      role: "user",
      content: "simple-capability-agent-task edited"
    });
    expect(editedPayload.state.messages[0].attachments).toMatchObject([{
      filename: "note.md"
    }]);
  });

  it("continues the run when the planner emits a progress note instead of a completed result", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      agentCommandToolEnabled: false,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const thread = await postJson("/api/agents/threads", {
      title: "Continuation Recovery",
      mode: "build"
    });

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "premature-stop-agent-task сделай правки" }
    });
    expect(runResponse.ok).toBe(true);
    const runBody = await runResponse.text();
    expect(runBody).toContain("\"title\":\"Planner continuation inferred\"");
    expect(runBody).toContain("\"type\":\"tool_call\"");
    expect(collectSseDeltas(runBody)).toContain("I inspected the workspace and continued the run instead of stopping after the intermediate note.");

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(finalState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "I inspected the workspace and continued the run instead of stopping after the intermediate note."
    });
    expect(finalState.events.some((event: { type: string; title: string }) => (
      event.type === "warning" && event.title === "Planner continuation inferred"
    ))).toBe(true);
    expect(finalState.events.some((event: { type: string; title: string }) => (
      event.type === "tool_call" && event.title === "workspace_list_files"
    ))).toBe(true);
  });

  it("continues the run when malformed planner JSON declares continue status", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      agentCommandToolEnabled: false,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const thread = await postJson("/api/agents/threads", {
      title: "Malformed Continue Recovery",
      mode: "build"
    });

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "malformed-continue-agent-task сделай правки" }
    });
    expect(runResponse.ok).toBe(true);
    const runBody = await runResponse.text();
    expect(runBody).toContain("\"title\":\"Planner output repaired\"");
    expect(runBody).toContain("\"type\":\"tool_call\"");
    expect(collectSseDeltas(runBody)).toContain("I kept going after the malformed continue step, inspected the workspace, and only then finished the run.");

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(finalState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "I kept going after the malformed continue step, inspected the workspace, and only then finished the run."
    });
    expect(finalState.events.some((event: { type: string; title: string }) => (
      event.type === "warning" && event.title === "Planner output repaired"
    ))).toBe(true);
    expect(finalState.events.some((event: { type: string; title: string }) => (
      event.type === "tool_call" && event.title === "workspace_list_files"
    ))).toBe(true);
  });

  it("stops repaired planner continue-loops after completed file edits and synthesizes a final answer", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      agentCommandToolEnabled: false,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const workspaceDir = mkdtempSync(join(dataDir, "agent-repair-loop-"));
    const thread = await postJson("/api/agents/threads", {
      title: "Repair Loop Guard",
      mode: "build",
      workspaceRoot: workspaceDir
    });

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "repair-loop-agent-task сделай mvp telegram web" }
    });
    expect(runResponse.ok).toBe(true);
    const runBody = await runResponse.text();
    expect(runBody).toContain("\"title\":\"Planner output repaired\"");
    expect(runBody).toContain("\"title\":\"Planner continuation stalled\"");
    expect(collectSseDeltas(runBody)).toContain("I updated the requested files and stopped the malformed planner loop instead of spinning.");

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(finalState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "I updated the requested files and stopped the malformed planner loop instead of spinning."
    });
    expect(finalState.events.some((event: { type: string; title: string }) => (
      event.type === "warning" && event.title === "Planner continuation stalled"
    ))).toBe(true);
  });

  it("runs build tasks through direct OpenAI tool calls instead of planner repair loops", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      agentCommandToolEnabled: false,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });
    lastBuildDirectToolChoice = "";

    const workspaceDir = mkdtempSync(join(dataDir, "agent-direct-build-"));
    const thread = await postJson("/api/agents/threads", {
      title: "Direct Build Tool Loop",
      mode: "build",
      workspaceRoot: workspaceDir
    });

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "build-direct-tool-agent-task сделай проект" }
    });
    expect(runResponse.ok).toBe(true);
    const runBody = await runResponse.text();
    expect(runBody).toContain("\"type\":\"tool_call\"");
    expect(runBody).toContain("workspace_write_file");
    expect(runBody).not.toContain("Planner output repaired");
    expect(collectSseDeltas(runBody)).toContain("I created the project files through the direct tool loop.");
    expect(lastBuildDirectToolChoice).toBe("required");
    expect(existsSync(join(workspaceDir, "src/App.tsx"))).toBe(true);
  });

  it("skips duplicate read-only planner calls instead of repeating the same context fetch", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      agentCommandToolEnabled: false,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const workspaceDir = mkdtempSync(join(dataDir, "agent-planner-repeat-read-"));
    writeFileSync(join(workspaceDir, "note.md"), "# Note\nsame context\n", "utf8");
    const thread = await postJson("/api/agents/threads", {
      title: "Planner Duplicate Read",
      mode: "build",
      workspaceRoot: workspaceDir
    });

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "planner loop task" }
    });
    expect(runResponse.ok).toBe(true);
    const runBody = await runResponse.text();
    expect(runBody).toContain("\"title\":\"workspace_read_file\"");
    expect(runBody).toContain("\"title\":\"Duplicate read skipped\"");
    expect((runBody.match(/"type":"tool_call"/g) || []).length).toBe(1);
    expect(collectSseDeltas(runBody)).toContain("I reused the first read result instead of reading the same file again.");
  });

  it("treats terse do-only prompts as continuation cues and keeps using direct tools", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      agentCommandToolEnabled: false,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const workspaceDir = mkdtempSync(join(dataDir, "agent-do-only-continuation-"));
    const thread = await postJson("/api/agents/threads", {
      title: "Do Only Continuation",
      mode: "build",
      workspaceRoot: workspaceDir
    });

    const initialRun = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "build-direct-tool-agent-task сделай проект" }
    });
    expect(initialRun.ok).toBe(true);
    await initialRun.text();

    lastBuildDirectToolChoice = "";
    const continueRun = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "ничего не пиши просто делай" }
    });
    expect(continueRun.ok).toBe(true);
    const runBody = await continueRun.text();
    expect(runBody).toContain("\"type\":\"tool_call\"");
    expect(runBody).toContain("workspace_write_file");
    expect(runBody).not.toContain("Planner output repaired");
    expect(lastBuildDirectToolChoice).toBe("required");
  });

  it("does not treat a short fresh task as continuation just because it follows another run", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      agentCommandToolEnabled: false,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const workspaceDir = mkdtempSync(join(dataDir, "agent-fresh-short-task-"));
    const thread = await postJson("/api/agents/threads", {
      title: "Fresh Short Task",
      mode: "build",
      workspaceRoot: workspaceDir
    });

    const initialRun = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "build-direct-tool-agent-task сделай проект" }
    });
    expect(initialRun.ok).toBe(true);
    await initialRun.text();

    const freshRun = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "новый лендинг" }
    });
    expect(freshRun.ok).toBe(true);
    await freshRun.text();

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    const freshUserMessage = [...finalState.messages]
      .reverse()
      .find((message: { role: string; content: string; metadata?: Record<string, unknown> }) => message.role === "user" && message.content === "новый лендинг");
    expect(freshUserMessage?.metadata?.followupIntent).toBe("new_task");
  });

  it("treats a short continue prompt as continuation of the prior task instead of a brand-new request", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      agentCommandToolEnabled: false,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const workspaceDir = mkdtempSync(join(dataDir, "agent-continuation-cue-"));
    const thread = await postJson("/api/agents/threads", {
      title: "Continuation Cue",
      mode: "build",
      workspaceRoot: workspaceDir
    });

    const initialRun = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "continuation-cue-agent-task создай telegram web mvp" }
    });
    expect(initialRun.ok).toBe(true);
    await initialRun.text();

    const continueRun = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "делай" }
    });
    expect(continueRun.ok).toBe(true);
    const continueBody = await continueRun.text();
    expect(continueBody).toContain("\"type\":\"tool_call\"");
    expect(collectSseDeltas(continueBody)).toContain("I continued the original task instead of treating the continuation cue as a brand-new request.");
    expect(collectSseDeltas(continueBody)).not.toContain("Я ещё не успел реально продолжить работу");

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(finalState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "I continued the original task instead of treating the continuation cue as a brand-new request."
    });
  });

  it("deletes assistant messages and prunes later agent run state", async () => {
    await updateSettings({
      agentsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      agentWorkspaceToolsEnabled: false,
      agentCommandToolEnabled: false,
      mcpServers: []
    });

    const thread = await postJson("/api/agents/threads", {
      title: "Delete Assistant Message",
      mode: "ask"
    });

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "simple-capability-agent-task" }
    });
    expect(runResponse.ok).toBe(true);
    await runResponse.text();

    const initialState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    const assistantMessage = initialState.messages.find((message: { role: string }) => message.role === "assistant");
    expect(assistantMessage).toBeTruthy();
    if (!assistantMessage) {
      throw new Error("Expected an assistant message to exist before deletion");
    }

    const deleteResponse = await requestJson(`/api/agents/messages/${assistantMessage.id}`, {
      method: "DELETE"
    });
    expect(deleteResponse.ok).toBe(true);
    const deletedPayload = await deleteResponse.json();
    expect(deletedPayload.state.messages).toHaveLength(1);
    expect(deletedPayload.state.messages[0]).toMatchObject({
      role: "user",
      content: "simple-capability-agent-task"
    });
    expect(deletedPayload.state.runs).toHaveLength(0);
    expect(deletedPayload.state.thread.memorySummary).toBe("");
  });

  it("uses the first-party command tool when enabled and removes it when disabled", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: false,
      agentCommandToolEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const enabledThread = await postJson("/api/agents/threads", {
      title: "Command Tool On"
    });
    const enabledRun = await requestJson(`/api/agents/threads/${enabledThread.id}/respond`, {
      method: "POST",
      body: { content: "command-tool-agent-task" }
    });
    expect(enabledRun.ok).toBe(true);
    const enabledBody = await enabledRun.text();
    expect(enabledBody).toContain("\"type\":\"tool_call\"");
    expect(enabledBody).toContain("workspace_run_command");
    expect(enabledBody).toContain("I ran a workspace command and confirmed the project identity from package.json.");

    const enabledState = await parseJsonResponse(
      `/api/agents/threads/${enabledThread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${enabledThread.id}/state`)
    );
    expect(enabledState.events.some((event: { type: string; title: string }) => (
      event.type === "tool_call" && event.title === "workspace_run_command"
    ))).toBe(true);
    expect(enabledState.events.some((event: { type: string; content: string }) => (
      event.type === "tool_result"
      && String(event.content || "").includes("Command: node -p")
      && String(event.content || "").includes("vellium")
    ))).toBe(true);

    await updateSettings({
      agentCommandToolEnabled: false
    });

    const disabledThread = await postJson("/api/agents/threads", {
      title: "Command Tool Off"
    });
    const disabledRun = await requestJson(`/api/agents/threads/${disabledThread.id}/respond`, {
      method: "POST",
      body: { content: "command-tool-agent-task" }
    });
    expect(disabledRun.ok).toBe(true);
    const disabledBody = await disabledRun.text();
    expect(disabledBody).not.toContain("\"type\":\"tool_call\"");
    expect(collectSseDeltas(disabledBody)).toContain("The workspace command tool is unavailable right now.");

    const disabledState = await parseJsonResponse(
      `/api/agents/threads/${disabledThread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${disabledThread.id}/state`)
    );
    expect(disabledState.events.some((event: { type: string; title: string }) => event.title === "workspace_run_command")).toBe(false);
  });

  it("blocks dangerous command mutations by default and allows them when explicitly enabled", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: false,
      agentCommandToolEnabled: true,
      agentDangerousFileOpsEnabled: false,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const workspaceDir = mkdtempSync(join(dataDir, "agent-dangerous-command-"));
    const blockedThread = await postJson("/api/agents/threads", {
      title: "Dangerous Command Blocked",
      workspaceRoot: workspaceDir
    });
    const blockedRun = await requestJson(`/api/agents/threads/${blockedThread.id}/respond`, {
      method: "POST",
      body: { content: "dangerous-command-agent-task run mkdir danger-dir inside the workspace" }
    });
    expect(blockedRun.ok).toBe(true);
    const blockedBody = await blockedRun.text();
    expect(blockedBody).toContain("The dangerous workspace command was blocked by policy.");
    expect(blockedBody).toContain("explicitly enabled for Agents");
    expect(existsSync(join(workspaceDir, "danger-dir"))).toBe(false);

    await updateSettings({
      agentDangerousFileOpsEnabled: true
    });

    const enabledThread = await postJson("/api/agents/threads", {
      title: "Dangerous Command Enabled",
      workspaceRoot: workspaceDir
    });
    const enabledRun = await requestJson(`/api/agents/threads/${enabledThread.id}/respond`, {
      method: "POST",
      body: { content: "dangerous-command-agent-task run mkdir danger-dir inside the workspace" }
    });
    expect(enabledRun.ok).toBe(true);
    const enabledBody = await enabledRun.text();
    expect(enabledBody).toContain("The dangerous workspace command ran after the policy was enabled.");
    expect(existsSync(join(workspaceDir, "danger-dir"))).toBe(true);
  });

  it("blocks destructive file tools by default and allows them when explicitly enabled", async () => {
    await updateSettings({
      agentsEnabled: true,
      agentWorkspaceToolsEnabled: true,
      agentCommandToolEnabled: false,
      agentDangerousFileOpsEnabled: false,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: []
    });

    const workspaceDir = mkdtempSync(join(dataDir, "agent-dangerous-delete-"));
    const blockedPath = join(workspaceDir, "trash.txt");
    writeFileSync(blockedPath, "delete me", "utf8");

    const blockedThread = await postJson("/api/agents/threads", {
      title: "Delete Tool Blocked",
      workspaceRoot: workspaceDir
    });
    const blockedRun = await requestJson(`/api/agents/threads/${blockedThread.id}/respond`, {
      method: "POST",
      body: { content: "dangerous-delete-agent-task delete the file trash.txt from the workspace" }
    });
    expect(blockedRun.ok).toBe(true);
    const blockedBody = await blockedRun.text();
    expect(blockedBody).toContain("The delete request was blocked by policy.");
    expect(blockedBody).toContain("workspace_delete_path is blocked by agent security policy");
    expect(existsSync(blockedPath)).toBe(true);

    await updateSettings({
      agentDangerousFileOpsEnabled: true
    });
    writeFileSync(blockedPath, "delete me again", "utf8");

    const enabledThread = await postJson("/api/agents/threads", {
      title: "Delete Tool Enabled",
      workspaceRoot: workspaceDir
    });
    const enabledRun = await requestJson(`/api/agents/threads/${enabledThread.id}/respond`, {
      method: "POST",
      body: { content: "dangerous-delete-agent-task delete the file trash.txt from the workspace" }
    });
    expect(enabledRun.ok).toBe(true);
    const enabledBody = await enabledRun.text();
    expect(enabledBody).toContain("The delete request ran after the policy was enabled.");
    expect(existsSync(blockedPath)).toBe(false);
  });

  it("creates agent workspaces from hero profiles with custom instructions and skills", async () => {
    await updateSettings({
      agentsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model"
    });

    const hero = await postJson("/api/characters/import", {
      rawJson: JSON.stringify({
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: {
          name: "Systems Hero",
          description: "A pragmatic operator who ships carefully.",
          personality: "Calm, technical, skeptical",
          scenario: "Working inside the Vellium agents workspace",
          system_prompt: "Prefer explicit tradeoffs.",
          tags: ["ops"],
          extensions: {
            vellium_agent: {
              enabled: true,
              mode: "research",
              customInstructions: "Always compare two strong approaches before deciding.",
              skills: [
                {
                  id: "hero-skill-1",
                  name: "Tradeoff Mapper",
                  description: "Compare execution paths.",
                  instructions: "List the upside, downside, and unknowns for each viable path.",
                  enabled: true
                }
              ]
            }
          }
        }
      })
    });

    expect(hero.agentProfile).toMatchObject({
      enabled: true,
      mode: "research",
      customInstructions: "Always compare two strong approaches before deciding."
    });

    const thread = await postJson("/api/agents/threads", {
      heroCharacterId: hero.id,
      title: "Hero Research Workspace"
    });

    expect(thread).toMatchObject({
      title: "Hero Research Workspace",
      mode: "research",
      heroCharacterId: hero.id,
      heroCharacterName: "Systems Hero"
    });
    expect(thread.systemPrompt).toContain("Always compare two strong approaches before deciding.");
    expect(thread.systemPrompt).toContain("Systems Hero");

    const threadState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(threadState.thread.mode).toBe("research");
    expect(threadState.thread.heroCharacterName).toBe("Systems Hero");
    expect(threadState.skills.some((skill: { name: string }) => skill.name === "Tradeoff Mapper")).toBe(true);
  });

  it("rejects parallel agent runs and prevents deleting threads while a run is active", async () => {
    await updateSettings({
      agentsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model"
    });

    const thread = await postJson("/api/agents/threads", {
      title: "Concurrency Guard"
    });

    const activeRun = requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "slow-agent-run" }
    });

    await sleep(40);

    const parallelResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "second-run-should-fail" }
    });
    expect(parallelResponse.status).toBe(409);
    expect(await parallelResponse.json()).toEqual({
      error: "Agent thread is already running"
    });

    const deleteResponse = await requestJson(`/api/agents/threads/${thread.id}`, {
      method: "DELETE"
    });
    expect(deleteResponse.status).toBe(409);
    expect(await deleteResponse.json()).toEqual({
      error: "Cannot delete a running agent thread"
    });

    const abortResult = await postJson(`/api/agents/threads/${thread.id}/abort`, {});
    expect(abortResult).toMatchObject({ ok: true, interrupted: true });

    const activeRunResponse = await activeRun;
    expect(activeRunResponse.ok).toBe(true);
    const activeRunBody = await activeRunResponse.text();
    expect(activeRunBody).toContain("\"type\":\"done\"");
  });

  it("retries a completed run with the prior branch context", async () => {
    await updateSettings({
      agentsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model"
    });

    const thread = await postJson("/api/agents/threads", {
      title: "Retry Flow"
    });
    const firstRunResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "retry-agent-run" }
    });
    expect(firstRunResponse.ok).toBe(true);
    const firstRunBody = await firstRunResponse.text();
    expect(firstRunBody).toContain("First attempt answer.");

    const firstState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    const sourceRunId = String(firstState.runs[0]?.id || "");
    expect(sourceRunId).toBeTruthy();

    const retryResponse = await requestJson(`/api/agents/threads/${thread.id}/runs/${sourceRunId}/retry`, {
      method: "POST",
      body: {}
    });
    expect(retryResponse.ok).toBe(true);
    const retryBody = await retryResponse.text();
    expect(retryBody).toContain("Second attempt answer after retry.");
    expect(retryBody).toContain("Retrying prior run");

    const retryState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(retryState.runs).toHaveLength(2);
    expect(retryState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Second attempt answer after retry."
    });
    expect(retryState.events.some((event: { title: string; payload: { launchMode?: string; sourceRunId?: string } }) => (
      event.title === "Retrying prior run"
      && event.payload?.launchMode === "retry"
      && event.payload?.sourceRunId === sourceRunId
    ))).toBe(true);
  });

  it("resumes an aborted run with the prior branch context", async () => {
    await updateSettings({
      agentsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model"
    });

    const thread = await postJson("/api/agents/threads", {
      title: "Resume Flow"
    });

    const activeRun = requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "slow-agent-run" }
    });

    await sleep(40);
    const abortResult = await postJson(`/api/agents/threads/${thread.id}/abort`, {});
    expect(abortResult).toMatchObject({ ok: true, interrupted: true });

    const abortedResponse = await activeRun;
    expect(abortedResponse.ok).toBe(true);
    await abortedResponse.text();

    const abortedState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    const sourceRunId = String(abortedState.runs[0]?.id || "");
    expect(abortedState.runs[0]?.status).toBe("aborted");

    const resumeResponse = await requestJson(`/api/agents/threads/${thread.id}/runs/${sourceRunId}/resume`, {
      method: "POST",
      body: {}
    });
    expect(resumeResponse.ok).toBe(true);
    const resumeBody = await resumeResponse.text();
    expect(collectSseDeltas(resumeBody)).toContain("I resumed the previous run and completed the task.");
    expect(resumeBody).toContain("Resuming prior run");

    const resumedState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(resumedState.runs).toHaveLength(2);
    expect(resumedState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "I resumed the previous run and completed the task."
    });
    expect(resumedState.events.some((event: { title: string; payload: { launchMode?: string; sourceRunId?: string } }) => (
      event.title === "Resuming prior run"
      && event.payload?.launchMode === "resume"
      && event.payload?.sourceRunId === sourceRunId
    ))).toBe(true);
  });

  it("enforces the configured subagent budget and allows nested delegation within that limit", async () => {
    await updateSettings({
      agentsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model"
    });

    const limitedThread = await postJson("/api/agents/threads", {
      title: "Limited Delegation",
      maxSubagents: 1
    });
    const limitedRun = await requestJson(`/api/agents/threads/${limitedThread.id}/respond`, {
      method: "POST",
      body: { content: "nested-subagent-task" }
    });
    expect(limitedRun.ok).toBe(true);
    const limitedBody = await limitedRun.text();
    expect(limitedBody).toContain("\"type\":\"subagent_start\"");

    const limitedState = await parseJsonResponse(
      `/api/agents/threads/${limitedThread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${limitedThread.id}/state`)
    );
    expect(limitedState.runs).toHaveLength(2);
    expect(limitedState.events.some((event: { type: string; content: string }) => (
      event.type === "warning" && String(event.content || "").includes("Subagent budget exhausted")
    ))).toBe(true);

    const nestedThread = await postJson("/api/agents/threads", {
      title: "Nested Delegation",
      maxSubagents: 2
    });
    const nestedRun = await requestJson(`/api/agents/threads/${nestedThread.id}/respond`, {
      method: "POST",
      body: { content: "nested-subagent-task" }
    });
    expect(nestedRun.ok).toBe(true);
    const nestedBody = await nestedRun.text();
    expect(nestedBody).toContain("\"type\":\"subagent_done\"");

    const nestedState = await parseJsonResponse(
      `/api/agents/threads/${nestedThread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${nestedThread.id}/state`)
    );
    expect(nestedState.runs).toHaveLength(3);
    expect(nestedState.runs.some((run: { depth: number; title: string }) => run.depth === 2 && run.title === "Second Layer Scout")).toBe(true);
    expect(nestedState.events.some((event: { type: string; payload: { role?: string } }) => (
      event.type === "subagent_start" && event.payload?.role === "reviewer"
    ))).toBe(true);
    expect(nestedState.events.some((event: { type: string; payload: { role?: string } }) => (
      event.type === "subagent_start" && event.payload?.role === "research"
    ))).toBe(true);
  });

  it("surfaces degraded MCP availability and recovers tool calls after a reconnect", async () => {
    await updateSettings({
      agentsEnabled: true,
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      mcpServers: [{
        id: "mockserver",
        name: "Mock MCP",
        command: process.execPath,
        args: mockMcpScriptPath,
        env: "",
        enabled: true,
        timeoutMs: 5000
      }, {
        id: "broken-mcp",
        name: "Broken MCP",
        command: "bad-command",
        args: "",
        env: "",
        enabled: true,
        timeoutMs: 5000
      }]
    });

    const thread = await postJson("/api/agents/threads", {
      title: "Recovered MCP Workspace"
    });

    const runResponse = await requestJson(`/api/agents/threads/${thread.id}/respond`, {
      method: "POST",
      body: { content: "retrying-tool-agent-task" }
    });
    expect(runResponse.ok).toBe(true);
    const runBody = await runResponse.text();
    expect(runBody).toContain("Recovered after reconnecting MCP server");
    expect(runBody).toContain("\"type\":\"warning\"");

    const finalState = await parseJsonResponse(
      `/api/agents/threads/${thread.id}/state`,
      await fetch(`${baseUrl}/api/agents/threads/${thread.id}/state`)
    );
    expect(finalState.events.some((event: { type: string; title: string; content: string }) => (
      event.type === "warning"
      && event.title === "MCP partially available"
      && String(event.content || "").includes("Broken MCP")
    ))).toBe(true);
    expect(finalState.events.some((event: { type: string; content: string }) => (
      event.type === "tool_result" && String(event.content || "").includes("Recovered after reconnecting MCP server Mock MCP")
    ))).toBe(true);
    expect(finalState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "I recovered from the MCP disconnect and still got the context."
    });
  });

  it("exports DOCX bundles and supports writer character generation and editing", async () => {
    await updateSettings({
      activeProviderId: "mock-openai",
      activeModel: "mock-model"
    });

    const character = await postJson("/api/writer/characters/generate", {
      description: "A detective with sharp instincts"
    });
    expect(character.name).toBe("Mock Character");
    expect(character.personality).toBe("Calm and observant");

    const edited = await postJson(`/api/writer/characters/${character.id}/edit`, {
      instruction: "Make the character more intense.",
      fields: ["personality"]
    });
    expect(edited.changedFields).toContain("personality");
    expect(edited.character.personality).toBe("Updated personality from patch.");

    const project = await postJson("/api/writer/projects", {
      name: "Docx Novel",
      description: "Docx export project"
    });
    const chapter = await postJson("/api/writer/chapters", {
      projectId: project.id,
      title: "Docx Chapter"
    });
    await postJson(`/api/writer/chapters/${chapter.id}/generate-draft`, {
      prompt: "Write the document body"
    });

    const docxResponse = await fetch(`${baseUrl}/api/writer/projects/${project.id}/export/docx/download`, {
      method: "POST"
    });
    expect(docxResponse.ok).toBe(true);
    expect(docxResponse.headers.get("content-type")).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(docxResponse.headers.get("content-disposition")).toContain(".docx");
    const docxBuffer = Buffer.from(await docxResponse.arrayBuffer());
    expect(docxBuffer.length).toBeGreaterThan(100);
  });

  it("routes provider preview test and models requests to the preview handlers instead of :id routes", async () => {
    const previewPayload = {
      baseUrl: `${mockProviderBaseUrl}/v1`,
      apiKey: "test-key",
      fullLocalOnly: false,
      providerType: "openai",
      adapterId: null,
      manualModels: []
    };

    const previewModels = await postJson("/api/providers/preview/models", previewPayload);
    expect(previewModels).toEqual([
      { id: "mock-model" },
      { id: "mock-secondary-model" }
    ]);

    const previewTest = await postJson("/api/providers/preview/test", previewPayload);
    expect(previewTest).toEqual({ ok: true });

    const blockedPreviewTest = await postJson("/api/providers/preview/test", {
      ...previewPayload,
      baseUrl: "https://example.com/v1",
      fullLocalOnly: true
    });
    expect(blockedPreviewTest).toEqual({
      ok: false,
      error: "Provider is set to Local-only. Disable Local-only for external URLs."
    });
  });

  it("streams tool-calling turns through an MCP server and persists tool traces", async () => {
    await updateSettings({
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      toolCallingEnabled: true,
      toolCallingPolicy: "aggressive",
      maxToolCallsPerTurn: 2,
      mcpServers: [{
        id: "mockserver",
        name: "Mock MCP",
        command: process.execPath,
        args: mockMcpScriptPath,
        env: "",
        enabled: true,
        timeoutMs: 5000
      }]
    });

    const created = await postJson("/api/chats", { title: "Tool Chat" });
    const sendResponse = await requestJson(`/api/chats/${created.id}/send`, {
      method: "POST",
      body: { content: "Use a tool for this answer." }
    });
    expect(sendResponse.ok).toBe(true);
    expect(sendResponse.headers.get("content-type")).toContain("text/event-stream");
    const sendBody = await sendResponse.text();
    expect(sendBody).toContain("\"type\":\"tool\"");
    expect(sendBody).toContain("\"phase\":\"start\"");
    expect(sendBody).toContain("\"phase\":\"done\"");
    expect(sendBody).toContain("FINAL TOOL ANSWER");
    expect(sendBody).toContain("\"type\":\"done\"");

    const timeline = await parseJsonResponse(
      `/api/chats/${created.id}/timeline`,
      await fetch(`${baseUrl}/api/chats/${created.id}/timeline`)
    );
    expect(timeline).toHaveLength(3);
    expect(timeline[1]).toMatchObject({
      role: "assistant",
      content: "FINAL TOOL ANSWER"
    });
    expect(timeline[2]).toMatchObject({
      role: "tool"
    });
    expect(String(timeline[2]?.content || "")).toContain("\"kind\":\"tool_call\"");
    expect(String(timeline[2]?.content || "")).toContain("mcp_mockserver__lookup");
    expect(String(timeline[2]?.content || "")).toContain("Tool result for: latest context");
  });

  it("keeps the first tool-enabled assistant answer in pure chat when the model does not emit tool_calls", async () => {
    await updateSettings({
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      toolCallingEnabled: true,
      toolCallingPolicy: "aggressive",
      maxToolCallsPerTurn: 2,
      mcpServers: [{
        id: "mockserver",
        name: "Mock MCP",
        command: process.execPath,
        args: mockMcpScriptPath,
        env: "",
        enabled: true,
        timeoutMs: 5000
      }]
    });

    const created = await postJson("/api/chats", { title: "Pure Chat Tool Fallback" });
    await postJson("/api/rp/scene-state", {
      chatId: created.id,
      chatMode: "pure_chat",
      pureChatMode: true,
      mood: "neutral",
      pacing: "balanced",
      intensity: 0.5,
      variables: {}
    });

    const sendResponse = await requestJson(`/api/chats/${created.id}/send`, {
      method: "POST",
      body: { content: "no-tool-first-pass" }
    });
    expect(sendResponse.ok).toBe(true);
    const sendBody = await sendResponse.text();
    expect(sendBody).toContain("TOOLS WERE VISIBLE ON FIRST PASS");
    expect(sendBody).not.toContain("MOCK STREAM RESPONSE");

    const timeline = await parseJsonResponse(
      `/api/chats/${created.id}/timeline`,
      await fetch(`${baseUrl}/api/chats/${created.id}/timeline`)
    );
    expect(timeline[1]).toMatchObject({
      role: "assistant",
      content: "TOOLS WERE VISIBLE ON FIRST PASS"
    });
  });

  it("parses tagged tool requests from plain assistant text and still executes the MCP tool", async () => {
    await updateSettings({
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      toolCallingEnabled: true,
      toolCallingPolicy: "aggressive",
      maxToolCallsPerTurn: 2,
      mcpServers: [{
        id: "mockserver",
        name: "Mock MCP",
        command: process.execPath,
        args: mockMcpScriptPath,
        env: "",
        enabled: true,
        timeoutMs: 5000
      }]
    });

    const created = await postJson("/api/chats", { title: "Tagged Tool Chat" });
    const sendResponse = await requestJson(`/api/chats/${created.id}/send`, {
      method: "POST",
      body: { content: "tagged-tool-request" }
    });
    expect(sendResponse.ok).toBe(true);
    const sendBody = await sendResponse.text();
    expect(sendBody).toContain("\"type\":\"tool\"");
    expect(sendBody).toContain("FINAL TOOL ANSWER");

    const timeline = await parseJsonResponse(
      `/api/chats/${created.id}/timeline`,
      await fetch(`${baseUrl}/api/chats/${created.id}/timeline`)
    );
    expect(String(timeline[2]?.content || "")).toContain("mcp_mockserver__lookup");
    expect(String(timeline[2]?.content || "")).toContain("Tool result for: latest context");
  });

  it("parses fenced json tool requests from plain assistant text and still executes the MCP tool", async () => {
    await updateSettings({
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      toolCallingEnabled: true,
      toolCallingPolicy: "aggressive",
      maxToolCallsPerTurn: 2,
      mcpServers: [{
        id: "mockserver",
        name: "Mock MCP",
        command: process.execPath,
        args: mockMcpScriptPath,
        env: "",
        enabled: true,
        timeoutMs: 5000
      }]
    });

    const created = await postJson("/api/chats", { title: "Fenced Tool Chat" });
    const sendResponse = await requestJson(`/api/chats/${created.id}/send`, {
      method: "POST",
      body: { content: "fenced-tool-request" }
    });
    expect(sendResponse.ok).toBe(true);
    const sendBody = await sendResponse.text();
    expect(sendBody).toContain("\"type\":\"tool\"");
    expect(sendBody).toContain("FINAL TOOL ANSWER");

    const timeline = await parseJsonResponse(
      `/api/chats/${created.id}/timeline`,
      await fetch(`${baseUrl}/api/chats/${created.id}/timeline`)
    );
    expect(String(timeline[1]?.content || "")).not.toContain("```json");
    expect(String(timeline[2]?.content || "")).toContain("mcp_mockserver__lookup");
    expect(String(timeline[2]?.content || "")).toContain("Tool result for: latest context");
  });

  it("aborts slow provider streams before they persist assistant output", async () => {
    await updateSettings({
      activeProviderId: "mock-openai",
      activeModel: "mock-model",
      toolCallingEnabled: false,
      mcpServers: []
    });

    const created = await postJson("/api/chats", { title: "Abort Chat" });
    const sendResponsePromise = requestJson(`/api/chats/${created.id}/send`, {
      method: "POST",
      body: { content: "Abort this stream before output" }
    });

    await sleep(40);
    const abortResult = await postJson(`/api/chats/${created.id}/abort`, {});
    expect(abortResult).toMatchObject({ ok: true, interrupted: true });

    const sendResponse = await sendResponsePromise;
    expect(sendResponse.ok).toBe(true);
    const sendBody = await sendResponse.text();
    expect(sendBody).toContain("\"interrupted\":true");

    const timeline = await parseJsonResponse(
      `/api/chats/${created.id}/timeline`,
      await fetch(`${baseUrl}/api/chats/${created.id}/timeline`)
    );
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      role: "user",
      content: "Abort this stream before output"
    });
  });

  it("round-trips DOCX export back into a new imported writer project", async () => {
    await updateSettings({
      activeProviderId: "mock-openai",
      activeModel: "mock-model"
    });

    const sourceProject = await postJson("/api/writer/projects", {
      name: "Roundtrip Novel",
      description: "Source for DOCX import"
    });
    const firstChapter = await postJson("/api/writer/chapters", {
      projectId: sourceProject.id,
      title: "Opening"
    });
    const secondChapter = await postJson("/api/writer/chapters", {
      projectId: sourceProject.id,
      title: "Ending"
    });

    db.prepare(
      "INSERT INTO writer_scenes (id, chapter_id, title, content, goals, conflicts, outcomes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(newId(), firstChapter.id, "Opening Scene", "Roundtrip scene one content.", "", "", "", new Date().toISOString());
    db.prepare(
      "INSERT INTO writer_scenes (id, chapter_id, title, content, goals, conflicts, outcomes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(newId(), secondChapter.id, "Ending Scene", "Roundtrip scene two content.", "", "", "", new Date().toISOString());

    const exportResponse = await fetch(`${baseUrl}/api/writer/projects/${sourceProject.id}/export/docx/download`, {
      method: "POST"
    });
    expect(exportResponse.ok).toBe(true);
    const exportBuffer = Buffer.from(await exportResponse.arrayBuffer());
    expect(exportBuffer.length).toBeGreaterThan(100);

    const imported = await postJson("/api/writer/import/docx-book", {
      base64Data: exportBuffer.toString("base64"),
      filename: "roundtrip.docx",
      parseMode: "auto"
    });
    expect(imported.ok).toBe(true);
    expect(imported.chaptersCreated).toBeGreaterThanOrEqual(2);
    expect(imported.project.name).toBe("roundtrip");

    const importedProject = await parseJsonResponse(
      `/api/writer/projects/${imported.project.id}`,
      await fetch(`${baseUrl}/api/writer/projects/${imported.project.id}`)
    );
    expect(importedProject.project.name).toBe("roundtrip");
    expect(importedProject.chapters).toHaveLength(imported.chaptersCreated);
    expect(importedProject.chapters.map((chapter: { title: string }) => chapter.title)).toEqual(
      expect.arrayContaining(["Opening Scene", "Ending Scene"])
    );
    expect(importedProject.scenes.some((scene: { content: string }) => scene.content.includes("Roundtrip scene one content."))).toBe(true);
    expect(importedProject.scenes.some((scene: { content: string }) => scene.content.includes("Roundtrip scene two content."))).toBe(true);
  });

  async function postJson(path: string, body: unknown) {
    return parseJsonResponse(path, await requestJson(path, { method: "POST", body }));
  }

  async function requestJson(path: string, init: JsonRequestInit = {}) {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
  }

  async function updateSettings(patch: Record<string, unknown>) {
    const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string };
    const current = JSON.parse(row.payload) as Record<string, unknown>;
    const next = {
      ...current,
      ...patch,
      samplerConfig: {
        ...(current.samplerConfig as Record<string, unknown> | undefined),
        ...((patch.samplerConfig as Record<string, unknown> | undefined) ?? {})
      },
      promptTemplates: {
        ...(current.promptTemplates as Record<string, unknown> | undefined),
        ...((patch.promptTemplates as Record<string, unknown> | undefined) ?? {})
      }
    };
    db.prepare("UPDATE settings SET payload = ? WHERE id = 1").run(JSON.stringify(next));
  }
});

async function parseJsonResponse(path: string, response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${path} (${response.status}), got: ${text.slice(0, 200)}`);
  }
}

async function readJsonBody(req: AsyncIterable<Buffer | string>) {
  let raw = "";
  for await (const chunk of req) {
    raw += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
  }
  return raw.trim() ? JSON.parse(raw) as Record<string, unknown> : {};
}

function toBaseUrl(server: HttpServer) {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function listen(app: Express) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", (error) => reject(error));
  });
  return server;
}

async function closeServer(server: HttpServer | undefined) {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
