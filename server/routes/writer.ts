import { Router } from "express";
import { createHash } from "crypto";
import { writeFileSync } from "fs";
import { join } from "path";
import mammoth from "mammoth";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { db, newId, now, DATA_DIR, DEFAULT_SETTINGS } from "../db.js";
import { runConsistency } from "../domain/writerEngine.js";
import { buildKoboldGenerateBody, extractKoboldGeneratedText, normalizeProviderType, requestKoboldGenerate } from "../services/providerApi.js";
import { buildKoboldSamplerConfig, buildOpenAiSamplingPayload, normalizeApiParamPolicy } from "../services/apiParamPolicy.js";

const router = Router();
const KOBOLD_TAGS = {
  systemOpen: "{{[SYSTEM]}}",
  systemClose: "{{[SYSTEM_END]}}",
  inputOpen: "{{[INPUT]}}",
  inputClose: "{{[INPUT_END]}}",
  outputOpen: "{{[OUTPUT]}}"
};

interface ProviderRow {
  id: string;
  base_url: string;
  api_key_cipher: string;
  full_local_only: number;
  provider_type: string;
}

interface CharacterRow {
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

interface WriterChapterSettings {
  tone: string;
  pacing: "slow" | "balanced" | "fast";
  pov: "first_person" | "third_limited" | "third_omniscient";
  creativity: number;
  tension: number;
  detail: number;
  dialogue: number;
}

interface WriterSampler {
  temperature: number;
  maxTokens: number;
}

interface WriterProjectNotes {
  premise: string;
  styleGuide: string;
  characterNotes: string;
  worldRules: string;
  contextMode: "economy" | "balanced" | "rich";
  summary: string;
}

type WriterSummaryLensScope = "project" | "chapter" | "scene";

interface WriterSummaryLensRow {
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

type WriterDocxParseMode = "auto" | "chapter_markers" | "heading_lines" | "single_book";

interface ParsedDocxChapter {
  title: string;
  content: string;
}

interface WriterCharacterAdvancedInput {
  name?: unknown;
  role?: unknown;
  personality?: unknown;
  scenario?: unknown;
  greetingStyle?: unknown;
  systemPrompt?: unknown;
  tags?: unknown;
  notes?: unknown;
}

interface WriterCharacterDraft {
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

type WriterCharacterPatchField =
  | "name"
  | "description"
  | "personality"
  | "scenario"
  | "greeting"
  | "systemPrompt"
  | "mesExample"
  | "creatorNotes"
  | "tags";

interface WriterCharacterPatch {
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

const WRITER_CHARACTER_PATCH_FIELDS: readonly WriterCharacterPatchField[] = [
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

const DEFAULT_CHAPTER_SETTINGS: WriterChapterSettings = {
  tone: "cinematic",
  pacing: "balanced",
  pov: "third_limited",
  creativity: 0.7,
  tension: 0.55,
  detail: 0.65,
  dialogue: 0.5
};

const DEFAULT_PROJECT_NOTES: WriterProjectNotes = {
  premise: "",
  styleGuide: "",
  characterNotes: "",
  worldRules: "",
  contextMode: "balanced",
  summary: ""
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseCardData(cardJson: string | null | undefined): Record<string, unknown> {
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

function characterToJson(row: CharacterRow) {
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

function toCleanText(value: unknown, maxLen: number): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maxLen);
}

function parseTagList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 16);
  }
  if (typeof value === "string") {
    return [...new Set(value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))].slice(0, 16);
  }
  return [];
}

function extractFirstJsonObject(raw: string): Record<string, unknown> | null {
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
    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = raw.slice(start, i + 1);
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

function buildCharacterDraft(
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

function parseCharacterTagsJson(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return parseTagList(parsed);
  } catch {
    return [];
  }
}

function parseWriterCharacterPatchFields(raw: unknown): WriterCharacterPatchField[] {
  if (!Array.isArray(raw)) return [];
  const values = raw
    .map((item) => String(item || "").trim())
    .filter((item) => WRITER_CHARACTER_PATCH_FIELD_SET.has(item)) as WriterCharacterPatchField[];
  return [...new Set(values)];
}

function buildWriterCharacterPatch(parsed: Record<string, unknown> | null): WriterCharacterPatch {
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

function filterWriterCharacterPatch(patch: WriterCharacterPatch, fields: WriterCharacterPatchField[]): WriterCharacterPatch {
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

function updateCharacterWithPatch(existing: CharacterRow, patch: WriterCharacterPatch): CharacterRow {
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

function parseIdArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.map((x) => String(x || "").trim()).filter(Boolean);
  return [...new Set(ids)];
}

function parseJsonIdArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    return parseIdArray(JSON.parse(raw));
  } catch {
    return [];
  }
}

function normalizeProjectName(input: unknown, fallback = "Untitled Book"): string {
  const value = String(input ?? "").trim();
  return value || fallback;
}

function normalizeChapterTitle(input: unknown, fallback = "Untitled Chapter"): string {
  const value = String(input ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  return value || fallback;
}

function normalizeProjectNotes(input: unknown): WriterProjectNotes {
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

function parseProjectNotes(raw: string | null | undefined): WriterProjectNotes {
  if (!raw) return { ...DEFAULT_PROJECT_NOTES };
  try {
    return normalizeProjectNotes(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PROJECT_NOTES };
  }
}

function decodeBase64Payload(value: string): Buffer {
  const raw = String(value || "").trim();
  const payload = raw.startsWith("data:")
    ? raw.slice(raw.indexOf(",") + 1)
    : raw;
  return Buffer.from(payload, "base64");
}

function normalizeDocxParseMode(raw: unknown): WriterDocxParseMode {
  const value = String(raw || "").trim();
  if (value === "chapter_markers" || value === "heading_lines" || value === "single_book") {
    return value;
  }
  return "auto";
}

function inferBookNameFromFilename(filename: string): string {
  const base = String(filename || "")
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeProjectName(base, "Imported Book").slice(0, 120);
}

function normalizeDocxText(raw: string): string {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function stripHtml(raw: string): string {
  return decodeHtmlEntities(String(raw || "").replace(/<[^>]*>/g, " "));
}

function splitLongText(text: string, maxChars: number): string[] {
  const normalized = normalizeDocxText(text);
  if (!normalized) return [];
  const parts = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const out: string[] = [];
  let current = "";
  for (const part of parts) {
    if (!current) {
      current = part;
      continue;
    }
    if ((current.length + part.length + 2) <= maxChars) {
      current = `${current}\n\n${part}`;
      continue;
    }
    out.push(current);
    current = part;
  }
  if (current) out.push(current);
  return out.length > 0 ? out : [normalized];
}

function isHeadingLineCandidate(line: string): boolean {
  const clean = String(line || "").trim();
  if (!clean || clean.length > 90) return false;
  if (/[.!?;:]$/.test(clean)) return false;
  if (clean.split(/\s+/).length > 11) return false;
  if (!/[A-Za-zА-Яа-я0-9]/.test(clean)) return false;
  return true;
}

function splitDocxIntoChaptersByMarkers(text: string): Array<{ title: string; content: string }> {
  const lines = normalizeDocxText(text).split("\n");
  const chapterMarkers = /^((chapter|ch\.|part|act)\s*\d+|prologue|epilogue)\b[:\-\s]*/i;
  const items: Array<{ title: string; content: string }> = [];
  let currentTitle = "Chapter";
  let buffer: string[] = [];

  const flush = () => {
    const content = normalizeDocxText(buffer.join("\n"));
    if (!content) return;
    items.push({ title: currentTitle, content });
    buffer = [];
  };

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) {
      buffer.push("");
      continue;
    }
    if (chapterMarkers.test(line) && line.length <= 110) {
      flush();
      currentTitle = line.replace(/\s+/g, " ").trim().slice(0, 120);
      continue;
    }
    buffer.push(lineRaw);
  }
  flush();

  return items;
}

function splitDocxIntoChaptersByHeadingLines(text: string): Array<{ title: string; content: string }> {
  const lines = normalizeDocxText(text).split("\n");
  const items: Array<{ title: string; content: string }> = [];
  let currentTitle = "Chapter";
  let buffer: string[] = [];

  const flush = () => {
    const content = normalizeDocxText(buffer.join("\n"));
    if (!content) return;
    items.push({ title: currentTitle, content });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const lineRaw = lines[i];
    const line = lineRaw.trim();
    const prev = i > 0 ? lines[i - 1].trim() : "";
    const next = i < (lines.length - 1) ? lines[i + 1].trim() : "";
    const headingLike = isHeadingLineCandidate(line) && (!prev || !next);

    if (headingLike) {
      flush();
      currentTitle = line.replace(/\s+/g, " ").trim().slice(0, 120);
      continue;
    }
    buffer.push(lineRaw);
  }
  flush();
  return items;
}

async function splitDocxIntoChaptersFromHtmlHeadings(buffer: Buffer): Promise<Array<{ title: string; content: string }>> {
  const html = (await mammoth.convertToHtml({ buffer })).value || "";
  const nodeRegex = /<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  const items: Array<{ title: string; content: string }> = [];
  let currentTitle = "Chapter";
  let lines: string[] = [];

  const flush = () => {
    const content = normalizeDocxText(lines.join("\n"));
    if (!content) return;
    items.push({ title: currentTitle, content });
    lines = [];
  };

  let match: RegExpExecArray | null = null;
  while ((match = nodeRegex.exec(html)) !== null) {
    const tag = String(match[1] || "").toLowerCase();
    const text = normalizeDocxText(stripHtml(match[2] || ""));
    if (!text) continue;
    if (tag.startsWith("h")) {
      flush();
      currentTitle = text.slice(0, 120);
      continue;
    }
    lines.push(text);
  }
  flush();
  return items;
}

function splitDocxIntoChaptersAuto(text: string): Array<{ title: string; content: string }> {
  const byMarkers = splitDocxIntoChaptersByMarkers(text);
  if (byMarkers.length >= 2) return byMarkers;
  const byHeadings = splitDocxIntoChaptersByHeadingLines(text);
  if (byHeadings.length >= 2) return byHeadings;
  return [{ title: "Chapter", content: normalizeDocxText(text) }];
}

function finalizeChapterTitle(rawTitle: string, fallbackIndex: number): string {
  const clean = normalizeProjectName(rawTitle, "").replace(/\s+/g, " ").trim().slice(0, 140);
  if (!clean) return `Chapter ${fallbackIndex + 1}`;
  if (/^(chapter|imported chapter)$/i.test(clean)) return `Chapter ${fallbackIndex + 1}`;
  return clean;
}

async function parseDocxIntoChapters(base64Data: string, filename: string, parseMode: WriterDocxParseMode): Promise<ParsedDocxChapter[]> {
  const buffer = decodeBase64Payload(base64Data);
  const extracted = await mammoth.extractRawText({ buffer });
  const text = normalizeDocxText(extracted.value || "");
  if (!text) {
    throw new Error("DOCX appears empty or unsupported");
  }

  let chunks: Array<{ title: string; content: string }> = [];
  if (parseMode === "single_book") {
    chunks = [{ title: inferBookNameFromFilename(filename), content: text }];
  } else if (parseMode === "chapter_markers") {
    chunks = splitDocxIntoChaptersByMarkers(text);
  } else if (parseMode === "heading_lines") {
    const byHtmlHeadings = await splitDocxIntoChaptersFromHtmlHeadings(buffer);
    chunks = byHtmlHeadings.length > 0 ? byHtmlHeadings : splitDocxIntoChaptersByHeadingLines(text);
  } else {
    chunks = splitDocxIntoChaptersAuto(text);
    if (chunks.length <= 1) {
      const byHtmlHeadings = await splitDocxIntoChaptersFromHtmlHeadings(buffer);
      if (byHtmlHeadings.length >= 2) chunks = byHtmlHeadings;
    }
  }

  const normalized = chunks
    .map((chunk, index) => ({
      title: finalizeChapterTitle(chunk.title, index),
      content: normalizeDocxText(chunk.content)
    }))
    .filter((chunk) => Boolean(chunk.content));

  if (normalized.length === 0) {
    return [{ title: "Chapter 1", content: text }];
  }
  return normalized.slice(0, 96);
}

function importParsedDocxChapters(projectId: string, chunks: ParsedDocxChapter[]) {
  const chapterCountRow = db.prepare(
    "SELECT COALESCE(MAX(position), 0) AS max_pos FROM writer_chapters WHERE project_id = ?"
  ).get(projectId) as { max_pos: number | null };
  let nextPosition = (chapterCountRow.max_pos ?? 0) + 1;
  let chaptersCreated = 0;
  let scenesCreated = 0;
  const chapterTitles: string[] = [];

  const tx = db.transaction(() => {
    for (const chunk of chunks) {
      const chapterId = newId();
      const chapterTitle = finalizeChapterTitle(chunk.title, nextPosition - 1).slice(0, 160);
      const parts = splitLongText(chunk.content, 6500).slice(0, 24);
      const chapterSettings = { ...DEFAULT_CHAPTER_SETTINGS };
      db.prepare(
        "INSERT INTO writer_chapters (id, project_id, title, position, settings_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(chapterId, projectId, chapterTitle, nextPosition, JSON.stringify(chapterSettings), now());
      nextPosition += 1;
      chaptersCreated += 1;
      chapterTitles.push(chapterTitle);

      parts.forEach((contentPart, index) => {
        const sceneId = newId();
        const sceneTitle = parts.length > 1 ? `${chapterTitle} (Part ${index + 1})` : chapterTitle;
        db.prepare(
          "INSERT INTO writer_scenes (id, chapter_id, title, content, goals, conflicts, outcomes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
          sceneId,
          chapterId,
          sceneTitle.slice(0, 180),
          contentPart,
          "Imported from DOCX",
          "",
          "",
          now()
        );
        scenesCreated += 1;
      });
    }
  });
  tx();
  return {
    ok: true,
    chaptersCreated,
    scenesCreated,
    chapterTitles
  };
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function normalizeLensScope(raw: unknown): WriterSummaryLensScope {
  const value = String(raw || "").trim();
  if (value === "chapter" || value === "scene") return value;
  return "project";
}

function normalizeLensName(raw: unknown): string {
  const value = toCleanText(raw, 120);
  return value || "Custom Lens";
}

function normalizeLensPrompt(raw: unknown): string {
  return toCleanText(raw, 8000);
}

function lensRowToJson(row: WriterSummaryLensRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    scope: row.scope,
    targetId: row.target_id,
    prompt: row.prompt,
    output: row.output,
    sourceHash: row.source_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function buildProjectSourceText(projectId: string): string {
  const chapters = db.prepare(
    "SELECT id, title, position FROM writer_chapters WHERE project_id = ? ORDER BY position ASC"
  ).all(projectId) as Array<{ id: string; title: string; position: number }>;
  if (chapters.length === 0) return "";
  const sceneStmt = db.prepare(
    "SELECT id, title, content FROM writer_scenes WHERE chapter_id = ? ORDER BY created_at ASC"
  );
  const blocks = chapters.map((chapter) => {
    const scenes = sceneStmt.all(chapter.id) as Array<{ id: string; title: string; content: string }>;
    const sceneText = scenes.map((scene) => `[Scene] ${scene.title}\n${scene.content}`).join("\n\n");
    return `# ${chapter.title}\n${sceneText}`.trim();
  }).filter(Boolean);
  return blocks.join("\n\n");
}

function resolveLensSource(projectId: string, scope: WriterSummaryLensScope, targetId: string | null): { targetId: string | null; sourceText: string } {
  if (scope === "project") {
    return { targetId: null, sourceText: buildProjectSourceText(projectId) };
  }

  if (!targetId) {
    throw new Error(`targetId is required for ${scope} scope`);
  }

  if (scope === "chapter") {
    const chapter = db.prepare(
      "SELECT id FROM writer_chapters WHERE id = ? AND project_id = ?"
    ).get(targetId, projectId) as { id: string } | undefined;
    if (!chapter) {
      throw new Error("Chapter target not found in this project");
    }
    const scenes = db.prepare(
      "SELECT title, content FROM writer_scenes WHERE chapter_id = ? ORDER BY created_at ASC"
    ).all(targetId) as Array<{ title: string; content: string }>;
    const sourceText = scenes.map((scene) => `[Scene] ${scene.title}\n${scene.content}`).join("\n\n");
    return { targetId, sourceText };
  }

  const scene = db.prepare(
    `SELECT s.id, s.title, s.content
     FROM writer_scenes s
     JOIN writer_chapters c ON c.id = s.chapter_id
     WHERE s.id = ? AND c.project_id = ?`
  ).get(targetId, projectId) as { id: string; title: string; content: string } | undefined;
  if (!scene) {
    throw new Error("Scene target not found in this project");
  }
  return { targetId: scene.id, sourceText: `[Scene] ${scene.title}\n${scene.content}` };
}

async function runSummaryLens(projectId: string, row: WriterSummaryLensRow, force = false): Promise<{ lens: ReturnType<typeof lensRowToJson>; cached: boolean; sourceChars: number }> {
  const resolved = resolveLensSource(projectId, row.scope, row.target_id);
  const sourceText = truncateForPrompt(resolved.sourceText, 120000);
  const sourceChars = sourceText.length;
  const sourceHash = hashContent(`${row.scope}|${resolved.targetId || ""}|${row.prompt}|${sourceText}`);

  if (!force && row.source_hash === sourceHash && row.output.trim()) {
    return {
      lens: lensRowToJson(row),
      cached: true,
      sourceChars
    };
  }

  const output = sourceText
    ? (await callLlm(
      [
        "You are a novel analysis assistant.",
        "Follow the user's analysis lens exactly.",
        "Produce an actionable, structured summary without markdown overload."
      ].join("\n"),
      [
        `[Lens Name]\n${row.name}`,
        `[Lens Prompt]\n${row.prompt}`,
        `[Source Material]\n${sourceText}`
      ].join("\n\n"),
      { temperature: 0.3, maxTokens: 1400 }
    )).trim()
    : "(No source material available for this scope yet.)";

  const outputText = output || "(empty lens output)";
  const updatedAt = now();
  db.prepare(
    `UPDATE writer_summary_lenses
     SET target_id = ?, output = ?, source_hash = ?, updated_at = ?
     WHERE id = ?`
  ).run(resolved.targetId, outputText, sourceHash, updatedAt, row.id);

  const updated = db.prepare("SELECT * FROM writer_summary_lenses WHERE id = ?").get(row.id) as WriterSummaryLensRow | undefined;
  if (!updated) {
    throw new Error("Failed to load updated lens");
  }
  return {
    lens: lensRowToJson(updated),
    cached: false,
    sourceChars
  };
}

function truncateForPrompt(text: string, maxChars: number): string {
  const value = String(text || "").trim();
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function buildProjectNotesDirective(notes: WriterProjectNotes): string {
  const parts = [
    notes.premise ? `[Book Premise]\n${notes.premise}` : "",
    notes.styleGuide ? `[Style Guide]\n${notes.styleGuide}` : "",
    notes.worldRules ? `[World Rules]\n${notes.worldRules}` : "",
    notes.characterNotes ? `[Character Notes]\n${notes.characterNotes}` : "",
    notes.summary ? `[Book Summary]\n${notes.summary}` : ""
  ].filter(Boolean);
  if (parts.length === 0) return "";
  return ["[Book Bible]", ...parts].join("\n\n");
}

function buildProjectContextPack(projectId: string, chapterId: string, notes: WriterProjectNotes): string {
  const mode = notes.contextMode;
  const limits = mode === "economy"
    ? { prev: 1400, current: 1000, total: 2600 }
    : mode === "rich"
      ? { prev: 5200, current: 3200, total: 9000 }
      : { prev: 2800, current: 1800, total: 5200 };

  const chapters = db.prepare(
    "SELECT id, title, position FROM writer_chapters WHERE project_id = ? ORDER BY position ASC"
  ).all(projectId) as Array<{ id: string; title: string; position: number }>;
  const currentIndex = chapters.findIndex((row) => row.id === chapterId);
  const previous = currentIndex > 0 ? chapters.slice(0, currentIndex) : [];

  let previousContext = "";
  for (let i = previous.length - 1; i >= 0; i -= 1) {
    const chapter = previous[i];
    const summaryRow = db.prepare(
      "SELECT summary FROM writer_chapter_summaries WHERE chapter_id = ?"
    ).get(chapter.id) as { summary: string } | undefined;
    const fallbackRow = db.prepare(
      "SELECT content FROM writer_scenes WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(chapter.id) as { content: string } | undefined;
    const snippet = truncateForPrompt(summaryRow?.summary || fallbackRow?.content || "", 500);
    if (!snippet) continue;
    const block = `${chapter.title}: ${snippet}`;
    if (previousContext.length + block.length + 2 > limits.prev) break;
    previousContext = previousContext ? `${block}\n${previousContext}` : block;
  }

  const currentScenes = db.prepare(
    "SELECT title, content FROM writer_scenes WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 3"
  ).all(chapterId) as Array<{ title: string; content: string }>;
  const currentContext = currentScenes
    .map((row) => `${row.title}: ${truncateForPrompt(row.content, 500)}`)
    .join("\n");

  const out = [
    previousContext ? `[Previous Chapters]\n${truncateForPrompt(previousContext, limits.prev)}` : "",
    currentContext ? `[Current Chapter Progress]\n${truncateForPrompt(currentContext, limits.current)}` : ""
  ].filter(Boolean).join("\n\n");
  return truncateForPrompt(out, limits.total);
}

async function summarizeWithCache(cacheKey: { kind: "chapter"; id: string } | { kind: "project"; id: string }, hash: string, systemPrompt: string, userPrompt: string): Promise<{ summary: string; cached: boolean }> {
  const selectSql = cacheKey.kind === "chapter"
    ? "SELECT summary, content_hash FROM writer_chapter_summaries WHERE chapter_id = ?"
    : "SELECT summary, content_hash FROM writer_project_summaries WHERE project_id = ?";
  const existing = db.prepare(selectSql).get(cacheKey.id) as { summary: string; content_hash: string } | undefined;
  if (existing && existing.content_hash === hash && existing.summary.trim()) {
    return { summary: existing.summary, cached: true };
  }

  const generated = (await callLlm(systemPrompt, userPrompt, { temperature: 0.35, maxTokens: 1200 })).trim();
  const summary = generated || "(empty summary)";
  if (cacheKey.kind === "chapter") {
    db.prepare(
      `INSERT INTO writer_chapter_summaries (chapter_id, content_hash, summary, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(chapter_id) DO UPDATE SET content_hash = excluded.content_hash, summary = excluded.summary, updated_at = excluded.updated_at`
    ).run(cacheKey.id, hash, summary, now());
  } else {
    db.prepare(
      `INSERT INTO writer_project_summaries (project_id, content_hash, summary, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET content_hash = excluded.content_hash, summary = excluded.summary, updated_at = excluded.updated_at`
    ).run(cacheKey.id, hash, summary, now());
  }
  return { summary, cached: false };
}

function normalizeChapterSettings(input: unknown): WriterChapterSettings {
  if (!input || typeof input !== "object") return { ...DEFAULT_CHAPTER_SETTINGS };
  const row = input as Partial<WriterChapterSettings>;
  const pacing = row.pacing === "slow" || row.pacing === "fast" ? row.pacing : "balanced";
  const pov = row.pov === "first_person" || row.pov === "third_omniscient" ? row.pov : "third_limited";
  return {
    tone: String(row.tone || DEFAULT_CHAPTER_SETTINGS.tone),
    pacing,
    pov,
    creativity: clamp01(Number(row.creativity ?? DEFAULT_CHAPTER_SETTINGS.creativity)),
    tension: clamp01(Number(row.tension ?? DEFAULT_CHAPTER_SETTINGS.tension)),
    detail: clamp01(Number(row.detail ?? DEFAULT_CHAPTER_SETTINGS.detail)),
    dialogue: clamp01(Number(row.dialogue ?? DEFAULT_CHAPTER_SETTINGS.dialogue))
  };
}

function parseChapterSettings(raw: string | null | undefined): WriterChapterSettings {
  if (!raw) return { ...DEFAULT_CHAPTER_SETTINGS };
  try {
    return normalizeChapterSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CHAPTER_SETTINGS };
  }
}

function createWriterSampler(base: { temperature?: number; maxTokens?: number }, chapter: WriterChapterSettings): WriterSampler {
  const baseTemperature = Number(base.temperature ?? 0.9);
  const baseMaxTokens = Number(base.maxTokens ?? 2048);
  const temperature = Math.max(0, Math.min(2, baseTemperature * (0.75 + chapter.creativity * 0.9)));
  const maxTokens = Math.max(256, Math.min(4096, Math.round(baseMaxTokens * (0.75 + chapter.detail * 0.7))));
  return { temperature, maxTokens };
}

function sanitizeExportFileName(name: string, fallback: string): string {
  const clean = String(name || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return clean || fallback;
}

function sanitizeHeaderFilenameAscii(name: string, fallback: string): string {
  const clean = String(name || "")
    .replace(/[\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .slice(0, 120);
  return clean || fallback;
}

function encode5987Value(value: string): string {
  return encodeURIComponent(String(value || ""))
    .replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildAttachmentDisposition(filename: string, fallback: string): string {
  const cleanName = String(filename || "").replace(/[\r\n]/g, " ").trim() || fallback;
  const asciiName = sanitizeHeaderFilenameAscii(cleanName, fallback);
  const utf8Name = encode5987Value(cleanName);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`;
}

interface WriterExportBundle {
  projectId: string;
  projectName: string;
  markdown: string;
  filenameBase: string;
}

function normalizeTitleForExportCompare(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function buildWriterExportBundle(projectId: string): WriterExportBundle | null {
  const project = db.prepare("SELECT name FROM writer_projects WHERE id = ?").get(projectId) as { name: string } | undefined;
  if (!project) return null;

  const chapters = db.prepare("SELECT * FROM writer_chapters WHERE project_id = ? ORDER BY position ASC")
    .all(projectId) as { id: string; title: string }[];

  const lines: string[] = [`# ${project.name}`, ""];
  for (const chapter of chapters) {
    lines.push(`## ${chapter.title}`, "");
    const scenes = db.prepare("SELECT title, content FROM writer_scenes WHERE chapter_id = ? ORDER BY created_at ASC")
      .all(chapter.id) as { title: string; content: string }[];
    const chapterTitleKey = normalizeTitleForExportCompare(chapter.title);
    for (const scene of scenes) {
      const sceneTitle = String(scene.title || "").trim();
      const sceneTitleKey = normalizeTitleForExportCompare(sceneTitle);
      const shouldRenderSceneHeading = Boolean(sceneTitle) && sceneTitleKey !== chapterTitleKey;
      if (shouldRenderSceneHeading) {
        lines.push(`### ${sceneTitle}`, "");
      }
      lines.push(scene.content, "");
    }
  }

  return {
    projectId,
    projectName: project.name,
    markdown: lines.join("\n"),
    filenameBase: sanitizeExportFileName(project.name, `book-${projectId}`)
  };
}

async function buildDocxBufferFromBundle(bundle: WriterExportBundle): Promise<Buffer> {
  const lines = bundle.markdown.split("\n");
  const paragraphs: Paragraph[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r/g, "");
    if (line.startsWith("# ")) {
      paragraphs.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }));
      continue;
    }
    if (line.startsWith("## ")) {
      paragraphs.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }));
      continue;
    }
    if (line.startsWith("### ")) {
      paragraphs.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 }));
      continue;
    }
    if (!line.trim()) {
      paragraphs.push(new Paragraph({ text: "" }));
      continue;
    }
    paragraphs.push(new Paragraph({ children: [new TextRun(line)] }));
  }

  const doc = new Document({
    sections: [{ children: paragraphs }]
  });
  return Packer.toBuffer(doc);
}

function buildChapterDirective(chapter: WriterChapterSettings): string {
  const tone = chapter.tone.trim() || DEFAULT_CHAPTER_SETTINGS.tone;
  const pacing = chapter.pacing;
  const pov = chapter.pov;
  const creativityPercent = Math.round(chapter.creativity * 100);
  const dialoguePercent = Math.round(chapter.dialogue * 100);
  const detailPercent = Math.round(chapter.detail * 100);
  const tensionPercent = Math.round(chapter.tension * 100);

  return [
    "[Chapter Settings]",
    `Tone: ${tone}`,
    `Pacing: ${pacing}`,
    `POV: ${pov}`,
    `Creativity: ${creativityPercent}%`,
    `Detail richness: ${detailPercent}%`,
    `Dialogue share: ${dialoguePercent}%`,
    `Narrative tension: ${tensionPercent}%`,
    "Apply these settings consistently in the output."
  ].join("\n");
}

function buildCharacterContext(characterIds: string[]): string {
  if (characterIds.length === 0) return "";
  const rows = db.prepare(
    "SELECT id, name, description, personality, scenario, system_prompt FROM characters WHERE id IN (" +
      characterIds.map(() => "?").join(",") +
      ")"
  ).all(...characterIds) as {
    id: string;
    name: string;
    description: string;
    personality: string;
    scenario: string;
    system_prompt: string;
  }[];
  if (rows.length === 0) return "";

  const blocks = rows.map((row) => {
    return [
      `- ${row.name}`,
      row.description ? `  Description: ${row.description}` : "",
      row.personality ? `  Personality: ${row.personality}` : "",
      row.scenario ? `  Scenario role: ${row.scenario}` : "",
      row.system_prompt ? `  Voice notes: ${row.system_prompt}` : ""
    ].filter(Boolean).join("\n");
  });

  return ["[Creative Writing Cast]", ...blocks].join("\n");
}

function getSettings() {
  const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string };
  const stored = JSON.parse(row.payload);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    samplerConfig: { ...DEFAULT_SETTINGS.samplerConfig, ...(stored.samplerConfig ?? {}) },
    apiParamPolicy: normalizeApiParamPolicy(stored.apiParamPolicy),
    promptTemplates: { ...DEFAULT_SETTINGS.promptTemplates, ...(stored.promptTemplates ?? {}) }
  };
}

