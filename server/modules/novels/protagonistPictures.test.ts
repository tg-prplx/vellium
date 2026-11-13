import { describe, expect, it } from "vitest";
import { DEFAULT_NOVEL_CONFIG, type NovelStory } from "../../../src/shared/types/novels.js";
import { parseLiteText } from "./liteFormat.js";
import { applyDirectorPlan } from "./liteDirector.js";
import { inlinePlan } from "./liteInline.js";
import { buildLiteScenes } from "./liteScenes.js";
import { novelImagePrompt } from "./imagePrompt.js";
import { inferCamera, PROTAGONIST_ID } from "./protagonist.js";

// Synthetic first-person story: the protagonist is a persona, Mika is a known character.
const mika = { id: "mika", name: "Mika", description: "", appearance: "young woman, long dark blue hair, violet eyes", personality: "", relationships: "", state: "", outfit: "black swimsuit" };
function story(pov: "first" | "third" = "first", imagePov: "dynamic" | "third" = "dynamic"): NovelStory {
  return { id: "p", title: "", config: { ...DEFAULT_NOVEL_CONFIG, imagesEnabled: true, generationMode: "lite", inlinePictures: true, pov, imagePov },
    persona: { id: "persona", name: "Ilya", description: "young man, short brown hair, tanned", personality: "" },
    cast: [], memory: { summary: "", facts: [], threads: [], characters: [mika] }, scenes: [], turns: [], cursor: { scene: 0, line: 0 }, revision: 0, createdAt: "", updatedAt: "", cache: null };
}
function draw(s: NovelStory, reply: string) {
  const batch = parseLiteText(reply, ["Mika"]);
  const saved = { ...s, scenes: buildLiteScenes(s, batch) };
  const applied = applyDirectorPlan(saved, saved.scenes.length, inlinePlan(saved, batch, saved.scenes.length), { choices: false, visuals: true });
  const scene = applied.scenes[0], frame = scene.illustrations[0];
  return { frame, prompt: novelImagePrompt(applied, scene, frame) };
}

describe("pictures of a first-person narrator", () => {
  it("chooses a camera from an explicit hint, then from the narrator's involvement", () => {
    expect(inferCamera(story(), { who: ["Mika"], see: "Mika waves.", hint: "pov" })).toBe("first-person");
    expect(inferCamera(story(), { who: ["Mika"], see: "Mika takes the glass from my hand." })).toBe("first-person");
    expect(inferCamera(story(), { who: ["Mika", "me"], see: "Mika and I laugh.", hint: "wide" })).toBe("external");
    expect(inferCamera(story(), { who: ["Mika"], see: "Mika looks at the sea." })).toBeUndefined();
    expect(inferCamera(story("third"), { who: ["Mika"], see: "Mika takes the glass from my hand." })).toBeUndefined();
  });
  it("draws 'takes the glass from my hand' through the narrator's eyes with their hand", () => {
    const { frame, prompt } = draw(story(), "Mika snatches the glass from my hand.\n[pic: Mika | Mika snatches the glass from my hand, drops splash onto my palm.]");
    expect(frame.camera).toBe("first-person");
    expect(frame.characterIds).toEqual(["mika"]);
    expect(prompt).toMatch(/^.*\n\npov hands, pov, first-person view/);
    expect(prompt).toContain("Mika has young woman, long dark blue hair, violet eyes.");
    expect(prompt).not.toContain("short brown hair");
  });
  it("shows the protagonist, by name, in an outside picture about them", () => {
    const { frame, prompt } = draw(story(), "Mika snatches the glass from my hand.\n[pic: Mika | Mika snatches the glass from my hand. | wide]");
    expect(frame.camera).toBe("external");
    expect(frame.characterIds).toEqual(["mika", PROTAGONIST_ID]);
    expect(prompt).toContain("Ilya has young man, short brown hair, tanned.");
    expect(prompt).toContain("Mika snatches the glass from Ilya's hand.");
    expect(prompt).not.toMatch(/\bmy\b/);
  });
  it("resolves 'me' among the names to the protagonist", () => {
    const { frame } = draw(story("first", "third"), "We stand together on the synthetic pier.\n[pic: Mika, me | Mika and I stand side by side on the pier.]");
    expect(frame.characterIds).toEqual(["mika", PROTAGONIST_ID]);
  });
  it("adds head-count tags only when everyone's sex is clear", async () => {
    const { headCountTags } = await import("./imagePrompt.js");
    const p = (appearance: string) => ({ appearance, description: "" });
    expect(headCountTags([p("young woman, long hair"), p("young man, short hair")])).toBe("1girl, 1boy");
    expect(headCountTags([p("girl, red eyes"), p("woman, tall")])).toBe("2girls");
    expect(headCountTags([p("young woman"), p("tall figure in a cloak")])).toBe("");
    expect(headCountTags([])).toBe("");
    const { prompt } = draw(story(), "Mika snatches the glass from my hand.\n[pic: Mika | Mika snatches the glass from my hand. | wide]");
    expect(prompt).toContain("1girl, 1boy. Only 2 people are visible: Mika, Ilya.");
  });
});
