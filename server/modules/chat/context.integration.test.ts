import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatContextBudget, ChatContextPreview } from "../../../src/shared/types/chatContext.js";

describe.sequential("chat context and telemetry integration", () => {
  let folder: string, base: string, providerUrl: string;
  let appServer: Server, providerServer: Server;
  let db: typeof import("../../db.js").db;
  let lastBody: Record<string, any> = {};
  let rejectUsage = false;
  let requestCount = 0;
  const listen = async (server: Server) => {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  const request = (path: string, body?: unknown, method = "POST") => fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (path: string, body?: unknown, method = "POST") => {
    const response = await request(path, body, method);
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    return response.json();
  };
  const preview = (chatId: string, body: unknown = {}) => json(`/api/chats/${chatId}/context/preview`, body) as Promise<ChatContextPreview>;
  const settings = async (patch: unknown) => {
    const current = await json("/api/settings", undefined, "GET");
    await json("/api/settings", { ...current, ...patch as object }, "PATCH");
  };
  const send = async (chatId: string, content: string, extra = {}) => {
    const response = await request(`/api/chats/${chatId}/send`, { content, ...extra });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"type":"done"');
    return json(`/api/chats/${chatId}/timeline`, undefined, "GET");
  };

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), "vellium-context-test-"));
    process.env.SLV_DATA_DIR = folder;
    process.env.ELECTRON_SERVE_STATIC = "0";
    vi.resetModules();
    const module = await import("../../app/createApp.js");
    db = (await import("../../db.js")).db;
    appServer = createServer(module.createApp());
    base = await listen(appServer);
    providerServer = createServer(async (req, res) => {
      let text = ""; for await (const chunk of req) text += chunk;
      const body = text ? JSON.parse(text) : {};
      if (req.url === "/apply-template") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ prompt: "FORMATTED MODEL PROMPT" })); return; }
      if (req.url === "/tokenize") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ tokens: Array.from({ length: 77 }, (_, i) => i) })); return; }
      lastBody = body; requestCount++;
      if (rejectUsage && body.stream_options) { res.writeHead(400); res.end(JSON.stringify({ error: "Unsupported stream_options" })); return; }
      if (!body.stream && JSON.stringify(body.messages || []).includes("Reply suggestions task")) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: "<think>plan</think>[\"Ask about the map\", \"Draw the sword\", \"ask about the map\"]" } }] }));
        return;
      }
      if (!body.stream) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: "Summary from mock" } }] })); return; }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Mock " } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "answer." } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 412, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 12 }, prompt_tokens_details: { cached_tokens: 100 } }, timings: { predicted_n: 40, predicted_ms: 2000 } })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
    providerUrl = await listen(providerServer);
    await json("/api/providers", { id: "context-mock", name: "Context mock", baseUrl: providerUrl + "/v1", apiKey: "", providerType: "openai" });
    await settings({ activeProviderId: "context-mock", activeModel: "mock-model", toolCallingEnabled: false, rpReasoningEnabled: false, contextWindowSize: 8192, contextMaxMessages: 0 });
  });
  afterAll(async () => {
    await Promise.all([appServer, providerServer].filter(Boolean).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
    db?.close(); rmSync(folder, { recursive: true, force: true });
  });

  it("persists terminal provider usage and decode speed, not character counts/wall duration", async () => {
    const chat = await json("/api/chats", { title: "Telemetry" });
    const timeline = await send(chat.id, "Hello");
    expect(lastBody.stream_options).toEqual({ include_usage: true });
    expect(timeline[1].generationStats).toMatchObject({ inputTokens: 412, outputTokens: 40, reasoningTokens: 12, cachedTokens: 100, tokenSource: "provider", tokensPerSecond: 20, speedSource: "provider" });
    const context = await preview(chat.id);
    expect(context.lastGeneration?.inputTokens).toBe(412);
    await json(`/api/messages/${timeline[1].id}`, { content: "Edited answer" }, "PATCH");
    const edited = await json(`/api/chats/${chat.id}/timeline`, undefined, "GET");
    expect(edited[1].generationStats).toBeUndefined();
    expect(edited[1].generationDurationMs).toBeUndefined();
    expect(edited[1].tokenCountSource).toBe("estimate");
  });

  it("matches the generated request including persona, attachments and one leading system", async () => {
    const chat = await json("/api/chats", { title: "Preview parity" });
    await send(chat.id, "Past turn");
    const extra = { userPersona: { name: "Mira", description: "A curious explorer" }, attachments: [{ id: "file", filename: "notes.txt", type: "text", content: "A key inside the oak tree" }] };
    const context = await preview(chat.id, { draft: "Find the key", ...extra });
    const before = db.prepare("SELECT count(*) AS n FROM messages WHERE chat_id = ?").get(chat.id);
    expect(context.sections.map(section => section.source)).toEqual(expect.arrayContaining(["persona", "attachments", "history", "instructions", "formatting"]));
    expect(context.inputTokens).toBe(context.sections.reduce((sum, section) => sum + section.tokens, 0));
    await send(chat.id, "Find the key", extra);
    expect(lastBody.messages).toEqual(context.messages);
    expect(lastBody.messages.filter((message: any) => message.role === "system")).toHaveLength(1);
    expect(lastBody.messages[0].role).toBe("system");
    expect(before).toEqual({ n: 2 });
  });

  it("keeps exclusions/summary/limits scoped to a branch and applies them to generation", async () => {
    const chat = await json("/api/chats", { title: "Scoped controls" });
    let timeline = await send(chat.id, "Keep this fact");
    timeline = await send(chat.id, "Exclude this fact");
    const root = timeline[0].branchId;
    const fork = await json(`/api/chats/${chat.id}/fork`, { parentMessageId: timeline[3].id, name: "Alternative" });
    await json(`/api/chats/${chat.id}/context`, { branchId: root, config: { excludedMessageIds: [timeline[2].id], summary: "Only branch A knows this", maxMessages: 3, maxOutputTokens: 256, contextWindowSize: 4096, includeReasoning: false } }, "PATCH");
    const context = await preview(chat.id, { branchId: root, draft: "Continue" });
    expect(context.reservedOutputTokens).toBe(256);
    expect(context.history.find(row => row.id === timeline[2].id)).toMatchObject({ included: false, reason: "manual" });
    expect(JSON.stringify(context.messages)).not.toContain("Exclude this fact");
    expect(JSON.stringify(context.messages)).toContain("Only branch A knows this");
    const other = await preview(chat.id, { branchId: fork.id });
    expect(other.effective.summary).not.toContain("Only branch A");
    expect(other.config.maxMessages).toBeUndefined();
    await send(chat.id, "Continue", { branchId: root });
    expect(lastBody.messages).toEqual(context.messages);
    expect(lastBody.max_tokens).toBe(256);
    const stored = await json(`/api/chats/${chat.id}/timeline`, undefined, "GET");
    expect(stored.some((row: any) => row.content === "Exclude this fact")).toBe(true);
    const fullFork = await json(`/api/chats/${chat.id}/fork`, { parentMessageId: stored.at(-1).id, name: "Full context copy" });
    const fullCopy = await preview(chat.id, { branchId: fullFork.id });
    expect(fullCopy.effective.summary).toBe("Only branch A knows this");
    expect(fullCopy.config.maxMessages).toBe(3);
    expect(fullCopy.config.excludedMessageIds).toHaveLength(1);
    expect(fullCopy.config.excludedMessageIds).not.toContain(timeline[2].id);
    expect(fullCopy.history.find(row => row.id === fullCopy.config.excludedMessageIds?.[0])?.included).toBe(false);
    expect(fullCopy.lastGeneration?.outputTokens).toBe(40);
    const pastFork = await json(`/api/chats/${chat.id}/fork`, { parentMessageId: timeline[1].id, name: "Earlier context" });
    expect((await preview(chat.id, { branchId: pastFork.id })).effective.summary).toBe("");
    const invalid = await request(`/api/chats/${chat.id}/context`, { branchId: root, config: { excludedMessageIds: [other.history[0].id] } }, "PATCH");
    expect(invalid.status).toBe(400);
    await json(`/api/chats/${chat.id}/context`, { branchId: root, reset: true }, "PATCH");
    expect((await preview(chat.id, { branchId: root })).config).toEqual({});
  });

  it("trims history against instructions plus reply reserve and honors large windows", async () => {
    const chat = await json("/api/chats", { title: "Budget" });
    await send(chat.id, "old fact ".repeat(180));
    const timeline = await send(chat.id, "recent fact");
    await json(`/api/chats/${chat.id}/context`, { config: { contextWindowSize: 1024, maxOutputTokens: 64 } }, "PATCH");
    const context = await preview(chat.id, { draft: "Next turn" });
    expect(context.inputTokens + context.reservedOutputTokens).toBeLessThanOrEqual(1024);
    expect(context.history.find(row => row.id === timeline[0].id)?.included).toBe(false);
    await json(`/api/chats/${chat.id}/context`, { config: { contextWindowSize: 512 } }, "PATCH");
    expect((await preview(chat.id, { draft: "Next turn" })).overBudget).toBe(true);
    const calls = requestCount;
    const rejected = await request(`/api/chats/${chat.id}/send`, { content: "Next turn" });
    expect(rejected.status).toBe(400);
    expect(requestCount).toBe(calls);
    await json(`/api/chats/${chat.id}/context`, { config: { contextWindowSize: 131072 } }, "PATCH");
    expect((await preview(chat.id)).effective.contextWindowSize).toBe(131072);
  });

  it("uses the local model template/tokenizer for preview without generating a reply", async () => {
    const chat = await json("/api/chats", { title: "Local tokenizer" });
    db.prepare("UPDATE providers SET llama_cpp_management_enabled = 1 WHERE id = 'context-mock'").run();
    try {
      const requests = requestCount;
      const context = await preview(chat.id, { draft: "Preview only" });
      expect(context.countSource).toBe("tokenizer"); expect(context.inputTokens).toBe(77);
      expect(requestCount).toBe(requests);
      expect(db.prepare("SELECT count(*) AS n FROM messages WHERE chat_id = ?").get(chat.id)).toEqual({ n: 0 });
    } finally { db.prepare("UPDATE providers SET llama_cpp_management_enabled = 0 WHERE id = 'context-mock'").run(); }
  });

  it("serves a lightweight branch budget that matches the full preview", async () => {
    const chat = await json("/api/chats", { title: "Budget meter" });
    const full = await preview(chat.id);
    const requests = requestCount;
    const budget = await json(`/api/chats/${chat.id}/context/budget?branchId=${encodeURIComponent(full.branchId)}`, undefined, "GET") as ChatContextBudget;
    expect(budget).toEqual({ branchId: full.branchId, contextWindowSize: full.effective.contextWindowSize, reservedOutputTokens: full.reservedOutputTokens });
    expect(requestCount).toBe(requests);

    await json(`/api/chats/${chat.id}/context`, { branchId: full.branchId, config: { contextWindowSize: 4096, maxOutputTokens: 512 } }, "PATCH");
    const overridden = await json(`/api/chats/${chat.id}/context/budget?branchId=${encodeURIComponent(full.branchId)}`, undefined, "GET") as ChatContextBudget;
    expect(overridden).toMatchObject({ contextWindowSize: 4096, reservedOutputTokens: 512 });

    const other = await json("/api/chats", { title: "Budget other" });
    expect((await request(`/api/chats/${other.id}/context/budget?branchId=${encodeURIComponent(full.branchId)}`, undefined, "GET")).status).toBe(404);
    expect((await request(`/api/chats/${chat.id}/context/budget?branchId=a&branchId=b`, undefined, "GET")).status).toBe(400);
  });

  it("suggests user replies only when enabled and only after a character reply", async () => {
    const chat = await json("/api/chats", { title: "Suggestions" });
    const branchId = (await preview(chat.id)).branchId;
    expect((await request(`/api/chats/${chat.id}/reply-suggestions`, { branchId })).status).toBe(409);
    await settings({ replySuggestionsEnabled: true });
    try {
      expect(await json(`/api/chats/${chat.id}/reply-suggestions`, { branchId })).toEqual({ messageId: null, suggestions: [] });
      const timeline = await send(chat.id, "Hello there");
      const lastAssistant = [...timeline].reverse().find((message: { role: string }) => message.role === "assistant");
      const requests = requestCount;
      const result = await json(`/api/chats/${chat.id}/reply-suggestions`, { branchId, userName: "Reader" });
      expect(result).toEqual({ messageId: lastAssistant.id, suggestions: ["Ask about the map", "Draw the sword"] });
      expect(requestCount).toBe(requests + 1);
      expect(JSON.stringify(lastBody.messages)).toContain("Reader: Hello there");
      const other = await json("/api/chats", { title: "Other suggestions" });
      expect((await request(`/api/chats/${other.id}/reply-suggestions`, { branchId })).status).toBe(404);
    } finally {
      await settings({ replySuggestionsEnabled: false });
    }
  });

  it("retries only an explicit unsupported usage option and rejects foreign/missing branches", async () => {
    const chat = await json("/api/chats", { title: "Legacy provider" });
    rejectUsage = true;
    try { await send(chat.id, "Works on old servers"); expect(lastBody.stream_options).toBeUndefined(); }
    finally { rejectUsage = false; }
    const other = await json("/api/chats", { title: "Other" });
    const otherPreview = await preview(other.id);
    expect((await request(`/api/chats/${chat.id}/context/preview`, { branchId: otherPreview.branchId })).status).toBe(404);
    expect((await request("/api/chats/missing/context/preview", {})).status).toBe(404);
    expect((await request(`/api/chats/${chat.id}/context/preview`, { branchId: { id: "invalid" } })).status).toBe(400);
    expect((await request(`/api/chats/${chat.id}/context`, { branchId: 7 }, "PATCH")).status).toBe(400);
    expect((await request(`/api/chats/${chat.id}/context`, { config: { excludedMessageIds: "malformed" } }, "PATCH")).status).toBe(200);
  });
});