async function callLlm(systemPrompt: string, userPrompt: string, sampler?: WriterSampler): Promise<string> {
  const settings = getSettings();
  const providerId = settings.activeProviderId;
  const modelId = settings.activeModel;

  if (!providerId || !modelId) {
    return `[No LLM configured] Placeholder for: ${userPrompt.slice(0, 100)}`;
  }

  const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId) as ProviderRow | undefined;
  if (!provider) return "[Provider not found]";

  try {
    const providerType = normalizeProviderType(provider.provider_type);
    if (providerType === "koboldcpp") {
      const koboldPolicy = normalizeApiParamPolicy(settings.apiParamPolicy).kobold;
      const customMemory = String(settings.samplerConfig.koboldMemory || "").trim();
      const memory = [
        customMemory,
        systemPrompt
          ? `${KOBOLD_TAGS.systemOpen}\n${systemPrompt}\n${KOBOLD_TAGS.systemClose}`
          : ""
      ].filter(Boolean).join("\n\n");
      const koboldSamplerConfig = buildKoboldSamplerConfig({
        samplerConfig: {
          temperature: sampler?.temperature ?? settings.samplerConfig.temperature ?? 0.9,
          maxTokens: sampler?.maxTokens ?? settings.samplerConfig.maxTokens ?? 2048,
          topP: settings.samplerConfig.topP,
          stop: settings.samplerConfig.stop,
          topK: settings.samplerConfig.topK,
          topA: settings.samplerConfig.topA,
          minP: settings.samplerConfig.minP,
          typical: settings.samplerConfig.typical,
          tfs: settings.samplerConfig.tfs,
          nSigma: settings.samplerConfig.nSigma,
          repetitionPenalty: settings.samplerConfig.repetitionPenalty,
          repetitionPenaltyRange: settings.samplerConfig.repetitionPenaltyRange,
          repetitionPenaltySlope: settings.samplerConfig.repetitionPenaltySlope,
          samplerOrder: settings.samplerConfig.samplerOrder,
          koboldMemory: settings.samplerConfig.koboldMemory,
          koboldUseDefaultBadwords: settings.samplerConfig.koboldUseDefaultBadwords,
          koboldBannedPhrases: settings.samplerConfig.koboldBannedPhrases
        },
        apiParamPolicy: settings.apiParamPolicy
      });
      const body = buildKoboldGenerateBody({
        prompt: `${KOBOLD_TAGS.inputOpen}\n${userPrompt}\n${KOBOLD_TAGS.inputClose}\n\n${KOBOLD_TAGS.outputOpen}`,
        memory,
        samplerConfig: koboldSamplerConfig,
        includeMemory: koboldPolicy.memory
      });
      const response = await requestKoboldGenerate(provider, body);
      if (!response.ok) {
        const errText = await response.text().catch(() => "KoboldCpp error");
        return `[KoboldCpp Error] ${errText.slice(0, 500)}`;
      }
      const payload = await response.json().catch(() => ({}));
      return extractKoboldGeneratedText(payload) || "[Empty response]";
    }

    const openAiSampling = buildOpenAiSamplingPayload({
      samplerConfig: {
        temperature: sampler?.temperature ?? settings.samplerConfig.temperature ?? 0.9,
        maxTokens: sampler?.maxTokens ?? settings.samplerConfig.maxTokens ?? 2048
      },
      apiParamPolicy: settings.apiParamPolicy,
      fields: ["temperature", "maxTokens"],
      defaults: {
        temperature: 0.9,
        maxTokens: 2048
      }
    });
    const response = await fetch(`${provider.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.api_key_cipher}`
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        ...openAiSampling
      })
    });

    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? "[Empty response]";
  } catch (err) {
    return `[LLM Error] ${err instanceof Error ? err.message : "Unknown error"}`;
  }
}

