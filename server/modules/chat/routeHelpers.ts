import { db, DEFAULT_SETTINGS, newId, now } from "../../db.js";
import { DEFAULT_PROMPT_BLOCKS, type CharacterCardData, type PromptBlock } from "../../domain/rpEngine.js";
import { normalizeApiParamPolicy } from "../../services/apiParamPolicy.js";
import type { RagContextSource } from "../../services/rag.js";

const PROMPT_BLOCK_KINDS = new Set(["system", "jailbreak", "character", "author_note", "lore", "scene", "history"]);

export type ChatMode = "rp" | "light_rp" | "pure_chat";

export interface MessageRow {
  id: string;
  chat_id: string;
  branch_id: string;
  role: string;
  content: string;
  attachments: string | null;
  rag_sources: string | null;
  token_count: number;
  parent_id: string | null;
  deleted: number;
  created_at: string;
  character_name: string | null;
  sort_order: number;
}

export interface MessageAttachmentPayload {
  id?: string;
  filename?: string;
  type?: string;
  url?: string;
  mimeType?: string;
  dataUrl?: string;
  content?: string;
}

export interface ProviderRow {
  id: string;
  base_url: string;
  api_key_cipher: string;
  full_local_only: number;
  provider_type: string;
  adapter_id?: string | null;
}

export interface LoreBookRow {
  id: string;
  name: string;
  entries_json: string;
}

export interface UserPersonaPayload {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
}

export function messageToJson(row: MessageRow) {
  let attachments: MessageAttachmentPayload[] = [];
  let ragSources: RagContextSource[] = [];
  try {
    const parsed = JSON.parse(row.attachments || "[]");
    if (Array.isArray(parsed)) attachments = parsed as MessageAttachmentPayload[];
  } catch {
    attachments = [];
  }
  try {
    const parsed = JSON.parse(row.rag_sources || "[]");
    if (Array.isArray(parsed)) ragSources = parsed as RagContextSource[];
  } catch {
    ragSources = [];
  }
  return {
    id: row.id,
    chatId: row.chat_id,
    branchId: row.branch_id,
    role: row.role,
    content: row.content,
    attachments,
    tokenCount: row.token_count,
    createdAt: row.created_at,
    parentId: row.parent_id,
    characterName: row.character_name || undefined,
    ragSources
  };
}

export function resolveBranch(chatId: string, branchId?: string): string {
  if (branchId) return branchId;
  const row = db.prepare("SELECT id FROM branches WHERE chat_id = ? ORDER BY created_at ASC LIMIT 1")
    .get(chatId) as { id: string } | undefined;
  if (row) return row.id;
  const id = newId();
  db.prepare("INSERT INTO branches (id, chat_id, name, parent_message_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, chatId, "main", null, now());
  return id;
}

export function getTimeline(chatId: string, branchId: string) {
  const rows = db.prepare(
    "SELECT * FROM messages WHERE chat_id = ? AND branch_id = ? AND deleted = 0 ORDER BY sort_order ASC, created_at ASC"
  ).all(chatId, branchId) as MessageRow[];
  return rows.map(messageToJson);
}

export function normalizePromptStack(raw: unknown): PromptBlock[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_PROMPT_BLOCKS.map((block) => ({ ...block }));
  }
  const next = raw
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const row = item as { id?: unknown; kind?: unknown; enabled?: unknown; order?: unknown; content?: unknown };
      const kind = String(row.kind || "").trim();
      if (!PROMPT_BLOCK_KINDS.has(kind)) return null;
      const orderRaw = Number(row.order);
      return {
        id: String(row.id || `prompt-${Date.now()}-${index}`),
        kind,
        enabled: row.enabled !== false,
        order: Number.isFinite(orderRaw) ? Math.max(1, Math.floor(orderRaw)) : index + 1,
        content: String(row.content || "")
      } as PromptBlock;
    })
    .filter((item): item is PromptBlock => item !== null);

  if (next.length === 0) {
    return DEFAULT_PROMPT_BLOCKS.map((block) => ({ ...block }));
  }

  return next
    .sort((a, b) => a.order - b.order)
    .map((block, index) => ({ ...block, order: index + 1 }));
}

export function getPromptBlocks(settings: Record<string, unknown>): PromptBlock[] {
  return normalizePromptStack((settings as { promptStack?: unknown }).promptStack);
}

export function getSettings() {
  const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string };
  const stored = JSON.parse(row.payload);
  const mcpServers = Array.isArray(stored.mcpServers) ? stored.mcpServers : DEFAULT_SETTINGS.mcpServers;
  const apiParamPolicy = normalizeApiParamPolicy(stored.apiParamPolicy);
  const promptStack = normalizePromptStack(stored.promptStack);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    samplerConfig: { ...DEFAULT_SETTINGS.samplerConfig, ...(stored.samplerConfig ?? {}) },
    apiParamPolicy,
    promptStack,
    promptTemplates: { ...DEFAULT_SETTINGS.promptTemplates, ...(stored.promptTemplates ?? {}) },
    mcpServers
  };
}

export function resolveChatMode(raw: unknown): ChatMode {
  if (raw === "pure_chat" || raw === "light_rp" || raw === "rp") {
    return raw;
  }
  return "rp";
}

export function parseCardData(cardJson: string | null | undefined): Record<string, unknown> {
  if (!cardJson) return {};
  try {
    const parsed = JSON.parse(cardJson) as { data?: unknown };
    if (parsed?.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)) {
      return parsed.data as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors and fallback to an empty object.
  }
  return {};
}

export function pickString(input: unknown): string {
  return typeof input === "string" ? input : "";
}

export function pickStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export function pickObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

export function pickInitialGreeting(mainGreeting: string, alternateGreetings: string[], useAlternateGreetings: boolean): string {
  const main = String(mainGreeting || "").trim();
  const alternates = alternateGreetings.map((item) => String(item || "").trim()).filter(Boolean);
  if (useAlternateGreetings) {
    const pool = [main, ...alternates].filter(Boolean);
    if (pool.length === 0) return "";
    const randomIndex = Math.floor(Math.random() * pool.length);
    return pool[randomIndex] || "";
  }
  return main || alternates[0] || "";
}

export function buildCompactContextPolicy(params: { charName?: string; userName: string }): string {
  const lines = [
    "[Context Policy]",
    "Priority: system instructions > recent chat history > summary/retrieved snippets.",
    "Do not invent missing facts; ask briefly or keep details neutral.",
    "Do not retcon established events unless explicitly asked."
  ];
  if (params.charName) lines.push(`Reply only as ${params.charName}.`);
  lines.push(`Never write dialogue/actions for ${params.userName}.`);
  return lines.join("\n");
}

export function parseCharacterCard(characterId: string | null): CharacterCardData | null {
  if (!characterId) return null;
  const row = db.prepare("SELECT card_json FROM characters WHERE id = ?").get(characterId) as { card_json: string } | undefined;
  if (!row) return null;
  const data = parseCardData(row.card_json);
  return {
    name: pickString(data.name),
    description: pickString(data.description),
    personality: pickString(data.personality),
    scenario: pickString(data.scenario),
    greeting: pickString(data.first_mes),
    systemPrompt: pickString(data.system_prompt),
    mesExample: pickString(data.mes_example),
    postHistoryInstructions: pickString(data.post_history_instructions),
    alternateGreetings: pickStringList(data.alternate_greetings),
    extensions: pickObject(data.extensions)
  };
}
