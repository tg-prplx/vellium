import type {
  WriterChapterSettings,
  WriterCharacterAdvancedOptions,
  WriterCharacterEditField,
  WriterProjectNotes
} from "../../shared/types/contracts";

export const SEVERITY_STYLES: Record<string, { badge: "warning" | "danger" | "default"; border: string }> = {
  low: { badge: "default", border: "border-border-subtle" },
  medium: { badge: "warning", border: "border-warning-border" },
  high: { badge: "danger", border: "border-danger-border" }
};

export const DEFAULT_CHAPTER_SETTINGS: WriterChapterSettings = {
  tone: "cinematic",
  pacing: "balanced",
  pov: "third_limited",
  creativity: 0.7,
  tension: 0.55,
  detail: 0.65,
  dialogue: 0.5
};

export const DEFAULT_WRITER_CHARACTER_ADVANCED: WriterCharacterAdvancedOptions = {
  name: "",
  role: "",
  personality: "",
  scenario: "",
  greetingStyle: "",
  systemPrompt: "",
  tags: "",
  notes: ""
};

export const DEFAULT_PROJECT_NOTES: WriterProjectNotes = {
  premise: "",
  styleGuide: "",
  characterNotes: "",
  worldRules: "",
  contextMode: "balanced",
  summary: ""
};

export const LENS_PRESET_IDS = [
  "characterArc",
  "objectTracker",
  "settingEvolution",
  "timelineProgression",
  "themeDevelopment"
] as const;

export const CHARACTER_AI_EDIT_FIELDS: WriterCharacterEditField[] = [
  "name",
  "description",
  "personality",
  "scenario",
  "greeting",
  "systemPrompt",
  "mesExample",
  "creatorNotes",
  "tags"
];

export const EMPTY_CHARACTER_EDIT_DRAFT = {
  name: "",
  description: "",
  personality: "",
  scenario: "",
  greeting: "",
  systemPrompt: "",
  mesExample: "",
  creatorNotes: "",
  tagsText: ""
};
