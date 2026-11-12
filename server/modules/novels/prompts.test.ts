import { describe, expect, it } from "vitest";
import { DEFAULT_NOVEL_CONFIG, type NovelStory } from "../../../src/shared/types/novels.js";
import { novelMessages, parseNovelBatch } from "./prompts.js";
import { mergeMemory } from "./normalize.js";
const initial = (): NovelStory => ({ id: "fiction-test", title: "Test", config: { ...DEFAULT_NOVEL_CONFIG, premise: "Invented test world", imagesEnabled: true, imagesPerScene: 2 }, cast: [], memory: { summary: "", facts: [], threads: [], characters: [] }, scenes: [], turns: [], cursor: { scene: 0, line: 0 }, revision: 0, createdAt: "", updatedAt: "", cache: null });
const scene = (question = "") => ({ title: "Test scene", lines: [{ speaker: "Test", text: "Fictional test line" }, { speaker: "Test", text: "Another line" }], question, choices: question ? ["A", "B"] : [], illustrations: [{ prompt: "Shot one", atLine: 0 }, { prompt: "Shot two", atLine: 1 }], memory: { summary: "A test event", characters: [{ id: "test", name: "Test", appearance: "red hair", state: "library" }], facts: ["A test fact"], threads: ["A test mystery"] } });
describe("novel cache and continuity", () => {
  it("keeps the prefix byte-identical across memory updates and appends existing turns intact", () => {
    const story = initial(); const first = novelMessages(story, "");
    story.turns = [{ user: first.user, assistant: "fixed response", throughSceneId: "test" }];
    story.memory.summary = "Changed memory";
    const second = novelMessages(story, "Go");
    expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
    expect(second.messages[2]).toEqual({ role: "assistant", content: "fixed response" });
    expect(second.messages.at(-1)?.content).not.toContain("Changed memory");
    expect(first.messages[0].content).not.toContain("Changed memory");
  });
  it("keeps appearance, identity and prior facts while updating state", () => {
    const previous = mergeMemory(initial().memory, scene().memory);
    const next = mergeMemory(previous, { summary: "new", facts: ["another"], characters: [{ id: "test", name: "Different", appearance: "blue hair", state: "garden" }] });
    expect(next.characters[0]).toMatchObject({ name: "Test", appearance: "red hair", state: "garden" });
    expect(next.facts).toEqual([]);
  });
  it("resolves changed model IDs back to canonical characters and image anchors", () => {
    const story = initial(); story.memory = mergeMemory(story.memory, scene().memory);
    const output = scene(); output.memory.characters[0] = { id: "different-id", name: "Test", appearance: "blue hair", state: "garden" };
    const withImages = { ...output, illustrations: [{ prompt: "new shot", atLine: 0, characterIds: ["different-id"] }] };
    const parsed = parseNovelBatch(JSON.stringify({ scenes: [withImages] }), story)[0];
    expect(parsed.memory.characters).toHaveLength(1);
    expect(parsed.memory.characters[0]).toMatchObject({ id: "test", appearance: "red hair", state: "garden" });
    expect(parsed.illustrations[0].characterIds).toEqual(["test"]);
  });
  it("creates multiple shots per scene, respects bounds and stops the batch at a dynamic question", () => {
    const story = initial(); story.config.questionFrequency = "frequent";
    const result = parseNovelBatch(JSON.stringify({ scenes: [scene(), scene("Which path?"), scene()] }), story);
    expect(result).toHaveLength(2); expect(result[0].illustrations).toHaveLength(2);
    expect(result[0].illustrations.map((im) => im.atLine)).toEqual([0, 1]);
    expect(result[1].memory.characters[0].appearance).toBe("red hair");
  });
  it("enforces question spacing and allows a batch with no forced questions", () => {
    const story = initial(); story.config.questionFrequency = "rare"; story.config.scenesPerTurn = 5;
    const result = parseNovelBatch(JSON.stringify({ scenes: [scene("a"), scene("b"), scene("c"), scene("d"), scene()] }), story);
    expect(result.map((s) => s.question)).toEqual(["", "", "", "d"]);
    story.config.questionFrequency = "off";
    expect(parseNovelBatch(JSON.stringify({ scenes: [scene("q")] }), story)[0].choices).toEqual([]);
    expect(parseNovelBatch(JSON.stringify({ scenes: [scene(), scene()] }), story)).toHaveLength(2);
  });
  it("accepts one compact memory delta per batch and anchors every frame to new cast", () => {
    const story = initial(); const one = scene();
    const { memory, ...rest } = one;
    const compact = { ...rest, illustrations: [{ prompt: "Shot", atLine: 0, characterIds: ["test"] }] };
    const result = parseNovelBatch(JSON.stringify({ scenes: [compact, compact], memory }), story);
    expect(result).toHaveLength(2);
    expect(result[1].memory.facts).toEqual([]);
    for (const item of result) {
      expect(item.illustrations[0].characterIds).toEqual(["test"]);
      expect(item.memory.characters[0].appearance).toBe("red hair");
    }
  });
  it("applies compact ID-only state updates without losing unchanged canon", () => {
    const prior = mergeMemory(initial().memory, {characters:[{id:"test",name:"Test",appearance:"red hair",state:"injured, holds key",relationships:"trusts guide"}]});
    const next = mergeMemory(prior, {characters:[{id:"test",state:"injured, holds key, in garden"}]});
    expect(next.characters[0]).toMatchObject({name:"Test",appearance:"red hair",state:"injured, holds key, in garden",relationships:"trusts guide"});
    expect(mergeMemory(next,{characters:[{id:"test",relationships:""}]}).characters[0].relationships).toBe("");
  });
  it("maps batch-level aliases to canonical IDs on every shot", () => {
    const story = initial();story.memory=mergeMemory(story.memory,scene().memory);
    const compact={lines:scene().lines,illustrations:[{prompt:"Synthetic shot",atLine:0,characterIds:["alias"]}]};
    const output={scenes:[compact,compact],memory:{characters:[{id:"alias",name:"Test",state:"garden"}]}};
    const parsed=parseNovelBatch(JSON.stringify(output),story);
    for(const item of parsed)expect(item.illustrations[0].characterIds).toEqual(["test"]);
    expect(parsed[1].memory.characters[0]).toMatchObject({id:"test",state:"garden"});
  });
  it("keeps library anchors once in the prefix and sends only nonduplicate memory fields", () => {
    const story=initial();const character={id:"test",name:"Synthetic",appearance:"unique visual anchor",description:"unique visual anchor",personality:"patient",state:"garden",relationships:""};
    story.cast=[{...character,state:""}];story.memory.characters=[character];
    const request=novelMessages(story,"");const user=JSON.parse(request.user);
    expect(user.maxScenes).toBe(story.config.scenesPerTurn);expect(user.replyTokenLimit).toBe(story.config.maxTokens);
    expect(user.characters).toEqual([{id:"test",name:"Synthetic",state:"garden"}]);
    expect(request.messages[0].content.split("unique visual anchor")).toHaveLength(2);
    expect(request.messages[0].content).toContain('"appearance":"English identity:');
    expect(request.messages[0].content).not.toContain('"memory":');
    expect(request.messages[0].content).not.toContain('dynamic =');
  });
  it("anchors opening shots at zero and prevents generating invisible duplicate shots", () => {
    const story=initial();story.config.imagesPerScene=4;
    const output={...scene(),illustrations:[{prompt:"First",atLine:1},{prompt:"Second",atLine:1},{prompt:"Invisible",atLine:1}]};
    expect(parseNovelBatch(JSON.stringify({scenes:[output]}),story)[0].illustrations.map(f=>f.atLine)).toEqual([0,1]);
  });
  it("never silently drops uncompressed oversized history", () => {
    const story = initial(); story.memory.summary = "Distant durable event";
    story.turns = [{ user: "x".repeat(50000), assistant: "old", throughSceneId: "old" }];
    const request = novelMessages(story, "Continue");
    expect(request.messages).toHaveLength(4); expect(request.user).not.toContain("Distant durable event");
  });
});

