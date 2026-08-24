export interface SharedChatContext {
  chatId: string;
  personaId: string;
  branchId: string;
  revision?: string;
}

export const CHAT_CONTEXT_FOR_LIVE_EVENT = "chat-context-for-live";
export const LIVE_CHAT_CONTEXT_CHANGED_EVENT = "live-chat-context-changed";
export const LIVE_REQUEST_CHAT_CONTEXT_EVENT = "live-request-chat-context";

export function normalizeSharedChatContext(value: Partial<SharedChatContext> | null | undefined): SharedChatContext {
  return {
    chatId: typeof value?.chatId === "string" ? value.chatId : "",
    personaId: typeof value?.personaId === "string" ? value.personaId : "",
    branchId: typeof value?.branchId === "string" ? value.branchId : "",
    revision: typeof value?.revision === "string" ? value.revision : undefined
  };
}

export function dispatchSharedChatContext(
  eventName: typeof CHAT_CONTEXT_FOR_LIVE_EVENT | typeof LIVE_CHAT_CONTEXT_CHANGED_EVENT,
  context: Partial<SharedChatContext>
) {
  window.dispatchEvent(new CustomEvent(eventName, {
    detail: normalizeSharedChatContext(context)
  }));
}
