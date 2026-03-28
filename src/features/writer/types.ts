import type { WriterCharacterEditField } from "../../shared/types/contracts";
import { EMPTY_CHARACTER_EDIT_DRAFT, LENS_PRESET_IDS } from "./constants";

export type LensPresetId = typeof LENS_PRESET_IDS[number];

export type WritingWorkspaceMode = "books" | "characters";

export interface CharacterEditDraft {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  greeting: string;
  systemPrompt: string;
  mesExample: string;
  creatorNotes: string;
  tagsText: string;
}

export interface CharacterEditStatus {
  tone: "success" | "error";
  text: string;
}

export interface BackgroundTask {
  id: string;
  type: "generate" | "expand" | "rewrite" | "summarize" | "consistency" | "character";
  label: string;
  startedAt: number;
  status: "running" | "done" | "error";
  result?: string;
}

export const EMPTY_CHARACTER_EDIT_DRAFT_TYPED: CharacterEditDraft = { ...EMPTY_CHARACTER_EDIT_DRAFT };

export type CharacterAiField = WriterCharacterEditField;
