import { estimateTokens } from "../../../src/shared/tokenEstimate.js";
import type { ContextSection, ContextSource } from "../../../src/shared/types/chatContext.js";
import { replacePromptPlaceholders } from "../../domain/rpEngine.js";
import { buildPromptContentWithAttachments } from "./attachments.js";
import { inlineRpReasoningHistory } from "./rpReasoning.js";
import type { MessageAttachmentPayload } from "./routeHelpers.js";

export function promptText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap(part => part && typeof part === "object" && typeof part.text === "string" ? [part.text] : []).join("\n");
}

export function accountContext(
  messages: Array<{ role: string; content: unknown; reasoning_content?: string }>,
  hints: Array<{ source: ContextSource; text: string }>,
  timeline: Array<{ content: string; reasoningContent?: string; attachments?: MessageAttachmentPayload[] }>,
  inlineReasoning: boolean,
  charName?: string,
  userName?: string
) {
  const sections: ContextSection[] = [];
  const add = (source: ContextSource, text: string) => {
    if (!text.trim()) return;
    const existing = sections.find(section => section.source === source);
    if (existing) { existing.text += `\n\n${text}`; existing.tokens += estimateTokens(text); }
    else sections.push({ source, text, tokens: estimateTokens(text) });
  };
  const splitHints = (text: string, candidates: typeof hints, fallback: ContextSource) => {
    let rest = text;
    for (const hint of candidates) {
      const value = hint.text.trim();
      const at = value ? rest.indexOf(value) : -1;
      if (at < 0) continue;
      add(hint.source, value);
      rest = rest.slice(0, at) + rest.slice(at + value.length);
    }
    add(fallback, rest.trim());
  };
  const historyHints: typeof hints = [];
  for (const row of timeline) {
    const attachmentText = buildPromptContentWithAttachments("", row.attachments || []).trim();
    if (attachmentText) historyHints.push({ source: "attachments", text: replacePromptPlaceholders(attachmentText, charName, userName) });
    if (inlineReasoning && row.reasoningContent) historyHints.push({ source: "reasoning", text: replacePromptPlaceholders(inlineRpReasoningHistory("", row.reasoningContent).content.trim(), charName, userName) });
  }
  for (const message of messages) {
    splitHints(promptText(message.content), message.role === "system" ? hints : historyHints, message.role === "system" ? "instructions" : "history");
    if (message.reasoning_content) add("reasoning", message.reasoning_content);
  }
  // An estimate of role separators and the reply prefix; never count image base64 as text.
  sections.push({ source: "formatting", text: "", tokens: messages.length * 4 + 2 });
  return { sections, inputTokens: sections.reduce((sum, section) => sum + section.tokens, 0),
    hasImages: messages.some(message => Array.isArray(message.content) && message.content.some(part => part?.type === "image_url")) };
}
