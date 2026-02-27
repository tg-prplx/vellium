import type { CharacterDetail, ChatMessage, ChatSession, ProviderProfile, UserPersona } from "../../shared/types/contracts";
import { REASONING_CALL_NAME } from "./constants";
import { parseToolCallContent, type ParsedToolCallContent } from "./utils";

export interface GroupedToolMessage {
  id: string;
  createdAt: string;
  payload: ParsedToolCallContent;
}

export function groupToolMessages(messages: ChatMessage[]) {
  const toolGrouped = new Map<string, GroupedToolMessage[]>();
  const reasoningGrouped = new Map<string, GroupedToolMessage[]>();

  for (const msg of messages) {
    if (msg.role !== "tool") continue;
    const parentId = String(msg.parentId || "").trim();
    if (!parentId) continue;
    const payload = parseToolCallContent(msg.content);
    const target = payload.name === REASONING_CALL_NAME ? reasoningGrouped : toolGrouped;
    const bucket = target.get(parentId) || [];
    bucket.push({
      id: msg.id,
      createdAt: msg.createdAt,
      payload
    });
    target.set(parentId, bucket);
  }

  const byTime = (a: GroupedToolMessage, b: GroupedToolMessage) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

  for (const [key, bucket] of toolGrouped.entries()) {
    toolGrouped.set(key, [...bucket].sort(byTime));
  }
  for (const [key, bucket] of reasoningGrouped.entries()) {
    reasoningGrouped.set(key, [...bucket].sort(byTime));
  }

  return {
    toolGrouped,
    reasoningGrouped
  };
}

export function buildActivePersonaPayload(activePersona: UserPersona | null, fallbackName: string) {
  if (!activePersona) return null;
  return {
    name: activePersona.name || fallbackName,
    description: activePersona.description || "",
    personality: activePersona.personality || "",
    scenario: activePersona.scenario || ""
  };
}

export function resolveActiveProviderType(providers: ProviderProfile[], chatProviderId: string) {
  const provider = providers.find((item) => item.id === chatProviderId);
  return provider?.providerType || "openai";
}

export function filterChatsByQuery(chats: ChatSession[], query: string, characters: CharacterDetail[]) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return chats;
  return chats.filter((chat) => {
    const ids = chat.characterIds?.length ? chat.characterIds : (chat.characterId ? [chat.characterId] : []);
    const names = ids
      .map((id) => characters.find((item) => item.id === id)?.name || "")
      .filter(Boolean)
      .join(" ");
    const haystack = `${chat.title} ${names}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function calcSimpleHomeComposerWidth(simpleHomeState: boolean, input: string, attachmentCount: number) {
  if (!simpleHomeState) return "100%";
  const draftLen = Math.max(input.trim().length, 0);
  const width = Math.min(92, 58 + Math.ceil(draftLen / 7) + (attachmentCount > 0 ? 6 : 0));
  return `${Math.max(58, width)}%`;
}
