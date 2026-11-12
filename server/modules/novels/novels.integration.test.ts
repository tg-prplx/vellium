import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_NOVEL_CONFIG, type NovelStory } from "../../../src/shared/types/novels.js";

// All story text in this suite is synthetic. The Vitest setup isolates the DB.
describe.sequential("novel generation API", () => {
  let server: Server, mock: Server, base: string, endpoint: string;
  let lastImageType = "";
  let summaryCalls=0;
  const imageBodies: Array<Record<string,{inputs:Record<string,unknown>}>>=[];
  let lastRawReply = "";
  let replyOverride: string | undefined;
  let count = 0, imageCount = 0, brokenImage = false, badJson = false;
  let holdModel = false, modelStarted: (() => void) | undefined, releaseModel: (() => void) | undefined;
  let holdImage = false, imageStarted: (() => void) | undefined, releaseImage: (() => void) | undefined;
  const bodies: Array<{ max_tokens?: number; stop?: string[]; messages: Array<{ role: string; content: string }> }> = [];
  const listen = async (s: Server) => { await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${(s.address() as AddressInfo).port}`; };
  const req = (path: string, body?: unknown, method = "POST") => fetch(base + "/api" + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (path: string, body?: unknown, method = "POST") => { const r = await req(path, body, method); if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`); return r.json(); };
  const workflow = { "1": { class_type: "CLIPTextEncode", inputs: { text: "" } }, "2": { class_type: "CLIPTextEncode", inputs: { text: "" } }, "3": { class_type: "KSampler", inputs: { positive: ["1", 0], negative: ["2", 0], seed: 1 } } };
  let story: NovelStory;
  beforeAll(async () => {
    const { createApp } = await import("../../app/createApp.js"); server = createServer(createApp()); base = await listen(server);
    mock = createServer(async (request, response) => {
      response.setHeader("Content-Type", "application/json");
      let raw = ""; for await (const part of request) raw += part;
      if (request.url === "/v1/chat/completions") {
        count++; bodies.push(JSON.parse(raw));
        if (holdModel) { modelStarted?.(); await new Promise<void>((resolve) => { releaseModel = resolve; }); }
        if(JSON.parse(raw).messages[0]?.content?.startsWith("Compress earlier fictional story events")) {
          summaryCalls++;response.end(JSON.stringify({choices:[{message:{content:"Earlier synthetic events: the explorer found a test key and agreed to return it."}}]}));return;
        }
        const scenes = [0, 1, 2].map((n) => ({ title: `Invented scene ${n}`, location: "Test garden", pov: "Test explorer", lines: [{ speaker: "Explorer", text: "An invented test observation." }, { speaker: "Narrator", text: "A synthetic continuation." }], choices: [],
          illustrations: [{ prompt: "wide shot", characterIds: ["invented"], atLine: 0 }, { prompt: "close up", characterIds: ["invented"], atLine: 1 }],
          memory: { summary: "Synthetic event", facts: ["Test key discovered"], threads: ["Synthetic thread"], characters: [{ id: "invented", name: "Test explorer", appearance: "green coat, brown hair", state: "test garden" }] } }));
        lastRawReply = replyOverride ?? (badJson ? "not json" : JSON.stringify({ scenes }, null, 2));
        response.end(JSON.stringify({ choices: [{ message: { content: lastRawReply } }], usage: { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 768 } } }));
      } else if (request.url === "/prompt") {
        imageBodies.push(JSON.parse(raw).prompt);
        imageCount++; response.end(JSON.stringify({ prompt_id: `frame-${imageCount}` }));
      } else if (request.url?.startsWith("/history/")) {
        if (holdImage) { imageStarted?.(); await new Promise<void>((resolve) => { releaseImage = resolve; }); }
        const id = request.url.split("/").at(-1)!;
        response.end(JSON.stringify({ [id]: brokenImage ? { status: { status_str: "error" } } : { outputs: { "9": { images: [{ filename: "mock.png", subfolder: "", type: "temp" }] } } } }));
      } else if (request.url?.startsWith("/view?")) {
        lastImageType = new URL(request.url, endpoint).searchParams.get("type") || "";
        response.setHeader("Content-Type", "image/png");
        response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64"));
      } else { response.statusCode = 404; response.end("{}"); }
    }); endpoint = await listen(mock);
    await json("/providers", { id: "novel-mock", name: "Novel mock", baseUrl: endpoint + "/v1", apiKey: "test-key", providerType: "openai" });
    story = await json("/novels", { title: "Synthetic novel", config: { ...DEFAULT_NOVEL_CONFIG, premise: "Synthetic world", providerId: "novel-mock", modelId: "test", imagesEnabled: true, comfyUrl: endpoint, workflow } });
  });
  afterAll(async () => { await Promise.all([server, mock].filter(Boolean).map((s) => new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()); }))); });
  it("does not generate on GET and rejects missing premise, unknown IDs and stale writes", async () => {
    expect((await req("/novels", { config: {} })).status).toBe(400);
    expect((await req("/novels/missing", undefined, "GET")).status).toBe(404);
    await json("/novels", undefined, "GET"); await json(`/novels/${story.id}`, undefined, "GET"); expect(count).toBe(0);
    expect((await req(`/novels/${story.id}`, { revision: 99 }, "PATCH")).status).toBe(409);
  });
  it("generates several scenes/shots and persists memory and actual cache usage", async () => {
    story = await json(`/novels/${story.id}/generate`, { revision: story.revision });
    expect(story.scenes).toHaveLength(3); expect(story.scenes[0].illustrations).toHaveLength(2);
    expect(story.memory.characters[0].appearance).toContain("green coat");
    expect(story.cache).toMatchObject({ inputTokens: 1000, cachedTokens: 768 });
    expect(story.turns[0].assistant).toBe(lastRawReply);
    const saved = await json(`/novels/${story.id}`, undefined, "GET"); expect(saved.memory.facts).toEqual([]);
    story = await json(`/novels/${story.id}/generate`, { revision: story.revision, action: "Continue the synthetic test" });
    expect(bodies[1].messages.slice(0, bodies[0].messages.length)).toEqual(bodies[0].messages);
  });
  it("renders multiple shots in multiple scenes and keeps narrative/cache unchanged", async () => {
    const before = story.turns; const textCalls = count;
    story = await json(`/novels/${story.id}/images`, { revision: story.revision });
    expect(story.scenes.flatMap((s) => s.illustrations).every((im) => im.status === "ready")).toBe(true);
    expect(count).toBe(textCalls);
    expect(imageCount).toBe(12); expect(lastImageType).toBe("temp"); expect(story.turns).toEqual(before);
    const image = story.scenes[0].illustrations[0]; expect(image.url).toMatch(/^\/api\/uploads\/novel-/);
    expect((await fetch(base + image.url)).headers.get("content-type")).toContain("image/png");
  });
  it("isolates frame failures, retries one frame, and preserves seed and text", async () => {
    const frame = story.scenes[0].illustrations[0]; const seed = frame.seed; const before = story.turns;
    brokenImage = true;
    story = await json(`/novels/${story.id}/images`, { revision: story.revision, illustrationId: frame.id });
    expect(story.scenes[0].illustrations[0].status).toBe("error");
    expect(story.scenes[0].illustrations[1].status).toBe("ready");
    brokenImage = false;
    story = await json(`/novels/${story.id}/images`, { revision: story.revision, illustrationId: frame.id });
    expect(story.scenes[0].illustrations[0]).toMatchObject({ seed, status: "ready" }); expect(story.turns).toEqual(before);
  });
  it("resumes an accepted ComfyUI job after cancellation without duplicating it", async () => {
    const frameId = story.scenes[0].illustrations[0].id;
    holdImage = true;
    const started = new Promise<void>((resolve) => { imageStarted = resolve; });
    const pending = req(`/novels/${story.id}/images`, { revision: story.revision, illustrationId: frameId });
    await started;
    const submissions = imageCount;
    await json(`/novels/${story.id}/abort`, {});
    expect((await pending).status).toBe(400);
    releaseImage?.(); holdImage = false;
    story = await json(`/novels/${story.id}`, undefined, "GET");
    expect(story.scenes[0].illustrations[0].status).toBe("pending");
    expect(story.scenes[0].illustrations[0].jobId).toBeTruthy();
    story = await json(`/novels/${story.id}/images`, { revision: story.revision, illustrationId: frameId });
    expect(story.scenes[0].illustrations[0].status).toBe("ready"); expect(imageCount).toBe(submissions);
  });
  it("saves usable truncated output in one model call and reuses the exact response in context", async () => {
    const draft = await json("/novels", {config:{...DEFAULT_NOVEL_CONFIG,premise:"Synthetic cut-off response",providerId:"novel-mock",modelId:"test"}});
    replyOverride = '{"scenes":[{"title":"Synthetic partial scene","lines":[{"speaker":"Tester","text":"Already paid for and complete."},{"text":"Not finished';
    const calls = count;
    try {
      const recovered = await json(`/novels/${draft.id}/generate`, {revision:draft.revision});
      expect(count-calls).toBe(1);
      expect(recovered.scenes[0].lines).toEqual([{speaker:"Tester",text:"Already paid for and complete."}]);
      expect(recovered.turns[0].assistant).toBe(replyOverride);
      const saved = await json(`/novels/${draft.id}`,undefined,"GET");
      expect(saved.scenes).toEqual(recovered.scenes);
    } finally { replyOverride = undefined; }
  });
  it("does not inherit chat stop strings or the chat system prompt", async () => {
    const settings = await json("/settings",undefined,"GET");
    try {
      await json("/settings",{systemPrompt:"SYNTHETIC_CHAT_RP_PROMPT",samplerConfig:{...settings.samplerConfig,stop:["}","Tester:"],koboldMemory:"SYNTHETIC_CHAT_MEMORY"}},"PATCH");
      const draft=await json("/novels",{config:{...DEFAULT_NOVEL_CONFIG,premise:"Synthetic isolation fixture",providerId:"novel-mock",modelId:"test"}});
      await json(`/novels/${draft.id}/generate`,{revision:draft.revision});
      const request=bodies.at(-1)!;
      expect(request.stop).toBeUndefined();
      expect(JSON.stringify(request.messages)).not.toContain("SYNTHETIC_CHAT_RP_PROMPT");
      expect(JSON.stringify(request.messages)).not.toContain("SYNTHETIC_CHAT_MEMORY");
    } finally { await json("/settings",{systemPrompt:settings.systemPrompt,samplerConfig:settings.samplerConfig},"PATCH"); }
  });
  it("sends landscape Anima prompts with stable outfits, setting and a subjective camera",async()=>{
    const draft=await json("/novels",{config:{...DEFAULT_NOVEL_CONFIG,premise:"Synthetic Anima fixture",providerId:"novel-mock",modelId:"test",pov:"first",povCharacter:"viewer",imagesEnabled:true,comfyUrl:endpoint,workflow:{...workflow,"4":{class_type:"EmptyLatentImage",inputs:{width:512,height:512}}}}});
    const item={location:"Pool",lines:[{text:"Synthetic first line"},{text:"Synthetic second line"}],illustrations:[{prompt:"The guest waves at the viewer. Eye-level medium shot with soft light.",characterIds:["viewer","guest"],viewpointCharacterId:"viewer",camera:"first-person",atLine:0}]};
    replyOverride=JSON.stringify({characters:[{id:"viewer",name:"Viewer",appearance:"short black hair",outfit:"white shirt"},{id:"guest",name:"Guest",appearance:"long red hair, green eyes",outfit:"blue striped swimsuit"}],scenes:[{...item,setting:"white tiles, glass roof"},item]});
    try {
      const generated=await json(`/novels/${draft.id}/generate`,{revision:draft.revision});
      const offset=imageBodies.length;
      await json(`/novels/${draft.id}/images`,{revision:generated.revision});
      const graphs=imageBodies.slice(offset);expect(graphs).toHaveLength(2);
      for(const graph of graphs){
        expect(graph["4"].inputs).toMatchObject({width:1344,height:768});
        const prompt=String(graph["1"].inputs.text);expect(prompt).toContain("first-person view");expect(prompt).toContain("blue striped swimsuit");expect(prompt).toContain("white tiles, glass roof");expect(prompt).not.toContain("short black hair");
      }
    }finally{replyOverride=undefined;}
  });
  it("submits missing-image recovery to a custom Anima sampler without calling the text model",async()=>{
    const custom={"1":{class_type:"CLIPTextEncode",inputs:{text:"positive"}},"2":{class_type:"BasicGuider",inputs:{conditioning:["1",0]}},"3":{class_type:"SamplerCustomAdvanced",inputs:{guider:["2",0]}}};
    const draft=await json("/novels",{config:{...DEFAULT_NOVEL_CONFIG,premise:"Synthetic recovery fixture",providerId:"novel-mock",modelId:"test",workflow:custom,comfyUrl:endpoint}});
    replyOverride=JSON.stringify({scenes:[{lines:[{speaker:"Test",text:"Synthetic line with no illustration plan"}]}]});
    let generated;
    try{generated=await json(`/novels/${draft.id}/generate`,{revision:draft.revision});}finally{replyOverride=undefined;}
    expect(generated.scenes[0].illustrations).toHaveLength(0);
    const calls=count,images=imageCount;
    const prepared=await json(`/novels/${draft.id}/images`,{revision:generated.revision,prepareOnly:true});expect(count).toBe(calls);expect(imageCount).toBe(images);expect(prepared.scenes[0].illustrations[0].atLine).toBe(0);
    const done=await json(`/novels/${draft.id}/images`,{revision:prepared.revision,illustrationId:prepared.scenes[0].illustrations[0].id});expect(imageCount).toBe(images+1);expect(count).toBe(calls);expect(done.scenes[0].illustrations[0].status).toBe("ready");
  });
  it("keeps the actual ComfyUI payload on the same set and costume despite model drift",async()=>{
    const draft=await json("/novels",{config:{...DEFAULT_NOVEL_CONFIG,premise:"Synthetic drift fixture",providerId:"novel-mock",modelId:"test",pov:"third",imagesEnabled:true,comfyUrl:endpoint,workflow}});
    const lines=[{speaker:"Guest",text:"The guest smiles and raises her right hand."}];
    replyOverride=JSON.stringify({characters:[{id:"guest",name:"Guest",appearance:"long red hair, green eyes",outfit:"blue striped one-piece swimsuit"}],scenes:[
      {location:"Pool",setting:"white tiles, glass roof",lines,illustrations:[{prompt:"Watercolor painting with thick brush strokes. She raises her hand. Eye-level medium shot.",characterIds:["guest"],atLine:0}]},
      {location:"Beach",setting:"golden sand",outfits:{guest:"green bikini"},lines,illustrations:[{prompt:"Photorealistic 3D render. Neon lighting. She wears a green bikini. The background is a tropical beach. She smiles and raises her right hand.",characterIds:["guest"],atLine:0}]}]});
    try{
      const generated=await json(`/novels/${draft.id}/generate`,{revision:draft.revision});const offset=imageBodies.length;
      await json(`/novels/${draft.id}/images`,{revision:generated.revision});const graphs=imageBodies.slice(offset);expect(graphs).toHaveLength(2);
      for(const graph of graphs){const prompt=String(graph["1"].inputs.text);expect(prompt).toContain("blue striped one-piece swimsuit");expect(prompt).toContain("white tiles, glass roof");expect(prompt).not.toMatch(/green bikini|golden sand|tropical beach|Watercolor|Photorealistic|Neon lighting/);expect(prompt.startsWith(DEFAULT_NOVEL_CONFIG.artStyle)).toBe(true);}
      expect(graphs[0]["3"].inputs.seed).toBe(graphs[1]["3"].inputs.seed);
    }finally{replyOverride=undefined;}
  });
  it("automatically compacts growing context, persists the checkpoint and keeps full scenes",async()=>{
    let draft=await json("/novels",{config:{...DEFAULT_NOVEL_CONFIG,premise:"Synthetic long context fixture",providerId:"novel-mock",modelId:"test",contextChars:8000,imagesEnabled:false}});
    const before=summaryCalls;
    for(let i=0;i<10;i++)draft=await json(`/novels/${draft.id}/generate`,{revision:draft.revision,action:`Synthetic decision ${i}`});
    expect(summaryCalls).toBeGreaterThan(before);expect(draft.scenes).toHaveLength(30);expect(draft.turns).toHaveLength(10);expect(draft.contextCheckpoint.throughTurn).toBeGreaterThan(0);
    const saved=await json(`/novels/${draft.id}`,undefined,"GET");expect(saved.contextCheckpoint).toEqual(draft.contextCheckpoint);expect(saved.scenes).toHaveLength(30);
    expect(bodies.some(body=>String(body.messages[0]?.content).includes("Earlier synthetic events: the explorer"))).toBe(true);
  });
  it("reuses a saved compaction checkpoint after the following scene request fails",async()=>{
    let draft=await json("/novels",{config:{...DEFAULT_NOVEL_CONFIG,premise:"Synthetic checkpoint failure fixture",providerId:"novel-mock",modelId:"test",contextChars:8000,imagesEnabled:false}});
    try{
      replyOverride=JSON.stringify({scenes:[{lines:[{text:"Synthetic older event "+"x".repeat(1150)},{text:"Synthetic consequence "+"y".repeat(1150)}]}]});
      for(let i=0;i<2;i++)draft=await json(`/novels/${draft.id}/generate`,{revision:draft.revision});
      replyOverride=undefined;badJson=true;const summariesBefore=summaryCalls;
      expect((await req(`/novels/${draft.id}/generate`,{revision:draft.revision})).status).toBe(400);
      draft=await json(`/novels/${draft.id}`,undefined,"GET");expect(draft.scenes).toHaveLength(2);expect(draft.contextCheckpoint).toBeTruthy();expect(summaryCalls).toBeGreaterThan(summariesBefore);
      const afterFailure=summaryCalls;badJson=false;
      await json(`/novels/${draft.id}/generate`,{revision:draft.revision});expect(summaryCalls).toBe(afterFailure);
    }finally{badJson=false;replyOverride=undefined;}
  });
  it("never makes an unrequested paid repair call or loses the story on invalid JSON", async () => {
    badJson = true; const previous = story.scenes.length; const calls = count;
    expect((await req(`/novels/${story.id}/generate`, { revision: story.revision })).status).toBe(400);
    expect(count - calls).toBe(1);
    expect((await json(`/novels/${story.id}`, undefined, "GET")).scenes).toHaveLength(previous); badJson = false;
  });
  it("snapshots optional Vellium cast without later library edits changing canon", async () => {
    const char = await json("/characters/import", { rawJson: JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: { name: "Synthetic guest", description: "silver hair, red scarf", personality: "patient" } }) });
    const castStory = await json("/novels", { config: { ...DEFAULT_NOVEL_CONFIG, premise: "Test with guest", characterIds: [char.id] } });
    await json(`/characters/${char.id}`, { name: "Renamed guest", description: "different" }, "PUT");
    const reloaded = await json(`/novels/${castStory.id}`, undefined, "GET");
    expect(reloaded.cast[0]).toMatchObject({ sourceCharacterId: char.id, name: "Synthetic guest", appearance: "silver hair, red scarf" });
  });
  it("rejects duplicate work and aborts without appending partial scenes", async () => {
    holdModel = true;
    const started = new Promise<void>((resolve) => { modelStarted = resolve; });
    const pending = req(`/novels/${story.id}/generate`, { revision: story.revision });
    await started;
    expect((await req(`/novels/${story.id}/generate`, { revision: story.revision })).status).toBe(409);
    expect((await req(`/novels/${story.id}`, undefined, "DELETE")).status).toBe(409);
    await json(`/novels/${story.id}/abort`, {});
    expect((await pending).status).toBe(400);
    releaseModel?.(); holdModel = false;
    expect((await json(`/novels/${story.id}`, undefined, "GET")).scenes).toHaveLength(story.scenes.length);
  });
  it("saves reading progress independently of generation revisions", async () => {
    const revision = story.revision;
    const cursor = await json(`/novels/${story.id}/progress`, { scene: 1, line: 1 });
    const saved = await json(`/novels/${story.id}`, undefined, "GET");
    expect(cursor).toEqual({ scene: 1, line: 1 });
    expect(saved.cursor).toEqual(cursor); expect(saved.revision).toBe(revision);
    expect((await json(`/novels/${story.id}/progress`, { scene: 9999, line: -99 }))).toEqual({ scene: story.scenes.length - 1, line: 0 });
  });
  it("deletes a selected novel permanently while preserving the other novels",async()=>{
    const draft=await json("/novels",{title:"Synthetic deletion fixture",config:{...DEFAULT_NOVEL_CONFIG,premise:"Synthetic deletion fixture"}});
    expect((await req(`/novels/${draft.id}`,undefined,"DELETE")).status).toBe(200);
    expect((await req(`/novels/${draft.id}`,undefined,"GET")).status).toBe(404);
    const list=await json("/novels",undefined,"GET");expect(list.some((item:{id:string})=>item.id===draft.id)).toBe(false);
    expect((await req(`/novels/${story.id}`,undefined,"GET")).status).toBe(200);
  });
  it("respects Full Local Mode for novel and image endpoints", async () => {
    await json("/settings", { fullLocalMode: true }, "PATCH");
    const { assertNovelEndpoint } = await import("./generation.js");
    expect(() => assertNovelEndpoint("https://example.com")).toThrow("local-only");
    expect(() => assertNovelEndpoint(endpoint)).not.toThrow();
    expect(() => assertNovelEndpoint("http://secret:pass@127.0.0.1")).toThrow("credentials");
    await json("/settings", { fullLocalMode: false }, "PATCH");
  });
});
