import { describe, expect, it } from "vitest";
import { DEFAULT_NOVEL_CONFIG, type NovelStory } from "../../../src/shared/types/novels.js";
import { parseLiteText, renderLiteScenes } from "./liteFormat.js";
import { inlinePlan, mergePlans, peopleToDescribe, sparseScenes } from "./liteInline.js";
import { sameMachine } from "./earlyFrames.js";
import { buildLiteScenes } from "./liteScenes.js";

// All story text here is synthetic.
const reply = `## Test pier
[place: wooden pier, fog, one iron lantern]
[pic: none | Wide view of the empty pier at dawn.]
Fog drifts over the invented pier.
[new: Ren | tall young man, messy black hair | navy blazer]
Ren: You came after all.
[wear: Ren | white shirt, grey trousers]
Ren takes off his blazer and folds it over the railing.
## Test hall
Shelves of synthetic ledgers fill the hall.
[pic: Ren | Ren pulls a ledger from the top shelf.]`;

describe("inline picture lines", () => {
  it("are kept out of the story text and tied to the line they belong to", () => {
    const batch = parseLiteText(reply, ["Ren"]);
    expect(batch.scenes.map((s) => s.lines.map((l) => l.text))).toEqual([["Fog drifts over the invented pier.", "You came after all.", "Ren takes off his blazer and folds it over the railing."], ["Shelves of synthetic ledgers fill the hall."]]);
    expect(batch.markers.map((m) => [m.kind, m.scene, m.line, Boolean(m.after)])).toEqual([["place", 0, 0, false], ["pic", 0, 0, false], ["new", 0, 1, false], ["wear", 0, 2, false], ["pic", 1, 0, true]]);
    expect(parseLiteText("Text line here.\n[PICTURE - none | An empty room]", []).markers[0]).toMatchObject({ kind: "pic", cells: ["none", "An empty room"] });
  });
  it("stay in the replayed history in canonical form", () => {
    const batch = parseLiteText(reply, ["Ren"]);
    const text = renderLiteScenes(batch.scenes, "", batch.markers);
    expect(text).toBe(reply);
    expect(renderLiteScenes(batch.scenes)).not.toContain("[pic:");
  });
  it("become a plan with exact positions, stable frame IDs, people, clothes and places", () => {
    const batch = parseLiteText(reply, ["Ren"]);
    const story = { id: "s", title: "", config: { ...DEFAULT_NOVEL_CONFIG, imagesEnabled: true }, cast: [], memory: { summary: "", facts: [], threads: [], characters: [] }, scenes: [], turns: [], cursor: { scene: 0, line: 0 }, revision: 0, createdAt: "", updatedAt: "", cache: null } as NovelStory;
    const saved = { ...story, scenes: buildLiteScenes(story, batch) };
    const ids: string[] = [];
    const plan = inlinePlan(saved, batch, saved.scenes.length, ids);
    expect(plan.shots.map((s) => [s.pos, s.who, s.see])).toEqual([[{ scene: 0, line: 0 }, [], "Wide view of the empty pier at dawn."], [{ scene: 1, line: 0 }, ["Ren"], "Ren pulls a ledger from the top shelf."]]);
    expect(plan.shots.map((s) => s.id)).toEqual(ids);
    expect(inlinePlan(saved, batch, saved.scenes.length, ids).shots.map((s) => s.id)).toEqual(ids);
    expect(plan.people).toEqual([{ name: "Ren", look: "tall young man, messy black hair", clothes: "navy blazer" }]);
    expect(plan.outfits).toEqual([{ name: "Ren", clothes: "white shirt, grey trousers", at: "", pos: { scene: 0, line: 2 } }]);
    expect(plan.places).toEqual([{ name: "Test pier", look: "wooden pier, fog, one iron lantern" }]);
    expect(peopleToDescribe(saved, 2, plan, false)).toEqual([]);
    // Ren is in a picture: without his [new] line he must be described.
    expect(peopleToDescribe(saved, 2, { ...plan, people: [] }, false)).toEqual(["Ren"]);
    // A speaker in no picture needs no description in full frames, but does in layers mode.
    const talker = { ...plan, people: [], shots: plan.shots.filter((s) => !s.who.length) };
    expect(peopleToDescribe(saved, 2, talker, false)).toEqual([]);
    expect(peopleToDescribe(saved, 2, talker, true)).toEqual(["Ren"]);
  });
  it("win over the director, which only fills gaps", () => {
    const inline = { question: "", choices: [], people: [{ name: "Ren", look: "a", clothes: "b" }], places: [], shots: [{ at: "", who: [], see: "inline" }], outfits: [] };
    const directed = { question: "Q?", choices: ["A", "B"], people: [{ name: "ren", look: "x", clothes: "y" }, { name: "Mira", look: "m", clothes: "n" }], places: [], shots: [{ at: "q", who: [], see: "director" }], outfits: [] };
    expect(mergePlans(inline, directed)).toMatchObject({ question: "Q?", choices: ["A", "B"], people: [{ name: "Ren" }, { name: "Mira" }], shots: [{ see: "inline" }, { see: "director" }] });
    expect(mergePlans({ ...inline, shots: [] }, directed).shots).toEqual([{ at: "q", who: [], see: "director" }]);
    expect(mergePlans(inline, null)).toBe(inline);
  });
  it("render early only when ComfyUI is on another machine", () => {
    expect(sameMachine("http://127.0.0.1:1234/v1", "http://localhost:8188")).toBe(true);
    expect(sameMachine("http://127.0.0.1:1234/v1", "http://192.168.2.154:8188")).toBe(false);
    expect(sameMachine("http://192.168.2.154:5001", "http://192.168.2.154:8188")).toBe(true);
  });
  it("finds scenes with too few pictures and fills only the empty stretches", async () => {
    const { applyDirectorPlan } = await import("./liteDirector.js");
    const long = Array.from({ length: 12 }, (_, i) => `Synthetic narration line number ${i} about the quiet harbour.`).join("\n");
    const batch = parseLiteText(`## Test pier\n[pic: none | The harbour at dawn.]\n${long}`, []);
    const story = { id: "s", title: "", config: { ...DEFAULT_NOVEL_CONFIG, imagesEnabled: true, imagesPerScene: 3 }, cast: [], memory: { summary: "", facts: [], threads: [], characters: [] }, scenes: [], turns: [], cursor: { scene: 0, line: 0 }, revision: 0, createdAt: "", updatedAt: "", cache: null } as NovelStory;
    const saved = { ...story, scenes: buildLiteScenes(story, batch) };
    const inline = inlinePlan(saved, batch, 1);
    expect(sparseScenes(saved, 1, inline)).toEqual([0]);
    expect(sparseScenes({ ...saved, config: { ...saved.config, imagesPerScene: 1 } }, 1, inline)).toEqual([]);
    const directed = { question: "", choices: [], people: [], places: [], outfits: [], shots: [
      { at: "Synthetic narration line number 0", who: [], see: "Duplicate of the opening." },
      { at: "Synthetic narration line number 5", who: [], see: "The tide comes in." },
      { at: "Synthetic narration line number 9", who: [], see: "Gulls over the pier." }] };
    const applied = applyDirectorPlan(saved, 1, mergePlans(inline, directed), { choices: false, visuals: true });
    expect(applied.scenes[0].illustrations.map((f) => [f.atLine, f.prompt])).toEqual([[0, "The harbour at dawn."], [5, "The tide comes in."], [9, "Gulls over the pier."]]);
  });
});
