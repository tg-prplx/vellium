import type { Request, Response } from "express";
import { isLocalhostUrl } from "../../db.js";
import { getProviderRow } from "../../services/providerStore.js";
import { contextBranch } from "./contextHandlers.js";
import { completeProviderOnce } from "./providerExecution.js";
import { getSettings, getTimeline, type ProviderRow } from "./routeHelpers.js";

/**
 * Opt-in "quick replies": after a character reply, the active model proposes a
 * few short messages the user could send next. Disabled by default because
 * every suggestion round is an extra billable model request.
 */
export const REPLY_SUGGESTION_COUNT = 3;
const HISTORY_MESSAGES = 12;
const MESSAGE_CHARS = 1500;
const TRANSCRIPT_CHARS = 8000;
const SUGGESTION_CHARS = 280;
const TIMEOUT_MS = 45_000;

export const REPLY_SUGGESTIONS_SYSTEM_PROMPT = [
  "Reply suggestions task.",
  "You help the user of an interactive chat or roleplay decide what to say next.",
  `Write exactly ${REPLY_SUGGESTION_COUNT} different short messages that {{user}} could send next in reply to {{char}}.`,
  "Write them in {{user}}'s voice and in the same language as the conversation; one or two sentences each.",
  "Make them meaningfully different: for example an in-character action, a question, and a line that moves the story forward.",
  "Never continue as {{char}} and never add commentary.",
  "Output only a JSON array of strings."
].join("\n");

function stripReasoning(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "").trim();
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Accepts a JSON array or a plain list; returns at most REPLY_SUGGESTION_COUNT unique, bounded strings. */
export function parseReplySuggestions(raw: string): string[] {
  const text = stripReasoning(String(raw || ""));
  let items: unknown[] = [];
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      items = [];
    }
  }
  if (items.length === 0) {
    items = text.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ""));
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const value = clip(item.replace(/^["“«']+|["”»']+$/g, "").replace(/\s+/g, " ").trim(), SUGGESTION_CHARS);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= REPLY_SUGGESTION_COUNT) break;
  }
  return result;
}

export async function suggestReplies(req: Request, res: Response) {
  const settings = getSettings() as ReturnType<typeof getSettings> & { replySuggestionsEnabled?: boolean };
  if (settings.replySuggestionsEnabled !== true) {
    res.status(409).json({ error: "Reply suggestions are disabled" });
    return;
  }
  const branchId = contextBranch(req, res);
  if (!branchId) return;
  const chatId = String(req.params.id);
  const timeline = getTimeline(chatId, branchId)
    .filter((message) => (message.role === "user" || message.role === "assistant") && String(message.content || "").trim());
  const last = timeline[timeline.length - 1];
  if (!last || last.role !== "assistant") {
    res.json({ messageId: last?.id ?? null, suggestions: [] });
    return;
  }

  const provider = settings.activeProviderId ? getProviderRow<ProviderRow>(settings.activeProviderId) : undefined;
  const modelId = settings.activeModel;
  if (!provider || !modelId) {
    res.status(400).json({ error: "Select a provider and model first" });
    return;
  }
  if ((settings.fullLocalMode || provider.full_local_only) && !isLocalhostUrl(provider.base_url)) {
    res.status(403).json({ error: "Provider blocked by Full Local Mode" });
    return;
  }

  const userName = String(req.body?.userName || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80) || "User";
  const charName = String(last.characterName || "").trim().slice(0, 80) || "Character";
  let transcript = timeline.slice(-HISTORY_MESSAGES)
    .map((message) => `${message.role === "user" ? userName : String(message.characterName || charName)}: ${clip(stripReasoning(String(message.content)), MESSAGE_CHARS)}`)
    .join("\n\n");
  if (transcript.length > TRANSCRIPT_CHARS) transcript = transcript.slice(-TRANSCRIPT_CHARS);
  const systemPrompt = REPLY_SUGGESTIONS_SYSTEM_PROMPT.replaceAll("{{user}}", userName).replaceAll("{{char}}", charName);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Reply suggestions timed out")), TIMEOUT_MS);
  const abortOnClose = () => { if (!res.writableEnded) controller.abort(new Error("Client closed the request")); };
  res.on("close", abortOnClose);
  try {
    const raw = await completeProviderOnce({
      provider,
      modelId,
      systemPrompt,
      userPrompt: `Conversation:\n\n${transcript}\n\nNow write the ${REPLY_SUGGESTION_COUNT} suggested messages for ${userName} as a JSON array.`,
      samplerConfig: { temperature: 0.9, maxTokens: 400 },
      apiParamPolicy: settings.apiParamPolicy,
      signal: controller.signal
    });
    res.json({ messageId: last.id, suggestions: parseReplySuggestions(raw) });
  } catch (error) {
    if (controller.signal.aborted && res.writableEnded) return;
    if (!res.headersSent) res.status(502).json({ error: error instanceof Error ? error.message : "Reply suggestions failed" });
  } finally {
    clearTimeout(timeout);
    res.off("close", abortOnClose);
  }
}
