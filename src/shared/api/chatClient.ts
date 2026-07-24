import type { BranchNode, ChatMessage, ChatSession, FileAttachment, PromptBlock, RagBinding, RpSceneState, SamplerConfig, UserPersona } from "../types/contracts";
import { del, get, patchReq, post, put, requestBlob, streamNdjson, streamPost, type StreamCallbacks } from "./core";

type UserPersonaPayload = Pick<UserPersona, "name" | "description" | "personality" | "scenario">;
export type TtsStreamEvent =
  | { type: "audio"; index: number; contentType: string; audioBase64: string; format?: "pcm"; sampleRate?: number }
  | { type: "done"; count: number }
  | { type: "error"; message: string };
const STREAM_TIMELINE_TIMEOUT_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadTimelineAfterStream(chatId: string, branchId?: string): Promise<ChatMessage[]> {
  let lastError: unknown = null;
  for (const delayMs of [0, 120, 320, 700]) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    try {
      return await get<ChatMessage[]>(
        `/chats/${chatId}/timeline${branchId ? `?branchId=${branchId}` : ""}`,
        { timeoutMs: STREAM_TIMELINE_TIMEOUT_MS }
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Failed to load chat timeline after stream");
}

export const chatClient = {
  chatCreate: (title: string, characterId?: string, characterIds?: string[], lorebookIds?: string[]) =>
    post<ChatSession>("/chats", { title, characterId, characterIds, lorebookIds }),
  chatRename: (chatId: string, title: string) =>
    patchReq<{ ok: boolean; title: string }>(`/chats/${chatId}`, { title }),
  chatAbort: (chatId: string) => post<{ ok: boolean; interrupted: boolean }>(`/chats/${chatId}/abort`),
  chatDelete: (chatId: string) => del<{ ok: boolean }>(`/chats/${chatId}`),
  chatBranches: (chatId: string) => get<BranchNode[]>(`/chats/${chatId}/branches`),
  chatRenameBranch: (chatId: string, branchId: string, name: string) =>
    patchReq<BranchNode>(`/chats/${chatId}/branches/${branchId}`, { name }),
  chatDeleteBranch: (chatId: string, branchId: string) =>
    del<{ ok: true; activeBranchId: string; branches: BranchNode[] }>(`/chats/${chatId}/branches/${branchId}`),
  chatUpdateCharacters: (chatId: string, characterIds: string[]) =>
    patchReq<{ ok: boolean; characterIds: string[]; characterId: string | null }>(`/chats/${chatId}/characters`, { characterIds }),
  chatList: () => get<ChatSession[]>("/chats"),
  chatTimeline: (chatId: string, branchId?: string) =>
    get<ChatMessage[]>(`/chats/${chatId}/timeline${branchId ? `?branchId=${branchId}` : ""}`),
  chatExportJson: (chatId: string, branchId?: string) =>
    requestBlob("GET", `/chats/${chatId}/export/json${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`, undefined, { timeoutMs: 0 }),
  chatNextTurn: async (chatId: string, characterName: string, branchId?: string, callbacks?: StreamCallbacks, isAutoConvo?: boolean, userPersona?: UserPersonaPayload | null): Promise<ChatMessage[]> => {
    if (callbacks) {
      await streamPost(`/chats/${chatId}/next-turn`, { characterName, branchId, isAutoConvo, userPersona }, callbacks);
      return loadTimelineAfterStream(chatId, branchId);
    }
    return post<ChatMessage[]>(`/chats/${chatId}/next-turn`, { characterName, branchId, isAutoConvo, userPersona });
  },
  chatSend: async (chatId: string, content: string, branchId?: string, callbacks?: StreamCallbacks, userPersona?: UserPersonaPayload | null, attachments?: FileAttachment[]): Promise<ChatMessage[]> => {
    if (callbacks) {
      await streamPost(`/chats/${chatId}/send`, { content, branchId, userPersona, attachments }, callbacks);
      return loadTimelineAfterStream(chatId, branchId);
    }
    return post<ChatMessage[]>(`/chats/${chatId}/send`, { content, branchId, userPersona, attachments });
  },
  chatRegenerate: async (chatId: string, branchId?: string, callbacks?: StreamCallbacks): Promise<ChatMessage[]> => {
    if (callbacks) {
      await streamPost(`/chats/${chatId}/regenerate`, { branchId }, callbacks);
      return loadTimelineAfterStream(chatId, branchId);
    }
    return post<ChatMessage[]>(`/chats/${chatId}/regenerate`, { branchId });
  },
  chatCompressContext: (chatId: string, branchId?: string) => post<{ summary: string }>(`/chats/${chatId}/compress`, { branchId }),
  chatFork: (chatId: string, parentMessageId: string, name: string) => post<BranchNode>(`/chats/${chatId}/fork`, { parentMessageId, name }),
  chatEditMessage: (messageId: string, content: string) => patchReq<{ ok: boolean; timeline: ChatMessage[] }>(`/messages/${messageId}`, { content }),
  chatDeleteMessage: (messageId: string) => del<{ ok: boolean; timeline: ChatMessage[] }>(`/messages/${messageId}`),
  chatTranslateMessage: (messageId: string, targetLanguage?: string, signal?: AbortSignal) =>
    post<{ translation: string }>(`/chats/messages/${messageId}/translate`, { targetLanguage }, { timeoutMs: 0, signal }),
  chatTtsMessage: (messageId: string) =>
    requestBlob("POST", `/chats/messages/${messageId}/tts`, undefined, { timeoutMs: 0 }),
  chatTtsText: (input: string) => requestBlob("POST", "/chats/tts", { input }, { timeoutMs: 0 }),
  chatTtsMessageRealtime: (messageId: string, onEvent: (event: TtsStreamEvent) => void | Promise<void>, signal?: AbortSignal) =>
    streamNdjson<TtsStreamEvent>(`/chats/messages/${messageId}/tts/realtime`, {}, onEvent, { timeoutMs: 0, signal }),
  chatTtsTextRealtime: (input: string, onEvent: (event: TtsStreamEvent) => void | Promise<void>, signal?: AbortSignal) =>
    streamNdjson<TtsStreamEvent>("/chats/tts/realtime", { input }, onEvent, { timeoutMs: 0, signal }),
  chatSaveSampler: (chatId: string, samplerConfig: SamplerConfig) => patchReq<{ ok: boolean }>(`/chats/${chatId}/sampler`, { samplerConfig }),
  chatGetSampler: (chatId: string) => get<SamplerConfig | null>(`/chats/${chatId}/sampler`),
  chatSavePreset: (chatId: string, presetId: string | null) => patchReq<{ ok: boolean }>(`/chats/${chatId}/preset`, { presetId }),
  chatGetPreset: (chatId: string) => get<{ presetId: string | null }>(`/chats/${chatId}/preset`),
  chatSaveLorebooks: (chatId: string, lorebookIds: string[]) => patchReq<{ ok: boolean; lorebookId: string | null; lorebookIds: string[] }>(`/chats/${chatId}/lorebook`, { lorebookIds }),
  chatGetLorebooks: (chatId: string) => get<{ lorebookId: string | null; lorebookIds: string[] }>(`/chats/${chatId}/lorebook`),
  chatSaveRag: (chatId: string, enabled: boolean, collectionIds: string[]) => patchReq<RagBinding>(`/chats/${chatId}/rag`, { enabled, collectionIds }),
  chatGetRag: (chatId: string) => get<RagBinding>(`/chats/${chatId}/rag`),
  rpSetSceneState: (state: RpSceneState) => post<void>("/rp/scene-state", state),
  rpGetSceneState: (chatId: string) => get<RpSceneState | null>(`/rp/scene-state/${chatId}`),
  rpUpdateAuthorNote: (chatId: string, authorNote: string) => post<void>("/rp/author-note", { chatId, authorNote }),
  rpGetAuthorNote: (chatId: string) => get<{ authorNote: string }>(`/rp/author-note/${chatId}`),
  rpApplyStylePreset: (chatId: string, presetId: string) => post<{ ok: boolean; sceneState: RpSceneState; presetId: string }>("/rp/apply-preset", { chatId, presetId }),
  rpGetBlocks: (chatId: string) => get<PromptBlock[]>(`/rp/blocks/${chatId}`),
  rpSaveBlocks: (chatId: string, blocks: PromptBlock[]) => put<void>(`/rp/blocks/${chatId}`, { blocks })
};
