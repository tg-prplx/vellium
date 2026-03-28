import { db } from "../../db.js";

export const KOBOLD_TAGS = {
  systemOpen: "{{[SYSTEM]}}",
  systemClose: "{{[SYSTEM_END]}}",
  inputOpen: "{{[INPUT]}}",
  inputClose: "{{[INPUT_END]}}",
  outputOpen: "{{[OUTPUT]}}"
};

export interface ProviderRow {
  id: string;
  base_url: string;
  api_key_cipher: string;
  full_local_only: number;
  provider_type: string;
  adapter_id: string | null;
}

export interface CharacterRow {
  id: string;
  name: string;
  card_json: string;
  lorebook_id: string | null;
  avatar_path: string | null;
  tags: string | null;
  greeting: string | null;
  system_prompt: string | null;
  description: string | null;
  personality: string | null;
  scenario: string | null;
  mes_example: string | null;
  creator_notes: string | null;
  created_at: string;
}

export interface WriterChapterSettings {
  tone: string;
  pacing: "slow" | "balanced" | "fast";
  pov: "first_person" | "third_limited" | "third_omniscient";
  creativity: number;
  tension: number;
  detail: number;
  dialogue: number;
}

export interface WriterSampler {
  temperature: number;
  maxTokens: number;
}

export interface WriterProjectNotes {
  premise: string;
  styleGuide: string;
  characterNotes: string;
  worldRules: string;
  contextMode: "economy" | "balanced" | "rich";
  summary: string;
}

export type WriterSummaryLensScope = "project" | "chapter" | "scene";

export interface WriterSummaryLensRow {
  id: string;
  project_id: string;
  name: string;
  scope: WriterSummaryLensScope;
  target_id: string | null;
  prompt: string;
  output: string;
  source_hash: string;
  created_at: string;
  updated_at: string;
}

export type WriterDocxParseMode = "auto" | "chapter_markers" | "heading_lines" | "single_book";

export interface WriterCharacterAdvancedInput {
  name?: unknown;
  role?: unknown;
  personality?: unknown;
  scenario?: unknown;
  greetingStyle?: unknown;
  systemPrompt?: unknown;
  tags?: unknown;
  notes?: unknown;
}

export interface WriterCharacterDraft {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  greeting: string;
  systemPrompt: string;
  mesExample: string;
  creatorNotes: string;
  tags: string[];
}

export type WriterCharacterPatchField =
  | "name"
  | "description"
  | "personality"
  | "scenario"
  | "greeting"
  | "systemPrompt"
  | "mesExample"
  | "creatorNotes"
  | "tags";

export interface WriterCharacterPatch {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  greeting?: string;
  systemPrompt?: string;
  mesExample?: string;
  creatorNotes?: string;
  tags?: string[];
}

export const WRITER_CHARACTER_PATCH_FIELDS: readonly WriterCharacterPatchField[] = [
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

const WRITER_CHARACTER_PATCH_FIELD_SET = new Set<string>(WRITER_CHARACTER_PATCH_FIELDS);

export const DEFAULT_CHAPTER_SETTINGS: WriterChapterSettings = {
  tone: "cinematic",
  pacing: "balanced",
  pov: "third_limited",
  creativity: 0.7,
  tension: 0.55,
  detail: 0.65,
  dialogue: 0.5
};

export const DEFAULT_PROJECT_NOTES: WriterProjectNotes = {
  premise: "",
  styleGuide: "",
  characterNotes: "",
  worldRules: "",
  contextMode: "balanced",
  summary: ""
};

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function parseCardData(cardJson: string | null | undefined): Record<string, unknown> {
  if (!cardJson) return {};
  try {
    const parsed = JSON.parse(cardJson) as { data?: unknown };
    if (parsed?.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)) {
      return parsed.data as Record<string, unknown>;
    }
  } catch {
    // Ignore invalid card payloads.
  }
  return {};
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function characterToJson(row: CharacterRow) {
  const cardData = parseCardData(row.card_json);
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags || "[]");
    if (Array.isArray(parsed)) tags = parsed.map((x) => String(x || "").trim()).filter(Boolean);
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_path ? (row.avatar_path.startsWith("http") ? row.avatar_path : `/api/avatars/${row.avatar_path}`) : null,
    lorebookId: row.lorebook_id || null,
    tags,
    greeting: row.greeting || "",
    systemPrompt: row.system_prompt || "",
    description: row.description || "",
    personality: row.personality || "",
    scenario: row.scenario || "",
    mesExample: row.mes_example || "",
    creatorNotes: row.creator_notes || "",
    alternateGreetings: parseStringArray(cardData.alternate_greetings),
    postHistoryInstructions: typeof cardData.post_history_instructions === "string" ? cardData.post_history_instructions : "",
    creator: typeof cardData.creator === "string" ? cardData.creator : "",
    characterVersion: typeof cardData.character_version === "string" ? cardData.character_version : "",
    creatorNotesMultilingual: parseObject(cardData.creator_notes_multilingual),
    extensions: parseObject(cardData.extensions),
    cardJson: row.card_json,
    createdAt: row.created_at
  };
}

