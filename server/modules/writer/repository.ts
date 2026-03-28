import { db } from "../../db.js";
import {
  DEFAULT_CHAPTER_SETTINGS,
  parseJsonIdArray,
  parseProjectNotes,
  type WriterProjectNotes
} from "./defs.js";
import { parseChapterSettings } from "./chapterSettings.js";

export interface WriterProjectRow {
  id: string;
  name: string;
  description: string;
  character_ids: string | null;
  notes_json: string | null;
  created_at: string;
}

export interface WriterChapterRow {
  id: string;
  project_id: string;
  title: string;
  position: number;
  settings_json: string | null;
  created_at: string;
}

export interface WriterSceneRow {
  id: string;
  chapter_id: string;
  title: string;
  content: string;
  goals: string;
  conflicts: string;
  outcomes: string;
  created_at: string;
}

interface WriterSceneProjectRow {
  id: string;
  chapter_id: string;
  project_id: string;
}

export interface WriterProjectSummaryRow {
  id: string;
  name: string;
  notes_json: string | null;
}

export interface WriterChapterSummarySourceRow {
  id: string;
  title: string;
}

export interface WriterSceneContentRow {
  title: string;
  content: string;
}

export interface WriterLensCreateParams {
  id: string;
  projectId: string;
  name: string;
  scope: string;
  targetId: string | null;
  prompt: string;
  createdAt: string;
}

export interface WriterLensUpdateParams {
  id: string;
  name: string;
  scope: string;
  targetId: string | null;
  prompt: string;
  updatedAt: string;
}

export interface WriterLastChapterRow {
  id: string;
  title: string;
  position: number;
  settings_json: string | null;
}

export interface WriterProjectGenerationRow {
  id: string;
  character_ids: string | null;
  notes_json: string | null;
}

export interface WriterChapterGenerationRow {
  project_id: string;
  title: string;
  settings_json: string | null;
}

export interface WriterSceneSummaryRow {
  chapter_id: string;
  content: string;
}

export function projectExists(projectId: string): boolean {
  const row = db.prepare("SELECT id FROM writer_projects WHERE id = ?").get(projectId) as { id: string } | undefined;
  return Boolean(row);
}

export function getProjectRow(projectId: string): WriterProjectRow | undefined {
  return db.prepare("SELECT * FROM writer_projects WHERE id = ?").get(projectId) as WriterProjectRow | undefined;
}

export function listProjects(): WriterProjectRow[] {
  return db.prepare("SELECT * FROM writer_projects ORDER BY created_at DESC").all() as WriterProjectRow[];
}

export function listProjectChapters(projectId: string): WriterChapterRow[] {
  return db.prepare("SELECT * FROM writer_chapters WHERE project_id = ? ORDER BY position ASC").all(projectId) as WriterChapterRow[];
}

export function listScenesForChapterIds(chapterIds: string[]): WriterSceneRow[] {
  if (chapterIds.length === 0) return [];
  const placeholders = chapterIds.map(() => "?").join(",");
  return db.prepare(`SELECT * FROM writer_scenes WHERE chapter_id IN (${placeholders}) ORDER BY created_at ASC`)
    .all(...chapterIds) as WriterSceneRow[];
}

export function getProjectOpenPayload(projectId: string) {
  const project = getProjectRow(projectId);
  if (!project) return null;
  const chapters = listProjectChapters(projectId);
  const scenes = listScenesForChapterIds(chapters.map((chapter) => chapter.id));
  return {
    project: toProjectJson(project),
    chapters: chapters.map((chapter) => toChapterJson(chapter)),
    scenes: scenes.map((scene) => toSceneJson(scene))
  };
}

export function getProjectSummaryRow(projectId: string): WriterProjectSummaryRow | undefined {
  return db.prepare("SELECT id, name, notes_json FROM writer_projects WHERE id = ?").get(projectId) as WriterProjectSummaryRow | undefined;
}

export function listProjectChapterSummaryRows(projectId: string): WriterChapterSummarySourceRow[] {
  return db.prepare("SELECT id, title FROM writer_chapters WHERE project_id = ? ORDER BY position ASC")
    .all(projectId) as WriterChapterSummarySourceRow[];
}

export function listChapterSceneContentRows(chapterId: string): WriterSceneContentRow[] {
  return db.prepare("SELECT title, content FROM writer_scenes WHERE chapter_id = ? ORDER BY created_at ASC")
    .all(chapterId) as WriterSceneContentRow[];
}

