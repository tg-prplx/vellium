import type { UnifiedGenerateMessage } from "./unifiedGeneration.js";
import { sanitizePluginSettingsPatch } from "./pluginSecurity.js";

export const MAX_PLUGIN_RUNTIME_MESSAGES = 64;
export const MAX_PLUGIN_RUNTIME_CONTENT_PARTS = 32;
export const MAX_PLUGIN_RUNTIME_TEXT_CHARS = 16_000;
export const MAX_PLUGIN_RUNTIME_TOTAL_TEXT_CHARS = 64_000;
export const MAX_PLUGIN_RUNTIME_ID_CHARS = 200;
export const MAX_PLUGIN_RUNTIME_IMAGE_URL_CHARS = 4_096;
export const MAX_PLUGIN_RUNTIME_SAMPLER_BYTES = 8 * 1024;
export const ALLOWED_PLUGIN_RUNTIME_ROLES = ["system", "user", "assistant", "tool"] as const;

const ALLOWED_RUNTIME_ROLE_SET = new Set<string>(ALLOWED_PLUGIN_RUNTIME_ROLES);
const DISALLOWED_INLINE_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const DISALLOWED_TEXT_CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function normalizeMultilineText(raw: unknown): string {
  return String(raw ?? "").replace(/\u0000/g, "").replace(/\r\n?/g, "\n");
}

function sanitizeBoundedText(
  raw: unknown,
  label: string,
  maxChars: number,
  options?: { trim?: boolean; allowMultiline?: boolean }
): string {
  const value = normalizeMultilineText(raw);
  const normalized = options?.trim === true ? value.trim() : value;
  if (normalized.length > maxChars) {
    throw new Error(`${label} exceeds ${maxChars} characters`);
  }
  const controlCharPattern = options?.allowMultiline === true
    ? DISALLOWED_TEXT_CONTROL_CHARS
    : DISALLOWED_INLINE_CONTROL_CHARS;
  if (controlCharPattern.test(normalized)) {
    throw new Error(`${label} contains invalid control characters`);
  }
  return normalized;
}

function countContentTextChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((total, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return total;
    const row = item as { type?: unknown; text?: unknown };
    if (row.type !== "text") return total;
    return total + String(row.text ?? "").length;
  }, 0);
}

function sanitizeContentParts(raw: unknown): Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> {
  if (!Array.isArray(raw)) {
    throw new Error("message content parts must be an array");
  }
  if (raw.length > MAX_PLUGIN_RUNTIME_CONTENT_PARTS) {
    throw new Error(`message content exceeds ${MAX_PLUGIN_RUNTIME_CONTENT_PARTS} parts`);
  }
  return raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("message content parts must be objects");
    }
    const row = item as { type?: unknown; text?: unknown; image_url?: unknown };
    const type = String(row.type || "").trim();
    if (type === "text") {
      return {
        type: "text" as const,
        text: sanitizeBoundedText(row.text, "message text", MAX_PLUGIN_RUNTIME_TEXT_CHARS, { allowMultiline: true })
      };
    }
    if (type === "image_url") {
      const imageUrl = row.image_url && typeof row.image_url === "object" && !Array.isArray(row.image_url)
        ? (row.image_url as { url?: unknown }).url
        : row.image_url;
      const url = sanitizeBoundedText(imageUrl, "image url", MAX_PLUGIN_RUNTIME_IMAGE_URL_CHARS, { trim: true });
      if (!url) {
        throw new Error("image url is required");
      }
      return {
        type: "image_url" as const,
        image_url: { url }
      };
    }
    throw new Error(`Unsupported message content type: ${type || "unknown"}`);
  });
}

export function sanitizePluginRuntimeId(raw: unknown, label: string): string {
  return sanitizeBoundedText(raw, label, MAX_PLUGIN_RUNTIME_ID_CHARS, { trim: true });
}

export function sanitizePluginRuntimePrompt(raw: unknown, label: string): string {
  return sanitizeBoundedText(raw, label, MAX_PLUGIN_RUNTIME_TEXT_CHARS, { trim: true, allowMultiline: true });
}

export function sanitizePluginRuntimeMessageContent(raw: unknown): UnifiedGenerateMessage["content"] {
  if (Array.isArray(raw)) {
    return sanitizeContentParts(raw);
  }
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return sanitizeBoundedText(raw, "message content", MAX_PLUGIN_RUNTIME_TEXT_CHARS, { allowMultiline: true });
  }
  throw new Error("message content must be text or supported content parts");
}

export function sanitizePluginRuntimeMessages(raw: unknown): UnifiedGenerateMessage[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_PLUGIN_RUNTIME_MESSAGES) {
    throw new Error(`messages exceed ${MAX_PLUGIN_RUNTIME_MESSAGES} items`);
  }
  let totalChars = 0;
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`message ${index + 1} must be an object`);
    }
    const row = item as { role?: unknown; content?: unknown };
    const role = sanitizePluginRuntimeId(row.role ?? "user", "message role").toLowerCase();
    if (!ALLOWED_RUNTIME_ROLE_SET.has(role)) {
      throw new Error(`Unsupported message role: ${role}`);
    }
    const content = sanitizePluginRuntimeMessageContent(row.content);
    totalChars += countContentTextChars(content);
    if (totalChars > MAX_PLUGIN_RUNTIME_TOTAL_TEXT_CHARS) {
      throw new Error(`messages exceed ${MAX_PLUGIN_RUNTIME_TOTAL_TEXT_CHARS} characters`);
    }
    return { role, content };
  });
}

export function sanitizePluginRuntimeSamplerConfig(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const sanitized = sanitizePluginSettingsPatch(raw);
  const serialized = JSON.stringify(sanitized);
  if (serialized.length > MAX_PLUGIN_RUNTIME_SAMPLER_BYTES) {
    throw new Error(`samplerConfig exceeds ${MAX_PLUGIN_RUNTIME_SAMPLER_BYTES} bytes`);
  }
  return sanitized;
}
