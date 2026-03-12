import type { PromptBlock } from "./rpEngine.js";

export interface LoreBookEntryData {
  id: string;
  name: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  selective: boolean;
  selectiveLogic: "and" | "or";
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

const TOKEN_BOUNDARY_CLASS = "\\p{L}\\p{N}_";

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

function normalizeSecondaryKeys(row: Record<string, unknown>): string[] {
  return normalizeKeyList(
    row.secondaryKeys
    ?? row.secondary_keys
    ?? row.keysecondary
    ?? []
  );
}

function normalizePosition(input: unknown): string {
  if (typeof input === "number" && Number.isFinite(input)) {
    switch (Math.floor(input)) {
      case 0: return "before_char";
      case 1: return "after_char";
      case 2: return "before_scene";
      case 3: return "after_scene";
      case 4: return "before_author_note";
      case 5: return "after_author_note";
      case 6: return "before_history";
      case 7: return "after_history";
      default: return "after_char";
    }
  }
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

function normalizeSelectiveLogic(input: unknown): "and" | "or" {
  if (typeof input === "string") {
    const raw = input.trim().toLowerCase();
    if (raw === "or") return "or";
    return "and";
  }
  const numeric = Number(input);
  if (!Number.isFinite(numeric)) return "and";
  return numeric === 1 ? "or" : "and";
}

function normalizeEntriesInput(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) {
    return input.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (input && typeof input === "object") {
    return Object.values(input as Record<string, unknown>)
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  return [];
}

export function normalizeLoreBookEntries(input: unknown): LoreBookEntryData[] {
  const rows = normalizeEntriesInput(input);
  if (rows.length === 0) return [];
  const out: LoreBookEntryData[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const content = String(row.content || "").trim();
    if (!content) continue;
    const id = String(row.id || row.uid || "").trim() || `entry-${index + 1}`;
    out.push({
      id,
      name: String(row.name || row.comment || "").trim(),
      keys: normalizeKeyList(row.keys ?? row.key),
      secondaryKeys: normalizeSecondaryKeys(row),
      content,
      enabled: row.enabled !== false && row.disable !== true,
      constant: row.constant === true,
      selective: row.selective === true,
      selectiveLogic: normalizeSelectiveLogic(row.selectiveLogic ?? row.selective_logic),
      position: normalizePosition(row.position),
      insertionOrder: toInsertionOrder(row.insertion_order ?? row.insertionOrder ?? row.order ?? row.priority, (index + 1) * 100)
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

export function parseSillyTavernWorldInfo(rawData: unknown): { name: string; description: string; entries: LoreBookEntryData[] } | null {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) return null;
  const data = rawData as Record<string, unknown>;
  const entries = normalizeLoreBookEntries(data.entries);
  if (entries.length === 0) return null;
  const name = String(data.name || "").trim() || "Imported World Info";
  const description = String(data.description || "").trim();
  return { name, description, entries };
}

function mapPositionToWorldInfoIndex(position: string): number {
  switch (position) {
    case "before_char":
    case "before_character":
      return 0;
    case "after_char":
    case "after_character":
      return 1;
    case "before_scene":
    case "before_scenario":
      return 2;
    case "after_scene":
    case "after_scenario":
      return 3;
    case "before_author_note":
      return 4;
    case "after_author_note":
      return 5;
    case "before_history":
      return 6;
    case "after_history":
      return 7;
    default:
      return 1;
  }
}

export function serializeSillyTavernWorldInfo(book: {
  id?: string;
  name: string;
  description?: string;
  entries: LoreBookEntryData[];
}) {
  const entries = Object.fromEntries(
    normalizeLoreBookEntries(book.entries).map((entry, index) => [
      entry.id || `entry-${index + 1}`,
      {
        uid: entry.id || `entry-${index + 1}`,
        key: [...entry.keys],
        keysecondary: [...entry.secondaryKeys],
        comment: entry.name || "",
        content: entry.content,
        constant: entry.constant === true,
        selective: entry.selective === true,
        selectiveLogic: entry.selectiveLogic === "or" ? 1 : 0,
        disable: entry.enabled !== true,
        order: entry.insertionOrder,
        insertion_order: entry.insertionOrder,
        position: mapPositionToWorldInfoIndex(entry.position)
      }
    ])
  );

  return {
    name: String(book.name || "").trim() || "LoreBook",
    description: String(book.description || "").trim(),
    entries
  };
}

function matchesKeyGroup(haystack: string, keys: string[], logic: "and" | "or"): boolean {
  if (keys.length === 0) return true;
  if (logic === "or") {
    return keys.some((key) => matchesLoreKey(haystack, key));
  }
  return keys.every((key) => matchesLoreKey(haystack, key));
}

export function getTriggeredLoreEntries(entries: LoreBookEntryData[], timelineTexts: string[]): LoreBookEntryData[] {
  const haystack = timelineTexts.join("\n").toLowerCase();
  return entries
    .filter((entry) => entry.enabled && entry.content.trim())
    .filter((entry) => {
      if (entry.constant) return true;
      if (entry.keys.length === 0) return false;
      const primaryMatched = entry.keys.some((key) => matchesLoreKey(haystack, key));
      if (!primaryMatched) return false;
      if (!entry.selective || entry.secondaryKeys.length === 0) return true;
      return matchesKeyGroup(haystack, entry.secondaryKeys, entry.selectiveLogic);
    })
    .sort((a, b) => a.insertionOrder - b.insertionOrder);
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesLoreKey(haystackLower: string, rawKey: string): boolean {
  const key = String(rawKey || "").trim().toLowerCase();
  if (!key) return false;

  // For normal words/phrases, use token boundaries to avoid false positives:
  // "he" should not trigger on "she" or "the".
  if (/^[\p{L}\p{N}_ ]+$/u.test(key)) {
    const escaped = escapeRegex(key).replace(/\s+/g, "\\s+");
    const pattern = new RegExp(`(^|[^${TOKEN_BOUNDARY_CLASS}])${escaped}(?=$|[^${TOKEN_BOUNDARY_CLASS}])`, "u");
    return pattern.test(haystackLower);
  }

  // For symbolic keys, fallback to substring matching.
  return haystackLower.includes(key);
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
    case "before_author_note": return { anchorKind: "author_note", place: "before" };
    case "after_author_note": return { anchorKind: "author_note", place: "after" };
    case "before_history": return { anchorKind: "history", place: "before" };
    case "after_history": return { anchorKind: "history", place: "after" };
    default: return { anchorKind: "character", place: "after" };
  }
}

function getAnchorOrder(blocks: PromptBlock[], kind: PromptBlock["kind"]): number {
  const block = blocks.find((item) => item.kind === kind);
  if (block) return block.order;
  if (kind === "system") return 1;
  if (kind === "jailbreak") return 2;
  if (kind === "character") return 3;
  if (kind === "author_note") return 4;
  if (kind === "scene") return 6;
  if (kind === "history") return 7;
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
