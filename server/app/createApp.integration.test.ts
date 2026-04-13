import { mkdtempSync, rmSync, writeFileSync } from "fs";
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
  let createApp: typeof import("./createApp.js").createApp;
  let db: typeof import("../db.js").db;
  let newId: typeof import("../db.js").newId;

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
const HEADER_DELIMITER = Buffer.from("\\r\\n\\r\\n");
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

        if (toolDefinitions.length > 0 && body.stream !== true && toolMessages.length === 0) {
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
          res.setHeader("Content-Type", "text/event-stream");
          if (toolMessages.length > 0) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "FINAL TOOL ANSWER" } }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "MOCK " } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "STREAM RESPONSE" } }] })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        const content = promptText.includes("Required JSON keys:")
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
