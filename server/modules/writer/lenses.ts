import { createHash } from "crypto";
import { db, now } from "../../db.js";
import {
  type WriterSummaryLensRow,
  type WriterSummaryLensScope,
  type WriterProjectNotes,
  toCleanText
} from "./defs.js";
import { buildProjectNotesDirective, truncateForPrompt } from "./context.js";
import { callWriterLlm } from "./llm.js";

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function normalizeLensScope(raw: unknown): WriterSummaryLensScope {
  const value = String(raw || "").trim();
  if (value === "chapter" || value === "scene") return value;
  return "project";
}

export function normalizeLensName(raw: unknown): string {
  const value = toCleanText(raw, 120);
  return value || "Custom Lens";
}

export function normalizeLensPrompt(raw: unknown): string {
  return toCleanText(raw, 8000);
}

export function lensRowToJson(row: WriterSummaryLensRow) {
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

export function resolveLensSource(projectId: string, scope: WriterSummaryLensScope, targetId: string | null): { targetId: string | null; sourceText: string } {
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

export async function runSummaryLens(projectId: string, row: WriterSummaryLensRow, force = false): Promise<{ lens: ReturnType<typeof lensRowToJson>; cached: boolean; sourceChars: number }> {
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
    ? (await callWriterLlm(
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

export async function summarizeWithCache(
  cacheKey: { kind: "chapter"; id: string } | { kind: "project"; id: string },
  hash: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{ summary: string; cached: boolean }> {
  const selectSql = cacheKey.kind === "chapter"
    ? "SELECT summary, content_hash FROM writer_chapter_summaries WHERE chapter_id = ?"
    : "SELECT summary, content_hash FROM writer_project_summaries WHERE project_id = ?";
  const existing = db.prepare(selectSql).get(cacheKey.id) as { summary: string; content_hash: string } | undefined;
  if (existing && existing.content_hash === hash && existing.summary.trim()) {
    return { summary: existing.summary, cached: true };
  }

  const generated = (await callWriterLlm(systemPrompt, userPrompt, { temperature: 0.35, maxTokens: 1200 })).trim();
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

export function buildChapterSummaryPrompt(notes: WriterProjectNotes, writerSummarizeTemplate: string) {
  return [
    writerSummarizeTemplate,
    buildProjectNotesDirective(notes)
  ].filter(Boolean).join("\n\n");
}

export function hashWriterContent(content: string): string {
  return hashContent(content);
}
