import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_NOVEL_CONFIG, type NovelStory } from "../../../src/shared/types/novels.js";

type Message = { role: string; content: string };
type Body = { messages: Message[]; stream?: boolean; response_format?: { json_schema: { name: string; schema: Record<string, unknown> } }; max_tokens?: number };
type Reply = string | { status: number; error: string };

// All story text in this suite is synthetic. The Vitest setup isolates the DB.
describe.sequential("novel lite mode API", () => {
  let server: Server, mock: Server, base: string, endpoint: string;
  const bodies: Body[] = [];
  let replies: Reply[] = [];
  const listen = async (s: Server) => { await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${(s.address() as AddressInfo).port}`; };
  const req = (path: string, body?: unknown, method = "POST") => fetch(base + "/api" + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (path: string, body?: unknown, method = "POST") => { const r = await req(path, body, method); if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`); return r.json(); };
  const LITE = { ...DEFAULT_NOVEL_CONFIG, generationMode: "lite" as const, providerId: "lite-mock", modelId: "test", questionFrequency: "off" as const };
  const create = (config: Record<string, unknown> = {}) => json("/novels", { title: "Synthetic lite", config: { ...LITE, premise: "Synthetic harbour world", ...config } }) as Promise<NovelStory>;
  const generate = (story: NovelStory, action = "") => json(`/novels/${story.id}/generate`, { revision: story.revision, action }) as Promise<NovelStory>;
  const last = <T,>(list: T[], back = 1) => list[list.length - back];

  beforeAll(async () => {
    const { createApp } = await import("../../app/createApp.js"); server = createServer(createApp()); base = await listen(server);
    mock = createServer(async (request, response) => {
      let raw = ""; for await (const part of request) raw += part;
      if (request.url !== "/v1/chat/completions") { response.statusCode = 404; response.end("{}"); return; }
      const body = JSON.parse(raw) as Body; bodies.push(body);
      // Summaries are answered out of band so a test need not predict which turn compacts.
      const summary = String(body.messages.at(-1)?.content || "").includes("Summarise everything");
      const reply = summary ? "Earlier synthetic events: the tester explored several invented halls." : replies.shift() ?? "Synthetic filler line for an unexpected request.";
      if (typeof reply !== "string") { response.statusCode = reply.status; response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ error: reply.error })); return; }
      if (body.stream) {
        response.setHeader("Content-Type", "text/event-stream");
        // Split mid-line so the server must buffer partial lines.
        for (const piece of reply.match(/[\s\S]{1,7}/g) || []) response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 900, prompt_tokens_details: { cached_tokens: 800 } } })}\n\n`);
        response.end("data: [DONE]\n\n"); return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 900, prompt_tokens_details: { cached_tokens: 800 } } }));
    }); endpoint = await listen(mock);
    await json("/providers", { id: "lite-mock", name: "Lite mock", baseUrl: endpoint + "/v1", apiKey: "test-key", providerType: "openai" });
  });
  beforeEach(() => { replies = []; });
  afterAll(async () => { await Promise.all([server, mock].filter(Boolean).map((s) => new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()); }))); });

  const opening = "## Test harbour\nFog drifts over the invented pier.\nMira: Did you bring the synthetic key?\nThe lantern flickers above the water.";
  const second = "Mira takes the synthetic key and turns it slowly.\nMira: It is warmer than I expected.";
  const third = "## Test archive\nShelves of invented ledgers fill the quiet hall.\nMira: Start with the oldest one.";
  // Same story, but with Markdown around the speaker: not the canonical layout.
  const thirdStray = "## Test archive\nShelves of invented ledgers fill the quiet hall.\n**Mira:** Start with the oldest one.";

  it("writes plain text in one request without pictures or a scheduled choice", async () => {
    let story = await create(); const calls = bodies.length;
    replies = [opening];
    story = await generate(story);
    expect(bodies.length - calls).toBe(1);
    expect(last(bodies).response_format).toBeUndefined();
    expect(story.scenes).toHaveLength(1);
    expect(story.scenes[0]).toMatchObject({ location: "Test harbour", question: "", choices: [], illustrations: [] });
    expect(story.scenes[0].lines[1]).toEqual({ speaker: "Mira", text: "Did you bring the synthetic key?" });
    expect(story.turns[0].lite).toEqual({ user: last(bodies).messages.at(-1)!.content, assistant: opening });
    expect(story.cache).toMatchObject({ inputTokens: 900, cachedTokens: 800 });
  });

  it("extends the previous request byte for byte on every turn (INV-1)", async () => {
    let story = await create(); const start = bodies.length;
    replies = [opening, `  ${second}  `, thirdStray];
    story = await generate(story);
    story = await generate(story, "I hand over the key.");
    story = await generate(story, "We go to the archive.");
    const [a, b, c] = bodies.slice(start);
    expect(b.messages.slice(0, a.messages.length)).toEqual(a.messages);
    expect(b.messages[a.messages.length]).toEqual({ role: "assistant", content: opening });
    expect(c.messages.slice(0, b.messages.length)).toEqual(b.messages);
    expect(c.messages.at(-1)!.content).toContain("We go to the archive.");
    // Per-turn data never enters the cached system prefix (INV-3).
    expect(a.messages[0]).toEqual(c.messages[0]);
    expect(a.messages[0].content).not.toContain("Write about");
    // Surrounding whitespace keeps the exact bytes; a layout that strays is replayed canonically.
    expect(story.turns[1].lite!.assistant).toBe(`  ${second}  `);
    expect(story.turns[2].lite!.assistant).toBe(third);
    expect(story.scenes.map((scene) => scene.location)).toEqual(["Test harbour", "Test harbour", "Test archive"]);
  });

  it("plans pictures as a continuation of the same conversation (INV-2, INV-4)", async () => {
    let story = await create({ imagesEnabled: true, imagesPerScene: 2, structuredOutput: "json_schema", imagePov: "dynamic" });
    const start = bodies.length;
    replies = [opening, JSON.stringify({
      people: [{ name: "Mira", look: "young woman, round face, short silver hair, grey eyes, slim", clothes: "dark green raincoat" }],
      places: [{ name: "Test harbour", look: "wooden pier, wet planks, fog, one lantern" }],
      shots: [{ at: "Fog drifts over the invented", who: [], camera: "external", see: "Wide view of the empty pier." },
        { at: "Did you bring the synthetic", who: ["Mira"], camera: "over-shoulder", see: "Mira holds out her hand." }],
      outfits: [] })];
    story = await generate(story);
    const [text, director] = bodies.slice(start);
    expect(bodies.length - start).toBe(2);
    expect(director.response_format?.json_schema.name).toBe("novel_director");
    expect(director.messages.slice(0, text.messages.length)).toEqual(text.messages);
    expect(director.messages[text.messages.length]).toEqual({ role: "assistant", content: opening });
    expect(director.messages).toHaveLength(text.messages.length + 2);
    expect(director.messages.at(-1)!.content).toContain("Do not continue the story");
    const mira = story.memory.characters.find((c) => c.name === "Mira")!;
    expect(mira).toMatchObject({ appearance: expect.stringContaining("silver hair"), outfit: "dark green raincoat" });
    expect(story.scenes[0].illustrations.map((frame) => [frame.atLine, frame.characterIds, frame.camera])).toEqual([[0, [], "external"], [1, [mira.id], "over-shoulder"]]);
    expect(story.scenes[0].visuals?.setting).toContain("wooden pier");
    expect(story.scenes[0].illustrations.every((frame) => frame.seed > 0 && frame.status === "pending")).toBe(true);
    replies = [second, JSON.stringify({ people: [], places: [], shots: [{ at: "Mira takes the synthetic", who: ["Mira"], camera: "external", see: "Close view of the key." }], outfits: [] })];
    story = await generate(story, "I hand over the key.");
    const next = bodies[start + 2];
    expect(next.messages.slice(0, text.messages.length)).toEqual(text.messages);
    // After a follow-up the turn is replayed as finally drawn, so the narrator
    // sees the picture lines in use on the next turn (INV-4: no technical turn).
    expect(next.messages[text.messages.length]).toEqual({ role: "assistant", content: `## Test harbour
