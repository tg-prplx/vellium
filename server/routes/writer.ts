import { Router } from "express";
import { writeFileSync } from "fs";
import { join } from "path";
import { db, newId, now, DATA_DIR } from "../db.js";
import { runConsistency } from "../domain/writerEngine.js";
import { getWriterRagBinding, setWriterRagBinding } from "../services/rag.js";
import {
  DEFAULT_CHAPTER_SETTINGS,
  DEFAULT_PROJECT_NOTES,
  characterToJson,
  normalizeProjectName,
  parseIdArray,
  parseJsonIdArray,
  parseProjectNotes,
  normalizeProjectNotes,
  type WriterProjectNotes,
  type WriterSummaryLensRow,
  type WriterCharacterAdvancedInput,
  extractFirstJsonObject,
  buildCharacterDraft,
  type CharacterRow,
  parseCharacterTagsJson,
  parseWriterCharacterPatchFields,
  buildWriterCharacterPatch,
  filterWriterCharacterPatch,
  updateCharacterWithPatch,
  WRITER_CHARACTER_PATCH_FIELDS,
  type WriterCharacterPatchField,
  toCleanText,
  normalizeChapterTitle
} from "../modules/writer/defs.js";
import {
  inferBookNameFromFilename,
  importParsedDocxChapters,
  normalizeDocxParseMode,
  parseDocxIntoChapters
} from "../modules/writer/docx.js";
import {
  buildAttachmentDisposition,
  createWriterSampler,
  normalizeChapterSettings,
  parseChapterSettings
} from "../modules/writer/chapterSettings.js";
import {
  buildCharacterContext,
  buildChapterDirective,
  buildProjectContextPack,
  buildProjectContinuationContextPack,
  buildProjectNotesDirective,
  buildWriterRagDirective,
  truncateForPrompt
} from "../modules/writer/context.js";
import { buildDocxBufferFromBundle, buildWriterExportBundle } from "../modules/writer/export.js";
import { callWriterLlm, getWriterSettings } from "../modules/writer/llm.js";
import {
  buildChapterSummaryPrompt,
  hashWriterContent,
  lensRowToJson,
  normalizeLensName,
  normalizeLensPrompt,
  normalizeLensScope,
  resolveLensSource,
  runSummaryLens,
  summarizeWithCache
} from "../modules/writer/lenses.js";
import {
  createGeneratedChapterWithScene,
  createGeneratedSceneRecord,
  createChapterRecord,
  createImportedProjectRecord,
  createLensRecord,
  createProjectRecord,
  deleteChapterCascade,
  deleteLensRecord,
  deleteProjectCascade,
  deleteSceneCascade,
  getChapterGenerationRow,
  getChapterIdsForProject,
  getChapterRow,
  getLastProjectChapter,
  getLensRow,
  getProjectOpenPayload,
  getProjectGenerationRow,
  getProjectRow,
  getProjectSummaryRow,
  getSceneProjectRow,
  getSceneRow,
  getSceneSummaryRow,
  listChapterSceneContentRows,
  listConsistencyScenes,
  listProjectChapterSummaryRows,
  listProjectLensRows,
  listProjects,
  projectExists,
  recordConsistencyReport,
  recordWriterExport,
  reorderProjectChapters,
  toChapterJson,
  toProjectJson,
  toSceneJson,
  updateLensRecord,
  updateChapterSettings,
  updateChapterTitle,
  updateProjectCharacters,
  updateProjectMetadata,
  updateProjectNotes,
  updateSceneContent,
  updateSceneRecord,
  upsertChapterSummary,
  upsertProjectSummary
} from "../modules/writer/repository.js";

