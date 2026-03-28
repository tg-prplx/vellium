import { DEFAULT_CHAPTER_SETTINGS, clamp01, type WriterChapterSettings, type WriterSampler } from "./defs.js";

export function normalizeChapterSettings(input: unknown): WriterChapterSettings {
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

export function parseChapterSettings(raw: string | null | undefined): WriterChapterSettings {
  if (!raw) return { ...DEFAULT_CHAPTER_SETTINGS };
  try {
    return normalizeChapterSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CHAPTER_SETTINGS };
  }
}

export function createWriterSampler(base: { temperature?: number; maxTokens?: number }, chapter: WriterChapterSettings): WriterSampler {
  const baseTemperature = Number(base.temperature ?? 0.9);
  const baseMaxTokens = Number(base.maxTokens ?? 2048);
  const temperature = Math.max(0, Math.min(2, baseTemperature * (0.75 + chapter.creativity * 0.9)));
  const maxTokens = Math.max(256, Math.min(4096, Math.round(baseMaxTokens * (0.75 + chapter.detail * 0.7))));
  return { temperature, maxTokens };
}

export function sanitizeExportFileName(name: string, fallback: string): string {
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

export function buildAttachmentDisposition(filename: string, fallback: string): string {
  const cleanName = String(filename || "").replace(/[\r\n]/g, " ").trim() || fallback;
  const asciiName = sanitizeHeaderFilenameAscii(cleanName, fallback);
  const utf8Name = encode5987Value(cleanName);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`;
}
