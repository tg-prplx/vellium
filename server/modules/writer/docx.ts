import mammoth from "mammoth";
import { db, newId, now } from "../../db.js";
import { DEFAULT_CHAPTER_SETTINGS, normalizeProjectName, type WriterDocxParseMode } from "./defs.js";

export interface ParsedDocxChapter {
  title: string;
  content: string;
}

function decodeBase64Payload(value: string): Buffer {
  const raw = String(value || "").trim();
  const payload = raw.startsWith("data:")
    ? raw.slice(raw.indexOf(",") + 1)
    : raw;
  return Buffer.from(payload, "base64");
}

export function normalizeDocxParseMode(raw: unknown): WriterDocxParseMode {
  const value = String(raw || "").trim();
  if (value === "chapter_markers" || value === "heading_lines" || value === "single_book") {
    return value;
  }
  return "auto";
}

export function inferBookNameFromFilename(filename: string): string {
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

  for (let index = 0; index < lines.length; index += 1) {
    const lineRaw = lines[index];
    const line = lineRaw.trim();
    const prev = lines[index - 1]?.trim() || "";
    const next = lines[index + 1]?.trim() || "";
    const isolated = !prev && !next;
    const likelyHeading = isHeadingLineCandidate(line) && (isolated || (!prev && next.length > 40));
    if (likelyHeading) {
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
  if (!html) return [];

  const regex = /<(h[1-3]|p)[^>]*>([\s\S]*?)<\/\1>/gi;
  const items: Array<{ title: string; content: string }> = [];
  let currentTitle = "";
  let bufferParts: string[] = [];
  let match: RegExpExecArray | null;

  const flush = () => {
    const content = normalizeDocxText(bufferParts.join("\n\n"));
    if (!content) return;
    items.push({ title: currentTitle || `Chapter ${items.length + 1}`, content });
    bufferParts = [];
  };

  while ((match = regex.exec(html))) {
    const tag = match[1].toLowerCase();
    const text = stripHtml(match[2]).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const isHeading = tag.startsWith("h") || isHeadingLineCandidate(text);
    if (isHeading) {
      flush();
      currentTitle = text.slice(0, 120);
    } else {
      bufferParts.push(text);
    }
  }
  flush();

  return items;
}

function splitDocxIntoChaptersAuto(text: string): Array<{ title: string; content: string }> {
  const byMarkers = splitDocxIntoChaptersByMarkers(text);
  if (byMarkers.length >= 2) return byMarkers;
  const byHeadings = splitDocxIntoChaptersByHeadingLines(text);
  if (byHeadings.length >= 2) return byHeadings;
  return [{ title: "Chapter 1", content: text }];
}

function finalizeChapterTitle(rawTitle: string, fallbackIndex: number): string {
  const clean = normalizeProjectName(rawTitle, "").replace(/\s+/g, " ").trim().slice(0, 140);
  if (clean) return clean;
  return `Chapter ${fallbackIndex + 1}`;
}

export async function parseDocxIntoChapters(
  base64Data: string,
  filename: string,
  parseMode: WriterDocxParseMode
): Promise<ParsedDocxChapter[]> {
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

export function importParsedDocxChapters(projectId: string, chunks: ParsedDocxChapter[]) {
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