export function upsertChapterSummary(params: {
  chapterId: string;
  contentHash: string;
  summary: string;
  updatedAt: string;
}) {
  db.prepare(
    `INSERT INTO writer_chapter_summaries (chapter_id, content_hash, summary, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(chapter_id) DO UPDATE SET content_hash = excluded.content_hash, summary = excluded.summary, updated_at = excluded.updated_at`
  ).run(params.chapterId, params.contentHash, params.summary, params.updatedAt);
}

export function upsertProjectSummary(params: {
  projectId: string;
  contentHash: string;
  summary: string;
  updatedAt: string;
}) {
  db.prepare(
    `INSERT INTO writer_project_summaries (project_id, content_hash, summary, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET content_hash = excluded.content_hash, summary = excluded.summary, updated_at = excluded.updated_at`
  ).run(params.projectId, params.contentHash, params.summary, params.updatedAt);
}

export function createProjectRecord(params: {
  id: string;
  name: string;
  description: string;
  characterIds: string[];
  notes: WriterProjectNotes;
  createdAt: string;
}) {
  db.prepare(
    "INSERT INTO writer_projects (id, name, description, character_ids, notes_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    params.id,
    params.name,
    params.description,
    JSON.stringify(params.characterIds),
    JSON.stringify(params.notes),
    params.createdAt
  );
  return {
    id: params.id,
    name: params.name,
    description: params.description,
    characterIds: params.characterIds,
    notes: params.notes,
    createdAt: params.createdAt
  };
}

export function updateProjectCharacters(projectId: string, characterIds: string[]) {
  db.prepare("UPDATE writer_projects SET character_ids = ? WHERE id = ?")
    .run(JSON.stringify(characterIds), projectId);
}

export function updateProjectMetadata(projectId: string, name: string, description: string) {
  db.prepare("UPDATE writer_projects SET name = ?, description = ? WHERE id = ?")
    .run(name, description, projectId);
}

export function updateProjectNotes(projectId: string, notes: WriterProjectNotes) {
  db.prepare("UPDATE writer_projects SET notes_json = ? WHERE id = ?")
    .run(JSON.stringify(notes), projectId);
}

export function deleteProjectCascade(projectId: string) {
  const deleteTx = db.transaction((id: string) => {
    db.prepare("DELETE FROM writer_scenes WHERE chapter_id IN (SELECT id FROM writer_chapters WHERE project_id = ?)")
      .run(id);
    db.prepare("DELETE FROM writer_chapter_summaries WHERE chapter_id IN (SELECT id FROM writer_chapters WHERE project_id = ?)")
      .run(id);
    db.prepare("DELETE FROM writer_chapters WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM writer_project_summaries WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM writer_summary_lenses WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM writer_rag_bindings WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM writer_beats WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM writer_consistency_reports WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM writer_exports WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM writer_projects WHERE id = ?").run(id);
  });

  deleteTx(projectId);
}

export function createImportedProjectRecord(params: {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}) {
  return createProjectRecord({
    ...params,
    characterIds: [],
    notes: parseProjectNotes(null)
  });
}

export function getChapterRow(chapterId: string): WriterChapterRow | undefined {
  return db.prepare("SELECT id, project_id, title, position, settings_json, created_at FROM writer_chapters WHERE id = ?")
    .get(chapterId) as WriterChapterRow | undefined;
}

