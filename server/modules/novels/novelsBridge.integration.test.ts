import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_NOVEL_CONFIG, type NovelStory } from "../../../src/shared/types/novels.js";

type Message = { role: string; content: string };
// All names and story text in this suite are synthetic. The Vitest setup isolates the DB.
describe.sequential("novel integration with personas, chats, knowledge and Writer", () => {
  let server: Server, mock: Server, base: string;
  const bodies: Array<{ messages: Message[] }> = [];
  let reply = "## Test hall\nSynthetic narration line for the hall.";
  const listen = async (s: Server) => { await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${(s.address() as AddressInfo).port}`; };
  const req = (path: string, body?: unknown, method = "POST") => fetch(base + "/api" + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (path: string, body?: unknown, method = "POST") => { const r = await req(path, body, method); if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`); return r.json(); };
  const importCharacter = (name: string, scenario = "") => json("/characters/import", { rawJson: JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: { name, first_mes: `${name} greets you.`, scenario, description: `${name} is a synthetic test character.` } }) });
  const LITE = { ...DEFAULT_NOVEL_CONFIG, generationMode: "lite" as const, providerId: "bridge-mock", modelId: "test", questionFrequency: "off" as const };

  beforeAll(async () => {
    const { createApp } = await import("../../app/createApp.js"); server = createServer(createApp()); base = await listen(server);
    mock = createServer(async (request, response) => {
      let raw = ""; for await (const part of request) raw += part;
      if (request.url !== "/v1/chat/completions") { response.statusCode = 404; response.end("{}"); return; }
      bodies.push(JSON.parse(raw));
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
    });
    const endpoint = await listen(mock);
    await json("/providers", { id: "bridge-mock", name: "Bridge mock", baseUrl: endpoint + "/v1", apiKey: "test-key", providerType: "openai" });
    await json("/settings", { activeProviderId: "bridge-mock", activeModel: "test" }, "PATCH");
  });
  afterAll(async () => { await Promise.all([server, mock].filter(Boolean).map((s) => new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()); }))); });

  it("uses a persona snapshot as the protagonist and keeps it after library edits", async () => {
    const persona = await json("/personas", { name: "Ilya Test", description: "A synthetic courier with a scarred hand.", personality: "Dry humour." });
    const card = await importCharacter("Source Keeper", "{{user}} arrives at the synthetic archive.");
    let story = await json("/novels", { title: "Persona story", config: { ...LITE, premise: "Synthetic archive", personaId: persona.id, protagonist: "Ignored manual hero", settingCardIds: [card.id] } }) as NovelStory;
    expect(story.persona).toMatchObject({ id: persona.id, name: "Ilya Test" });
    await json(`/personas/${persona.id}`, { name: "Renamed Persona", description: "", personality: "" }, "PUT");
    story = await json(`/novels/${story.id}/generate`, { revision: story.revision, action: "" });
    const system = bodies.at(-1)!.messages[0].content;
    expect(system).toContain("Protagonist: Ilya Test. A synthetic courier with a scarred hand.. Personality: Dry humour.");
    expect(system).toContain("Ilya Test arrives at the synthetic archive.");
    expect(system).not.toContain("Ignored manual hero");
    expect(system).not.toContain("Renamed Persona");
    // Switching back to the manual field drops the snapshot.
    story = await json(`/novels/${story.id}`, { revision: story.revision, config: { personaId: "" } }, "PATCH");
    expect(story.persona).toBeUndefined();
    expect((await req(`/novels/${story.id}`, { revision: story.revision, config: { personaId: "missing-persona" } }, "PATCH")).status).toBe(400);
    expect((await req("/novels", { config: { ...LITE, premise: "x", personaId: "missing-persona" } })).status).toBe(400);
  });

  it("starts a novel from a chat branch without changing the chat", async () => {
    const { db, newId } = await import("../../db.js");
    const first = await importCharacter("Chat Lead", "A synthetic harbour mystery.");
    const second = await importCharacter("Chat Partner");
    const chat = await json("/chats", { title: "Harbour chat", characterIds: [second.id, first.id] });
    const branch = (db.prepare("SELECT id FROM branches WHERE chat_id = ?").get(chat.id) as { id: string }).id;
    const add = (role: string, content: string, sort: number, deleted = 0, branchId = branch) => db.prepare("INSERT INTO messages (id, chat_id, branch_id, role, content, token_count, deleted, created_at, sort_order, character_name) VALUES (?, ?, ?, ?, ?, 5, ?, ?, ?, ?)")
      .run(newId(), chat.id, branchId, role, content, deleted, new Date(Date.UTC(2026, 0, 1, 0, 0, sort)).toISOString(), sort, role === "assistant" ? "Chat Partner" : "");
    add("user", "Where is the synthetic key?", 3);
    add("assistant", "<think>plan the reply</think>The lantern swings.\n\nChat Partner points at the pier.", 4);
    add("user", "This message was deleted.", 5, 1);
    add("assistant", "A branch that is not active.", 6, 0, "other-branch");
    add("user", "I follow.", 2.5 as unknown as number);
    const before = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?").get(chat.id);
    const story = await json("/novels/from-chat", { chatId: chat.id }) as NovelStory;
    expect(story.config).toMatchObject({ generationMode: "lite", providerId: "bridge-mock", modelId: "test", characterIds: [second.id, first.id] });
    expect(story.config.premise).toBe("A synthetic harbour mystery.");
    expect(story.cast.map((c) => c.name)).toEqual(["Chat Partner", "Chat Lead"]);
    const lines = story.scenes.flatMap((scene) => scene.lines);
    expect(lines.map((line) => line.text)).toEqual(["Chat Partner greets you.", "I follow.", "Where is the synthetic key?", "The lantern swings.", "Chat Partner points at the pier."]);
    expect(lines.filter((line) => line.speaker).map((line) => line.speaker)).toEqual(["You", "You"]);
    expect(story.turns).toHaveLength(1);
    expect(story.turns[0].throughSceneId).toBe(story.scenes.at(-1)!.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?").get(chat.id)).toEqual(before);
    // The imported prose is replayed as the first exchange of the cached history.
    reply = "Synthetic continuation line.";
    await json(`/novels/${story.id}/generate`, { revision: story.revision, action: "Look closer" });
    expect(bodies.at(-1)!.messages[2].content).toContain("Chat Partner points at the pier.");
    expect((await req("/novels/from-chat", { chatId: "missing" })).status).toBe(404);
    expect((await req("/novels/from-chat", { chatId: chat.id, branchId: "missing" })).status).toBe(404);
  });

  it("continues a novel as an ordinary chat with the same cast", async () => {
    const lead = await importCharacter("Novel Lead");
    reply = "## Test pier\nFog drifts over the synthetic pier.\nNovel Lead: We should go.";
    let story = await json("/novels", { title: "Pier novel", config: { ...LITE, premise: "Synthetic pier", characterIds: [lead.id] } }) as NovelStory;
    story = await json(`/novels/${story.id}/generate`, { revision: story.revision, action: "" });
    const created = await json(`/novels/${story.id}/to-chat`);
    expect(created.title).toBe("Pier novel");
    const chats = await json("/chats", undefined, "GET") as Array<{ id: string; characterIds?: string[] }>;
    const chat = chats.find((item) => item.id === created.chatId)!;
    expect(chat.characterIds).toEqual([lead.id]);
    const timeline = await json(`/chats/${created.chatId}/timeline`, undefined, "GET") as Array<{ role: string; content: string }>;
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ role: "assistant" });
    expect(timeline[0].content).toBe("Test pier\n\nFog drifts over the synthetic pier.\n\nNovel Lead: We should go.");
    expect((await json(`/novels/${story.id}`, undefined, "GET")).revision).toBe(story.revision);
  });

  it("passes no reference notes when knowledge is off or the collection is gone", async () => {
    reply = "Synthetic line.";
    let story = await json("/novels", { title: "Knowledge", config: { ...LITE, premise: "Synthetic", ragEnabled: true, ragCollectionIds: ["missing-collection"] } }) as NovelStory;
    expect(story.config).toMatchObject({ ragEnabled: true, ragCollectionIds: ["missing-collection"] });
    story = await json(`/novels/${story.id}/generate`, { revision: story.revision, action: "Search" });
    expect(bodies.at(-1)!.messages.at(-1)!.content).not.toContain("Reference notes");
    const { liteTurnMessage } = await import("./litePrompt.js");
    expect(liteTurnMessage(story, "Look", { reference: "The synthetic key opens the archive." })).toMatch(/^\[Reference notes, use if relevant: The synthetic key opens the archive\.\]\n\nLook/);
  });

  it("exports the prose to a new Writer project in story order", async () => {
    reply = Array.from({ length: 7 }, (_, i) => `## Synthetic place ${i}\nNarration for place ${i}.\nNovel Speaker: Line ${i}.`).join("\n");
    let story = await json("/novels", { title: "Export novel", config: { ...LITE, premise: "Synthetic export premise" } }) as NovelStory;
    expect((await req(`/novels/${story.id}/export-writer`)).status).toBe(400);
    story = await json(`/novels/${story.id}/generate`, { revision: story.revision, action: "" });
    expect(story.scenes).toHaveLength(7);
    const exported = await json(`/novels/${story.id}/export-writer`);
    expect(exported).toMatchObject({ name: "Export novel", chapters: 2, scenes: 7 });
    const project = await json(`/writer/projects/${exported.projectId}`, undefined, "GET");
    const chapters = project.chapters as Array<{ id: string; title: string }>;
    expect(chapters.map((c) => c.title)).toEqual(["Synthetic place 0", "Synthetic place 5"]);
    const scenes = project.scenes as Array<{ chapterId: string; title: string; content: string }>;
    expect(scenes.map((s) => s.title)).toEqual(Array.from({ length: 7 }, (_, i) => `Synthetic place ${i}`));
    expect(scenes[0].content).toBe("Narration for place 0.\n\nNovel Speaker: Line 0.");
    expect(scenes.filter((s) => s.chapterId === chapters[1].id)).toHaveLength(2);
    expect(project.project.notes.premise).toBe("Synthetic export premise");
  });
});
