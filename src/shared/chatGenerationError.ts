/** Recognize old server-generated failure rows without confusing user text with errors. */
export function isLegacyChatFailure(message: { role: string; content: string }): boolean {
  return message.role === "assistant" && /^\[Error\]\s/.test(message.content);
}

export function describeChatGenerationError(raw: string) {
  const details = raw.replace(/^Error:\s*/, "").replace(/^\[Error\]\s*/, "");
  const address = details.match(/attempted address:\s*([^,\s)]+)/i)?.[1];
  const url = details.match(/https?:\/\/[^\s)]+/i)?.[0];
  let endpoint = address || "";
  if (!endpoint && url) {
    try { endpoint = new URL(url).host; } catch { /* Show a generic summary for malformed URLs. */ }
  }
  const timeoutMs = Number(details.match(/timeout:\s*(\d+)\s*(?:ms)?/i)?.[1]);
  const status = Number(details.match(/\[API Error:\s*(\d{3})\]|\bstatus(?: code)?:?\s*(\d{3})\b/i)?.slice(1).find(Boolean));
  return {
    details,
    contextBudgetExceeded: /^Context budget exceeded\./i.test(details),
    endpoint,
    timeoutSeconds: timeoutMs > 0 ? Math.round(timeoutMs / 100) / 10 : null,
    timedOut: /timeout|timed out|ETIMEDOUT/i.test(details),
    connectionFailed: /fetch failed|failed to fetch|ECONNREFUSED|network error|ENOTFOUND/i.test(details),
    authFailed: status === 401 || status === 403 || /invalid_api_key|authentication_error|incorrect api key|unauthorized/i.test(details),
    modelMissing: /model_not_found|model[^.]{0,80}(?:not found|does not exist|not available)/i.test(details),
    providerMessage: extractProviderMessage(details)
  };
}

const PROVIDER_MESSAGE_MAX = 160;

/** The human sentence inside a provider's JSON error body, if there is one. */
function extractProviderMessage(details: string): string {
  const start = details.indexOf("{");
  if (start < 0) return "";
  try {
    const parsed = JSON.parse(details.slice(start, details.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const error = parsed.error;
    const candidate = typeof error === "string" ? error
      : (error && typeof error === "object" ? (error as Record<string, unknown>).message : undefined) ?? parsed.message ?? parsed.detail;
    if (typeof candidate !== "string") return "";
    const message = candidate.replace(/\s+/g, " ").trim();
    return message.length > PROVIDER_MESSAGE_MAX ? `${message.slice(0, PROVIDER_MESSAGE_MAX - 1)}…` : message;
  } catch {
    return "";
  }
}