export function toCleanText(value: unknown, maxLen: number): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maxLen);
}

export function parseTagList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 16);
  }
  if (typeof value === "string") {
    return [...new Set(value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))].slice(0, 16);
  }
  return [];
}

export function extractFirstJsonObject(raw: string): Record<string, unknown> | null {
  const direct = raw.trim();
  if (direct.startsWith("{") && direct.endsWith("}")) {
    try {
      const parsed = JSON.parse(direct);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Continue with substring scanning.
    }
  }

  for (let start = raw.indexOf("{"); start >= 0; start = raw.indexOf("{", start + 1)) {
    let depth = 0;
    for (let index = start; index < raw.length; index += 1) {
      const ch = raw[index];
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = raw.slice(start, index + 1);
          try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              return parsed as Record<string, unknown>;
            }
          } catch {
            // Continue scanning.
          }
          break;
        }
      }
    }
  }

  return null;
}

export function buildCharacterDraft(
  parsed: Record<string, unknown> | null,
  descriptionPrompt: string,
  advanced: WriterCharacterAdvancedInput | undefined
): WriterCharacterDraft {
  const data = parsed || {};
  const name = toCleanText(
    data.name ?? advanced?.name ?? "New Character",
    80
  ) || "New Character";
  const description = toCleanText(
    data.description ?? descriptionPrompt,
    2000
  ) || descriptionPrompt.slice(0, 2000);
  const personality = toCleanText(
    data.personality ?? advanced?.personality ?? "Expressive, consistent, and grounded in their own motives.",
    2000
  );
  const scenario = toCleanText(
    data.scenario ?? advanced?.scenario ?? advanced?.role ?? descriptionPrompt,
    2000
  );
  const greeting = toCleanText(
    data.greeting ?? data.first_mes ?? `${name} glances up with a faint, curious smile. "So, where do we begin?"`,
    1200
  );
  const systemPrompt = toCleanText(
    data.systemPrompt ?? data.system_prompt ?? advanced?.systemPrompt ?? `Stay in character as ${name}. Keep voice consistent and reactive to context.`,
    1600
  );
  const mesExample = toCleanText(
    data.mesExample ?? data.mes_example ?? `<START>\n{{user}}: Tell me about yourself.\n${name}: ${greeting}`,
    2000
  );
  const creatorNotes = toCleanText(
    data.creatorNotes ?? data.creator_notes ?? advanced?.notes ?? "Generated from Writing character builder.",
    2000
  );

  const tagsFromModel = parseTagList(data.tags);
  const tagsFromAdvanced = parseTagList(advanced?.tags);
  const tags = [...new Set([...tagsFromModel, ...tagsFromAdvanced])].slice(0, 16);

  return {
    name,
    description,
    personality,
    scenario,
    greeting,
    systemPrompt,
    mesExample,
    creatorNotes,
    tags
  };
}

export function parseCharacterTagsJson(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return parseTagList(parsed);
  } catch {
    return [];
  }
}

export function parseWriterCharacterPatchFields(raw: unknown): WriterCharacterPatchField[] {
  if (!Array.isArray(raw)) return [];
  const values = raw
    .map((item) => String(item || "").trim())
    .filter((item) => WRITER_CHARACTER_PATCH_FIELD_SET.has(item)) as WriterCharacterPatchField[];
  return [...new Set(values)];
}

