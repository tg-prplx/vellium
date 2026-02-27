import type { BranchNode, ChatMessage, ChatSession, FileAttachment, PromptBlock, RagBinding, RpSceneState, SamplerConfig, UserPersona } from "../types/contracts";
import { del, get, patchReq, post, put, requestBlob, streamPost, type StreamCallbacks } from "./core";

type UserPersonaPayload = Pick<UserPersona, "name" | "description" | "personality" | "scenario">;

export const chatClient = {
  chatCreate: (title: string, characterId?: string, characterIds?: string[]) =>
    post<ChatSession>("/chats", { title, characterId, characterIds }),
  chatRename: (chatId: string, title: string) =>
    patchReq<{ ok: boolean; title: string }>(`/chats/${chatId}`, { title }),
  chatAbort: (chatId: string) => post<{ ok: boolean; interrupted: boolean }>(`/chats/${chatId}/abort`),
  chatDelete: (chatId: string) => del<{ ok: boolean }>(`/chats/${chatId}`),
  chatBranches: (chatId: string) => get<BranchNode[]>(`/chats/${chatId}/branches`),
  chatUpdateCharacters: (chatId: string, characterIds: string[]) =>
    patchReq<{ ok: boolean; characterIds: string[]; characterId: string | null }>(`/chats/${chatId}/characters`, { characterIds }),
  chatList: () => get<ChatSession[]>("/chats"),
  chatTimeline: (chatId: string, branchId?: string) =>
    get<ChatMessage[]>(`/chats/${chatId}/timeline${branchId ? `?branchId=${branchId}` : ""}`),
  chatNextTurn: async (chatId: string, characterName: string, branchId?: string, callbacks?: StreamCallbacks, isAutoConvo?: boolean, userPersona?: UserPersonaPayload | null): Promise<ChatMessage[]> => {
    if (callbacks) {
      await streamPost(`/chats/${chatId}/next-turn`, { characterName, branchId, isAutoConvo, userPersona }, callbacks);
      return chatClient.chatTimeline(chatId, branchId);
    }
    return post<ChatMessage[]>(`/chats/${chatId}/next-turn`, { characterName, branchId, isAutoConvo, userPersona });
  },
  chatSend: async (chatId: string, content: string, branchId?: string, callbacks?: StreamCallbacks, userPersona?: UserPersonaPayload | null, attachments?: FileAttachment[]): Promise<ChatMessage[]> => {
    if (callbacks) {
      await streamPost(`/chats/${chatId}/send`, { content, branchId, userPersona, attachments }, callbacks);
      return chatClient.chatTimeline(chatId, branchId);
    }
    return post<ChatMessage[]>(`/chats/${chatId}/send`, { content, branchId, userPersona, attachments });
  },
  chatRegenerate: async (chatId: string, branchId?: string, callbacks?: StreamCallbacks): Promise<ChatMessage[]> => {
    if (callbacks) {
      await streamPost(`/chats/${chatId}/regenerate`, { branchId }, callbacks);
      return chatClient.chatTimeline(chatId, branchId);
    }
    return post<ChatMessage[]>(`/chats/${chatId}/regenerate`, { branchId });
  },
  chatCompressContext: (chatId: string, branchId?: string) => post<{ summary: string }>(`/chats/${chatId}/compress`, { branchId }),
  chatFork: (chatId: string, parentMessageId: string, name: string) => post<BranchNode>(`/chats/${chatId}/fork`, { parentMessageId, name }),
  chatEditMessage: (messageId: string, content: string) => patchReq<{ ok: boolean; timeline: ChatMessage[] }>(`/messages/${messageId}`, { content }),
  chatDeleteMessage: (messageId: string) => del<{ ok: boolean; timeline: ChatMessage[] }>(`/messages/${messageId}`),
  chatTranslateMessage: (messageId: string, targetLanguage?: string) => post<{ translation: string }>(`/chats/messages/${messageId}/translate`, { targetLanguage }),
  chatTtsMessage: (messageId: string) => requestBlob("POST", `/chats/messages/${messageId}/tts`),
  chatSaveSampler: (chatId: string, samplerConfig: SamplerConfig) => patchReq<{ ok: boolean }>(`/chats/${chatId}/sampler`, { samplerConfig }),
  chatGetSampler: (chatId: string) => get<SamplerConfig | null>(`/chats/${chatId}/sampler`),
  chatSavePreset: (chatId: string, presetId: string | null) => patchReq<{ ok: boolean }>(`/chats/${chatId}/preset`, { presetId }),
  chatGetPreset: (chatId: string) => get<{ presetId: string | null }>(`/chats/${chatId}/preset`),
  chatSaveLorebook: (chatId: string, lorebookId: string | null) => patchReq<{ ok: boolean; lorebookId: string | null }>(`/chats/${chatId}/lorebook`, { lorebookId }),
  chatGetLorebook: (chatId: string) => get<{ lorebookId: string | null }>(`/chats/${chatId}/lorebook`),
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
