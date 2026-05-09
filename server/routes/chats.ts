import { Router } from "express";
import { db, isLocalhostUrl, newId, now, roughTokenCount, nextSortOrder } from "../db.js";
import type { Response } from "express";
import {
  autoIngestTextAttachmentsForChat,
  buildPromptContentWithAttachments,
  normalizeCharacterIdList,
  normalizeLorebookIdList,
  resolveLorebookIds,
  sanitizeAttachments,
  selectFirstResponderByMention
} from "../modules/chat/attachments.js";
import {
  getSettings,
  getTimeline,
  parseCardData,
  pickInitialGreeting,
  pickStringList,
  resolveBranch,
  type MessageRow,
  type ProviderRow,
  type UserPersonaPayload
} from "../modules/chat/routeHelpers.js";
import {
  activeAbortControllers,
  streamLlmResponse
} from "../modules/chat/chatOrchestrator.js";
import {
  compressChat,
  translateMessage,
  ttsMessage,
  ttsText
} from "../modules/chat/contentHandlers.js";
import { completeProviderOnce, countProviderTokens } from "../modules/chat/providerExecution.js";
import {
  deleteChatCascade,
  deleteMessageTree,
  forkBranch,
  listBranches
} from "../modules/chat/repository.js";
import {
  getChatPreset,
  getChatSampler,
  updateChatPreset,
  updateChatSampler
} from "../modules/chat/settingsHandlers.js";
import { getChatRagBinding, setChatRagBinding } from "../services/rag.js";

const router = Router();

// --- Routes ---

// Abort/interrupt stream
router.post("/:id/abort", (req, res) => {
  const chatId = req.params.id;
  const controller = activeAbortControllers.get(chatId);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(chatId);
    res.json({ ok: true, interrupted: true });
  } else {
    res.json({ ok: true, interrupted: false });
  }
});

router.post("/", (req, res) => {
  const { title, characterId, characterIds } = req.body;
  const settings = getSettings();
  const chatId = newId();
  const ts = now();

  const allCharIds: string[] = characterIds?.length ? characterIds : (characterId ? [characterId] : []);
  const charIdsJson = JSON.stringify(allCharIds);
  let lorebookIds = normalizeLorebookIdList(req.body?.lorebookIds);
  if (lorebookIds.length === 0 && req.body?.lorebookId) {
    lorebookIds = [String(req.body.lorebookId).trim()].filter(Boolean);
  }
  if (lorebookIds.length === 0 && allCharIds[0]) {
    const row = db.prepare("SELECT lorebook_id FROM characters WHERE id = ?").get(allCharIds[0]) as { lorebook_id: string | null } | undefined;
    if (row?.lorebook_id) {
      lorebookIds = [row.lorebook_id];
    }
  }
  const lorebookId = lorebookIds[0] || null;

  db.prepare("INSERT INTO chats (id, title, character_id, character_ids, lorebook_id, lorebook_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(chatId, title, characterId || null, charIdsJson, lorebookId, JSON.stringify(lorebookIds), ts);

  // Auto-create root branch
  const branchId = newId();
  db.prepare("INSERT INTO branches (id, chat_id, name, parent_message_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(branchId, chatId, "main", null, ts);

  // If character has a greeting, insert it as first message
  if (allCharIds.length > 0) {
    // Insert greeting from first character
    const firstChar = db.prepare("SELECT name, greeting, card_json FROM characters WHERE id = ?").get(allCharIds[0]) as {
      name: string;
      greeting: string;
      card_json: string;
    } | undefined;
    const cardData = parseCardData(firstChar?.card_json);
    const alternateGreetings = pickStringList(cardData.alternate_greetings);
    const firstGreeting = String(firstChar?.greeting || "").trim();
    const greetingToInsert = pickInitialGreeting(firstGreeting, alternateGreetings, settings.useAlternateGreetings === true);
    if (greetingToInsert) {
      db.prepare(
        "INSERT INTO messages (id, chat_id, branch_id, role, content, token_count, parent_id, deleted, created_at, character_name, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)"
      ).run(newId(), chatId, branchId, "assistant", greetingToInsert, roughTokenCount(greetingToInsert), null, ts, firstChar.name, 1);
    }
  }

  res.json({ id: chatId, title, characterId: characterId || null, characterIds: allCharIds, lorebookId, lorebookIds, createdAt: ts });
});

router.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM chats ORDER BY created_at DESC").all() as {
    id: string; title: string; character_id: string | null; character_ids: string | null; lorebook_id: string | null; lorebook_ids: string | null; auto_conversation: number; created_at: string;
  }[];
  res.json(rows.map((r) => {
    let characterIds: string[] = [];
    try { characterIds = JSON.parse(r.character_ids || "[]"); } catch { /* empty */ }
    const lorebookIds = resolveLorebookIds(r);
    return {
      id: r.id, title: r.title, characterId: r.character_id,
      characterIds,
      lorebookId: lorebookIds[0] || r.lorebook_id || null,
      lorebookIds,
      autoConversation: r.auto_conversation === 1,
      createdAt: r.created_at
    };
  }));
});