export function getChapterIdsForProject(projectId: string): string[] {
  const rows = db.prepare("SELECT id FROM writer_chapters WHERE project_id = ?").all(projectId) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export function getLastProjectChapter(projectId: string): WriterLastChapterRow | undefined {
  return db.prepare(
    `SELECT id, title, position, settings_json
     FROM writer_chapters
     WHERE project_id = ?
     ORDER BY position DESC
     LIMIT 1`
  ).get(projectId) as WriterLastChapterRow | undefined;
}

export function getProjectGenerationRow(projectId: string): WriterProjectGenerationRow | undefined {
  return db.prepare("SELECT id, character_ids, notes_json FROM writer_projects WHERE id = ?")
    .get(projectId) as WriterProjectGenerationRow | undefined;
}

export function createChapterRecord(params: {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
}) {
  const posRow = db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM writer_chapters WHERE project_id = ?")
    .get(params.projectId) as { next_pos: number };
  db.prepare(
    "INSERT INTO writer_chapters (id, project_id, title, position, settings_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    params.id,
    params.projectId,
    params.title,
    posRow.next_pos,
    JSON.stringify(DEFAULT_CHAPTER_SETTINGS),
    params.createdAt
  );

  return {
    id: params.id,
    projectId: params.projectId,
    title: params.title,
    position: posRow.next_pos,
    settings: { ...DEFAULT_CHAPTER_SETTINGS },
    createdAt: params.createdAt
  };
}

export function reorderProjectChapters(projectId: string, orderedIds: string[]) {
  const stmt = db.prepare("UPDATE writer_chapters SET position = ? WHERE id = ? AND project_id = ?");
  const tx = db.transaction(() => {
    orderedIds.forEach((id, idx) => stmt.run(idx + 1, id, projectId));
  });
  tx();
}

export function updateChapterTitle(chapterId: string, title: string) {
  db.prepare("UPDATE writer_chapters SET title = ? WHERE id = ?")
    .run(title, chapterId);
}

export function updateChapterSettings(chapterId: string, settings: Record<string, unknown>) {
  db.prepare("UPDATE writer_chapters SET settings_json = ? WHERE id = ?")
    .run(JSON.stringify(settings), chapterId);
}

export function deleteChapterCascade(chapterId: string, projectId: string, position: number) {
  const tx = db.transaction((targetChapterId: string, targetProjectId: string, targetPosition: number) => {
    const sceneIds = db.prepare("SELECT id FROM writer_scenes WHERE chapter_id = ?")
      .all(targetChapterId) as Array<{ id: string }>;
    db.prepare("DELETE FROM writer_scenes WHERE chapter_id = ?").run(targetChapterId);
    db.prepare("DELETE FROM writer_chapter_summaries WHERE chapter_id = ?").run(targetChapterId);
    db.prepare("DELETE FROM writer_chapters WHERE id = ?").run(targetChapterId);
    db.prepare("UPDATE writer_chapters SET position = position - 1 WHERE project_id = ? AND position > ?")
      .run(targetProjectId, targetPosition);
    db.prepare(
      "DELETE FROM writer_summary_lenses WHERE project_id = ? AND scope = 'chapter' AND target_id = ?"
    ).run(targetProjectId, targetChapterId);
    if (sceneIds.length > 0) {
      const placeholders = sceneIds.map(() => "?").join(",");
      db.prepare(
        `DELETE FROM writer_summary_lenses
         WHERE project_id = ?
           AND scope = 'scene'
           AND target_id IN (${placeholders})`
      ).run(targetProjectId, ...sceneIds.map((row) => row.id));
    }
  });

  tx(chapterId, projectId, position);
}

export function getSceneRow(sceneId: string): WriterSceneRow | undefined {
  return db.prepare("SELECT * FROM writer_scenes WHERE id = ?").get(sceneId) as WriterSceneRow | undefined;
}

export function getSceneSummaryRow(sceneId: string): WriterSceneSummaryRow | undefined {
  return db.prepare("SELECT chapter_id, content FROM writer_scenes WHERE id = ?")
    .get(sceneId) as WriterSceneSummaryRow | undefined;
}

export function getChapterGenerationRow(chapterId: string): WriterChapterGenerationRow | undefined {
  return db.prepare("SELECT project_id, title, settings_json FROM writer_chapters WHERE id = ?")
    .get(chapterId) as WriterChapterGenerationRow | undefined;
}

export function updateSceneRecord(sceneId: string, patch: {
  content: string;
  title: string;
  goals: string;
  conflicts: string;
  outcomes: string;
}) {
  db.prepare(
    "UPDATE writer_scenes SET content = ?, title = ?, goals = ?, conflicts = ?, outcomes = ? WHERE id = ?"
  ).run(
    patch.content,
    patch.title,
    patch.goals,
    patch.conflicts,
    patch.outcomes,
    sceneId
  );
}

export function getSceneProjectRow(sceneId: string): WriterSceneProjectRow | undefined {
  return db.prepare(
    `SELECT s.id, s.chapter_id, c.project_id
     FROM writer_scenes s
     JOIN writer_chapters c ON c.id = s.chapter_id
     WHERE s.id = ?`
  ).get(sceneId) as WriterSceneProjectRow | undefined;
}

export function deleteSceneCascade(sceneId: string, projectId: string) {
  const tx = db.transaction((id: string, targetProjectId: string) => {
    db.prepare("DELETE FROM writer_scenes WHERE id = ?").run(id);
    db.prepare(
      "DELETE FROM writer_summary_lenses WHERE project_id = ? AND scope = 'scene' AND target_id = ?"
    ).run(targetProjectId, id);
  });

  tx(sceneId, projectId);
}

export function createGeneratedChapterWithScene(params: {
  chapterId: string;
  sceneId: string;
  projectId: string;
  chapterTitle: string;
  position: number;
  settingsJson: string;
  sceneTitle: string;
  sceneContent: string;
  createdAt: string;
}) {
  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO writer_chapters (id, project_id, title, position, settings_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      params.chapterId,
      params.projectId,
      params.chapterTitle,
      params.position,
      params.settingsJson,
      params.createdAt
    );
    db.prepare(
      "INSERT INTO writer_scenes (id, chapter_id, title, content, goals, conflicts, outcomes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      params.sceneId,
      params.chapterId,
      params.sceneTitle,
      params.sceneContent,
      "Advance plot",
      "Escalate conflict",
      "Open ending",
      params.createdAt
    );
  });

  tx();
}

