import { randomUUID } from "crypto";
import { db, newId, now } from "../../db.js";
import { DEFAULT_NOVEL_CONFIG, type NovelScene, type NovelStory } from "../../../src/shared/types/novels.js";
import { insertChatRecord } from "../chat/repository.js";
import { readCharacterSceneDefaults } from "../chat/characterSceneDefaults.js";
import { novelCheckpoint } from "./contextCheckpoint.js";
import { renderLiteScenes } from "./liteFormat.js";
import { novelSettings } from "./endpoint.js";
import { record, text } from "./normalize.js";
import { protagonistName } from "./protagonist.js";
import { createNovel, writeNovel } from "./repository.js";

const MAX_MESSAGES = 30, MAX_IMPORT_CHARS = 12000, MAX_SCENE_LINES = 40, MAX_CHAT_PROSE = 6000;
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const cleanMessage = (value: string) => value.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "").trim();
const readCard = (raw: string) => { try { const parsed = record(JSON.parse(raw)); return record(parsed.data || parsed); } catch { return {}; } };
const parseIds = (raw: unknown) => { try { const value = JSON.parse(String(raw || "[]")); return Array.isArray(value) ? value.map(String).filter(Boolean) : []; } catch { return []; } };

/** Start a lite novel from a chat branch: its cast in chat order, its summary
 * or first character's scenario as the premise, and its most recent messages
 * as opening scenes. The chat itself is not changed. */
export function novelFromChat(chatId: string, branchId?: string): NovelStory {
  const chat = db.prepare("SELECT id, title, character_id, character_ids, context_summary FROM chats WHERE id = ?").get(chatId) as
    { id: string; title: string; character_id: string | null; character_ids: string | null; context_summary: string | null } | undefined;
  if (!chat) throw fail("Chat not found", 404);
  const branch = (branchId
    ? db.prepare("SELECT id FROM branches WHERE id = ? AND chat_id = ?").get(branchId, chatId)
    : db.prepare("SELECT id FROM branches WHERE chat_id = ? ORDER BY CASE WHEN name = 'main' THEN 0 ELSE 1 END, created_at ASC LIMIT 1").get(chatId)) as { id: string } | undefined;
  if (!branch) throw fail("Branch not found", 404);
  const listed = parseIds(chat.character_ids);
  const ordered = (listed.length ? listed : chat.character_id ? [chat.character_id] : [])
    .filter((id, i, all) => all.indexOf(id) === i && db.prepare("SELECT 1 FROM characters WHERE id = ?").get(id)).slice(0, 12);
  // The first character, in chat order, whose card has a scenario.
  const scenario = ordered.map((id) => text(readCard((db.prepare("SELECT card_json FROM characters WHERE id = ?").get(id) as { card_json: string }).card_json).scenario, 16000)).find(Boolean);
  const premise = text(chat.context_summary, 16000) || scenario || `Continue the story of the chat "${text(chat.title, 120)}".`;
  const settings = novelSettings();
  const persona = db.prepare("SELECT id FROM user_personas WHERE is_default = 1 LIMIT 1").get() as { id: string } | undefined;
  const created = createNovel({ title: text(chat.title, 160) || "Novel", config: { ...DEFAULT_NOVEL_CONFIG, premise, characterIds: ordered,
    providerId: text(settings.activeProviderId, 200), modelId: text(settings.activeModel, 200), generationMode: "lite", personaId: persona?.id || "" } });

  // Chronological branch timeline; keep the newest messages within budget.
  const rows = (db.prepare(`SELECT role, content, character_name FROM messages WHERE chat_id = ? AND branch_id = ? AND deleted = 0 AND role IN ('user', 'assistant')
    ORDER BY sort_order ASC, created_at ASC`).all(chatId, branch.id) as Array<{ role: string; content: string; character_name: string | null }>)
    .map((row) => ({ ...row, content: cleanMessage(row.content) })).filter((row) => row.content).slice(-MAX_MESSAGES);
  while (rows.length > 1 && rows.reduce((sum, row) => sum + row.content.length, 0) > MAX_IMPORT_CHARS) rows.shift();
  if (!rows.length) return created;
  const hero = protagonistName(created) || "You";
  const lines = rows.flatMap((row) => row.role === "user"
    ? [{ speaker: hero, text: text(row.content.replace(/\s*\n+\s*/g, " "), 2000) }]
    : row.content.split(/\n\s*\n|\n/).map((part) => ({ speaker: "", text: text(part, 2000) }))).filter((line) => line.text);
  const scenes: NovelScene[] = [];
  for (let i = 0; i < lines.length; i += MAX_SCENE_LINES) {
    scenes.push({ id: randomUUID(), title: scenes.length ? lines[i].text.slice(0, 60) : text(chat.title, 200) || lines[i].text.slice(0, 60), location: "", pov: text(created.config.povCharacter, 160) || hero,
      lines: lines.slice(i, i + MAX_SCENE_LINES), question: "", choices: [], illustrations: [], memory: created.memory, createdAt: now() });
  }
  const replay = renderLiteScenes(scenes);
  return writeNovel({ ...created, scenes, turns: [{ user: JSON.stringify({ action: "" }), throughSceneId: scenes[scenes.length - 1].id,
    assistant: JSON.stringify({ scenes: scenes.map((s) => ({ location: s.location, lines: s.lines })) }),
    lite: { user: "[The story so far, carried over from a chat. Continue from where it stops.]", assistant: replay } }] }, created.revision);
}

/** Continue a novel as an ordinary chat with the same cast: the latest prose
 * becomes the first message and the earlier-story summary the chat summary. */
export function novelToChat(story: NovelStory) {
  const prose: string[] = [];
  let size = 0;
  // Chat prose: paragraphs per line, no format markers or offered choices.
  for (const scene of [...story.scenes].reverse()) {
    const block = [scene.location, ...scene.lines.map((line) => line.speaker ? `${line.speaker}: ${line.text}` : line.text)].filter(Boolean).join("\n\n");
    if (prose.length && size + block.length > MAX_CHAT_PROSE) break;
    prose.unshift(block); size += block.length;
  }
  const content = prose.join("\n\n").slice(-MAX_CHAT_PROSE).trim();
  const characterIds = story.config.characterIds.filter((id) => db.prepare("SELECT 1 FROM characters WHERE id = ?").get(id));
  const first = characterIds[0] ? db.prepare("SELECT name, card_json FROM characters WHERE id = ?").get(characterIds[0]) as { name: string; card_json: string } : undefined;
  const id = newId(), title = text(story.title, 160) || "Novel";
  const summary = [novelCheckpoint(story)?.text || "", story.config.premise.trim()].filter(Boolean).join("\n\n");
  insertChatRecord({ id, title, primaryCharacterId: characterIds[0] || null, characterIds, lorebookIds: [],
    sceneDefaults: readCharacterSceneDefaults(first?.card_json, id), firstMessage: content ? { content, characterName: first?.name || "" } : null,
    contextSummary: summary, createdAt: now() });
  return { chatId: id, title };
}
