import { describe, expect, it } from "vitest";
import { readCharacterSceneDefaults } from "./characterSceneDefaults.js";

function cardWithSceneDefaults(defaults: Record<string, unknown>) {
  return JSON.stringify({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "Scene Character",
      extensions: {
        vellium_scene_state: defaults
      }
    }
  });
}

describe("readCharacterSceneDefaults", () => {
  it("normalizes enabled per-character defaults for a new chat", () => {
    const result = readCharacterSceneDefaults(cardWithSceneDefaults({
      enabled: true,
      mood: " tense ",
      pacing: "fast",
      intensity: 1.8,
      variables: {
        dialogueStyle: "formal",
        initiative: 150,
        descriptiveness: "42"
      }
    }), "chat-1");

    expect(result).toEqual({
      chatId: "chat-1",
      mood: "tense",
      pacing: "fast",
      intensity: 1,
      variables: {
        dialogueStyle: "formal",
        initiative: "100",
        descriptiveness: "42"
      },
      chatMode: "rp",
      pureChatMode: false
    });
  });

  it("does not initialize a chat when character defaults are disabled or malformed", () => {
    expect(readCharacterSceneDefaults(cardWithSceneDefaults({
      enabled: false,
      mood: "quiet"
    }), "chat-2")).toBeNull();
    expect(readCharacterSceneDefaults("{broken", "chat-3")).toBeNull();
  });
});