export function createGeneratedSceneRecord(params: {
  id: string;
  chapterId: string;
  title: string;
  content: string;
  createdAt: string;
}) {
  db.prepare(
    "INSERT INTO writer_scenes (id, chapter_id, title, content, goals, conflicts, outcomes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    params.id,
    params.chapterId,
    params.title,
    params.content,
    "Advance plot",
    "Internal conflict",
    "Open ending",
    params.createdAt
  );
}

export function updateSceneContent(sceneId: string, content: string) {
  db.prepare("UPDATE writer_scenes SET content = ? WHERE id = ?").run(content, sceneId);
}

export function listProjectLensRows(projectId: string) {
  return db.prepare("SELECT * FROM writer_summary_lenses WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId);
}

export function createLensRecord(params: WriterLensCreateParams) {
  db.prepare(
    `INSERT INTO writer_summary_lenses
     (id, project_id, name, scope, target_id, prompt, output, source_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', '', ?, ?)`
  ).run(params.id, params.projectId, params.name, params.scope, params.targetId, params.prompt, params.createdAt, params.createdAt);
}

export function getLensRow(projectId: string, lensId: string) {
  return db.prepare("SELECT * FROM writer_summary_lenses WHERE id = ? AND project_id = ?")
    .get(lensId, projectId);
}

export function updateLensRecord(params: WriterLensUpdateParams) {
  db.prepare(
    "UPDATE writer_summary_lenses SET name = ?, scope = ?, target_id = ?, prompt = ?, source_hash = '', updated_at = ? WHERE id = ?"
  ).run(params.name, params.scope, params.targetId, params.prompt, params.updatedAt, params.id);
}

export function deleteLensRecord(lensId: string) {
  db.prepare("DELETE FROM writer_summary_lenses WHERE id = ?").run(lensId);
}

export function listConsistencyScenes(projectId: string): Array<{ id: string; title: string; content: string }> {
  const chapterIds = getChapterIdsForProject(projectId);
  if (chapterIds.length === 0) return [];
  const placeholders = chapterIds.map(() => "?").join(",");
  return db.prepare(`SELECT id, title, content FROM writer_scenes WHERE chapter_id IN (${placeholders})`)
    .all(...chapterIds) as Array<{ id: string; title: string; content: string }>;
}

export function recordConsistencyReport(params: {
  id: string;
  projectId: string;
  payload: string;
  createdAt: string;
}) {
  db.prepare("INSERT INTO writer_consistency_reports (id, project_id, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(params.id, params.projectId, params.payload, params.createdAt);
}

export function recordWriterExport(params: {
  id: string;
  projectId: string;
  exportType: "markdown" | "docx";
  outputPath: string;
  createdAt: string;
}) {
  db.prepare("INSERT INTO writer_exports (id, project_id, export_type, output_path, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(params.id, params.projectId, params.exportType, params.outputPath, params.createdAt);
}

export function toProjectJson(row: WriterProjectRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    characterIds: parseJsonIdArray(row.character_ids),
    notes: parseProjectNotes(row.notes_json),
    createdAt: row.created_at
  };
}

export function toChapterJson(row: WriterChapterRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    position: row.position,
    settings: parseChapterSettings(row.settings_json),
    createdAt: row.created_at
  };
}

export function toSceneJson(row: WriterSceneRow) {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    title: row.title,
    content: row.content,
    goals: row.goals,
    conflicts: row.conflicts,
    outcomes: row.outcomes,
    createdAt: row.created_at
  };
}
