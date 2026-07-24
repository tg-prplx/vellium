export const RP_REASONING_SYSTEM_PROMPT = `Before every response, write a reasoning block inside <think>...</think> tags.

Inside the block, briefly analyze the user's message: what they wrote, the tone and mood of the message, and what they actually want to get as a response. If the message contains slang, references, or ambiguous parts, decode them for yourself in your own words. Then decide how you will respond: what the main point is, and what tone and length would fit. You may have your own opinion on the topic, and it does not have to match the user's opinion.

Write the reasoning in first person, in natural language, roughly 2-5 sentences. It is a draft of a thought, not a formal report.

Immediately after </think>, write the actual response. The response follows the plan from the reasoning but does not retell it word for word. Never skip the reasoning block, even if the message is short.`;

export const RP_REASONING_TURN_GUARD = `[Mandatory format for the next assistant turn]
Start the response with exactly <think>. Write the required 2-5 sentence first-person reasoning draft, then close it with </think> and immediately write the actual reply. Emit no text before <think>. This requirement applies on every turn, even if an earlier assistant message omitted the block.`;

interface PromptMessage {
  role: string;
  content: unknown;
}

export function inlineRpReasoningHistory(content: string, reasoningContent?: string): {
  content: string;
  reasoningContent?: string;
} {
  const reasoning = String(reasoningContent || "").trim();
  if (!reasoning) return { content };
  return {
    content: `<think>\n${reasoning}\n</think>\n\n${content}`
  };
}

/**
 * Reassert the simulated-reasoning format after the complete prompt stack has
 * been assembled. Keeping the guard at the end of the one leading system
 * message gives it turn-level recency without mutating or adding a user row.
 */
export function appendRpReasoningTurnGuard<T extends PromptMessage>(messages: T[]): T[] {
  const systemIndex = messages.findIndex((message) => message.role === "system");
  if (systemIndex < 0) {
    return [{ role: "system", content: RP_REASONING_TURN_GUARD } as T, ...messages.map((message) => ({ ...message }))];
  }

  return messages.map((message, index) => {
    if (index !== systemIndex) return { ...message };
    const content = typeof message.content === "string"
      ? message.content.trim()
      : String(message.content ?? "").trim();
    const contentWithoutExistingGuard = content
      .split(RP_REASONING_TURN_GUARD)
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n");
    return {
      ...message,
      content: [contentWithoutExistingGuard, RP_REASONING_TURN_GUARD].filter(Boolean).join("\n\n")
    };
  });
}