router.post("/desktop-pet/reply", async (req, res) => {
  const content = String(req.body?.content || "").trim().slice(0, 1000);
  if (!content) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const settings = getSettings();
  const providerId = String(settings.activeProviderId || "").trim();
  const modelId = String(settings.activeModel || "").trim();
  if (!providerId || !modelId) {
    res.json({ reply: "[No provider configured] Configure a provider in Settings." });
    return;
  }

  const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId) as ProviderRow | undefined;
  if (!provider) {
    res.json({ reply: "[Provider not found] Configure a provider in Settings." });
    return;
  }
  if (settings.fullLocalMode && !isLocalhostUrl(provider.base_url)) {
    res.status(400).json({ error: "Provider blocked by Full Local Mode" });
    return;
  }

  const pet = req.body?.pet && typeof req.body.pet === "object" && !Array.isArray(req.body.pet)
    ? req.body.pet as Record<string, unknown>
    : {};
  const name = String(pet.name || "Desktop Pet").trim().slice(0, 80);
  const history = Array.isArray(req.body?.history)
    ? req.body.history.flatMap((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : "";
      const historyContent = String(record.content || "").replace(/\s+/g, " ").trim().slice(0, 1200);
      return role && historyContent ? [{ role, content: historyContent }] : [];
    }).slice(-12)
    : [];
  const recentConversation = history
    .map((item) => `${item.role === "assistant" ? name : "User"}: ${item.content}`)
    .join("\n");
  const rawScreenContext = req.body?.screenContext && typeof req.body.screenContext === "object" && !Array.isArray(req.body.screenContext)
    ? req.body.screenContext as Record<string, unknown>
    : null;
  const screenDataUrl = String(rawScreenContext?.dataUrl || "").slice(0, 8 * 1024 * 1024);
  const screenContext = screenDataUrl.startsWith("data:image/")
    ? {
      dataUrl: screenDataUrl,
      width: Number(rawScreenContext?.width) || 0,
      height: Number(rawScreenContext?.height) || 0
    }
    : null;
  const systemPrompt = [
    String(settings.defaultSystemPrompt || "").trim(),
    String(pet.systemPrompt || "").trim().slice(0, 4000),
    `[Pet Character]\nName: ${name}\nDescription: ${String(pet.description || "").trim().slice(0, 2000)}\nPersonality: ${String(pet.personality || "").trim().slice(0, 4000)}\nScenario: ${String(pet.scenario || "").trim().slice(0, 4000)}`,
    String(req.body?.runtimeSystemPrompt || "").trim().slice(0, 4000)
  ].filter(Boolean).join("\n\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const reply = await completeProviderOnce({
      provider,
      modelId,
      systemPrompt,
      userPrompt: [
        recentConversation ? `[Recent Pet Conversation]\n${recentConversation}` : "",
        screenContext ? `[Screen Context]\nA current screenshot of the user's desktop is attached. The desktop pet itself was hidden before capture, so do not claim to see the pet in the image unless it is actually visible.` : "",
        `[Current User Message]\n${content}`
      ].filter(Boolean).join("\n\n"),
      imageDataUrl: screenContext?.dataUrl,
      samplerConfig: {
        ...((settings.samplerConfig as Record<string, unknown> | undefined) || {}),
        maxTokens: 420
      },
      apiParamPolicy: settings.apiParamPolicy,
      signal: controller.signal
    });
    res.json({ reply: reply.trim() || "..." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desktop pet LLM request failed";
    res.status(500).json({ error: message });
  } finally {
    clearTimeout(timeout);
  }
});

// Rename chat
router.patch("/:id", (req, res) => {
  const chatId = req.params.id;
  const title = String(req.body?.title || "").trim();
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const existing = db.prepare("SELECT id FROM chats WHERE id = ?").get(chatId) as { id: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: "Chat not found" });
    return;
  }
  db.prepare("UPDATE chats SET title = ? WHERE id = ?").run(title.slice(0, 160), chatId);
  res.json({ ok: true, title: title.slice(0, 160) });
});

// Delete chat
router.delete("/:id", (req, res) => {
  deleteChatCascade(req.params.id);
  res.json({ ok: true });
});

