import type { Request, Response } from "express";
import { db } from "../../db.js";
import { buildChatContext } from "./buildChatContext.js";
import { getContextConfig, normalizeContextConfig, saveContextConfig } from "./contextConfig.js";
import { tokenizeContext, koboldContext } from "./contextTokenization.js";
import { normalizeProviderType } from "../../services/providerApi.js";
import { getTimeline, type ProviderRow } from "./routeHelpers.js";
import { sanitizeAttachments, selectFirstResponderByMention } from "./attachments.js";
import { activeAbortControllers } from "./chatOrchestrator.js";
import type { ChatContextPreview } from "../../../src/shared/types/chatContext.js";

/** Resolve only an existing branch belonging to this chat; previews never create data. */
export function contextBranch(req: Request, res: Response): string | null {
  const chatId = String(req.params.id);
  const requested = req.body?.branchId;
  if (requested !== undefined && requested !== null && (typeof requested !== "string" || requested.length > 100)) {
    res.status(400).json({ error: "Invalid branch ID" });
    return null;
  }
  const row = requested
    ? db.prepare("SELECT id FROM branches WHERE id = ? AND chat_id = ?").get(requested, chatId)
    : db.prepare("SELECT id FROM branches WHERE chat_id = ? ORDER BY created_at ASC LIMIT 1").get(chatId);
  if (!row) { res.status(404).json({ error: "Chat branch not found" }); return null; }
  return (row as { id: string }).id;
}

export async function previewChatContext(req: Request, res: Response) {
  const branchId = contextBranch(req, res);
  if (!branchId) return;
  try {
    const content = typeof req.body?.draft === "string" ? req.body.draft.slice(0, 100000) : "";
    const names = db.prepare("SELECT character_ids, character_id FROM chats WHERE id = ?").get(req.params.id) as { character_ids?: string; character_id?: string };
    let ids: string[] = [];
    try { ids = JSON.parse(names.character_ids || "[]"); } catch { /* Legacy single-character chat. */ }
    if (!ids.length && names.character_id) ids = [names.character_id];
    const cards = ids.flatMap(id => { const card = db.prepare("SELECT name FROM characters WHERE id = ?").get(id) as { name: string } | undefined; return card ? [card] : []; });
    const context = await buildChatContext({ chatId: String(req.params.id), branchId,
      draft: { content, attachments: sanitizeAttachments(req.body?.attachments) },
      userPersona: req.body?.userPersona, liveAvatar: req.body?.liveAvatar,
      overrideCharacterName: ids.length > 1 ? selectFirstResponderByMention(content, cards.map(card => card.name)) ?? cards[0]?.name : undefined
    });
    const provider = context.providerId ? db.prepare("SELECT * FROM providers WHERE id = ?").get(context.providerId) as ProviderRow | undefined : undefined;
    const hasTools = context.settings.toolCallingEnabled && context.settings.mcpAutoAttachTools !== false && context.settings.mcpServers.length > 0;
    const counted = provider && !context.hasImages && !hasTools ? await tokenizeContext(provider, context.messages, context.samplerConfig, context.settings.apiParamPolicy) : null;
    const inputTokens = counted ?? context.inputTokens;
    const result: ChatContextPreview = {
      branchId, model: context.modelId || null, config: context.config,
      effective: { contextWindowSize: context.contextWindowBudget, maxMessages: context.maxMessages, includeReasoning: context.includeReasoning, summary: context.contextSummary },
      inputTokens, reservedOutputTokens: context.reservedOutputTokens,
      availableTokens: Math.max(0, context.contextWindowBudget - inputTokens - context.reservedOutputTokens),
      overBudget: inputTokens + context.reservedOutputTokens > context.contextWindowBudget,
      countSource: counted === null ? "estimate" : "tokenizer",
      transport: provider && normalizeProviderType(provider.provider_type) === "koboldcpp" ? koboldContext(context.messages, context.samplerConfig, context.settings.apiParamPolicy) : undefined, sections: context.sections, history: context.history,
      messages: context.messages.map(message => ({ ...message, content: Array.isArray(message.content) ? message.content.map(part => part.type === "image_url" ? { type: "image_url", image_url: { url: "[image]" } } : part) : message.content })),
      hasImages: context.hasImages, hasTools,
      lastGeneration: [...getTimeline(String(req.params.id), branchId)].reverse().find(message => message.role === "assistant" && message.generationStats)?.generationStats
    };
    res.json(result);
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Context preview failed" }); }
}

export function updateChatContext(req: Request, res: Response) {
  const branchId = contextBranch(req, res);
  if (!branchId) return;
  const chatId = String(req.params.id);
  if (activeAbortControllers.has(chatId)) { res.status(409).json({ error: "Wait for generation to finish before changing context" }); return; }
  const config = req.body?.reset === true ? {} : normalizeContextConfig({ ...getContextConfig(chatId, branchId), ...req.body?.config });
  const ids = new Set((db.prepare("SELECT id FROM messages WHERE chat_id = ? AND branch_id = ? AND role IN ('user', 'assistant')").all(chatId, branchId) as { id: string }[]).map(message => message.id));
  if (Array.isArray(req.body?.config?.excludedMessageIds) && req.body.config.excludedMessageIds.some((id: unknown) => typeof id !== "string" || !ids.has(id))) { res.status(400).json({ error: "Excluded messages must belong to this branch" }); return; }
  if (config.excludedMessageIds) config.excludedMessageIds = config.excludedMessageIds.filter(id => ids.has(id));
  saveContextConfig(chatId, branchId, config);
  res.json({ config });
}
