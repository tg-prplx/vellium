import { roughTokenCount } from "../../db/utils.js";

const REASONING_CALL_NAME = "__reasoning__";

interface TimelineMessage {
  id: string;
  role: string;
  content: string;
  parentId?: string | null;
  tokenCount?: number;
}

export type ReasoningAwareMessage<T extends TimelineMessage> = T & {
  reasoningContent?: string;
};

export function extractStoredReasoning(content: string): string {
  try {
    const parsed = JSON.parse(String(content || "")) as {
      kind?: unknown;
      name?: unknown;
      result?: unknown;
    };
    if (parsed.kind !== "tool_call" || parsed.name !== REASONING_CALL_NAME) return "";
    return typeof parsed.result === "string" ? parsed.result.trim() : "";
  } catch {
    return "";
  }
}

export function buildReasoningAwareTimeline<T extends TimelineMessage>(
  timeline: T[],
  includeReasoning: boolean
): Array<ReasoningAwareMessage<T>> {
  const reasoningByParent = new Map<string, string[]>();
  if (includeReasoning) {
    for (const message of timeline) {
      if (message.role !== "tool" || !message.parentId) continue;
      const reasoning = extractStoredReasoning(message.content);
      if (!reasoning) continue;
      const values = reasoningByParent.get(message.parentId) ?? [];
      values.push(reasoning);
      reasoningByParent.set(message.parentId, values);
    }
  }

  return timeline
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const reasoningContent = message.role === "assistant"
        ? reasoningByParent.get(message.id)?.join("\n\n").trim()
        : "";
      if (!reasoningContent) return { ...message };
      return {
        ...message,
        reasoningContent,
        tokenCount: roughTokenCount(`${message.content}\n${reasoningContent}`)
      };
    });
}
