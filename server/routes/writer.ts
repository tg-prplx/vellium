import { Router } from "express";
import { writeFileSync } from "fs";
import { join } from "path";
import { db, newId, now, roughTokenCount, DATA_DIR, DEFAULT_SETTINGS } from "../db.js";
import { runConsistency } from "../domain/writerEngine.js";

const router = Router();

interface ProviderRow {
  id: string;
  base_url: string;
  api_key_cipher: string;
  full_local_only: number;
}

function getSettings() {
  const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string };
  const stored = JSON.parse(row.payload);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    samplerConfig: { ...DEFAULT_SETTINGS.samplerConfig, ...(stored.samplerConfig ?? {}) },
    promptTemplates: { ...DEFAULT_SETTINGS.promptTemplates, ...(stored.promptTemplates ?? {}) }
  };
}

async function callLlm(systemPrompt: string, userPrompt: string): Promise<string> {
  const settings = getSettings();
  const providerId = settings.activeProviderId;
  const modelId = settings.activeModel;

  if (!providerId || !modelId) {
    return `[No LLM configured] Placeholder for: ${userPrompt.slice(0, 100)}`;
  }

  const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId) as ProviderRow | undefined;
  if (!provider) return "[Provider not found]";

  try {
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
        temperature: settings.samplerConfig.temperature ?? 0.9,
        max_tokens: settings.samplerConfig.maxTokens ?? 2048
      })
    });

    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? "[Empty response]";
  } catch (err) {
    return `[LLM Error] ${err instanceof Error ? err.message : "Unknown error"}`;
  }
}

// --- Projects ---

router.post("/projects", (req, res) => {
  const { name, description } = req.body;
  const id = newId();
  const ts = now();
  db.prepare("INSERT INTO writer_projects (id, name, description, created_at) VALUES (?, ?, ?, ?)")
    .run(id, name, description, ts);
  res.json({ id, name, description, createdAt: ts });
});

router.get("/projects", (_req, res) => {
  const rows = db.prepare("SELECT * FROM writer_projects ORDER BY created_at DESC").all() as {
    id: string; name: string; description: string; created_at: string;
  }[];
  res.json(rows.map((r) => ({ id: r.id, name: r.name, description: r.description, createdAt: r.created_at })));
});

router.get("/projects/:id", (req, res) => {
  const projectId = req.params.id;
  const project = db.prepare("SELECT * FROM writer_projects WHERE id = ?").get(projectId) as {
    id: string; name: string; description: string; created_at: string;
  } | undefined;

  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const chapters = db.prepare("SELECT * FROM writer_chapters WHERE project_id = ? ORDER BY position ASC").all(projectId) as {
    id: string; project_id: string; title: string; position: number; created_at: string;
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
    project: { id: project.id, name: project.name, description: project.description, createdAt: project.created_at },
    chapters: chapters.map((c) => ({ id: c.id, projectId: c.project_id, title: c.title, position: c.position, createdAt: c.created_at })),
    scenes: scenes.map((s) => ({
      id: s.id, chapterId: s.chapter_id, title: s.title, content: s.content,
      goals: s.goals, conflicts: s.conflicts, outcomes: s.outcomes, createdAt: s.created_at
    }))
  });
});

// --- Chapters ---

