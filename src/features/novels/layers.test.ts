import { describe, expect, it } from "vitest";
import { DEFAULT_NOVEL_CONFIG, type NovelStory } from "../../shared/types/novels";
import { novelImageQueue, sceneFrames, stageFor, usesLayers } from "./layers";

const memory = { summary: "", facts: [], threads: [], characters: ["Mira Sol", "Ren", "Aya"].map((name) => ({ id: name[0].toLowerCase(), name, description: "", appearance: "", personality: "", relationships: "", state: "" })) };
const asset = (id: string, status: "ready" | "pending", cut = true) => ({ id, kind: "sprite" as const, prompt: "", seed: 1, url: status === "ready" ? `/api/uploads/${id}.png` : null, status, width: 832, height: 1216, cut });
const story = { id: "s", title: "", config: { ...DEFAULT_NOVEL_CONFIG, imagesEnabled: true, generationMode: "lite", visualMode: "layers" }, cast: [], memory, turns: [], cursor: { scene: 0, line: 0 }, revision: 0, createdAt: "", updatedAt: "", cache: null,
  backgrounds: { pier: { ...asset("bg", "ready"), kind: "background" as const } }, sprites: { "m:1": asset("m1", "ready"), "r:1": asset("r1", "ready", false), "a:1": asset("a1", "pending") },
  scenes: [{ id: "x", title: "", location: "Pier", pov: "", background: "pier", present: [{ characterId: "m", sprite: "m:1" }, { characterId: "r", sprite: "r:1" }, { characterId: "a", sprite: "a:1" }], lines: [], question: "", choices: [], illustrations: [], memory, createdAt: "" }] } as unknown as NovelStory;

describe("layered stage", () => {
  it("shows the background and only ready sprites, lighting the speaker", () => {
    const stage = stageFor(story, story.scenes[0], "Mira");
    expect(stage.background).toBe("/api/uploads/bg.png");
    expect(stage.sprites.map((s) => [s.characterId, s.slot, s.speaking, s.cut])).toEqual([["m", "left", true, true], ["r", "right", false, false]]);
    expect(stageFor(story, story.scenes[0], "").sprites.every((s) => !s.speaking)).toBe(true);
  });
  it("queues backgrounds, then sprites, then frames, and needs lite mode", () => {
    expect(novelImageQueue(story).map((item) => item.id)).toEqual(["bg", "m1", "r1", "a1"]);
    expect(usesLayers(story.config)).toBe(true);
    expect(usesLayers({ ...story.config, generationMode: "json" })).toBe(false);
  });
  it("keeps an action frame at its own line", () => {
    const frame = (atLine: number) => ({ id: String(atLine), prompt: "", characterIds: [], atLine, seed: 1, url: null, status: "ready" as const });
    expect(sceneFrames([frame(5), frame(2)]).map((f) => f.atLine)).toEqual([2, 5]);
  });
});
