import type { PromptBlock, RpSceneState } from "../../shared/types/contracts";

export const RP_PRESETS = ["slowburn", "dominant", "romantic", "action", "mystery", "submissive", "seductive", "gentle_fem", "rough", "passionate"] as const;
export const DEFAULT_AUTHOR_NOTE = "Stay in character, avoid repetition, keep sensual pacing controlled.";
export type ChatMode = "rp" | "light_rp" | "pure_chat";

export const DEFAULT_PROMPT_STACK: PromptBlock[] = [
  { id: "default-1", kind: "system", enabled: true, order: 1, content: "" },
  { id: "default-2", kind: "jailbreak", enabled: true, order: 2, content: "Never break character. Write as the character would, staying true to their personality." },
  { id: "default-3", kind: "character", enabled: true, order: 3, content: "" },
  { id: "default-4", kind: "author_note", enabled: true, order: 4, content: "" },
  { id: "default-5", kind: "lore", enabled: false, order: 5, content: "" },
  { id: "default-6", kind: "scene", enabled: true, order: 6, content: "" },
  { id: "default-7", kind: "history", enabled: true, order: 7, content: "" }
];

export const DEFAULT_SCENE_FIELD_VISIBILITY = {
  dialogueStyle: true,
  initiative: true,
  descriptiveness: true,
  unpredictability: true,
  emotionalDepth: true
};

export const DEFAULT_SCENE_STATE: Omit<RpSceneState, "chatId"> = {
  variables: {
    dialogueStyle: "teasing",
    initiative: "65",
    descriptiveness: "70",
    unpredictability: "45",
    emotionalDepth: "75"
  },
  mood: "teasing",
  pacing: "slow",
  intensity: 0.7,
  chatMode: "rp",
  pureChatMode: false
};

export const REASONING_CALL_NAME = "__reasoning__";
export const MESSAGE_DELETE_ANIMATION_MS = 180;
