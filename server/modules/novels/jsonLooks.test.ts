import { describe, expect, it } from "vitest";
import { DEFAULT_NOVEL_CONFIG, type NovelStory } from "../../../src/shared/types/novels.js";
import { describeForPictures, novelMessages, parseNovelBatch } from "./prompts.js";
import { defaultNovelSystemPrompt } from "./systemPrompt.js";
import { novelResponseFormat } from "./responseSchema.js";
import { novelImagePrompt } from "./imagePrompt.js";

// Synthetic JSON-mode story with a card character whose description is prose.
const mika = { id: "card-mika", sourceCharacterId: "card-mika", name: "Мика", description: "Мика — дерзкая и уверенная в себе девушка.", appearance: "Мика — дерзкая и уверенная в себе девушка.", personality: "", relationships: "", state: "" };
const story = (): NovelStory => ({ id: "j", title: "", config: { ...DEFAULT_NOVEL_CONFIG, generationMode: "json", imagesEnabled: true, structuredOutput: "json_schema" }, cast: [mika], settingCards: [],
  memory: { summary: "", facts: [], threads: [], characters: [mika] }, scenes: [], turns: [], cursor: { scene: 0, line: 0 }, revision: 0, createdAt: "", updatedAt: "", cache: null });

describe("picture looks in JSON mode", () => {
  it("asks per turn for people without a picture look or clothes, never in the system prefix", () => {
    const s = story();
    expect(describeForPictures(s)).toEqual([{ id: "card-mika", name: "Мика", missing: ["look", "outfit"] }]);
    const { user, messages } = novelMessages(s, "Continue");
    expect(JSON.parse(user).describeForPictures).toEqual(describeForPictures(s));
    expect(messages[0].content).not.toContain("card-mika\",\"name\":\"Мика\",\"missing");
    expect(defaultNovelSystemPrompt(s.config)).toContain("describeForPictures lists known people");
    expect(defaultNovelSystemPrompt({ ...s.config, imagesEnabled: false })).not.toContain("describeForPictures");
    expect(JSON.parse(novelMessages({ ...s, config: { ...s.config, imagesEnabled: false } }, "x").user).describeForPictures).toBeUndefined();
  });
  it("accepts look and clothes for a known person and draws them instead of the card prose", () => {
    const s = story();
    const reply = JSON.stringify({ characters: [{ id: "card-mika", look: "young woman, fair skin, long straight black hair, blue eyes, slim build", outfit: "black one-piece swimsuit" }],
      scenes: [{ location: "Pool", lines: ["Мика ухмыляется у шезлонга."], illustrations: [{ prompt: "Mika smirks by the lounger.", characterIds: ["card-mika"] }] }] });
    const scenes = parseNovelBatch(reply, s);
    const person = scenes[0].memory.characters.find((c) => c.id === "card-mika")!;
    expect(person).toMatchObject({ look: expect.stringContaining("fair skin"), outfit: "black one-piece swimsuit", appearance: mika.appearance });
    const next = { ...s, scenes, memory: scenes[0].memory };
    expect(describeForPictures(next)).toEqual([]);
    const prompt = novelImagePrompt(next, scenes[0], scenes[0].illustrations[0]);
    expect(prompt).toContain("Мика has young woman, fair skin, long straight black hair, blue eyes, slim build.");
    expect(prompt).toContain("Мика is wearing black one-piece swimsuit.");
    expect(prompt).not.toContain("дерзкая");
  });
  it("allows look in the strict schema", () => {
    const format = novelResponseFormat(story().config, { id: "p", name: "LM Studio", base_url: "http://127.0.0.1:1234", api_key_cipher: "", provider_type: "openai" })!;
    const schema = format.json_schema.schema as { properties: { characters: { items: { properties: Record<string, unknown> } } } };
    expect(schema.properties.characters.items.properties.look).toEqual({ type: "string" });
  });
});