router.post("/chapters", (req, res) => {
  const { projectId, title } = req.body;
  const id = newId();
  const ts = now();

  const posRow = db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM writer_chapters WHERE project_id = ?")
    .get(projectId) as { next_pos: number };

  db.prepare("INSERT INTO writer_chapters (id, project_id, title, position, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, projectId, title, posRow.next_pos, ts);

  res.json({ id, projectId, title, position: posRow.next_pos, createdAt: ts });
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

// --- Scenes / Generation (LLM-backed) ---

router.post("/chapters/:id/generate-draft", async (req, res) => {
  const chapterId = req.params.id;
  const { prompt } = req.body;
  const id = newId();
  const ts = now();

  const settings = getSettings();
  const systemPrompt = settings.promptTemplates.writerGenerate;

  const content = await callLlm(systemPrompt, prompt);
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
  const systemPrompt = settings.promptTemplates.writerExpand;
  const expanded = await callLlm(systemPrompt, row.content);

  db.prepare("UPDATE writer_scenes SET content = ? WHERE id = ?").run(expanded, sceneId);

  res.json({
    id: row.id, chapterId: row.chapter_id, title: row.title, content: expanded,
    goals: row.goals, conflicts: row.conflicts, outcomes: row.outcomes, createdAt: row.created_at
  });
});

router.post("/scenes/:id/rewrite", async (req, res) => {
  const sceneId = req.params.id;
  const { tone } = req.body ?? { tone: "cinematic" };
  const row = db.prepare("SELECT * FROM writer_scenes WHERE id = ?").get(sceneId) as {
    id: string; chapter_id: string; title: string; content: string;
    goals: string; conflicts: string; outcomes: string; created_at: string;
  } | undefined;

  if (!row) { res.status(404).json({ error: "Scene not found" }); return; }

  const settings = getSettings();
  const systemPrompt = (settings.promptTemplates.writerRewrite || "").replace("{{tone}}", tone);
  const rewritten = await callLlm(systemPrompt, row.content);

  db.prepare("UPDATE writer_scenes SET content = ? WHERE id = ?").run(rewritten, sceneId);

  res.json({
    id: row.id, chapterId: row.chapter_id, title: row.title, content: rewritten,
    goals: row.goals, conflicts: row.conflicts, outcomes: row.outcomes, createdAt: row.created_at
  });
});

router.get("/scenes/:id/summarize", async (req, res) => {
  const row = db.prepare("SELECT content FROM writer_scenes WHERE id = ?")
    .get(req.params.id) as { content: string } | undefined;

  if (!row) { res.status(404).json({ error: "Scene not found" }); return; }

  const settings = getSettings();
  const systemPrompt = settings.promptTemplates.writerSummarize;
  const summary = await callLlm(systemPrompt, row.content);

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
  const project = db.prepare("SELECT name FROM writer_projects WHERE id = ?").get(projectId) as { name: string } | undefined;
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const chapters = db.prepare("SELECT * FROM writer_chapters WHERE project_id = ? ORDER BY position ASC")
    .all(projectId) as { id: string; title: string }[];

  let markdown = `# ${project.name}\n\n`;
  for (const ch of chapters) {
    markdown += `## ${ch.title}\n\n`;
    const scenes = db.prepare("SELECT title, content FROM writer_scenes WHERE chapter_id = ? ORDER BY created_at ASC")
      .all(ch.id) as { title: string; content: string }[];
    for (const sc of scenes) {
      markdown += `### ${sc.title}\n\n${sc.content}\n\n`;
    }
  }

  const outputPath = join(DATA_DIR, `book-${projectId}.md`);
  writeFileSync(outputPath, markdown);

  db.prepare("INSERT INTO writer_exports (id, project_id, export_type, output_path, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(newId(), projectId, "markdown", outputPath, now());

  res.json(outputPath);
});

router.post("/projects/:id/export/docx", (req, res) => {
  const projectId = req.params.id;
  const project = db.prepare("SELECT name FROM writer_projects WHERE id = ?").get(projectId) as { name: string } | undefined;
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const chapters = db.prepare("SELECT * FROM writer_chapters WHERE project_id = ? ORDER BY position ASC")
    .all(projectId) as { id: string; title: string }[];

  let text = `${project.name}\n\n`;
  for (const ch of chapters) {
    text += `${ch.title}\n\n`;
    const scenes = db.prepare("SELECT title, content FROM writer_scenes WHERE chapter_id = ? ORDER BY created_at ASC")
      .all(ch.id) as { title: string; content: string }[];
    for (const sc of scenes) {
      text += `${sc.title}\n${sc.content}\n\n`;
    }
  }

  const outputPath = join(DATA_DIR, `book-${projectId}.docx`);
  writeFileSync(outputPath, text);

  db.prepare("INSERT INTO writer_exports (id, project_id, export_type, output_path, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(newId(), projectId, "docx", outputPath, now());

  res.json(outputPath);
});

export default router;
