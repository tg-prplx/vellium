import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYSTEM_PROMPT,
  LEGACY_DEFAULT_SYSTEM_PROMPT,
  migrateDefaultSystemPrompt
} from "../db/defaultSettings.js";
import {
  buildMessageArray,
  buildMultiCharSystemPrompt,
  buildSystemPrompt,
  coalesceSystemMessages,
  type CharacterCardData,
  type PromptContext
} from "./rpEngine.js";
import { buildSillyTavernCompatiblePurePrompt } from "../modules/chat/promptContext.js";

function character(name: string): CharacterCardData {
  return {
    name,
    description: `${name} description`,
    personality: "direct",
    scenario: "A shared room",
    systemPrompt: "",
    mesExample: "",
    greeting: "",
    postHistoryInstructions: "",
    alternateGreetings: [],
    creator: "",
    characterVersion: "",
    extensions: {}
  };
}

function context(currentCharacter: CharacterCardData): PromptContext {
  return {
    blocks: [{ id: "system", kind: "system", enabled: true, order: 1, content: "" }],
    characterCard: currentCharacter,
    sceneState: null,
    authorNote: "",
    intensity: 0,
    responseLanguage: "English",
    censorshipMode: "",
    contextSummary: "",
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    strictGrounding: false,
    userName: "Reader"
  };
}

describe("default roleplay system prompt", () => {
  it("migrates only the previous untouched default", () => {
    expect(migrateDefaultSystemPrompt(undefined)).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(migrateDefaultSystemPrompt(LEGACY_DEFAULT_SYSTEM_PROMPT)).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(migrateDefaultSystemPrompt("My edited prompt for {{char}}")).toBe("My edited prompt for {{char}}");
    expect(migrateDefaultSystemPrompt("")).toBe("");
  });

  it("resolves char and user placeholders for single and multi-character prompts", () => {
    const alice = character("Alice");
    const bob = character("Bob");
    const singlePrompt = buildSystemPrompt(context(alice));
    const multiPrompt = buildMultiCharSystemPrompt(context(bob), [alice, bob], "Bob");

    expect(singlePrompt).toContain("You are an author writing Alice in an ongoing story with Reader.");
    expect(singlePrompt).toContain("Write Alice's next reply only.");
    expect(multiPrompt).toContain("You are an author writing Bob in an ongoing story with Reader.");
    expect(`${singlePrompt}\n${multiPrompt}`).not.toMatch(/\{\{(?:char|user)\}\}/i);
  });

  it("resolves placeholders in the pure-chat compatible prompt path", () => {
    const prompt = buildSillyTavernCompatiblePurePrompt({
      baseSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      currentCharacter: character("Mira"),
      characterCards: [character("Mira")],
      currentCharacterName: "Mira",
      userName: "Alex",
      strictGrounding: false
    });

    expect(prompt).toContain("writing Mira in an ongoing story with Alex");
    expect(prompt).not.toMatch(/\{\{(?:char|user)\}\}/i);
  });

  it("emits one combined system message at the beginning", () => {
    const messages = buildMessageArray(
      "Base system",
      [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" }
      ],
      "Keep the subtext quiet.",
      "Earlier context",
      "Alice",
      "Reader",
      "End with an actionable beat."
    );

    expect(messages.map((message) => message.role)).toEqual(["system", "user", "assistant"]);
    expect(messages.filter((message) => message.role === "system")).toHaveLength(1);
    expect(messages[0]?.content).toContain("Base system");
    expect(messages[0]?.content).toContain("[Previous context summary]");
    expect(messages[0]?.content).toContain("[Author's Note: Keep the subtext quiet.]");
    expect(messages[0]?.content).toContain("[Post-History Instructions]");
  });

  it("moves late system instructions into the same leading message", () => {
    const normalized = coalesceSystemMessages([
      { role: "user", content: "First user turn" },
      { role: "system", content: "Base" },
      { role: "assistant", content: "Reply" },
      { role: "system", content: "Tool policy" }
    ]);

    expect(normalized).toEqual([
      { role: "system", content: "Base\n\nTool policy" },
      { role: "user", content: "First user turn" },
      { role: "assistant", content: "Reply" }
    ]);
  });
});