export function buildWriterCharacterPatch(parsed: Record<string, unknown> | null): WriterCharacterPatch {
  if (!parsed) return {};
  const patch: WriterCharacterPatch = {};

  if ("name" in parsed) patch.name = toCleanText(parsed.name, 80);
  if ("description" in parsed) patch.description = toCleanText(parsed.description, 2000);
  if ("personality" in parsed) patch.personality = toCleanText(parsed.personality, 2000);
  if ("scenario" in parsed) patch.scenario = toCleanText(parsed.scenario, 2000);
  if ("greeting" in parsed || "first_mes" in parsed) patch.greeting = toCleanText(parsed.greeting ?? parsed.first_mes, 1200);
  if ("systemPrompt" in parsed || "system_prompt" in parsed) patch.systemPrompt = toCleanText(parsed.systemPrompt ?? parsed.system_prompt, 1600);
  if ("mesExample" in parsed || "mes_example" in parsed) patch.mesExample = toCleanText(parsed.mesExample ?? parsed.mes_example, 2000);
  if ("creatorNotes" in parsed || "creator_notes" in parsed) patch.creatorNotes = toCleanText(parsed.creatorNotes ?? parsed.creator_notes, 2000);
  if ("tags" in parsed) patch.tags = parseTagList(parsed.tags);

  return patch;
}

export function filterWriterCharacterPatch(patch: WriterCharacterPatch, fields: WriterCharacterPatchField[]): WriterCharacterPatch {
  if (fields.length === 0) return patch;
  const allowed = new Set(fields);
  const filtered: WriterCharacterPatch = {};
  for (const key of WRITER_CHARACTER_PATCH_FIELDS) {
    if (allowed.has(key) && patch[key] !== undefined) {
      filtered[key] = patch[key];
    }
  }
  return filtered;
}

export function updateCharacterWithPatch(existing: CharacterRow, patch: WriterCharacterPatch): CharacterRow {
  const tags = patch.tags ?? parseCharacterTagsJson(existing.tags);
  const name = patch.name !== undefined ? (toCleanText(patch.name, 80) || existing.name || "New Character") : existing.name;
  const description = patch.description ?? (existing.description || "");
  const personality = patch.personality ?? (existing.personality || "");
  const scenario = patch.scenario ?? (existing.scenario || "");
  const greeting = patch.greeting ?? (existing.greeting || "");
  const systemPrompt = patch.systemPrompt ?? (existing.system_prompt || "");
  const mesExample = patch.mesExample ?? (existing.mes_example || "");
  const creatorNotes = patch.creatorNotes ?? (existing.creator_notes || "");

  let cardData: Record<string, unknown>;
  try {
    const parsed = JSON.parse(existing.card_json) as { data?: Record<string, unknown> };
    cardData = (parsed && parsed.data && typeof parsed.data === "object") ? { ...parsed.data } : {};
  } catch {
    cardData = {};
  }

  cardData.name = name;
  cardData.description = description;
  cardData.personality = personality;
  cardData.scenario = scenario;
  cardData.first_mes = greeting;
  cardData.system_prompt = systemPrompt;
  cardData.mes_example = mesExample;
  cardData.creator_notes = creatorNotes;
  cardData.tags = tags;

  const cardJson = JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: cardData }, null, 2);

  db.prepare(
    `UPDATE characters SET name = ?, description = ?, personality = ?, scenario = ?, greeting = ?,
     system_prompt = ?, tags = ?, mes_example = ?, creator_notes = ?, card_json = ? WHERE id = ?`
  ).run(
    name,
    description,
    personality,
    scenario,
    greeting,
    systemPrompt,
    JSON.stringify(tags),
    mesExample,
    creatorNotes,
    cardJson,
    existing.id
  );

  return db.prepare("SELECT * FROM characters WHERE id = ?").get(existing.id) as CharacterRow;
}

export function parseIdArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.map((item) => String(item || "").trim()).filter(Boolean);
  return [...new Set(ids)];
}

export function parseJsonIdArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    return parseIdArray(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function normalizeProjectName(input: unknown, fallback = "Untitled Book"): string {
  const value = String(input ?? "").trim();
  return value || fallback;
}

export function normalizeChapterTitle(input: unknown, fallback = "Untitled Chapter"): string {
  const value = String(input ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  return value || fallback;
}

export function normalizeProjectNotes(input: unknown): WriterProjectNotes {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...DEFAULT_PROJECT_NOTES };
  }
  const row = input as Partial<WriterProjectNotes>;
  const contextMode = row.contextMode === "economy" || row.contextMode === "rich"
    ? row.contextMode
    : "balanced";
  return {
    premise: toCleanText(row.premise, 6000),
    styleGuide: toCleanText(row.styleGuide, 6000),
    characterNotes: toCleanText(row.characterNotes, 12000),
    worldRules: toCleanText(row.worldRules, 8000),
    contextMode,
    summary: toCleanText(row.summary, 20000)
  };
}

export function parseProjectNotes(raw: string | null | undefined): WriterProjectNotes {
  if (!raw) return { ...DEFAULT_PROJECT_NOTES };
  try {
    return normalizeProjectNotes(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PROJECT_NOTES };
  }
}