// Update chat character list
router.patch("/:id/characters", (req, res) => {
  const chatId = req.params.id;
  const ids = normalizeCharacterIdList(req.body?.characterIds);
  const primaryCharacterId = ids[0] || null;
  db.prepare("UPDATE chats SET character_ids = ?, character_id = ? WHERE id = ?")
    .run(JSON.stringify(ids), primaryCharacterId, chatId);
  res.json({ ok: true, characterIds: ids, characterId: primaryCharacterId });
});

router.patch("/:id/lorebook", (req, res) => {
  const chatId = req.params.id;
  let lorebookIds = normalizeLorebookIdList(req.body?.lorebookIds);
  if (lorebookIds.length === 0 && req.body?.lorebookId) {
    lorebookIds = [String(req.body.lorebookId).trim()].filter(Boolean);
  }
  const lorebookId = lorebookIds[0] || null;
  db.prepare("UPDATE chats SET lorebook_id = ?, lorebook_ids = ? WHERE id = ?").run(lorebookId, JSON.stringify(lorebookIds), chatId);
  res.json({ ok: true, lorebookId, lorebookIds });
});

router.get("/:id/lorebook", (req, res) => {
  const chatId = req.params.id;
  const row = db.prepare("SELECT lorebook_id, lorebook_ids FROM chats WHERE id = ?").get(chatId) as { lorebook_id: string | null; lorebook_ids: string | null } | undefined;
  const lorebookIds = resolveLorebookIds(row);
  res.json({ lorebookId: lorebookIds[0] || row?.lorebook_id || null, lorebookIds });
});

router.get("/:id/rag", (req, res) => {
  const chatId = req.params.id;
  const settings = getSettings();
  const binding = getChatRagBinding(chatId, settings as Record<string, unknown>);
  res.json(binding);
});

router.patch("/:id/rag", (req, res) => {
  const chatId = req.params.id;
  const enabled = req.body?.enabled === true;
  const collectionIds = req.body?.collectionIds;
  const binding = setChatRagBinding(chatId, enabled, collectionIds);
  res.json(binding);
});

router.get("/:id/branches", (req, res) => {
  res.json(listBranches(req.params.id));
});

router.get("/:id/timeline", (req, res) => {
  const branchId = resolveBranch(req.params.id, req.query.branchId as string | undefined);
  res.json(getTimeline(req.params.id, branchId));
});

router.post("/:id/send", async (req, res: Response) => {
  const chatId = req.params.id;
  const { content, branchId: reqBranchId, userName, userPersona, attachments: rawAttachments, runtimeSystemPrompt } = req.body;
  const branchId = resolveBranch(chatId, reqBranchId);
  const persona: UserPersonaPayload = {
    name: String(userPersona?.name || userName || "User"),
    description: String(userPersona?.description || ""),
    personality: String(userPersona?.personality || ""),
    scenario: String(userPersona?.scenario || "")
  };
  const attachments = sanitizeAttachments(rawAttachments);

  // In multi-char mode, store who sent the message (user persona name)
  const chat = db.prepare("SELECT character_ids FROM chats WHERE id = ?").get(chatId) as { character_ids: string | null } | undefined;
  let charIds: string[] = [];
  try { charIds = JSON.parse(chat?.character_ids || "[]"); } catch { /* empty */ }
  const isMultiChar = charIds.length > 1;
  const senderName = (persona.name || "").trim() || "User";
  const settings = getSettings();
  const activeProviderId = String(settings.activeProviderId || "").trim();
  const activeProvider = activeProviderId
    ? db.prepare("SELECT * FROM providers WHERE id = ?").get(activeProviderId) as ProviderRow | undefined
    : undefined;
  const userTokenCount = await countProviderTokens(
    activeProvider,
    buildPromptContentWithAttachments(String(content || ""), attachments)
  );

  // Insert user message — with character_name set to user persona name in multi-char mode
  const userId = newId();
  const userTs = now();
  db.prepare(
    "INSERT INTO messages (id, chat_id, branch_id, role, content, attachments, token_count, parent_id, deleted, created_at, character_name, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)"
  ).run(
    userId,
    chatId,
    branchId,
    "user",
    String(content || ""),
    JSON.stringify(attachments),
    userTokenCount,
    null,
    userTs,
    isMultiChar ? senderName : "",
    nextSortOrder(chatId, branchId)
  );

  void autoIngestTextAttachmentsForChat({
    chatId,
    messageId: userId,
    attachments,
    settings: settings as Record<string, unknown>
  });

  // In multi-char mode, pick first responder by mentioned character name (fallback: first in chat order)
  if (isMultiChar && charIds.length > 0) {
    const placeholders = charIds.map(() => "?").join(",");
    const rows = db.prepare(`SELECT id, name FROM characters WHERE id IN (${placeholders})`).all(...charIds) as { id: string; name: string }[];
    const nameById = new Map(rows.map((row) => [row.id, row.name]));
    const orderedNames = charIds
      .map((id) => nameById.get(id))
      .filter((name): name is string => Boolean(name));
    const firstResponder = selectFirstResponderByMention(String(content || ""), orderedNames) ?? orderedNames[0];
    await streamLlmResponse({
      chatId,
      branchId,
      res,
      parentMsgId: userId,
      overrideCharacterName: firstResponder,
      isAutoConvo: false,
      userPersona: persona,
      runtimeSystemPrompt: typeof runtimeSystemPrompt === "string" ? runtimeSystemPrompt : undefined
    });
  } else {
    await streamLlmResponse({
      chatId,
      branchId,
      res,
      parentMsgId: userId,
      isAutoConvo: false,
      userPersona: persona,
      runtimeSystemPrompt: typeof runtimeSystemPrompt === "string" ? runtimeSystemPrompt : undefined
    });
  }
});

