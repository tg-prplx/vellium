import { describe, expect, it } from "vitest";
import { DEFAULT_NOVEL_CONFIG, type NovelScene, type NovelStory } from "../../../src/shared/types/novels.js";
import { renderLiteScenes } from "./liteFormat.js";
import { defaultLiteSystemPrompt, liteMessages } from "./litePrompt.js";
import { novelMessages } from "./prompts.js";

// Synthetic five-turn story, identical prose in both modes: compares the size
// of what each mode sends and what the model has to write per turn.
const memory = { summary: "", facts: [], threads: [], characters: [{ id: "mira", name: "Mira", description: "", appearance: "young woman, short silver hair, grey eyes", personality: "", relationships: "", state: "", outfit: "dark green raincoat" }] };
function scene(turn: number, n: number): NovelScene {
  return { id: `s${turn}-${n}`, title: "", location: `Test hall ${turn}`, pov: "Tester", question: "", choices: [], memory, createdAt: "",
    lines: Array.from({ length: 8 }, (_, i) => i % 3 === 1 ? { speaker: "Mira", text: `Synthetic reply ${turn}.${n}.${i}, spoken quietly near the lantern.` } : { speaker: "", text: `Synthetic narration ${turn}.${n}.${i} describes the invented hall and its cold air.` }),
    illustrations: [0, 4].map((atLine) => ({ id: `f${turn}${n}${atLine}`, prompt: "Medium shot of Mira turning toward the lantern, one hand raised.", characterIds: ["mira"], atLine, seed: 1, url: null, status: "pending" as const, camera: "external" as const })) };
}
function build(mode: "json" | "lite"): NovelStory {
  const config = { ...DEFAULT_NOVEL_CONFIG, generationMode: mode, imagesEnabled: true, premise: "A synthetic harbour town with an invented archive.", questionFrequency: "off" as const };
  const base: NovelStory = { id: "budget", title: "Budget", config, cast: [], memory, scenes: [], turns: [], cursor: { scene: 0, line: 0 }, revision: 0, createdAt: "", updatedAt: "", cache: null };
  for (let turn = 0; turn < 5; turn++) {
    const scenes = [scene(turn, 0), scene(turn, 1)];
    const user = mode === "json" ? novelMessages(base, `Synthetic action ${turn}`).user : liteMessages(base, `Synthetic action ${turn}`).user;
    const assistant = mode === "json"
      ? JSON.stringify({ characters: turn ? [{ id: "mira", state: "calm" }] : memory.characters, scenes: scenes.map((s) => ({ location: s.location, lines: s.lines.map((l) => l.speaker ? l : l.text), illustrations: s.illustrations.map((f) => ({ prompt: f.prompt, characterIds: f.characterIds, atLine: f.atLine, camera: f.camera })) })) })
      : renderLiteScenes(scenes, base.scenes.at(-1)?.location || "");
    base.scenes.push(...scenes);
    base.turns.push({ user: mode === "json" ? user : JSON.stringify({ action: `Synthetic action ${turn}` }), assistant: mode === "json" ? assistant : JSON.stringify({ scenes }), throughSceneId: scenes[1].id, ...(mode === "lite" ? { lite: { user, assistant } } : {}) });
  }
  return base;
}
const size = (messages: Array<{ content: unknown }>) => messages.reduce((sum, m) => sum + String(m.content).length, 0);

describe("lite prompt budget", () => {
  it("keeps the lite system prompt short and sends less than JSON mode", () => {
    expect(defaultLiteSystemPrompt(DEFAULT_NOVEL_CONFIG).length).toBeLessThan(2000);
    const json = build("json"), lite = build("lite");
    const jsonRequest = novelMessages(json, "Next synthetic action").messages, liteRequest = liteMessages(lite, "Next synthetic action").messages;
    const jsonReply = json.turns[4].assistant.length, liteReply = lite.turns[4].lite!.assistant.length;
    console.info(`[budget] system ${jsonRequest[0].content.length} -> ${liteRequest[0].content.length} chars; request ${size(jsonRequest)} -> ${size(liteRequest)} chars; reply per turn ${jsonReply} -> ${liteReply} chars`);
    expect(liteRequest[0].content.length).toBeLessThan(jsonRequest[0].content.length / 2);
    expect(size(liteRequest)).toBeLessThan(size(jsonRequest));
    expect(liteReply).toBeLessThan(jsonReply);
  });
});