it("persists new visual anchors and first-person camera without copying batch-final wardrobe into earlier scenes",()=>{
 const story=initial();story.config.pov="first";
 const output={characters:[{id:"viewer",name:"Viewer",appearance:"short black hair",outfit:"plain white shirt"},{id:"guest",name:"Guest",appearance:"long red hair",outfit:"blue striped swimsuit"}],scenes:[
 {location:"Pool",setting:"white tiles and glass roof",lines:[{text:"Synthetic opening"}],illustrations:[{prompt:"The guest waves toward the camera. Eye-level shot, soft light.",characterIds:["guest"],camera:"first-person",viewpointCharacterId:"viewer",atLine:0}]},
 {location:"Pool",outfits:{guest:"white shirt and green shorts"},outfitChanges:{guest:{line:0,quote:"Synthetic explicit clothing change"}},lines:[{text:"Synthetic explicit clothing change"}],illustrations:[]}]};
 const scenes=parseNovelBatch(JSON.stringify(output),story);
 expect(scenes[0].visuals?.outfits.guest).toBe("blue striped swimsuit");expect(scenes[1].visuals?.outfits.guest).toBe("white shirt and green shorts");
 expect(scenes[0].visuals?.setting).toBe(scenes[1].visuals?.setting);expect(scenes[0].illustrations[0]).toMatchObject({camera:"first-person",viewpointCharacterId:"viewer"});
});

it("still schedules the opening image when a new response has prose but omitted its illustration tail",()=>{
 const story=initial();const result=parseNovelBatch('{"scenes":[{"location":"Synthetic garden","lines":[{"speaker":"Test","text":"Synthetic completed line."}]}]}',story);
 expect(result[0].illustrations).toHaveLength(1);expect(result[0].illustrations[0]).toMatchObject({atLine:0,status:"pending"});
 expect(result[0].lines[0].text).toBe("Synthetic completed line.");
});
