import { db } from "../../db.js";
import { retrieveWriterRagContext } from "../../services/rag.js";
import {
  DEFAULT_CHAPTER_SETTINGS,
  type WriterChapterSettings,
  type WriterProjectNotes
} from "./defs.js";

export function truncateForPrompt(text: string, maxChars: number): string {
  const value = String(text || "").trim();
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function buildProjectNotesDirective(notes: WriterProjectNotes): string {
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

function resolveWriterContextLimits(mode: WriterProjectNotes["contextMode"]): { prev: number; current: number; total: number } {
  if (mode === "economy") {
    return { prev: 1400, current: 1000, total: 2600 };
  }
  if (mode === "rich") {
    return { prev: 5200, current: 3200, total: 9000 };
  }
  return { prev: 2800, current: 1800, total: 5200 };
}

export function buildProjectContextPack(projectId: string, chapterId: string, notes: WriterProjectNotes): string {
  const limits = resolveWriterContextLimits(notes.contextMode);

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

export function buildProjectContinuationContextPack(projectId: string, notes: WriterProjectNotes): string {
  const limits = resolveWriterContextLimits(notes.contextMode);
  const chapters = db.prepare(
    "SELECT id, title, position FROM writer_chapters WHERE project_id = ? ORDER BY position ASC"
  ).all(projectId) as Array<{ id: string; title: string; position: number }>;
  if (chapters.length === 0) return "";

  const previous = chapters.slice(0, -1);
  const latest = chapters[chapters.length - 1];
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

  const latestScenes = db.prepare(
    "SELECT title, content FROM writer_scenes WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 3"
  ).all(latest.id) as Array<{ title: string; content: string }>;
  const latestContext = latestScenes
    .map((row) => `${row.title}: ${truncateForPrompt(row.content, 500)}`)
    .join("\n");

  const out = [
    previousContext ? `[Previous Chapters]\n${truncateForPrompt(previousContext, limits.prev)}` : "",
    latestContext ? `[Latest Chapter Progress]\n${truncateForPrompt(latestContext, limits.current)}` : ""
  ].filter(Boolean).join("\n\n");
  return truncateForPrompt(out, limits.total);
}

export async function buildWriterRagDirective(projectId: string, settings: Record<string, unknown>, queryParts: Array<string | null | undefined>): Promise<string> {
  const query = truncateForPrompt(
    queryParts
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join("\n\n"),
    8000
  );
  if (!query) return "";
  const ragResult = await retrieveWriterRagContext({
    projectId,
    queryText: query,
    settings
  });
  if (!ragResult.context) return "";
  return [
    "[Retrieved Knowledge]",
    ragResult.context,
    "Use retrieved knowledge only when relevant. If it conflicts with explicit writing instructions, follow the writing instructions."
  ].join("\n\n");
}

export function buildChapterDirective(chapter: WriterChapterSettings): string {
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

export function buildCharacterContext(characterIds: string[]): string {
  if (characterIds.length === 0) return "";
  const rows = db.prepare(
    "SELECT id, name, description, personality, scenario, system_prompt FROM characters WHERE id IN (" +
      characterIds.map(() => "?").join(",") +
      ")"
  ).all(...characterIds) as Array<{
    id: string;
    name: string;
    description: string;
    personality: string;
    scenario: string;
    system_prompt: string;
  }>;
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
