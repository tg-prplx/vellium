import { db, now } from "../../db.js";
import { getTimeline, messageToJson, type MessageRow } from "./routeHelpers.js";
import { listBranches } from "./repository.js";
import { resolveLorebookIds } from "./attachments.js";

type ExportParticipantKind = "user" | "character" | "system" | "tool";

interface ExportParticipant {
  id: string;
  kind: ExportParticipantKind;
  name: string;
  characterId: string | null;
  avatarUrl: string | null;
}

interface CharacterExportRow {
  id: string;
  name: string;
  avatar_path: string | null;
}

function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function avatarUrl(path: string | null): string | null {
  if (!path) return null;
  return /^https?:\/\//i.test(path) ? path : `/api/avatars/${path}`;
}

function participantKey(kind: ExportParticipantKind, name: string) {
  return `${kind}:${name.trim().toLocaleLowerCase() || "unknown"}`;
}

export function exportChatJson(chatId: string, activeBranchId?: string) {
  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(chatId) as {
    id: string;
    title: string;
    character_id?: string | null;
    character_ids?: string | null;
    lorebook_id?: string | null;
    lorebook_ids?: string | null;
    auto_conversation?: number;
    context_summary?: string | null;
    created_at: string;
  } | undefined;
  if (!chat) return null;

  const branches = listBranches(chatId);
  const resolvedActiveBranchId = branches.some((branch) => branch.id === activeBranchId)
    ? activeBranchId
    : branches[0]?.id || null;
  const rows = db.prepare(
    "SELECT * FROM messages WHERE chat_id = ? AND deleted = 0 ORDER BY branch_id ASC, sort_order ASC, created_at ASC, id ASC"
  ).all(chatId) as MessageRow[];
  const messages = rows.map(messageToJson);
  const messagesByBranch = branches.reduce<Record<string, typeof messages>>((acc, branch) => {
    acc[branch.id] = messages.filter((message) => message.branchId === branch.id);
    return acc;
  }, {});

  const characterIds = parseStringArray(chat.character_ids);
  if (characterIds.length === 0 && chat.character_id) characterIds.push(chat.character_id);
  const characterRows = characterIds.length > 0
    ? db.prepare(
      `SELECT id, name, avatar_path FROM characters WHERE id IN (${characterIds.map(() => "?").join(", ")})`
    ).all(...characterIds) as CharacterExportRow[]
    : [];
  const characterById = new Map(characterRows.map((character) => [character.id, character]));
  const orderedCharacters = characterIds.flatMap((id) => {
    const character = characterById.get(id);
    return character ? [character] : [];
  });
  const characterByName = new Map(orderedCharacters.map((character) => [character.name.toLocaleLowerCase(), character]));
  const participants = new Map<string, ExportParticipant>();

  for (const character of orderedCharacters) {
    participants.set(`character:${character.id}`, {
      id: `character:${character.id}`,
      kind: "character",
      name: character.name,
      characterId: character.id,
      avatarUrl: avatarUrl(character.avatar_path)
    });
  }

  function resolveSpeaker(message: (typeof messages)[number]): ExportParticipant {
    if (message.role === "system" || message.role === "tool") {
      const name = message.role === "system" ? "System" : "Tool";
      const id = participantKey(message.role, name);
      return { id, kind: message.role, name, characterId: null, avatarUrl: null };
    }
    if (message.role === "user") {
      const name = message.characterName?.trim() || "User";
      return { id: participantKey("user", name), kind: "user", name, characterId: null, avatarUrl: null };
    }

    const explicitName = message.characterName?.trim();
    const matchedCharacter = explicitName
      ? characterByName.get(explicitName.toLocaleLowerCase())
      : orderedCharacters.length === 1
        ? orderedCharacters[0]
        : undefined;
    if (matchedCharacter) {
      return participants.get(`character:${matchedCharacter.id}`)!;
    }
    const name = explicitName || "Assistant";
    return {
      id: participantKey("character", name),
      kind: "character",
      name,
      characterId: null,
      avatarUrl: null
    };
  }

  for (const message of messages) {
    const speaker = resolveSpeaker(message);
    if (!participants.has(speaker.id)) participants.set(speaker.id, speaker);
  }

  const activeMessages = resolvedActiveBranchId ? getTimeline(chatId, resolvedActiveBranchId) : [];
  const conversationMessages = activeMessages.map((message, index) => {
    const speaker = resolveSpeaker(message);
    return {
      sequence: index + 1,
      id: message.id,
      role: message.role,
      speakerId: speaker.id,
      speakerName: speaker.name,
      characterId: speaker.characterId,
      content: message.content,
      attachments: message.attachments || [],
      tokenCount: message.tokenCount,
      createdAt: message.createdAt,
      parentId: message.parentId || null
    };
  });

  const promptBlocks = db.prepare(
    "SELECT id, kind, enabled, ordering, content, created_at FROM prompt_blocks WHERE chat_id = ? ORDER BY ordering ASC, created_at ASC, id ASC"
  ).all(chatId) as Array<{
    id: string;
    kind: string;
    enabled: number;
    ordering: number;
    content: string;
    created_at: string;
  }>;
  const sceneRow = db.prepare("SELECT payload, updated_at FROM rp_scene_state WHERE chat_id = ?").get(chatId) as {
    payload: string;
    updated_at: string;
  } | undefined;

  return {
    format: "vellium.chat.export",
    version: 2,
    exportedAt: now(),
    chat: {
      id: chat.id,
      title: chat.title,
      characterId: chat.character_id || null,
      characterIds,
      lorebookId: chat.lorebook_id || null,
      lorebookIds: resolveLorebookIds(chat),
      autoConversation: chat.auto_conversation === 1,
      contextSummary: chat.context_summary || "",
      createdAt: chat.created_at
    },
    participants: Array.from(participants.values()),
    conversation: {
      branchId: resolvedActiveBranchId,
      branchName: branches.find((branch) => branch.id === resolvedActiveBranchId)?.name || null,
      multiCharacter: orderedCharacters.length > 1,
      messages: conversationMessages
    },
    activeBranchId: resolvedActiveBranchId,
    branches,
    messages,
    messagesByBranch,
    promptBlocks: promptBlocks.map((block) => ({
      id: block.id,
      kind: block.kind,
      enabled: block.enabled === 1,
      order: block.ordering,
      content: block.content,
      createdAt: block.created_at
    })),
    sceneState: sceneRow ? {
      payload: parseJsonObject(sceneRow.payload),
      updatedAt: sceneRow.updated_at
    } : null
  };
}