router.post("/:id/fork", (req, res) => {
  const chatId = req.params.id;
  const { parentMessageId, name } = req.body;
  if (!parentMessageId) {
    res.status(400).json({ error: "parentMessageId is required" });
    return;
  }

  const branch = forkBranch(chatId, String(parentMessageId), name);
  if (!branch) {
    res.status(404).json({ error: "Parent message not found" });
    return;
  }
  res.json(branch);
});

router.post("/:id/regenerate", async (req, res: Response) => {
  const chatId = req.params.id;
  const { branchId: reqBranchId } = req.body ?? {};
  const branchId = resolveBranch(chatId, reqBranchId);

  // Regenerate must operate on the timeline tail only:
  // - tail assistant -> replace that assistant turn
  // - tail user -> keep history and generate a new assistant reply for that user
  const tail = db.prepare(
    "SELECT * FROM messages WHERE chat_id = ? AND branch_id = ? AND role IN ('user', 'assistant') AND deleted = 0 ORDER BY sort_order DESC, created_at DESC, id DESC LIMIT 1"
  ).get(chatId, branchId) as MessageRow | undefined;

  let parentMsgId: string | null = null;
  let overrideCharacterName: string | undefined;

  if (tail?.role === "assistant") {
    deleteMessageTree(chatId, branchId, tail.id);
    overrideCharacterName = tail.character_name || undefined;
    parentMsgId = tail.parent_id ?? null;
    if (!parentMsgId) {
      const previousUser = db.prepare(
        "SELECT id FROM messages WHERE chat_id = ? AND branch_id = ? AND role = 'user' AND deleted = 0 AND sort_order < ? ORDER BY sort_order DESC, created_at DESC, id DESC LIMIT 1"
      ).get(chatId, branchId, tail.sort_order) as { id: string } | undefined;
      parentMsgId = previousUser?.id ?? null;
    }
  } else if (tail?.role === "user") {
    parentMsgId = tail.id;
  }

  await streamLlmResponse({
    chatId,
    branchId,
    res,
    parentMsgId,
    overrideCharacterName
  });
});

// Multi-character: generate next turn for a specific character
router.post("/:id/next-turn", async (req, res: Response) => {
  const chatId = req.params.id;
  const { characterName, branchId: reqBranchId, isAutoConvo, userName, userPersona, runtimeSystemPrompt } = req.body;
  const branchId = resolveBranch(chatId, reqBranchId);
  const persona: UserPersonaPayload = {
    name: String(userPersona?.name || userName || "User"),
    description: String(userPersona?.description || ""),
    personality: String(userPersona?.personality || ""),
    scenario: String(userPersona?.scenario || "")
  };

  await streamLlmResponse({
    chatId,
    branchId,
    res,
    parentMsgId: null,
    overrideCharacterName: characterName,
    isAutoConvo,
    userPersona: persona,
    runtimeSystemPrompt: typeof runtimeSystemPrompt === "string" ? runtimeSystemPrompt : undefined
  });
});

router.post("/:id/compress", compressChat);

// --- Translate message ---
router.post("/messages/:id/translate", translateMessage);

// --- TTS message (OpenAI-compatible audio/speech) ---
router.post("/messages/:id/tts", ttsMessage);
router.post("/tts", ttsText);

// --- Per-chat sampler config ---
router.patch("/:id/sampler", updateChatSampler);

router.get("/:id/sampler", getChatSampler);

// --- Per-chat active preset ---
router.patch("/:id/preset", updateChatPreset);

router.get("/:id/preset", getChatPreset);

export default router;
