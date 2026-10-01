import { db } from "../../db.js";
import type { ChatContextConfig } from "../../../src/shared/types/chatContext.js";

export function normalizeContextConfig(raw: unknown): ChatContextConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  const result: ChatContextConfig = {};
  for (const [key, min, max] of [["contextWindowSize", 512, 2097152], ["maxMessages", 0, 10000], ["maxOutputTokens", 1, 131072]] as const) {
    if (typeof row[key] === "number" && Number.isFinite(row[key])) result[key] = Math.max(min, Math.min(max, Math.floor(row[key] as number)));
  }
  if (typeof row.includeReasoning === "boolean") result.includeReasoning = row.includeReasoning;
  if (typeof row.summary === "string") result.summary = row.summary.slice(0, 100000);
  if (Array.isArray(row.excludedMessageIds)) result.excludedMessageIds = [...new Set(row.excludedMessageIds.filter((id): id is string => typeof id === "string" && id.length <= 100))].slice(0, 10000);
  return result;
}

export function getContextConfig(chatId: string, branchId: string): ChatContextConfig {
  const row = db.prepare("SELECT context_config FROM branches WHERE id = ? AND chat_id = ?").get(branchId, chatId) as { context_config: string } | undefined;
  try { return normalizeContextConfig(JSON.parse(row?.context_config || "{}")); } catch { return {}; }
}

export function saveContextConfig(chatId: string, branchId: string, config: ChatContextConfig) {
  db.prepare("UPDATE branches SET context_config = ? WHERE id = ? AND chat_id = ?").run(JSON.stringify(normalizeContextConfig(config)), branchId, chatId);
}
