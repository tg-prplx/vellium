import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_NOVEL_CONFIG, type NovelStory } from "../../../src/shared/types/novels.js";
import { decodePng, encodePng } from "./png.js";

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
// All story text and images in this suite are synthetic. The Vitest setup isolates the DB.
describe.sequential("novel layers mode API", () => {
  let server: Server, mock: Server, base: string, endpoint: string;
  let replies: string[] = [];
  let noisySprites = false;
  const submitted: Graph[] = [];
  const listen = async (s: Server) => { await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${(s.address() as AddressInfo).port}`; };
  const req = (path: string, body?: unknown, method = "POST") => fetch(base + "/api" + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (path: string, body?: unknown, method = "POST") => { const r = await req(path, body, method); if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`); return r.json(); };
  const workflow = { "1": { class_type: "CLIPTextEncode", inputs: { text: "" } }, "2": { class_type: "CLIPTextEncode", inputs: { text: "" } }, "3": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } }, "4": { class_type: "KSampler", inputs: { positive: ["1", 0], negative: ["2", 0], latent_image: ["3", 0], seed: 1 } } };
  const textOf = (graph: Graph) => String(graph["1"].inputs.text);
  /** A dark-outlined figure on a vivid green backdrop, or noise the cut-out must refuse. */
  function picture(sprite: boolean) {
    const width = 48, height = 64, rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const inside = x >= 12 && x <= 36 && y >= 8 && y <= 60, edge = inside && (x <= 13 || x >= 35 || y <= 9 || y >= 59);
      const noise = ((x * 7919 + y * 104729) % 97) > 48;
      const colour = !sprite ? [90, 110, 140] : noisySprites ? (noise ? [10, 200, 30] : [230, 20, 200]) : edge ? [20, 20, 25] : inside ? [215, 215, 220] : [190, 225, 35];
      rgba.set([...colour, 255], (y * width + x) * 4);
    }
    return encodePng({ width, height, rgba });
  }
  let jobs = 0;
  const jobKinds = new Map<string, boolean>();

  beforeAll(async () => {
    const { createApp } = await import("../../app/createApp.js"); server = createServer(createApp()); base = await listen(server);
    mock = createServer(async (request, response) => {
      let raw = ""; for await (const part of request) raw += part;
      const url = request.url || "";
      if (url === "/v1/chat/completions") {
        const reply = replies.shift() ?? "Synthetic filler line.";
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ choices: [{ message: { content: reply } }] })); return;
      }
      if (url === "/system_stats") { response.setHeader("Content-Type", "application/json"); response.end("{}"); return; }
      if (url === "/prompt") {
        const graph = JSON.parse(raw).prompt as Graph; submitted.push(graph);
        const id = `job-${++jobs}`; jobKinds.set(id, textOf(graph).includes("cowboy shot"));
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ prompt_id: id })); return;
      }
      if (url.startsWith("/history/")) {
        const id = url.split("/").at(-1)!;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ [id]: { outputs: { "9": { images: [{ filename: `${id}.png`, subfolder: "", type: "output" }] } } } })); return;
      }
      if (url.startsWith("/view?")) {
        const id = new URL(url, "http://x").searchParams.get("filename")!.replace(".png", "");
        response.setHeader("Content-Type", "image/png"); response.end(picture(jobKinds.get(id) === true)); return;
      }
      response.statusCode = 404; response.end("{}");
    }); endpoint = await listen(mock);
    await json("/providers", { id: "layers-mock", name: "Layers mock", baseUrl: endpoint + "/v1", apiKey: "test-key", providerType: "openai" });
  });
  beforeEach(() => { replies = []; noisySprites = false; });
  afterAll(async () => { await Promise.all([server, mock].filter(Boolean).map((s) => new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()); }))); });

  const create = (config: Record<string, unknown> = {}) => json("/novels", { title: "Synthetic layers", config: { ...DEFAULT_NOVEL_CONFIG, premise: "Synthetic harbour", providerId: "layers-mock", modelId: "test", generationMode: "lite", visualMode: "layers", imagesEnabled: true, comfyUrl: endpoint, workflow, structuredOutput: "off", questionFrequency: "off", pov: "third", ...config } }) as Promise<NovelStory>;
  const generate = (story: NovelStory, action = "") => json(`/novels/${story.id}/generate`, { revision: story.revision, action }) as Promise<NovelStory>;
  const opening = "## Test pier\nFog drifts over the invented pier.\nMira: Did you bring the synthetic key?\nRen grabs the railing and vaults over it toward her.\nRen: Of course I did.";
  const director = "PERSON | Mira | young woman, short silver hair, grey eyes | green raincoat\nPERSON | Ren | tall young man, black hair | navy blazer\nPLACE | Test pier | wooden pier, fog, one lantern\nEVENT | Ren grabs the railing and | Ren | Ren vaults over the railing mid-jump.";

  it("queues one background and a sprite per person, with a full picture only for the action", async () => {
    let story = await create();
    replies = [opening, director];
    story = await generate(story);
    const scene = story.scenes[0];
    expect(Object.keys(story.backgrounds!)).toEqual(["test pier"]);
    expect(story.backgrounds!["test pier"].prompt).toContain("wooden pier, fog");
    const names = scene.present!.map((p) => story.memory.characters.find((c) => c.id === p.characterId)!.name);
    expect(names).toEqual(["Mira", "Ren"]);
    expect(Object.keys(story.sprites!)).toEqual(scene.present!.map((p) => p.sprite));
    expect(scene.illustrations).toHaveLength(1);
    expect(scene.illustrations[0]).toMatchObject({ atLine: 2, prompt: "Ren vaults over the railing mid-jump." });
    const start = submitted.length;
    story = await json(`/novels/${story.id}/images`, { revision: story.revision });
    const graphs = submitted.slice(start);
    // Backgrounds, then sprites (portrait), then the frame.
    expect(graphs.map((g) => [g["3"].inputs.width, g["3"].inputs.height])).toEqual([[1344, 768], [832, 1216], [832, 1216], [1344, 768]]);
    expect(textOf(graphs[0])).toContain("no humans"); expect(textOf(graphs[1])).toContain("vivid");
    const sprites = Object.values(story.sprites!);
    expect(sprites.every((s) => s.status === "ready" && s.cut === true)).toBe(true);
    const png = decodePng(Buffer.from(await (await fetch(base + sprites[0].url)).arrayBuffer()))!;
    expect(png.rgba[3]).toBe(0);
    expect(png.rgba[(30 * png.width + 24) * 4 + 3]).toBe(255);
    expect(story.backgrounds!["test pier"].status).toBe("ready");
    // Same place and people: nothing new to draw.
    replies = ["Mira takes the synthetic key from Ren.\nRen: Careful with it.", "PLACE | Test pier | wooden pier"];
    story = await generate(story, "Continue");
    expect(Object.keys(story.sprites!)).toHaveLength(2); expect(Object.keys(story.backgrounds!)).toHaveLength(1);
    expect(story.scenes[1].illustrations).toEqual([]);
    expect(story.scenes[1]).toMatchObject({ background: "test pier" });
  });

  it("retries a sprite once with a new seed and then shows it uncut", async () => {
    let story = await create();
    replies = ["## Test hall\nMira: Hello there, synthetic friend.", "PERSON | Mira | woman, silver hair | red coat"];
    story = await generate(story);
    noisySprites = true;
    const start = submitted.length;
    story = await json(`/novels/${story.id}/images`, { revision: story.revision });
    const sprite = Object.values(story.sprites!)[0];
    const spriteJobs = submitted.slice(start).filter((g) => textOf(g).includes("cowboy shot"));
    expect(spriteJobs).toHaveLength(2);
    expect(spriteJobs[0]["4"].inputs.seed).not.toBe(spriteJobs[1]["4"].inputs.seed);
    expect(sprite).toMatchObject({ status: "ready", cut: false, attempts: 1 });
  });

  it("edits, reseeds and adds pictures only on request", async () => {
    let story = await create({ visualMode: "shots" });
    replies = [opening, "PERSON | Mira | woman, silver hair | red coat\nSHOT | Fog drifts over the | none | Empty pier."];
    story = await generate(story);
    story = await json(`/novels/${story.id}/images`, { revision: story.revision });
    const frame = story.scenes[0].illustrations[0];
    expect(frame.status).toBe("ready");
    const jobsBefore = submitted.length;
    const edited = await json(`/novels/${story.id}/illustrations/${frame.id}`, { revision: story.revision, prompt: "Wide view of the empty pier at dusk.", reseed: true }, "PATCH") as NovelStory;
    const after = edited.scenes[0].illustrations[0];
    expect(after).toMatchObject({ prompt: "Wide view of the empty pier at dusk.", status: "pending", url: null });
    expect(after.seed).not.toBe(frame.seed);
    expect(submitted.length).toBe(jobsBefore);
    expect((await req(`/novels/${story.id}/illustrations/${frame.id}`, { revision: story.revision, reseed: true }, "PATCH")).status).toBe(409);
    expect((await req(`/novels/${story.id}/illustrations/missing`, { revision: edited.revision, reseed: true }, "PATCH")).status).toBe(404);
    expect((await req(`/novels/${story.id}/illustrations/${frame.id}`, { revision: edited.revision, prompt: "  " }, "PATCH")).status).toBe(400);
    const added = await json(`/novels/${story.id}/illustrations`, { revision: edited.revision, sceneId: edited.scenes[0].id, atLine: 1, prompt: "" }) as { story: NovelStory; frameId: string };
    const created = added.story.scenes[0].illustrations.find((f) => f.id === added.frameId)!;
    expect(created).toMatchObject({ atLine: 1, prompt: "Did you bring the synthetic key?", status: "pending" });
    expect(created.characterIds).toEqual([added.story.memory.characters.find((c) => c.name === "Mira")!.id]);
    const rendered = await json(`/novels/${story.id}/images`, { revision: added.story.revision, illustrationId: added.frameId }) as NovelStory;
    expect(rendered.scenes[0].illustrations.find((f) => f.id === added.frameId)!.status).toBe("ready");
    expect(rendered.scenes[0].illustrations.find((f) => f.id === frame.id)!.status).toBe("pending");
  });

  it("checks the ComfyUI connection and workflow without queueing a job", async () => {
    const before = submitted.length;
    expect(await json("/novels/comfy-check", { config: { comfyUrl: endpoint, workflow } })).toMatchObject({ reachable: true, workflowOk: true, positiveNode: "1" });
    const broken = await json("/novels/comfy-check", { config: { comfyUrl: "http://127.0.0.1:1", workflow: { "1": { class_type: "KSampler", inputs: {} } } } });
    expect(broken).toMatchObject({ reachable: false, workflowOk: false });
    expect(broken.error).toBeTruthy();
    expect(submitted.length).toBe(before);
  });

  it("queues inline pictures in ComfyUI while the text streams and adopts matching jobs", async () => {
    const { EarlyFrames } = await import("./earlyFrames.js");
    const { parseLiteText } = await import("./liteFormat.js");
    const { buildLiteScenes } = await import("./liteScenes.js");
    const { inlinePlan } = await import("./liteInline.js");
    const { applyDirectorPlan } = await import("./liteDirector.js");
    const story = await create({ visualMode: "shots", inlinePictures: true }) as NovelStory;
    const picIds: string[] = [], sceneIds = ["scene-a"];
    const early = new EarlyFrames(story, picIds, new AbortController().signal);
    const partial = "## Test pier\n[pic: none | Wide view of the empty pier.]\nFog drifts over the invented pier.\n";
    const before = submitted.length;
    early.consider(parseLiteText(partial, []), sceneIds);
    early.consider(parseLiteText(partial, []), sceneIds);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(submitted.length - before).toBe(1);
    expect(textOf(submitted.at(-1)!)).toContain("Wide view of the empty pier.");
    const full = parseLiteText(`${partial}Mira: Hello there.\n[pic: none | A gull lands on the railing.]`, []);
    const scenes = buildLiteScenes(story, full, sceneIds);
    const saved = { ...story, scenes };
    const final = applyDirectorPlan(saved, 1, inlinePlan(saved, full, 1, picIds), { choices: false, visuals: true });
    await early.adopt(final, 1);
    const [first, second] = final.scenes[0].illustrations;
    expect(first.jobId).toMatch(/^job-/); expect(first.jobEndpoint).toBe(endpoint);
    expect(second.jobId).toBeUndefined();
    // A changed prompt is never adopted.
    final.scenes[0].illustrations[0] = { ...first, jobId: undefined, prompt: "Something else." };
    const changed = await early.adopt(final, 1);
    expect(changed.scenes[0].illustrations[0].jobId).toBeUndefined();
  });
  it("waits to queue an early picture until everyone in it is described", async () => {
    const { EarlyFrames } = await import("./earlyFrames.js");
    const { parseLiteText } = await import("./liteFormat.js");
    const story = await create({ visualMode: "shots", inlinePictures: true }) as NovelStory;
    const early = new EarlyFrames(story, [], new AbortController().signal);
    const before = submitted.length;
    const head = "## Test cafe\n[pic: Nia | Nia waves from the doorway.]\nNia steps in from the synthetic rain.\n";
    early.consider(parseLiteText(head, []), ["scene-b"]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(submitted.length - before).toBe(0);
    early.consider(parseLiteText(`${head}[new: Nia | young woman, black braid | yellow raincoat]\nNia: Hello again.\n`, []), ["scene-b"]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(submitted.length - before).toBe(1);
    expect(textOf(submitted.at(-1)!)).toContain("black braid");
  });
});