[place: wooden pier, wet planks, fog, one lantern]
[pic: none | Wide view of the empty pier.]
Fog drifts over the invented pier.
[new: Mira | young woman, round face, short silver hair, grey eyes, slim | dark green raincoat]
[pic: Mira | Mira holds out her hand.]
Mira: Did you bring the synthetic key?
The lantern flickers above the water.` });
    expect(story.turns[0].lite!.director).toEqual(["pictures"]);
    expect(JSON.stringify(next.messages)).not.toContain("Do not continue the story");
    expect(story.memory.characters.filter((c) => c.name === "Mira")).toHaveLength(1);
  });

  it("asks the director for a scheduled choice the text forgot, in line format without a schema", async () => {
    let story = await create({ questionFrequency: "frequent", structuredOutput: "off" }); const start = bodies.length;
    replies = [opening, "ASK | What do you do?\nOPTION | Give her the key\nOPTION | Keep it hidden"];
    story = await generate(story);
    expect(bodies.length - start).toBe(2);
    expect(bodies[start + 1].response_format).toBeUndefined();
    expect(bodies[start + 1].messages.at(-1)!.content).toContain("OPTION |");
    expect(story.scenes.at(-1)).toMatchObject({ question: "What do you do?", choices: ["Give her the key", "Keep it hidden"] });
  });

  it("uses a choice the text already wrote and skips the director", async () => {
    let story = await create({ questionFrequency: "frequent" }); const start = bodies.length;
    replies = [`${opening}\n? What now?\n> Answer her\n> Stay silent`];
    story = await generate(story);
    expect(bodies.length - start).toBe(1);
    expect(story.scenes.at(-1)!.choices).toEqual(["Answer her", "Stay silent"]);
  });

  it("keeps the turn when the director fails and still gives every scene a picture", async () => {
    let story = await create({ imagesEnabled: true, structuredOutput: "json_schema" });
    replies = [opening, { status: 400, error: "synthetic upstream failure" }];
    story = await generate(story);
    expect(story.scenes).toHaveLength(1);
    expect(story.turns).toHaveLength(1);
    expect(story.scenes[0].illustrations).toHaveLength(1);
    expect(story.scenes[0].illustrations[0]).toMatchObject({ atLine: 0, characterIds: [], status: "pending" });
  });

  it("turns a reply that ignores the format into narration and rejects an empty one", async () => {
    let story = await create();
    replies = ["Sure! Here is the story.\n\n{\"scenes\": [broken json"];
    story = await generate(story);
    expect(story.scenes[0].lines.every((line) => line.speaker === "")).toBe(true);
    replies = ["<think>only planning</think>"];
    const failed = await req(`/novels/${story.id}/generate`, { revision: story.revision, action: "" });
    expect(failed.status).toBe(400);
    expect(await failed.text()).toContain("story is unchanged");
    const saved = await json(`/novels/${story.id}`, undefined, "GET");
    expect(saved).toMatchObject({ revision: story.revision, scenes: story.scenes });
  });

  it("streams parsed scenes and saves them under the same IDs", async () => {
    const story = await create();
    replies = [`${opening}\n## Test archive\nShelves of invented ledgers fill the quiet hall.`];
    const response = await req(`/novels/${story.id}/generate-stream`, { revision: story.revision, action: "" });
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(last(bodies).stream).toBe(true);
    const previews = events.filter((event) => event.type === "preview");
    const done = events.at(-1);
    expect(done.type).toBe("done");
    expect(previews.length).toBeGreaterThan(2);
    expect(previews[0].scenes[0].lines.length).toBeLessThan(previews.at(-1).scenes[0].lines.length);
    const ids = previews.at(-1).scenes.map((scene: { id: string }) => scene.id);
    expect(previews.every((event) => event.scenes[0].id === ids[0])).toBe(true);
    // A last line without a newline is never previewed, so its scene first
    // appears on save; every previewed scene keeps its ID.
    expect(done.story.scenes.map((scene: { id: string }) => scene.id).slice(0, ids.length)).toEqual(ids);
    expect(done.story.scenes).toHaveLength(2);
  });

  it("reports a stream failure as an event and leaves the story unchanged", async () => {
    const story = await create();
    replies = ["   "];
    const events = (await (await req(`/novels/${story.id}/generate-stream`, { revision: story.revision, action: "" })).text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({ type: "error", error: expect.stringContaining("story is unchanged") });
    expect((await json(`/novels/${story.id}`, undefined, "GET")).revision).toBe(story.revision);
    expect((await req(`/novels/${story.id}/generate-stream`, { revision: 99, action: "" })).status).toBe(409);
  });

  it("summarises old turns as a continuation of the cached context", async () => {
    let story = await create({ contextChars: 8000 });
    const longReply = (n: number) => `## Test hall ${n}\n${Array.from({ length: 12 }, (_, i) => `Synthetic passage ${n}.${i} describes the invented hall in calm and careful detail.`).join("\n")}`;
    const start = bodies.length;
    for (let n = 0; n < 8 && !story.contextCheckpoint; n++) { replies = [longReply(n)]; story = await generate(story, `Synthetic action ${n}`); }
    const at = bodies.findIndex((body, i) => i >= start && String(body.messages.at(-1)?.content).includes("Summarise everything"));
    expect(at).toBeGreaterThan(start);
    const [previous, summary, text] = bodies.slice(at - 1, at + 2);
    expect(summary.response_format).toBeUndefined();
    expect(summary.messages.slice(0, -1)).toEqual(previous.messages.slice(0, summary.messages.length - 1));
    expect(summary.messages.length).toBeLessThan(previous.messages.length);
    expect(summary.messages[0].content).not.toContain("STORY SO FAR");
    expect(story.contextCheckpoint).toMatchObject({ text: expect.stringContaining("several invented halls"), passes: 1 });
    expect(text.messages[0].content).toContain("STORY SO FAR");
    expect(text.messages[0].content).toContain("several invented halls");
    expect(text.messages.length).toBeLessThan(previous.messages.length + 2);
  });

  const inlineReply = `## Test pier
[place: wooden pier, fog, one iron lantern]
[pic: none | Wide view of the empty pier at dawn.]
Fog drifts over the invented pier.
[new: Ren | tall young man, messy black hair | navy blazer]
Ren: You came after all.
[wear: Ren | white shirt, grey trousers]
Ren takes off his blazer and folds it over the railing.
[pic: Ren | Ren folds his blazer over the railing.]`;

  it("draws from picture lines in the story text with a single request", async () => {
    let story = await create({ imagesEnabled: true, inlinePictures: true, structuredOutput: "off" });
    const start = bodies.length;
    replies = [inlineReply];
    story = await generate(story);
    expect(bodies.length - start).toBe(1);
    expect(bodies[start].messages[0].content).toContain("Picture lines");
    expect(bodies[start].messages.at(-1)!.content).toContain("Start with a [pic: names | what is seen] line");
    expect(bodies[start].messages[0].content).toContain("[pic: Name | Name stands by the window, looking out.]");
    const scene = story.scenes[0];
    expect(scene.lines.map((l) => l.text)).toEqual(["Fog drifts over the invented pier.", "You came after all.", "Ren takes off his blazer and folds it over the railing."]);
    const ren = story.memory.characters.find((c) => c.name === "Ren")!;
    expect(ren).toMatchObject({ appearance: "tall young man, messy black hair", outfit: "navy blazer" });
    expect(scene.illustrations.map((f) => [f.atLine, f.characterIds, f.prompt])).toEqual([[0, [], "Wide view of the empty pier at dawn."], [2, [ren.id], "Ren folds his blazer over the railing."]]);
    expect(scene.visuals).toMatchObject({ setting: "wooden pier, fog, one iron lantern", outfits: { [ren.id]: "white shirt, grey trousers" } });
    expect(story.turns[0].lite!.assistant).toBe(inlineReply);
    // Next turn replays the picture lines byte for byte (INV-1 holds).
    replies = ["Ren leans on the railing and smiles at the synthetic sea.\n[pic: Ren | Ren leans on the railing.]"];
    await generate(story, "Wait");
    expect(bodies.at(-1)!.messages.slice(0, bodies[start].messages.length)).toEqual(bodies[start].messages);
    expect(bodies.at(-1)!.messages[bodies[start].messages.length]).toEqual({ role: "assistant", content: inlineReply });
  });

  it("asks the follow-up only for what the picture lines missed", async () => {
    let story = await create({ imagesEnabled: true, inlinePictures: true, structuredOutput: "off" });
    const start = bodies.length;
    // No [pic] lines at all in full-frames mode: the director plans the shots.
    replies = ["## Test hall\nShelves of synthetic ledgers fill the quiet hall.", "SHOT | Shelves of synthetic ledgers | none | The quiet hall."];
    story = await generate(story);
    expect(bodies.length - start).toBe(2);
    expect(story.scenes[0].illustrations.map((f) => f.prompt)).toEqual(["The quiet hall."]);
    // Pictures are there, but a speaker was never described: the director adds the person, inline shots stay.
    replies = ["Kai: Synthetic greetings from the doorway.\n[pic: Kai | Kai waves from the doorway.]", "PERSON | Kai | old man, white beard | brown coat"];
    story = await generate(story, "Look up");
    expect(bodies.length - start).toBe(4);
    expect(story.memory.characters.find((c) => c.name === "Kai")).toMatchObject({ appearance: "old man, white beard" });
    expect(story.scenes.at(-1)!.illustrations.map((f) => f.prompt)).toEqual(["Kai waves from the doorway."]);
  });

  it("stays at one request for a Russian story whose picture lines name people as the text does", async () => {
    let story = await create({ imagesEnabled: true, inlinePictures: true, structuredOutput: "off", language: "Russian" });
    const start = bodies.length;
    replies = [`## Кафе у гавани
[new: Мира | young woman, short silver hair, grey eyes | dark green raincoat]
[pic: Мира | Mira stands in the doorway, shaking rain off her hood.]
Мира входит с дождя и откидывает капюшон.
Мира: Я думала, ты не придёшь.
Ярослав: Я бы не пропустил.
Дождь стучит по окнам кафе.`];
    story = await generate(story);
    // Ярослав speaks but is in no picture: full frames need no description of him.
    expect(bodies.length - start).toBe(1);
    expect(bodies[start].messages[0].content).toContain("Write names exactly as they appear in the story");
    expect(story.scenes[0].illustrations[0].characterIds).toEqual([story.memory.characters.find((c) => c.name === "Мира")!.id]);
  });

  it("describes a card character once for pictures, then keeps their look and clothes", async () => {
    const card = await json("/characters/import", { rawJson: JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: { name: "Мика", first_mes: "Привет.", description: "Мика — дерзкая и уверенная в себе девушка, любит подшучивать над друзьями и никогда не извиняется первой." } }) });
    let story = await create({ imagesEnabled: true, inlinePictures: true, structuredOutput: "off", language: "Russian", characterIds: [card.id] });
    const start = bodies.length;
    replies = ["## Терраса у бассейна\n[pic: Мика | Mika smirks and steps onto the edge of the lounger.]\nМика ухмыляется и наступает на край шезлонга.\nМика: Подвинься.", "PERSON | Мика | young woman, fair skin, sharp face, long straight black hair, blue eyes, slim athletic build | white string bikini"];
    story = await generate(story);
    expect(bodies.length - start).toBe(2);
    expect(story.turns[0].lite!.director).toEqual(["describe:Мика"]);
    expect(bodies[start + 1].messages.at(-1)!.content).toContain("and also: Мика");
    const mika = story.memory.characters.find((c) => c.name === "Мика")!;
    expect(mika).toMatchObject({ look: expect.stringContaining("fair skin"), outfit: "white string bikini" });
    expect(mika.appearance).toContain("дерзкая");
    // Next picture of her: one request, same look and clothes in the prompt.
    replies = ["Мика слегка пинает меня по ноге шлёпанцем.\n[pic: Мика | Mika nudges my leg with her sandal. | wide]"];
    story = await generate(story, "Жду");
    expect(bodies.length - start).toBe(3);
    const { novelImagePrompt } = await import("./imagePrompt.js");
    const scene = story.scenes.at(-1)!, frame = scene.illustrations[0];
    const prompt = novelImagePrompt(story, scene, frame);
    expect(prompt).toContain("Мика has young woman, fair skin, sharp face, long straight black hair, blue eyes, slim athletic build.");
    expect(prompt).toContain("Мика is wearing white string bikini.");
    expect(prompt).not.toContain("дерзкая");
  });
});