const router = Router();

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

  const raw = await callWriterLlm(systemPrompt, userPrompt, {
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

  const raw = await callWriterLlm(systemPrompt, userPrompt, {
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
  res.json(createProjectRecord({
    id,
    name: normalizedName,
    description: normalizedDescription,
    characterIds: normalizedCharacterIds,
    notes,
    createdAt: ts
  }));
});

router.get("/projects", (_req, res) => {
  res.json(listProjects().map((row) => toProjectJson(row)));
});

router.get("/projects/:id", (req, res) => {
  const projectId = req.params.id;
  const payload = getProjectOpenPayload(projectId);
  if (!payload) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(payload);
});

router.patch("/projects/:id/characters", (req, res) => {
  const projectId = req.params.id;
  const characterIds = parseIdArray((req.body as { characterIds?: unknown })?.characterIds);
  const row = getProjectRow(projectId);
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  updateProjectCharacters(projectId, characterIds);
  res.json({ ...toProjectJson(row), characterIds });
});

router.patch("/projects/:id", (req, res) => {
  const projectId = req.params.id;
  const row = getProjectRow(projectId);
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const body = req.body as { name?: unknown; description?: unknown };
  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasDescription = Object.prototype.hasOwnProperty.call(body, "description");
  const nextName = hasName ? normalizeProjectName(body.name, row.name) : row.name;
  const nextDescription = hasDescription ? String(body.description ?? "").trim() : row.description;

  updateProjectMetadata(projectId, nextName, nextDescription);
  res.json({ ...toProjectJson(row), name: nextName, description: nextDescription });
});

router.patch("/projects/:id/notes", (req, res) => {
  const projectId = req.params.id;
  const row = getProjectRow(projectId);
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
  updateProjectNotes(projectId, merged);

  res.json({
    project: {
      ...toProjectJson(row),
      notes: merged
    }
  });
});

router.get("/projects/:id/rag", (req, res) => {
  const projectId = req.params.id;
  if (!projectExists(projectId)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const settings = getWriterSettings();
  const binding = getWriterRagBinding(projectId, settings as Record<string, unknown>);
  res.json(binding);
});

router.patch("/projects/:id/rag", (req, res) => {
  const projectId = req.params.id;
  if (!projectExists(projectId)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const enabled = req.body?.enabled === true;
  const collectionIds = Array.isArray(req.body?.collectionIds) ? req.body.collectionIds : [];
  const binding = setWriterRagBinding(projectId, enabled, collectionIds);
  res.json(binding);
});

router.delete("/projects/:id", (req, res) => {
  const projectId = req.params.id;
  if (!projectExists(projectId)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  deleteProjectCascade(projectId);
  res.json({ ok: true, id: projectId });
});

router.post("/projects/:id/import/docx", async (req, res) => {
  const projectId = req.params.id;
  if (!projectExists(projectId)) {
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
    const project = createImportedProjectRecord({
      id,
      name: projectName,
      description: projectDescription,
      createdAt: ts
    });
    const result = importParsedDocxChapters(id, chunks);
    res.json({
      ...result,
      project
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
  const project = getProjectSummaryRow(projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const chapters = listProjectChapterSummaryRows(projectId);
  if (chapters.length === 0) {
    res.json({ summary: "", cached: true, chapterCount: 0 });
    return;
  }

  const settings = getWriterSettings();
  const notes = parseProjectNotes(project.notes_json);
  const chapterSummaries: string[] = [];
  let anyCacheMiss = false;

  for (const chapter of chapters) {
    const scenes = listChapterSceneContentRows(chapter.id);
    const sourceText = scenes.map((scene) => `${scene.title}\n${scene.content}`).join("\n\n");
    const hash = hashWriterContent(sourceText);

    let summaryResult: { summary: string; cached: boolean };
    if (!force) {
      summaryResult = await summarizeWithCache(
        { kind: "chapter", id: chapter.id },
        hash,
        buildChapterSummaryPrompt(notes, settings.promptTemplates.writerSummarize),
        `Summarize chapter "${chapter.title}" from the following material:\n\n${truncateForPrompt(sourceText, 22000)}`
      );
    } else {
      const generated = await callWriterLlm(
        buildChapterSummaryPrompt(notes, settings.promptTemplates.writerSummarize),
        `Summarize chapter "${chapter.title}" from the following material:\n\n${truncateForPrompt(sourceText, 22000)}`,
        { temperature: 0.35, maxTokens: 1200 }
      );
      summaryResult = { summary: generated.trim() || "(empty summary)", cached: false };
      upsertChapterSummary({
        chapterId: chapter.id,
        contentHash: hash,
        summary: summaryResult.summary,
        updatedAt: now()
      });
    }

    if (!summaryResult.cached) anyCacheMiss = true;
    chapterSummaries.push(`${chapter.title}\n${summaryResult.summary}`);
  }

  const projectSource = chapterSummaries.join("\n\n");
  const projectHash = hashWriterContent(projectSource);
  const projectPrompt = [
    "You are a novel development assistant.",
    "Create a concise but rich book-level summary with plot progression, character arcs, and unresolved threads.",
    "Output in clear prose, no markdown bullet spam."
  ].join("\n");
  const projectResult = force
    ? { summary: (await callWriterLlm(projectPrompt, projectSource, { temperature: 0.3, maxTokens: 1400 })).trim() || "(empty summary)", cached: false }
    : await summarizeWithCache({ kind: "project", id: projectId }, projectHash, projectPrompt, projectSource);
  if (force) {
    upsertProjectSummary({
      projectId,
      contentHash: projectHash,
      summary: projectResult.summary,
      updatedAt: now()
    });
  }

  const mergedNotes = normalizeProjectNotes({ ...notes, summary: projectResult.summary });
  updateProjectNotes(projectId, mergedNotes);

  res.json({
    summary: projectResult.summary,
    cached: !force && projectResult.cached && !anyCacheMiss,
    chapterCount: chapters.length
  });
});

router.get("/projects/:id/lenses", (req, res) => {
  const projectId = req.params.id;
  if (!projectExists(projectId)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const rows = listProjectLensRows(projectId) as WriterSummaryLensRow[];
  res.json(rows.map((row) => lensRowToJson(row)));
});

router.post("/projects/:id/lenses", (req, res) => {
  const projectId = req.params.id;
  if (!projectExists(projectId)) {
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
    createLensRecord({
      id,
      projectId,
      name,
      scope,
      targetId: resolved.targetId,
      prompt,
      createdAt: ts
    });
    const row = getLensRow(projectId, id) as WriterSummaryLensRow | undefined;
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
  const row = getLensRow(projectId, lensId) as WriterSummaryLensRow | undefined;
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
    updateLensRecord({
      id: row.id,
      name: nextName,
      scope: nextScope,
      targetId: resolved.targetId,
      prompt: nextPrompt,
      updatedAt: now()
    });
    const updated = getLensRow(projectId, row.id) as WriterSummaryLensRow | undefined;
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
  const existing = getLensRow(projectId, lensId) as { id: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: "Lens not found" });
    return;
  }
  deleteLensRecord(lensId);
  res.json({ ok: true, id: lensId });
});

router.post("/projects/:id/lenses/:lensId/run", async (req, res) => {
  const projectId = req.params.id;
  const lensId = req.params.lensId;
  const force = Boolean((req.body as { force?: unknown } | undefined)?.force);
  const row = getLensRow(projectId, lensId) as WriterSummaryLensRow | undefined;
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
  const existingCount = getChapterIdsForProject(String(projectId || "")).length;
  const normalizedTitle = normalizeChapterTitle(title, `Chapter ${existingCount + 1}`);
  res.json(createChapterRecord({
    id,
    projectId,
    title: normalizedTitle,
    createdAt: ts
  }));
});

router.post("/chapters/reorder", (req, res) => {
  const { projectId, orderedIds } = req.body as { projectId: string; orderedIds: string[] };
  reorderProjectChapters(projectId, orderedIds);
  res.json({ ok: true });
});

router.patch("/chapters/:id", (req, res) => {
  const chapterId = req.params.id;
  const row = getChapterRow(chapterId);
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

  updateChapterTitle(chapterId, nextTitle);
  res.json({ ...toChapterJson(row), title: nextTitle });
});

router.delete("/chapters/:id", (req, res) => {
  const chapterId = req.params.id;
  const chapter = getChapterRow(chapterId);
  if (!chapter) {
    res.status(404).json({ error: "Chapter not found" });
    return;
  }

  deleteChapterCascade(chapter.id, chapter.project_id, chapter.position);
  res.json({ ok: true, id: chapter.id });
});

router.patch("/chapters/:id/settings", (req, res) => {
  const chapterId = req.params.id;
  const row = getChapterRow(chapterId);
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
  updateChapterSettings(chapterId, patch);
  res.json({ ...toChapterJson(row), settings: patch });
});

router.post("/projects/:id/generate-next-chapter", async (req, res) => {
  const projectId = String(req.params.id || "").trim();
  if (!projectId) {
    res.status(400).json({ error: "Project id is required" });
    return;
  }

  const project = getProjectGenerationRow(projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const lastChapter = getLastProjectChapter(projectId);

  const nextPosition = (lastChapter?.position ?? 0) + 1;
  const defaultTitle = `Chapter ${nextPosition}`;
  const chapterSettings = parseChapterSettings(lastChapter?.settings_json);
  const projectNotes = parseProjectNotes(project.notes_json);
  const continuationContext = buildProjectContinuationContextPack(projectId, projectNotes);
  const prompt = toCleanText(req.body?.prompt, 5000);

  const settings = getWriterSettings();
  const writerRagDirective = await buildWriterRagDirective(projectId, settings as Record<string, unknown>, [
    prompt,
    continuationContext,
    projectNotes.summary
  ]);
  const systemPrompt = [
    settings.promptTemplates.writerGenerate,
    buildChapterDirective(chapterSettings),
    buildCharacterContext(parseJsonIdArray(project.character_ids)),
    buildProjectNotesDirective(projectNotes)
  ].filter(Boolean).join("\n\n");

  const userPrompt = [
    "[Writing Task]",
    "Write the next chapter of this book as a direct continuation of previous events.",
    "Preserve continuity of facts, relationships, and unresolved threads. Move the story forward with concrete new developments.",
    prompt ? `[Additional Direction]\n${prompt}` : "",
    continuationContext ? `[Context Pack]\n${continuationContext}` : "",
    writerRagDirective
  ].filter(Boolean).join("\n\n");

  const content = String(await callWriterLlm(systemPrompt, userPrompt, createWriterSampler(settings.samplerConfig, chapterSettings)) || "").trim();
  const chapterTitleMatch = content.match(/^#\s*(.+)$/m);
  const chapterTitle = normalizeChapterTitle(chapterTitleMatch?.[1] || "", defaultTitle);

  const chapterId = newId();
  const sceneId = newId();
  const ts = now();
  const sceneContent = content || "(empty scene)";
  const sceneTitle = chapterTitle;

  createGeneratedChapterWithScene({
    chapterId,
    sceneId,
    projectId,
    chapterTitle,
    position: nextPosition,
    settingsJson: JSON.stringify(chapterSettings),
    sceneTitle,
    sceneContent,
    createdAt: ts
  });

  res.json({
    chapter: {
      id: chapterId,
      projectId,
      title: chapterTitle,
      position: nextPosition,
      settings: chapterSettings,
      createdAt: ts
    },
    scene: {
      id: sceneId,
      chapterId,
      title: sceneTitle,
      content: sceneContent,
      goals: "Advance plot",
      conflicts: "Escalate conflict",
      outcomes: "Open ending",
      createdAt: ts
    }
  });
});

// --- Scenes / Generation (LLM-backed) ---

router.post("/chapters/:id/generate-draft", async (req, res) => {
  const chapterId = req.params.id;
  const { prompt } = req.body;
  const chapter = getChapterGenerationRow(chapterId);
  if (!chapter) {
    res.status(404).json({ error: "Chapter not found" });
    return;
  }
  const project = getProjectGenerationRow(chapter.project_id);

  const chapterSettings = parseChapterSettings(chapter.settings_json);
  const id = newId();
  const ts = now();

  const settings = getWriterSettings();
  const projectNotes = parseProjectNotes(project?.notes_json);
  const projectContext = buildProjectContextPack(chapter.project_id, chapterId, projectNotes);
  const writerRagDirective = await buildWriterRagDirective(chapter.project_id, settings as Record<string, unknown>, [
    chapter.title,
    String(prompt || ""),
    projectContext,
    projectNotes.summary
  ]);
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
    projectContext ? `[Context Pack]\n${projectContext}` : "",
    writerRagDirective
  ].filter(Boolean).join("\n\n");
  const content = await callWriterLlm(systemPrompt, userPrompt, sampler);
  const titleMatch = content.match(/^#\s*(.+)/m);
  const title = titleMatch ? titleMatch[1].slice(0, 60) : "Generated Scene";

  createGeneratedSceneRecord({
    id,
    chapterId,
    title,
    content,
    createdAt: ts
  });

  res.json({
    id, chapterId, title, content,
    goals: "Advance plot", conflicts: "Internal conflict", outcomes: "Open ending", createdAt: ts
  });
});

router.post("/scenes/:id/expand", async (req, res) => {
  const sceneId = req.params.id;
  const row = getSceneRow(sceneId);

  if (!row) { res.status(404).json({ error: "Scene not found" }); return; }

  const settings = getWriterSettings();
  const chapter = getChapterGenerationRow(row.chapter_id);
  const project = chapter ? getProjectGenerationRow(chapter.project_id) : undefined;
  const chapterSettings = parseChapterSettings(chapter?.settings_json);
  const projectNotes = parseProjectNotes(project?.notes_json);
  const projectContext = chapter ? buildProjectContextPack(chapter.project_id, row.chapter_id, projectNotes) : "";
  const writerRagDirective = chapter
    ? await buildWriterRagDirective(chapter.project_id, settings as Record<string, unknown>, [
      row.title,
      row.content,
      projectContext,
      projectNotes.summary
    ])
    : "";
  const systemPrompt = [
    settings.promptTemplates.writerExpand,
    buildChapterDirective(chapterSettings),
    buildCharacterContext(parseJsonIdArray(project?.character_ids)),
    buildProjectNotesDirective(projectNotes)
  ].filter(Boolean).join("\n\n");
  const sampler = createWriterSampler(settings.samplerConfig, chapterSettings);
  const expanded = await callWriterLlm(
    systemPrompt,
    [projectContext ? `[Context Pack]\n${projectContext}` : "", writerRagDirective, row.content].filter(Boolean).join("\n\n"),
    sampler
  );

  updateSceneContent(sceneId, expanded);

  res.json({
    id: row.id, chapterId: row.chapter_id, title: row.title, content: expanded,
    goals: row.goals, conflicts: row.conflicts, outcomes: row.outcomes, createdAt: row.created_at
  });
});

router.post("/scenes/:id/rewrite", async (req, res) => {
  const sceneId = req.params.id;
  const toneRaw = typeof req.body?.tone === "string" ? req.body.tone : "";
  const row = getSceneRow(sceneId);

  if (!row) { res.status(404).json({ error: "Scene not found" }); return; }

  const settings = getWriterSettings();
  const chapter = getChapterGenerationRow(row.chapter_id);
  const project = chapter ? getProjectGenerationRow(chapter.project_id) : undefined;
  const chapterSettings = parseChapterSettings(chapter?.settings_json);
  const projectNotes = parseProjectNotes(project?.notes_json);
  const projectContext = chapter ? buildProjectContextPack(chapter.project_id, row.chapter_id, projectNotes) : "";
  const writerRagDirective = chapter
    ? await buildWriterRagDirective(chapter.project_id, settings as Record<string, unknown>, [
      row.title,
      row.content,
      toneRaw,
      projectContext,
      projectNotes.summary
    ])
    : "";
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
  const rewritten = await callWriterLlm(
    systemPrompt,
    [projectContext ? `[Context Pack]\n${projectContext}` : "", writerRagDirective, row.content].filter(Boolean).join("\n\n"),
    sampler
  );

  updateSceneContent(sceneId, rewritten);

  res.json({
    id: row.id, chapterId: row.chapter_id, title: row.title, content: rewritten,
    goals: row.goals, conflicts: row.conflicts, outcomes: row.outcomes, createdAt: row.created_at
  });
});

router.get("/scenes/:id/summarize", async (req, res) => {
  const row = getSceneSummaryRow(req.params.id);

  if (!row) { res.status(404).json({ error: "Scene not found" }); return; }

  const settings = getWriterSettings();
  const chapter = getChapterGenerationRow(row.chapter_id);
  const project = chapter ? getProjectGenerationRow(chapter.project_id) : undefined;
  const chapterSettings = parseChapterSettings(chapter?.settings_json);
  const projectNotes = parseProjectNotes(project?.notes_json);
  const projectContext = chapter ? buildProjectContextPack(chapter.project_id, row.chapter_id, projectNotes) : "";
  const writerRagDirective = chapter
    ? await buildWriterRagDirective(chapter.project_id, settings as Record<string, unknown>, [
      row.content,
      projectContext,
      projectNotes.summary
    ])
    : "";
  const systemPrompt = [
    settings.promptTemplates.writerSummarize,
    buildChapterDirective(chapterSettings),
    buildCharacterContext(parseJsonIdArray(project?.character_ids)),
    buildProjectNotesDirective(projectNotes)
  ].filter(Boolean).join("\n\n");
  const summary = await callWriterLlm(
    systemPrompt,
    [projectContext ? `[Context Pack]\n${projectContext}` : "", writerRagDirective, row.content].filter(Boolean).join("\n\n"),
    createWriterSampler(settings.samplerConfig, chapterSettings)
  );

  res.json(summary);
});

// Scene content update (direct editing)
router.patch("/scenes/:id", (req, res) => {
  const sceneId = req.params.id;
  const { content, title, goals, conflicts, outcomes } = req.body;
  const row = getSceneRow(sceneId);
  if (!row) { res.status(404).json({ error: "Scene not found" }); return; }

  const newContent = content ?? row.content;
  const newTitle = title ?? row.title;
  const newGoals = goals ?? row.goals;
  const newConflicts = conflicts ?? row.conflicts;
  const newOutcomes = outcomes ?? row.outcomes;

  updateSceneRecord(sceneId, {
    content: newContent,
    title: newTitle,
    goals: newGoals,
    conflicts: newConflicts,
    outcomes: newOutcomes
  });

  res.json({ ...toSceneJson(row), title: newTitle, content: newContent, goals: newGoals, conflicts: newConflicts, outcomes: newOutcomes });
});

router.delete("/scenes/:id", (req, res) => {
  const sceneId = req.params.id;
  const row = getSceneProjectRow(sceneId);
  if (!row) {
    res.status(404).json({ error: "Scene not found" });
    return;
  }
  deleteSceneCascade(row.id, row.project_id);
  res.json({ ok: true, id: row.id });
});

// --- Consistency ---

router.post("/projects/:id/consistency", (req, res) => {
  const projectId = req.params.id;
  const scenes = listConsistencyScenes(projectId);
  const issues = runConsistency(projectId, scenes);
  recordConsistencyReport({
    id: newId(),
    projectId,
    payload: JSON.stringify(issues),
    createdAt: now()
  });

  res.json(issues);
});

// --- Export ---

router.post("/projects/:id/export/markdown", (req, res) => {
  const projectId = req.params.id;
  const bundle = buildWriterExportBundle(projectId);
  if (!bundle) { res.status(404).json({ error: "Project not found" }); return; }

  const outputPath = join(DATA_DIR, `${bundle.filenameBase}.md`);
  writeFileSync(outputPath, bundle.markdown);

  recordWriterExport({
    id: newId(),
    projectId,
    exportType: "markdown",
    outputPath,
    createdAt: now()
  });

  res.json(outputPath);
});

router.post("/projects/:id/export/docx", async (req, res) => {
  const projectId = req.params.id;
  const bundle = buildWriterExportBundle(projectId);
  if (!bundle) { res.status(404).json({ error: "Project not found" }); return; }

  const outputPath = join(DATA_DIR, `${bundle.filenameBase}.docx`);
  const buffer = await buildDocxBufferFromBundle(bundle);
  writeFileSync(outputPath, buffer);

  recordWriterExport({
    id: newId(),
    projectId,
    exportType: "docx",
    outputPath,
    createdAt: now()
  });

  res.json(outputPath);
});

router.post("/projects/:id/export/markdown/download", (req, res) => {
  const projectId = req.params.id;
  const bundle = buildWriterExportBundle(projectId);
  if (!bundle) { res.status(404).json({ error: "Project not found" }); return; }
  const filename = `${bundle.filenameBase}.md`;

  recordWriterExport({
    id: newId(),
    projectId,
    exportType: "markdown",
    outputPath: filename,
    createdAt: now()
  });

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
  recordWriterExport({
    id: newId(),
    projectId,
    exportType: "docx",
    outputPath: filename,
    createdAt: now()
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", buildAttachmentDisposition(filename, `book-${projectId}.docx`));
  res.send(buffer);
});

export default router;
