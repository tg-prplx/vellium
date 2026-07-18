export interface OpenAiCompatibleMessage {
  role: string;
  content: unknown;
  reasoning_content?: string;
}

export function isOfficialOpenAiChatEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(String(baseUrl || "").trim());
    return url.hostname.toLowerCase() === "api.openai.com";
  } catch {
    return false;
  }
}

/** Official Chat Completions does not accept the OpenAI-compatible reasoning_content extension. */
export function prepareOpenAiCompatibleMessages<T extends OpenAiCompatibleMessage>(
  baseUrl: string,
  messages: T[]
): T[] {
  if (!isOfficialOpenAiChatEndpoint(baseUrl)) {
    return messages.map((message) => ({ ...message }));
  }
  return messages.map((message) => {
    const { reasoning_content: _reasoningContent, ...rest } = message;
    return rest as T;
  });
}
