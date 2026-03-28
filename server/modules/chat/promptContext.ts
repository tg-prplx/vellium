import { db } from "../../db.js";
import { normalizeLoreBookEntries, type LoreBookEntryData } from "../../domain/lorebooks.js";
import type { CharacterCardData } from "../../domain/rpEngine.js";
import {
  buildCompactContextPolicy,
  parseCardData,
  pickObject,
  pickString,
  pickStringList,
  resolveChatMode,
  type ChatMode,
  type LoreBookRow
} from "./routeHelpers.js";

export interface SceneState {
  mood: string;
  pacing: string;
  variables: Record<string, string>;
  intensity: number;
  pureChatMode: boolean;
  chatMode: ChatMode;
}

export function buildSillyTavernCompatiblePurePrompt(params: {
  baseSystemPrompt: string;
  currentCharacter: CharacterCardData | null;
  characterCards: CharacterCardData[];
  currentCharacterName?: string;
  userName: string;
  ragAppendix?: string;
  isAutoConvo?: boolean;
  strictGrounding?: boolean;
}): string {
  const sections: string[] = [];
  const base = String(params.baseSystemPrompt || "").trim();
  if (base) sections.push(base);

  const current = params.currentCharacter;
  if (current) {
    const charName = params.currentCharacterName || current.name || "Character";
    sections.push("[SillyTavern-Compatible Character Context]");
    sections.push(`<char_name>${charName}</char_name>`);
    if (current.description.trim()) sections.push(`<description>${current.description.trim()}</description>`);
    if (current.personality.trim()) sections.push(`<personality>${current.personality.trim()}</personality>`);
    if (current.scenario.trim()) sections.push(`<scenario>${current.scenario.trim()}</scenario>`);
    if (current.systemPrompt.trim()) sections.push(`<char_system_prompt>${current.systemPrompt.trim()}</char_system_prompt>`);
    if (current.mesExample.trim()) sections.push(`<mes_example>${current.mesExample.trim()}</mes_example>`);
    if (current.greeting.trim()) sections.push(`<first_mes>${current.greeting.trim()}</first_mes>`);
    if (current.postHistoryInstructions.trim()) {
      sections.push(`<post_history_instructions>${current.postHistoryInstructions.trim()}</post_history_instructions>`);
    }

    if (params.characterCards.length > 1) {
      const others = params.characterCards
        .filter((card) => card.name !== charName)
        .map((card) => card.name)
        .filter(Boolean);
      if (others.length > 0) {
        sections.push(`[Other active characters]\n${others.join(", ")}`);
      }
    }

    sections.push(
      [
        "[Roleplay rules]",
        `You are ${charName}.`,
        "Stay in character at all times.",
        `Write ONLY as ${charName}; do not write messages for ${params.userName}.`,
        "Use previous chat history as canonical context.",
        params.strictGrounding !== false ? "If key facts are missing, do not invent them." : ""
      ].join("\n")
    );
    if (params.strictGrounding !== false) {
      sections.push(buildCompactContextPolicy({ charName, userName: params.userName }));
    }
  }

  if (params.isAutoConvo) {
    sections.push(
      "[IMPORTANT: This is an autonomous conversation between characters. There is NO human user participating. Do NOT wait for user input, do NOT address the user, do NOT ask questions to the user. Act naturally and continue the roleplay conversation with the other character(s). Advance the plot, respond to what the other character said, and keep the story flowing. Be proactive — take actions, express emotions, move the scene forward.]"
    );
  }

  const rag = String(params.ragAppendix || "").trim();
  if (rag) sections.push(rag);

  return sections.filter(Boolean).join("\n\n");
}

