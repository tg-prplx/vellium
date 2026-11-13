import { describe, expect, it } from "vitest";
import { DEFAULT_NOVEL_CONFIG, type NovelCharacter, type NovelScene, type NovelStory } from "../../../src/shared/types/novels.js";
import { backgroundKey, registerLayerAssets, scenePresence, spriteBackdrop, spritePrompt } from "./layers.js";

// Synthetic cast and prose only.
const person = (id: string, name: string, appearance = "", outfit = ""): NovelCharacter => ({ id, name, description: "", appearance, personality: "", relationships: "", state: "", ...(outfit ? { outfit } : {}) });
const memory = { summary: "", facts: [], threads: [], characters: [person("m", "Mira Sol", "silver hair", "green raincoat"), person("r", "Ren", "black hair", "navy blazer"), person("a", "Aya", "white hair", "grey hoodie"), person("k", "Kai"), person("g", "Harbour crew"), person("me", "Tester")] };
memory.characters[4].isGroup = true;
const scene = (lines: Array<[string, string]>, location = "Test pier"): NovelScene => ({ id: Math.random().toString(36), title: "", location, pov: "", lines: lines.map(([speaker, text]) => ({ speaker, text })), question: "", choices: [], illustrations: [], memory, createdAt: "" });
const story = (pov: "first" | "third" = "third", scenes: NovelScene[] = []): NovelStory => ({ id: "layers", title: "", config: { ...DEFAULT_NOVEL_CONFIG, imagesEnabled: true, generationMode: "lite", visualMode: "layers", pov, protagonist: "Tester" }, cast: [], memory, scenes, turns: [], cursor: { scene: 0, line: 0 }, revision: 0, createdAt: "", updatedAt: "", cache: null });

describe("layers mode", () => {
  it("puts speakers and named people on screen in order, at most three, never a group", () => {
    const s = scene([["", "Ren waves from the railing while the Harbour crew works."], ["Mira", "There you are."], ["", "Aya and Kai arrive late."]]);
    expect(scenePresence(story(), s).map((c) => c.id)).toEqual(["r", "m", "a"]);
    expect(scenePresence(story(), scene([["Mira", "Hello."]])).map((c) => c.id)).toEqual(["m"]);
  });
  it("keeps a first-person narrator behind the camera", () => {
    const s = scene([["Tester", "I look around."], ["", "Ren nods at Tester."]]);
    expect(scenePresence(story("first"), s).map((c) => c.id)).toEqual(["r"]);
    expect(scenePresence(story("third"), s).map((c) => c.id)).toEqual(["me", "r"]);
  });
  it("picks a chroma backdrop the character does not wear", () => {
    expect(spriteBackdrop(person("x", "X", "red hair"), "white dress")).toBe("vivid green");
    expect(spriteBackdrop(person("x", "X", "silver hair"), "dark green raincoat")).toBe("vivid blue");
    expect(spriteBackdrop(person("x", "X", "teal eyes"), "green coat")).toBe("magenta");
    const prompt = spritePrompt(story(), memory.characters[0], "green raincoat");
    expect(prompt).toContain("vivid blue background"); expect(prompt).not.toContain("detailed background");
  });
  it("queues one background per place and one sprite per person and outfit, reusing both", () => {
    const first = registerLayerAssets(story("third", [scene([["Mira", "Hi."], ["Ren", "Hey."]])]), 1);
    expect(Object.keys(first.backgrounds!)).toEqual([backgroundKey("Test pier")]);
    expect(Object.values(first.sprites!).map((a) => [a.characterId, a.width, a.height, a.status])).toEqual([["m", 832, 1216, "pending"], ["r", 832, 1216, "pending"]]);
    const s = first.scenes[0];
    expect(s.background).toBe("test pier"); expect(s.present!.map((p) => p.characterId)).toEqual(["m", "r"]);
    const again = registerLayerAssets({ ...first, scenes: [...first.scenes, scene([["Mira", "Again."]], "test  PIER")] }, 1);
    expect(again.backgrounds).toEqual(first.backgrounds); expect(again.sprites).toEqual(first.sprites);
    const changed = registerLayerAssets({ ...first, scenes: [...first.scenes, { ...scene([["Mira", "New clothes."]], "Test archive"), visuals: { setting: "", outfits: { m: "black swimsuit" } } }] }, 1);
    expect(Object.keys(changed.backgrounds!)).toHaveLength(2); expect(Object.keys(changed.sprites!)).toHaveLength(3);
  });
});
