import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { db } from "../../db.js";
import { sanitizeExportFileName } from "./chapterSettings.js";

export interface WriterExportBundle {
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

export function buildWriterExportBundle(projectId: string): WriterExportBundle | null {
  const project = db.prepare("SELECT name FROM writer_projects WHERE id = ?").get(projectId) as { name: string } | undefined;
  if (!project) return null;

  const chapters = db.prepare("SELECT * FROM writer_chapters WHERE project_id = ? ORDER BY position ASC")
    .all(projectId) as Array<{ id: string; title: string }>;

  const lines: string[] = [`# ${project.name}`, ""];
  for (const chapter of chapters) {
    lines.push(`## ${chapter.title}`, "");
    const scenes = db.prepare("SELECT title, content FROM writer_scenes WHERE chapter_id = ? ORDER BY created_at ASC")
      .all(chapter.id) as Array<{ title: string; content: string }>;
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

export async function buildDocxBufferFromBundle(bundle: WriterExportBundle): Promise<Buffer> {
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