router.post("/characters/generate", async (req, res) => {
  const description = typeof req.body?.description === "string"
    ? toCleanText(req.body.description, 5000)
    : "";
  if (!description) {
    res.status(400).json({ error: "Description is required" });
    return;
  }

  const mode = req.body?.mode === "advanced" ? "advanced" : "basic";
  const advanced = (req.body?.advanced && typeof req.body.advanced === "object")
    ? req.body.advanced as WriterCharacterAdvancedInput
    : undefined;

  const systemPrompt = [
    "You are a character designer for roleplay character cards.",
    "Return ONLY valid JSON without markdown.",
    "Required JSON keys: name, description, personality, scenario, greeting, systemPrompt, mesExample, creatorNotes, tags.",
    "tags must be an array of short strings."
  ].join("\n");

  const advancedHints = advanced ? [
    toCleanText(advanced.name, 120) ? `Name hint: ${toCleanText(advanced.name, 120)}` : "",
    toCleanText(advanced.role, 400) ? `Role/archetype: ${toCleanText(advanced.role, 400)}` : "",
    toCleanText(advanced.personality, 600) ? `Personality hints: ${toCleanText(advanced.personality, 600)}` : "",
    toCleanText(advanced.scenario, 1000) ? `Scenario hints: ${toCleanText(advanced.scenario, 1000)}` : "",
    toCleanText(advanced.greetingStyle, 300) ? `Greeting style: ${toCleanText(advanced.greetingStyle, 300)}` : "",
    toCleanText(advanced.systemPrompt, 600) ? `System prompt style: ${toCleanText(advanced.systemPrompt, 600)}` : "",
    toCleanText(advanced.tags, 400) ? `Tag hints: ${toCleanText(advanced.tags, 400)}` : "",
    toCleanText(advanced.notes, 800) ? `Extra notes: ${toCleanText(advanced.notes, 800)}` : ""
  ].filter(Boolean).join("\n") : "";

  const userPrompt = [
    `Create a roleplay character from this description:\n${description}`,
    mode === "advanced" ? "Use advanced constraints below when possible." : "Keep output concise and practical.",
    advancedHints
  ].filter(Boolean).join("\n\n");

  const raw = await callLlm(systemPrompt, userPrompt, {
    temperature: mode === "advanced" ? 1 : 0.85,
    maxTokens: 1400
  });

  const parsed = extractFirstJsonObject(raw);
  const draft = buildCharacterDraft(parsed, description, advanced);

  const id = newId();
  const ts = now();
  const cardJson = JSON.stringify({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: draft.name,
      description: draft.description,
      personality: draft.personality,
      scenario: draft.scenario,
      first_mes: draft.greeting,
      system_prompt: draft.systemPrompt,
      mes_example: draft.mesExample,
      creator_notes: draft.creatorNotes,
      tags: draft.tags
    }
  }, null, 2);

  db.prepare(
    `INSERT INTO characters (id, name, card_json, lorebook_id, avatar_path, tags, greeting, system_prompt, description, personality, scenario, mes_example, creator_notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    draft.name,
    cardJson,
    null,
    null,
    JSON.stringify(draft.tags),
    draft.greeting,
    draft.systemPrompt,
    draft.description,
    draft.personality,
    draft.scenario,
    draft.mesExample,
    draft.creatorNotes,
    ts
  );

  const row = db.prepare("SELECT * FROM characters WHERE id = ?").get(id) as CharacterRow | undefined;
  if (!row) {
    res.status(500).json({ error: "Failed to create character" });
    return;
  }
  res.json(characterToJson(row));
});

router.post("/characters/:id/edit", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const instruction = toCleanText(req.body?.instruction, 5000);
  if (!id) {
    res.status(400).json({ error: "Character id is required" });
    return;
  }
  if (!instruction) {
    res.status(400).json({ error: "Instruction is required" });
    return;
  }

  const existing = db.prepare("SELECT * FROM characters WHERE id = ?").get(id) as CharacterRow | undefined;
  if (!existing) {
    res.status(404).json({ error: "Character not found" });
    return;
  }

  const selectedFields = parseWriterCharacterPatchFields(req.body?.fields);
  const currentCharacter = {
    name: existing.name || "",
    description: existing.description || "",
    personality: existing.personality || "",
    scenario: existing.scenario || "",
    greeting: existing.greeting || "",
    systemPrompt: existing.system_prompt || "",
    mesExample: existing.mes_example || "",
    creatorNotes: existing.creator_notes || "",
    tags: parseCharacterTagsJson(existing.tags)
  };

  const allowedText = selectedFields.length > 0
    ? selectedFields.join(", ")
    : WRITER_CHARACTER_PATCH_FIELDS.join(", ");

  const systemPrompt = [
    "You edit roleplay character cards using user instructions.",
    "Return ONLY valid JSON without markdown.",
    "Include ONLY fields that should be changed.",
    "Allowed keys: name, description, personality, scenario, greeting, systemPrompt, mesExample, creatorNotes, tags.",
    "If tags is provided, it must be an array of short strings.",
    "Do not include keys for unchanged values."
  ].join("\n");

  const userPrompt = [
    `Current character JSON:\n${JSON.stringify(currentCharacter, null, 2)}`,
    `Instruction:\n${instruction}`,
    `Allowed fields for this request: ${allowedText}`,
    "Apply only what the instruction asks for. If no changes are needed, return {}."
  ].join("\n\n");

  const raw = await callLlm(systemPrompt, userPrompt, {
    temperature: 0.7,
    maxTokens: 1400
  });

  const parsed = extractFirstJsonObject(raw);
  const patch = filterWriterCharacterPatch(buildWriterCharacterPatch(parsed), selectedFields);
  const changedFields = Object.keys(patch) as WriterCharacterPatchField[];

  if (changedFields.length === 0) {
    res.json({ character: characterToJson(existing), changedFields });
    return;
  }

  const updated = updateCharacterWithPatch(existing, patch);
  res.json({ character: characterToJson(updated), changedFields });
});

// --- Projects ---

router.post("/projects", (req, res) => {
  const { name, description, characterIds } = req.body as { name: string; description: string; characterIds?: unknown };
  const id = newId();
  const ts = now();
  const normalizedName = normalizeProjectName(name, `Book ${new Date().toLocaleDateString()}`);
  const normalizedDescription = String(description || "").trim() || "New writing project";
  const normalizedCharacterIds = parseIdArray(characterIds);
  const notes = { ...DEFAULT_PROJECT_NOTES };
  db.prepare("INSERT INTO writer_projects (id, name, description, character_ids, notes_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, normalizedName, normalizedDescription, JSON.stringify(normalizedCharacterIds), JSON.stringify(notes), ts);
  res.json({ id, name: normalizedName, description: normalizedDescription, characterIds: normalizedCharacterIds, notes, createdAt: ts });
});

router.get("/projects", (_req, res) => {
  const rows = db.prepare("SELECT * FROM writer_projects ORDER BY created_at DESC").all() as {
    id: string; name: string; description: string; character_ids: string | null; notes_json: string | null; created_at: string;
  }[];
  res.json(rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    characterIds: parseJsonIdArray(r.character_ids),
    notes: parseProjectNotes(r.notes_json),
    createdAt: r.created_at
  })));
});

router.get("/projects/:id", (req, res) => {
  const projectId = req.params.id;
  const project = db.prepare("SELECT * FROM writer_projects WHERE id = ?").get(projectId) as {
    id: string; name: string; description: string; character_ids: string | null; notes_json: string | null; created_at: string;
  } | undefined;

  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const chapters = db.prepare("SELECT * FROM writer_chapters WHERE project_id = ? ORDER BY position ASC").all(projectId) as {
    id: string; project_id: string; title: string; position: number; settings_json: string | null; created_at: string;
  }[];

  const chapterIds = chapters.map((c) => c.id);
  let scenes: {
    id: string; chapter_id: string; title: string; content: string;
    goals: string; conflicts: string; outcomes: string; created_at: string;
  }[] = [];

  if (chapterIds.length > 0) {
    const placeholders = chapterIds.map(() => "?").join(",");
    scenes = db.prepare(`SELECT * FROM writer_scenes WHERE chapter_id IN (${placeholders}) ORDER BY created_at ASC`)
      .all(...chapterIds) as typeof scenes;
  }

  res.json({
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      characterIds: parseJsonIdArray(project.character_ids),
      notes: parseProjectNotes(project.notes_json),
      createdAt: project.created_at
    },
    chapters: chapters.map((c) => ({
      id: c.id,
      projectId: c.project_id,
      title: c.title,
      position: c.position,
      settings: parseChapterSettings(c.settings_json),
      createdAt: c.created_at
    })),
    scenes: scenes.map((s) => ({
      id: s.id, chapterId: s.chapter_id, title: s.title, content: s.content,
      goals: s.goals, conflicts: s.conflicts, outcomes: s.outcomes, createdAt: s.created_at
    }))
  });
});

router.patch("/projects/:id/characters", (req, res) => {
  const projectId = req.params.id;
  const characterIds = parseIdArray((req.body as { characterIds?: unknown })?.characterIds);
  const row = db.prepare("SELECT id, name, description, notes_json, created_at FROM writer_projects WHERE id = ?")
    .get(projectId) as { id: string; name: string; description: string; notes_json: string | null; created_at: string } | undefined;
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  db.prepare("UPDATE writer_projects SET character_ids = ? WHERE id = ?")
    .run(JSON.stringify(characterIds), projectId);

  res.json({
    id: row.id,
    name: row.name,
    description: row.description,
    characterIds,
    notes: parseProjectNotes(row.notes_json),
    createdAt: row.created_at
  });
});

router.patch("/projects/:id", (req, res) => {
  const projectId = req.params.id;
  const row = db.prepare("SELECT id, name, description, character_ids, notes_json, created_at FROM writer_projects WHERE id = ?")
    .get(projectId) as {
      id: string;
      name: string;
      description: string;
      character_ids: string | null;
      notes_json: string | null;
      created_at: string;
    } | undefined;
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const body = req.body as { name?: unknown; description?: unknown };
  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasDescription = Object.prototype.hasOwnProperty.call(body, "description");
  const nextName = hasName ? normalizeProjectName(body.name, row.name) : row.name;
  const nextDescription = hasDescription ? String(body.description ?? "").trim() : row.description;

  db.prepare("UPDATE writer_projects SET name = ?, description = ? WHERE id = ?")
    .run(nextName, nextDescription, projectId);

  res.json({
    id: row.id,
    name: nextName,
    description: nextDescription,
    characterIds: parseJsonIdArray(row.character_ids),
    notes: parseProjectNotes(row.notes_json),
    createdAt: row.created_at
  });
});

router.patch("/projects/:id/notes", (req, res) => {
  const projectId = req.params.id;
  const row = db.prepare("SELECT id, name, description, character_ids, notes_json, created_at FROM writer_projects WHERE id = ?")
    .get(projectId) as {
      id: string;
      name: string;
      description: string;
      character_ids: string | null;
      notes_json: string | null;
      created_at: string;
    } | undefined;
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const currentNotes = parseProjectNotes(row.notes_json);
  const patchInput = (req.body as { notes?: unknown })?.notes;
  const patch = patchInput && typeof patchInput === "object" && !Array.isArray(patchInput)
    ? patchInput as Record<string, unknown>
    : {};
  const merged = normalizeProjectNotes({ ...currentNotes, ...patch });
  db.prepare("UPDATE writer_projects SET notes_json = ? WHERE id = ?").run(JSON.stringify(merged), projectId);

  res.json({
    project: {
      id: row.id,
      name: row.name,
      description: row.description,
      characterIds: parseJsonIdArray(row.character_ids),
      notes: merged,
      createdAt: row.created_at
    }
  });
});

router.delete("/projects/:id", (req, res) => {
  const projectId = req.params.id;
  const row = db.prepare("SELECT id FROM writer_projects WHERE id = ?")
    .get(projectId) as { id: string } | undefined;
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const deleteTx = db.transaction((id: string) => {
    db.prepare("DELETE FROM writer_scenes WHERE chapter_id IN (SELECT id FROM writer_chapters WHERE project_id = ?)")
      .run(id);
    db.prepare("DELETE FROM writer_chapter_summaries WHERE chapter_id IN (SELECT id FROM writer_chapters WHERE project_id = ?)")
      .run(id);
    db.prepare("DELETE FROM writer_chapters WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM writer_project_summaries WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM writer_summary_lenses WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM writer_beats WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM writer_consistency_reports WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM writer_exports WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM writer_projects WHERE id = ?").run(id);
  });

  deleteTx(projectId);
  res.json({ ok: true, id: projectId });
});

router.post("/projects/:id/import/docx", async (req, res) => {
  const projectId = req.params.id;
  const row = db.prepare("SELECT id FROM writer_projects WHERE id = ?").get(projectId) as { id: string } | undefined;
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const base64Data = String((req.body as { base64Data?: unknown })?.base64Data || "");
  const filename = String((req.body as { filename?: unknown })?.filename || "import.docx");
  const parseMode = normalizeDocxParseMode((req.body as { parseMode?: unknown })?.parseMode);
  if (!base64Data.trim()) {
    res.status(400).json({ error: "base64Data is required" });
    return;
  }

  try {
    const chunks = await parseDocxIntoChapters(base64Data, filename, parseMode);
    const result = importParsedDocxChapters(projectId, chunks);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to import DOCX"
    });
  }
});

router.post("/import/docx-book", async (req, res) => {
  const base64Data = String((req.body as { base64Data?: unknown })?.base64Data || "");
  const filename = String((req.body as { filename?: unknown })?.filename || "import.docx");
  const parseMode = normalizeDocxParseMode((req.body as { parseMode?: unknown })?.parseMode);
  const requestedName = normalizeProjectName((req.body as { bookName?: unknown })?.bookName, "");
  if (!base64Data.trim()) {
    res.status(400).json({ error: "base64Data is required" });
    return;
  }

  try {
    const chunks = await parseDocxIntoChapters(base64Data, filename, parseMode);
    const id = newId();
    const ts = now();
    const projectName = requestedName || inferBookNameFromFilename(filename);
    const projectDescription = `Imported from DOCX (${parseMode})`;
    const notes = { ...DEFAULT_PROJECT_NOTES };
    db.prepare(
      "INSERT INTO writer_projects (id, name, description, character_ids, notes_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, projectName, projectDescription, "[]", JSON.stringify(notes), ts);

    const result = importParsedDocxChapters(id, chunks);
    res.json({
      ...result,
      project: {
        id,
        name: projectName,
        description: projectDescription,
        characterIds: [],
        notes,
        createdAt: ts
      }
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to import DOCX as book"
    });
  }
});

router.post("/projects/:id/summarize", async (req, res) => {
  const projectId = req.params.id;
  const force = Boolean((req.body as { force?: unknown } | undefined)?.force);
  const project = db.prepare("SELECT id, name, notes_json FROM writer_projects WHERE id = ?").get(projectId) as {
    id: string;
    name: string;
    notes_json: string | null;
  } | undefined;
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const chapters = db.prepare(
    "SELECT id, title FROM writer_chapters WHERE project_id = ? ORDER BY position ASC"
  ).all(projectId) as Array<{ id: string; title: string }>;
  if (chapters.length === 0) {
    res.json({ summary: "", cached: true, chapterCount: 0 });
    return;
  }

  const settings = getSettings();
  const notes = parseProjectNotes(project.notes_json);
  const chapterSummaries: string[] = [];
  let anyCacheMiss = false;

  for (const chapter of chapters) {
    const scenes = db.prepare(
      "SELECT title, content FROM writer_scenes WHERE chapter_id = ? ORDER BY created_at ASC"
    ).all(chapter.id) as Array<{ title: string; content: string }>;
    const sourceText = scenes.map((scene) => `${scene.title}\n${scene.content}`).join("\n\n");
    const hash = hashContent(sourceText);

    let summaryResult: { summary: string; cached: boolean };
    if (!force) {
      summaryResult = await summarizeWithCache(
        { kind: "chapter", id: chapter.id },
        hash,
        [
          settings.promptTemplates.writerSummarize,
          buildProjectNotesDirective(notes)
        ].filter(Boolean).join("\n\n"),
        `Summarize chapter "${chapter.title}" from the following material:\n\n${truncateForPrompt(sourceText, 22000)}`
      );
    } else {
      const generated = await callLlm(
        [
          settings.promptTemplates.writerSummarize,
          buildProjectNotesDirective(notes)
        ].filter(Boolean).join("\n\n"),
        `Summarize chapter "${chapter.title}" from the following material:\n\n${truncateForPrompt(sourceText, 22000)}`,
        { temperature: 0.35, maxTokens: 1200 }
      );
      summaryResult = { summary: generated.trim() || "(empty summary)", cached: false };
      db.prepare(
        `INSERT INTO writer_chapter_summaries (chapter_id, content_hash, summary, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(chapter_id) DO UPDATE SET content_hash = excluded.content_hash, summary = excluded.summary, updated_at = excluded.updated_at`
      ).run(chapter.id, hash, summaryResult.summary, now());
    }

    if (!summaryResult.cached) anyCacheMiss = true;
    chapterSummaries.push(`${chapter.title}\n${summaryResult.summary}`);
  }

  const projectSource = chapterSummaries.join("\n\n");
  const projectHash = hashContent(projectSource);
  const projectPrompt = [
    "You are a novel development assistant.",
    "Create a concise but rich book-level summary with plot progression, character arcs, and unresolved threads.",
    "Output in clear prose, no markdown bullet spam."
  ].join("\n");
  const projectResult = force
    ? { summary: (await callLlm(projectPrompt, projectSource, { temperature: 0.3, maxTokens: 1400 })).trim() || "(empty summary)", cached: false }
    : await summarizeWithCache({ kind: "project", id: projectId }, projectHash, projectPrompt, projectSource);
  if (force) {
    db.prepare(
      `INSERT INTO writer_project_summaries (project_id, content_hash, summary, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET content_hash = excluded.content_hash, summary = excluded.summary, updated_at = excluded.updated_at`
    ).run(projectId, projectHash, projectResult.summary, now());
  }

  const mergedNotes = normalizeProjectNotes({ ...notes, summary: projectResult.summary });
  db.prepare("UPDATE writer_projects SET notes_json = ? WHERE id = ?")
    .run(JSON.stringify(mergedNotes), projectId);

  res.json({
    summary: projectResult.summary,
    cached: !force && projectResult.cached && !anyCacheMiss,
    chapterCount: chapters.length
  });
});

router.get("/projects/:id/lenses", (req, res) => {
  const projectId = req.params.id;
  const project = db.prepare("SELECT id FROM writer_projects WHERE id = ?").get(projectId) as { id: string } | undefined;
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const rows = db.prepare(
    "SELECT * FROM writer_summary_lenses WHERE project_id = ? ORDER BY created_at DESC"
  ).all(projectId) as WriterSummaryLensRow[];
  res.json(rows.map((row) => lensRowToJson(row)));
});

router.post("/projects/:id/lenses", (req, res) => {
  const projectId = req.params.id;
  const project = db.prepare("SELECT id FROM writer_projects WHERE id = ?").get(projectId) as { id: string } | undefined;
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const scope = normalizeLensScope((req.body as { scope?: unknown })?.scope);
  const name = normalizeLensName((req.body as { name?: unknown })?.name);
  const prompt = normalizeLensPrompt((req.body as { prompt?: unknown })?.prompt);
  const rawTarget = (req.body as { targetId?: unknown })?.targetId;
  const targetInput = typeof rawTarget === "string" ? rawTarget.trim() : "";
  if (!prompt) {
    res.status(400).json({ error: "Lens prompt is required" });
    return;
  }
  try {
    const resolved = resolveLensSource(projectId, scope, scope === "project" ? null : (targetInput || null));
    const id = newId();
    const ts = now();
    db.prepare(
      `INSERT INTO writer_summary_lenses
       (id, project_id, name, scope, target_id, prompt, output, source_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '', '', ?, ?)`
    ).run(id, projectId, name, scope, resolved.targetId, prompt, ts, ts);
    const row = db.prepare("SELECT * FROM writer_summary_lenses WHERE id = ?").get(id) as WriterSummaryLensRow | undefined;
    if (!row) {
      res.status(500).json({ error: "Failed to load created lens" });
      return;
    }
    res.json(lensRowToJson(row));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid lens target" });
  }
});

router.patch("/projects/:id/lenses/:lensId", (req, res) => {
  const projectId = req.params.id;
  const lensId = req.params.lensId;
  const row = db.prepare(
    "SELECT * FROM writer_summary_lenses WHERE id = ? AND project_id = ?"
  ).get(lensId, projectId) as WriterSummaryLensRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Lens not found" });
    return;
  }

  const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasPrompt = Object.prototype.hasOwnProperty.call(body, "prompt");
  const hasScope = Object.prototype.hasOwnProperty.call(body, "scope");
  const hasTarget = Object.prototype.hasOwnProperty.call(body, "targetId");

  const nextScope = hasScope ? normalizeLensScope(body.scope) : row.scope;
  const nextName = hasName ? normalizeLensName(body.name) : row.name;
  const nextPrompt = hasPrompt ? normalizeLensPrompt(body.prompt) : row.prompt;
  if (!nextPrompt) {
    res.status(400).json({ error: "Lens prompt is required" });
    return;
  }
  const targetInput = hasTarget
    ? (typeof body.targetId === "string" ? body.targetId.trim() : "")
    : (row.target_id || "");
  try {
    const resolved = resolveLensSource(projectId, nextScope, nextScope === "project" ? null : (targetInput || null));
    db.prepare(
      "UPDATE writer_summary_lenses SET name = ?, scope = ?, target_id = ?, prompt = ?, source_hash = '', updated_at = ? WHERE id = ?"
    ).run(nextName, nextScope, resolved.targetId, nextPrompt, now(), row.id);
    const updated = db.prepare("SELECT * FROM writer_summary_lenses WHERE id = ?").get(row.id) as WriterSummaryLensRow | undefined;
    if (!updated) {
      res.status(500).json({ error: "Failed to load updated lens" });
      return;
    }
    res.json(lensRowToJson(updated));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid lens target" });
  }
});

router.delete("/projects/:id/lenses/:lensId", (req, res) => {
  const projectId = req.params.id;
  const lensId = req.params.lensId;
  const existing = db.prepare(
    "SELECT id FROM writer_summary_lenses WHERE id = ? AND project_id = ?"
  ).get(lensId, projectId) as { id: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: "Lens not found" });
    return;
  }
  db.prepare("DELETE FROM writer_summary_lenses WHERE id = ?").run(lensId);
  res.json({ ok: true, id: lensId });
});

router.post("/projects/:id/lenses/:lensId/run", async (req, res) => {
  const projectId = req.params.id;
  const lensId = req.params.lensId;
  const force = Boolean((req.body as { force?: unknown } | undefined)?.force);
  const row = db.prepare(
    "SELECT * FROM writer_summary_lenses WHERE id = ? AND project_id = ?"
  ).get(lensId, projectId) as WriterSummaryLensRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Lens not found" });
    return;
  }
  try {
    const result = await runSummaryLens(projectId, row, force);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to run lens" });
  }
});

// --- Chapters ---

router.post("/chapters", (req, res) => {
  const { projectId, title } = req.body;
  const id = newId();
  const ts = now();

  const posRow = db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM writer_chapters WHERE project_id = ?")
    .get(projectId) as { next_pos: number };
  const normalizedTitle = normalizeChapterTitle(title, `Chapter ${posRow.next_pos}`);

  const chapterSettings = { ...DEFAULT_CHAPTER_SETTINGS };
  db.prepare("INSERT INTO writer_chapters (id, project_id, title, position, settings_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, projectId, normalizedTitle, posRow.next_pos, JSON.stringify(chapterSettings), ts);

  res.json({ id, projectId, title: normalizedTitle, position: posRow.next_pos, settings: chapterSettings, createdAt: ts });
});

router.post("/chapters/reorder", (req, res) => {
  const { projectId, orderedIds } = req.body as { projectId: string; orderedIds: string[] };
  const stmt = db.prepare("UPDATE writer_chapters SET position = ? WHERE id = ? AND project_id = ?");
  const txn = db.transaction(() => {
    orderedIds.forEach((id, idx) => stmt.run(idx + 1, id, projectId));
  });
  txn();
  res.json({ ok: true });
});

router.patch("/chapters/:id", (req, res) => {
  const chapterId = req.params.id;
  const row = db.prepare("SELECT id, project_id, title, position, settings_json, created_at FROM writer_chapters WHERE id = ?")
    .get(chapterId) as {
      id: string;
      project_id: string;
      title: string;
      position: number;
      settings_json: string | null;
      created_at: string;
    } | undefined;
  if (!row) {
    res.status(404).json({ error: "Chapter not found" });
    return;
  }

  const body = (req.body && typeof req.body === "object")
    ? req.body as { title?: unknown }
    : {};
  const hasTitle = Object.prototype.hasOwnProperty.call(body, "title");
  const nextTitle = hasTitle
    ? normalizeChapterTitle(body.title, row.title)
    : row.title;

  db.prepare("UPDATE writer_chapters SET title = ? WHERE id = ?")
    .run(nextTitle, chapterId);

  res.json({
    id: row.id,
    projectId: row.project_id,
    title: nextTitle,
    position: row.position,
    settings: parseChapterSettings(row.settings_json),
    createdAt: row.created_at
  });
});

router.delete("/chapters/:id", (req, res) => {
  const chapterId = req.params.id;
  const chapter = db.prepare("SELECT id, project_id, position FROM writer_chapters WHERE id = ?")
    .get(chapterId) as { id: string; project_id: string; position: number } | undefined;
  if (!chapter) {
    res.status(404).json({ error: "Chapter not found" });
    return;
  }

  const tx = db.transaction((targetChapterId: string, projectId: string, position: number) => {
    const sceneIds = db.prepare("SELECT id FROM writer_scenes WHERE chapter_id = ?")
      .all(targetChapterId) as Array<{ id: string }>;
    db.prepare("DELETE FROM writer_scenes WHERE chapter_id = ?").run(targetChapterId);
    db.prepare("DELETE FROM writer_chapter_summaries WHERE chapter_id = ?").run(targetChapterId);
    db.prepare("DELETE FROM writer_chapters WHERE id = ?").run(targetChapterId);
    db.prepare("UPDATE writer_chapters SET position = position - 1 WHERE project_id = ? AND position > ?")
      .run(projectId, position);
    db.prepare(
      "DELETE FROM writer_summary_lenses WHERE project_id = ? AND scope = 'chapter' AND target_id = ?"
    ).run(projectId, targetChapterId);
    if (sceneIds.length > 0) {
      const placeholders = sceneIds.map(() => "?").join(",");
      db.prepare(
        `DELETE FROM writer_summary_lenses
         WHERE project_id = ?
           AND scope = 'scene'
           AND target_id IN (${placeholders})`
      ).run(projectId, ...sceneIds.map((row) => row.id));
    }
  });

  tx(chapter.id, chapter.project_id, chapter.position);
  res.json({ ok: true, id: chapter.id });
});

router.patch("/chapters/:id/settings", (req, res) => {
  const chapterId = req.params.id;
  const row = db.prepare("SELECT id, project_id, title, position, settings_json, created_at FROM writer_chapters WHERE id = ?")
    .get(chapterId) as {
      id: string;
      project_id: string;
      title: string;
      position: number;
      settings_json: string | null;
      created_at: string;
    } | undefined;
  if (!row) {
    res.status(404).json({ error: "Chapter not found" });
    return;
  }

  const current = parseChapterSettings(row.settings_json);
  const patchInput = (req.body as { settings?: unknown })?.settings;
  const patchObject =
    patchInput && typeof patchInput === "object"
      ? patchInput as Record<string, unknown>
      : {};
  const patch = normalizeChapterSettings({ ...current, ...patchObject });
  db.prepare("UPDATE writer_chapters SET settings_json = ? WHERE id = ?")
    .run(JSON.stringify(patch), chapterId);

  res.json({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    position: row.position,
    settings: patch,
    createdAt: row.created_at
  });
});

// --- Scenes / Generation (LLM-backed) ---

router.post("/chapters/:id/generate-draft", async (req, res) => {
  const chapterId = req.params.id;
  const { prompt } = req.body;
  const chapter = db.prepare("SELECT project_id, settings_json FROM writer_chapters WHERE id = ?")
    .get(chapterId) as { project_id: string; settings_json: string | null } | undefined;
  if (!chapter) {
    res.status(404).json({ error: "Chapter not found" });
    return;
  }
  const project = db.prepare("SELECT character_ids, notes_json FROM writer_projects WHERE id = ?")
    .get(chapter.project_id) as { character_ids: string | null; notes_json: string | null } | undefined;

  const chapterSettings = parseChapterSettings(chapter.settings_json);
  const id = newId();
  const ts = now();

  const settings = getSettings();
  const projectNotes = parseProjectNotes(project?.notes_json);
  const projectContext = buildProjectContextPack(chapter.project_id, chapterId, projectNotes);
  const systemPrompt = [
    settings.promptTemplates.writerGenerate,
    buildChapterDirective(chapterSettings),
    buildCharacterContext(parseJsonIdArray(project?.character_ids)),
    buildProjectNotesDirective(projectNotes)
  ].filter(Boolean).join("\n\n");
  const sampler = createWriterSampler(settings.samplerConfig, chapterSettings);
  const userPrompt = [
    "[Writing Task]",
    String(prompt || ""),
    projectContext ? `[Context Pack]\n${projectContext}` : ""
  ].filter(Boolean).join("\n\n");
  const content = await callLlm(systemPrompt, userPrompt, sampler);
  const titleMatch = content.match(/^#\s*(.+)/m);
  const title = titleMatch ? titleMatch[1].slice(0, 60) : "Generated Scene";

  db.prepare(
    "INSERT INTO writer_scenes (id, chapter_id, title, content, goals, conflicts, outcomes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, chapterId, title, content, "Advance plot", "Internal conflict", "Open ending", ts);

  res.json({
    id, chapterId, title, content,
    goals: "Advance plot", conflicts: "Internal conflict", outcomes: "Open ending", createdAt: ts
  });
});

router.post("/scenes/:id/expand", async (req, res) => {
  const sceneId = req.params.id;
  const row = db.prepare("SELECT * FROM writer_scenes WHERE id = ?").get(sceneId) as {
    id: string; chapter_id: string; title: string; content: string;
    goals: string; conflicts: string; outcomes: string; created_at: string;
  } | undefined;

  if (!row) { res.status(404).json({ error: "Scene not found" }); return; }

  const settings = getSettings();
  const chapter = db.prepare("SELECT project_id, settings_json FROM writer_chapters WHERE id = ?")
    .get(row.chapter_id) as { project_id: string; settings_json: string | null } | undefined;
  const project = chapter
    ? db.prepare("SELECT character_ids, notes_json FROM writer_projects WHERE id = ?").get(chapter.project_id) as { character_ids: string | null; notes_json: string | null } | undefined
    : undefined;
  const chapterSettings = parseChapterSettings(chapter?.settings_json);
  const projectNotes = parseProjectNotes(project?.notes_json);
  const projectContext = chapter ? buildProjectContextPack(chapter.project_id, row.chapter_id, projectNotes) : "";
  const systemPrompt = [
    settings.promptTemplates.writerExpand,
    buildChapterDirective(chapterSettings),
    buildCharacterContext(parseJsonIdArray(project?.character_ids)),
    buildProjectNotesDirective(projectNotes)
  ].filter(Boolean).join("\n\n");
  const sampler = createWriterSampler(settings.samplerConfig, chapterSettings);
  const expanded = await callLlm(
    systemPrompt,
    [projectContext ? `[Context Pack]\n${projectContext}` : "", row.content].filter(Boolean).join("\n\n"),
    sampler
  );

  db.prepare("UPDATE writer_scenes SET content = ? WHERE id = ?").run(expanded, sceneId);

  res.json({
    id: row.id, chapterId: row.chapter_id, title: row.title, content: expanded,
    goals: row.goals, conflicts: row.conflicts, outcomes: row.outcomes, createdAt: row.created_at
  });
});

router.post("/scenes/:id/rewrite", async (req, res) => {
  const sceneId = req.params.id;
  const toneRaw = typeof req.body?.tone === "string" ? req.body.tone : "";
  const row = db.prepare("SELECT * FROM writer_scenes WHERE id = ?").get(sceneId) as {
    id: string; chapter_id: string; title: string; content: string;
    goals: string; conflicts: string; outcomes: string; created_at: string;
  } | undefined;

  if (!row) { res.status(404).json({ error: "Scene not found" }); return; }

  const settings = getSettings();
  const chapter = db.prepare("SELECT project_id, settings_json FROM writer_chapters WHERE id = ?")
    .get(row.chapter_id) as { project_id: string; settings_json: string | null } | undefined;
  const project = chapter
    ? db.prepare("SELECT character_ids, notes_json FROM writer_projects WHERE id = ?").get(chapter.project_id) as { character_ids: string | null; notes_json: string | null } | undefined
    : undefined;
  const chapterSettings = parseChapterSettings(chapter?.settings_json);
  const projectNotes = parseProjectNotes(project?.notes_json);
  const projectContext = chapter ? buildProjectContextPack(chapter.project_id, row.chapter_id, projectNotes) : "";
  const mergedToneSettings = normalizeChapterSettings({
    ...chapterSettings,
    tone: toneRaw.trim() || chapterSettings.tone
  });
  const systemPrompt = [
    (settings.promptTemplates.writerRewrite || "").replace("{{tone}}", mergedToneSettings.tone),
    buildChapterDirective(mergedToneSettings),
    buildCharacterContext(parseJsonIdArray(project?.character_ids)),
    buildProjectNotesDirective(projectNotes)
  ].filter(Boolean).join("\n\n");
  const sampler = createWriterSampler(settings.samplerConfig, mergedToneSettings);
  const rewritten = await callLlm(
    systemPrompt,
    [projectContext ? `[Context Pack]\n${projectContext}` : "", row.content].filter(Boolean).join("\n\n"),
    sampler
  );

  db.prepare("UPDATE writer_scenes SET content = ? WHERE id = ?").run(rewritten, sceneId);

  res.json({
    id: row.id, chapterId: row.chapter_id, title: row.title, content: rewritten,
    goals: row.goals, conflicts: row.conflicts, outcomes: row.outcomes, createdAt: row.created_at
  });
});

router.get("/scenes/:id/summarize", async (req, res) => {
  const row = db.prepare("SELECT chapter_id, content FROM writer_scenes WHERE id = ?")
    .get(req.params.id) as { chapter_id: string; content: string } | undefined;

  if (!row) { res.status(404).json({ error: "Scene not found" }); return; }

  const settings = getSettings();
  const chapter = db.prepare("SELECT project_id, settings_json FROM writer_chapters WHERE id = ?")
    .get(row.chapter_id) as { project_id: string; settings_json: string | null } | undefined;
  const project = chapter
    ? db.prepare("SELECT character_ids, notes_json FROM writer_projects WHERE id = ?").get(chapter.project_id) as { character_ids: string | null; notes_json: string | null } | undefined
    : undefined;
  const chapterSettings = parseChapterSettings(chapter?.settings_json);
  const projectNotes = parseProjectNotes(project?.notes_json);
  const projectContext = chapter ? buildProjectContextPack(chapter.project_id, row.chapter_id, projectNotes) : "";
  const systemPrompt = [
    settings.promptTemplates.writerSummarize,
    buildChapterDirective(chapterSettings),
    buildCharacterContext(parseJsonIdArray(project?.character_ids)),
    buildProjectNotesDirective(projectNotes)
  ].filter(Boolean).join("\n\n");
  const summary = await callLlm(
    systemPrompt,
    [projectContext ? `[Context Pack]\n${projectContext}` : "", row.content].filter(Boolean).join("\n\n"),
    createWriterSampler(settings.samplerConfig, chapterSettings)
  );

  res.json(summary);
});

// Scene content update (direct editing)
router.patch("/scenes/:id", (req, res) => {
  const sceneId = req.params.id;
  const { content, title, goals, conflicts, outcomes } = req.body;
  const row = db.prepare("SELECT * FROM writer_scenes WHERE id = ?").get(sceneId) as {
    id: string; chapter_id: string; title: string; content: string;
    goals: string; conflicts: string; outcomes: string; created_at: string;
  } | undefined;
  if (!row) { res.status(404).json({ error: "Scene not found" }); return; }

  const newContent = content ?? row.content;
  const newTitle = title ?? row.title;
  const newGoals = goals ?? row.goals;
  const newConflicts = conflicts ?? row.conflicts;
  const newOutcomes = outcomes ?? row.outcomes;

  db.prepare("UPDATE writer_scenes SET content = ?, title = ?, goals = ?, conflicts = ?, outcomes = ? WHERE id = ?")
    .run(newContent, newTitle, newGoals, newConflicts, newOutcomes, sceneId);

  res.json({
    id: row.id, chapterId: row.chapter_id, title: newTitle, content: newContent,
    goals: newGoals, conflicts: newConflicts, outcomes: newOutcomes, createdAt: row.created_at
  });
});

router.delete("/scenes/:id", (req, res) => {
  const sceneId = req.params.id;
  const row = db.prepare(
    `SELECT s.id, s.chapter_id, c.project_id
     FROM writer_scenes s
     JOIN writer_chapters c ON c.id = s.chapter_id
     WHERE s.id = ?`
  ).get(sceneId) as {
    id: string;
    chapter_id: string;
    project_id: string;
  } | undefined;
  if (!row) {
    res.status(404).json({ error: "Scene not found" });
    return;
  }

  const tx = db.transaction((id: string, projectId: string) => {
    db.prepare("DELETE FROM writer_scenes WHERE id = ?").run(id);
    db.prepare(
      "DELETE FROM writer_summary_lenses WHERE project_id = ? AND scope = 'scene' AND target_id = ?"
    ).run(projectId, id);
  });

  tx(row.id, row.project_id);
  res.json({ ok: true, id: row.id });
});

// --- Consistency ---

router.post("/projects/:id/consistency", (req, res) => {
  const projectId = req.params.id;

  const chapters = db.prepare("SELECT id FROM writer_chapters WHERE project_id = ?")
    .all(projectId) as { id: string }[];
  const chapterIds = chapters.map((c) => c.id);

  let scenes: { id: string; title: string; content: string }[] = [];
  if (chapterIds.length > 0) {
    const placeholders = chapterIds.map(() => "?").join(",");
    scenes = db.prepare(`SELECT id, title, content FROM writer_scenes WHERE chapter_id IN (${placeholders})`)
      .all(...chapterIds) as typeof scenes;
  }

  const issues = runConsistency(projectId, scenes);

  db.prepare("INSERT INTO writer_consistency_reports (id, project_id, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(newId(), projectId, JSON.stringify(issues), now());

  res.json(issues);
});

// --- Export ---

router.post("/projects/:id/export/markdown", (req, res) => {
  const projectId = req.params.id;
  const bundle = buildWriterExportBundle(projectId);
  if (!bundle) { res.status(404).json({ error: "Project not found" }); return; }

  const outputPath = join(DATA_DIR, `${bundle.filenameBase}.md`);
  writeFileSync(outputPath, bundle.markdown);

  db.prepare("INSERT INTO writer_exports (id, project_id, export_type, output_path, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(newId(), projectId, "markdown", outputPath, now());

  res.json(outputPath);
});

router.post("/projects/:id/export/docx", async (req, res) => {
  const projectId = req.params.id;
  const bundle = buildWriterExportBundle(projectId);
  if (!bundle) { res.status(404).json({ error: "Project not found" }); return; }

  const outputPath = join(DATA_DIR, `${bundle.filenameBase}.docx`);
  const buffer = await buildDocxBufferFromBundle(bundle);
  writeFileSync(outputPath, buffer);

  db.prepare("INSERT INTO writer_exports (id, project_id, export_type, output_path, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(newId(), projectId, "docx", outputPath, now());

  res.json(outputPath);
});

router.post("/projects/:id/export/markdown/download", (req, res) => {
  const projectId = req.params.id;
  const bundle = buildWriterExportBundle(projectId);
  if (!bundle) { res.status(404).json({ error: "Project not found" }); return; }
  const filename = `${bundle.filenameBase}.md`;

  db.prepare("INSERT INTO writer_exports (id, project_id, export_type, output_path, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(newId(), projectId, "markdown", filename, now());

  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", buildAttachmentDisposition(filename, `book-${projectId}.md`));
  res.send(bundle.markdown);
});

router.post("/projects/:id/export/docx/download", async (req, res) => {
  const projectId = req.params.id;
  const bundle = buildWriterExportBundle(projectId);
  if (!bundle) { res.status(404).json({ error: "Project not found" }); return; }
  const filename = `${bundle.filenameBase}.docx`;

  const buffer = await buildDocxBufferFromBundle(bundle);
  db.prepare("INSERT INTO writer_exports (id, project_id, export_type, output_path, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(newId(), projectId, "docx", filename, now());

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", buildAttachmentDisposition(filename, `book-${projectId}.docx`));
  res.send(buffer);
});

export default router;
