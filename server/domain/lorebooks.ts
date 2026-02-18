import type { PromptBlock } from "./rpEngine.js";

export interface LoreBookEntryData {
  id: string;
  name: string;
  keys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  position: string;
  insertionOrder: number;
}

export interface LoreBookData {
  id: string;
  name: string;
  description: string;
  entries: LoreBookEntryData[];
  sourceCharacterId: string | null;
  createdAt: string;
  updatedAt: string;
}

function normalizeKeyList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const key = String(raw || "").trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(key);
  }
  return out;
}

function normalizePosition(input: unknown): string {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "after_char";
  if (raw === "before_character") return "before_char";
  if (raw === "after_character") return "after_char";
  return raw;
}

function toInsertionOrder(input: unknown, fallback: number): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

export function normalizeLoreBookEntries(input: unknown): LoreBookEntryData[] {
  if (!Array.isArray(input)) return [];
  const out: LoreBookEntryData[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const raw = input[index];
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const content = String(row.content || "").trim();
    if (!content) continue;
    const id = String(row.id || row.uid || "").trim() || `entry-${index + 1}`;
    out.push({
      id,
      name: String(row.name || "").trim(),
      keys: normalizeKeyList(row.keys),
      content,
      enabled: row.enabled !== false,
      constant: row.constant === true,
      position: normalizePosition(row.position),
      insertionOrder: toInsertionOrder(row.insertion_order ?? row.insertionOrder, (index + 1) * 100)
    });
  }

  return out;
}

export function parseCharacterLoreBook(rawData: unknown): { name: string; description: string; entries: LoreBookEntryData[] } | null {
  if (!rawData || typeof rawData !== "object") return null;
  const data = rawData as Record<string, unknown>;
  const rawBook = data.character_book;
  if (!rawBook || typeof rawBook !== "object") return null;
  const book = rawBook as Record<string, unknown>;
  const entries = normalizeLoreBookEntries(book.entries);
  if (entries.length === 0) return null;
  const name = String(book.name || "").trim() || `${String(data.name || "Character").trim() || "Character"} LoreBook`;
  const description = String(book.description || "").trim();
  return { name, description, entries };
}

export function getTriggeredLoreEntries(entries: LoreBookEntryData[], timelineTexts: string[]): LoreBookEntryData[] {
  const haystack = timelineTexts.join("\n").toLowerCase();
  return entries
    .filter((entry) => entry.enabled && entry.content.trim())
    .filter((entry) => {
      if (entry.constant) return true;
      if (entry.keys.length === 0) return false;
      return entry.keys.some((key) => haystack.includes(key.toLowerCase()));
    })
    .sort((a, b) => a.insertionOrder - b.insertionOrder);
}

function resolveAnchor(position: string): { anchorKind: PromptBlock["kind"]; place: "before" | "after" } {
  switch (position) {
    case "before_system": return { anchorKind: "system", place: "before" };
    case "after_system": return { anchorKind: "system", place: "after" };
    case "before_jailbreak": return { anchorKind: "jailbreak", place: "before" };
    case "after_jailbreak": return { anchorKind: "jailbreak", place: "after" };
    case "before_char": return { anchorKind: "character", place: "before" };
    case "after_char": return { anchorKind: "character", place: "after" };
    case "before_character": return { anchorKind: "character", place: "before" };
    case "after_character": return { anchorKind: "character", place: "after" };
    case "before_scenario": return { anchorKind: "scene", place: "before" };
    case "after_scenario": return { anchorKind: "scene", place: "after" };
    case "before_scene": return { anchorKind: "scene", place: "before" };
    case "after_scene": return { anchorKind: "scene", place: "after" };
    case "before_author_note": return { anchorKind: "scene", place: "before" };
    case "after_author_note": return { anchorKind: "scene", place: "after" };
    case "before_history": return { anchorKind: "scene", place: "before" };
    case "after_history": return { anchorKind: "scene", place: "after" };
    default: return { anchorKind: "character", place: "after" };
  }
}

function getAnchorOrder(blocks: PromptBlock[], kind: PromptBlock["kind"]): number {
  const block = blocks.find((item) => item.kind === kind);
  if (block) return block.order;
  if (kind === "system") return 1;
  if (kind === "jailbreak") return 2;
  if (kind === "character") return 3;
  if (kind === "scene") return 6;
  return 5;
}

export function injectLoreBlocks(baseBlocks: PromptBlock[], entries: LoreBookEntryData[]): PromptBlock[] {
  if (entries.length === 0) return baseBlocks;

  const dynamicBlocks: PromptBlock[] = entries.map((entry, index) => {
    const { anchorKind, place } = resolveAnchor(entry.position);
    const anchorOrder = getAnchorOrder(baseBlocks, anchorKind);
    const shiftBase = place === "before" ? -0.49 : 0.49;
    const order = anchorOrder + shiftBase + (index / 10000);

    return {
      id: `lore-${entry.id}-${index}`,
      kind: "lore",
      enabled: true,
      order,
      content: entry.content
    };
  });

  return [...baseBlocks, ...dynamicBlocks].sort((a, b) => a.order - b.order);
}