export function buildSillyTavernCompatibleLightPrompt(params: {
  baseSystemPrompt: string;
  currentCharacter: CharacterCardData | null;
  characterCards: CharacterCardData[];
  currentCharacterName?: string;
  userName: string;
  responseLanguage?: string;
  sceneState?: Pick<SceneState, "mood" | "pacing" | "variables" | "intensity"> | null;
  authorNote?: string;
  ragAppendix?: string;
  isAutoConvo?: boolean;
  strictGrounding?: boolean;
}): string {
  const base = buildSillyTavernCompatiblePurePrompt({
    baseSystemPrompt: params.baseSystemPrompt,
    currentCharacter: params.currentCharacter,
    characterCards: params.characterCards,
    currentCharacterName: params.currentCharacterName,
    userName: params.userName,
    ragAppendix: "",
    isAutoConvo: params.isAutoConvo,
    strictGrounding: params.strictGrounding
  });
  const sections: string[] = [base];
  const scene = params.sceneState;
  if (scene) {
    const style = String(scene.variables.dialogueStyle || "").trim();
    const initiative = String(scene.variables.initiative || "").trim();
    const descriptiveness = String(scene.variables.descriptiveness || "").trim();
    const unpredictability = String(scene.variables.unpredictability || "").trim();
    const emotionalDepth = String(scene.variables.emotionalDepth || "").trim();
    const lines = [
      "[Light RP Scene]",
      `Mood: ${scene.mood || "neutral"}`,
      `Pacing: ${scene.pacing || "balanced"}`,
      `Intensity: ${Math.round(Math.max(0, Math.min(1, scene.intensity)) * 100)}%`,
      style ? `Dialogue style: ${style}` : "",
      initiative ? `Initiative: ${initiative}%` : "",
      descriptiveness ? `Descriptiveness: ${descriptiveness}%` : "",
      unpredictability ? `Unpredictability: ${unpredictability}%` : "",
      emotionalDepth ? `Emotional depth: ${emotionalDepth}%` : ""
    ].filter(Boolean);
    sections.push(lines.join("\n"));
  }
  const authorNote = String(params.authorNote || "").trim();
  if (authorNote) {
    sections.push(`[Author's Note]\n${authorNote}\nUse as style steering; do not override established facts unless user requests it.`);
  }
  const responseLanguage = String(params.responseLanguage || "").trim();
  if (responseLanguage && responseLanguage.toLowerCase() !== "english") {
    sections.push(`Respond in ${responseLanguage}.`);
  }
  const rag = String(params.ragAppendix || "").trim();
  if (rag) sections.push(rag);
  if (!params.currentCharacter && params.strictGrounding !== false) {
    sections.push(buildCompactContextPolicy({ userName: params.userName }));
  }
  return sections.filter(Boolean).join("\n\n");
}

export function getCharacterCard(characterId: string | null): CharacterCardData | null {
  if (!characterId) return null;
  const row = db.prepare("SELECT * FROM characters WHERE id = ?").get(characterId) as {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    system_prompt: string;
    mes_example: string;
    greeting: string;
    card_json: string;
  } | undefined;
  if (!row) return null;
  const cardData = parseCardData(row.card_json);
  const alternateGreetings = pickStringList(cardData.alternate_greetings);
  return {
    name: row.name,
    description: row.description || "",
    personality: row.personality || "",
    scenario: row.scenario || "",
    systemPrompt: row.system_prompt || "",
    mesExample: row.mes_example || "",
    greeting: row.greeting || "",
    postHistoryInstructions: pickString(cardData.post_history_instructions),
    alternateGreetings,
    creator: pickString(cardData.creator),
    characterVersion: pickString(cardData.character_version),
    extensions: pickObject(cardData.extensions)
  };
}

export function getLorebookEntries(lorebookIds: string[]): LoreBookEntryData[] {
  if (lorebookIds.length === 0) return [];
  const out: LoreBookEntryData[] = [];
  for (const lorebookId of lorebookIds) {
    const row = db.prepare("SELECT id, name, entries_json FROM lorebooks WHERE id = ?").get(lorebookId) as LoreBookRow | undefined;
    if (!row) continue;
    try {
      const parsed = JSON.parse(row.entries_json || "[]");
      out.push(...normalizeLoreBookEntries(parsed));
    } catch {
      // Ignore malformed lorebook payloads.
    }
  }
  return out;
}

export function getSceneState(chatId: string): SceneState | null {
  const row = db.prepare("SELECT payload FROM rp_scene_state WHERE chat_id = ?").get(chatId) as { payload: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.payload);
    const intensity = typeof parsed.intensity === "number" ? parsed.intensity : 0.5;
    const chatMode = resolveChatMode(parsed.chatMode);
    const legacyPureMode = parsed.pureChatMode === true;
    const resolvedMode = chatMode !== "rp" ? chatMode : (legacyPureMode ? "pure_chat" : "rp");
    return {
      mood: parsed.mood || "neutral",
      pacing: parsed.pacing || "balanced",
      variables: parsed.variables || {},
      intensity: Math.max(0, Math.min(1, intensity)),
      pureChatMode: resolvedMode === "pure_chat",
      chatMode: resolvedMode
    };
  } catch {
    return null;
  }
}

export function getAuthorNote(chatId: string): string {
  const chat = db.prepare("SELECT author_note FROM chats WHERE id = ?").get(chatId) as { author_note: string | null } | undefined;
  if (chat?.author_note) return chat.author_note;
  const row = db.prepare(
    "SELECT content FROM rp_memory_entries WHERE chat_id = ? AND role = 'author_note' ORDER BY created_at DESC LIMIT 1"
  ).get(chatId) as { content: string } | undefined;
  return row?.content || "";
}

export function getChatSamplerConfig(chatId: string, globalConfig: Record<string, unknown>): Record<string, unknown> {
  const chat = db.prepare("SELECT sampler_config FROM chats WHERE id = ?").get(chatId) as { sampler_config: string | null } | undefined;
  if (chat?.sampler_config) {
    try {
      return { ...globalConfig, ...JSON.parse(chat.sampler_config) };
    } catch {
      // Fall back to global configuration.
    }
  }
  return globalConfig;
}
