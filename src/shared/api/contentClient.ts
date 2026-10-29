import type { CharacterDetail, FileAttachment, LoreBook, RagBinding, RagCollection, RagDocument, RagIngestResult, UserPersona } from "../types/contracts";
import { notifyAfterCharacterCatalogMutation } from "../characterCatalog";
import { notifyAfterDataCatalogMutation } from "../dataCatalog";
import { del, get, patchReq, post, put, requestBlob } from "./core";

export const contentClient = {
  characterList: () => get<CharacterDetail[]>("/characters"),
  characterReorder: (characterIds: string[]) => notifyAfterCharacterCatalogMutation(
    patchReq<CharacterDetail[]>("/characters/reorder", { characterIds })
  ),
  characterGet: (id: string) => get<CharacterDetail>(`/characters/${id}`),
  characterImportV2: (rawJson: string) => notifyAfterCharacterCatalogMutation(
    post<CharacterDetail>("/characters/import", { rawJson })
  ),
  characterTranslateCopy: (id: string, targetLanguage?: string, signal?: AbortSignal) =>
    notifyAfterCharacterCatalogMutation(
      post<CharacterDetail>(`/characters/${id}/translate-copy`, { targetLanguage }, { timeoutMs: 0, signal })
    ),
  characterValidateV2: (rawJson: string) => post<{ valid: boolean; errors: string[] }>("/characters/validate", { rawJson }),
  characterUpdate: (id: string, data: Partial<CharacterDetail>) => notifyAfterCharacterCatalogMutation(
    put<CharacterDetail>(`/characters/${id}`, data)
  ),
  characterDelete: (id: string) => notifyAfterCharacterCatalogMutation(del<void>(`/characters/${id}`)),
  characterExportJson: (id: string) => requestBlob("GET", `/characters/${id}/export/json`),
  characterUploadAvatar: (id: string, base64Data: string, filename: string) => notifyAfterCharacterCatalogMutation(
    post<{ avatarUrl: string }>(`/characters/${id}/avatar`, { base64Data, filename })
  ),
  lorebookList: () => get<LoreBook[]>("/lorebooks"),
  lorebookGet: (id: string) => get<LoreBook>(`/lorebooks/${id}`),
  lorebookCreate: (data: Partial<LoreBook>) => notifyAfterDataCatalogMutation("lorebooks", post<LoreBook>("/lorebooks", data)),
  lorebookImportWorldInfo: (data: unknown) => notifyAfterDataCatalogMutation("lorebooks", post<LoreBook>("/lorebooks/import/world-info", { data })),
  lorebookTranslateCopy: (id: string, targetLanguage?: string, signal?: AbortSignal) => notifyAfterDataCatalogMutation(
    "lorebooks",
    post<LoreBook>(`/lorebooks/${id}/translate-copy`, { targetLanguage }, { timeoutMs: 0, signal })
  ),
  lorebookUpdate: (id: string, data: Partial<LoreBook>) => notifyAfterDataCatalogMutation("lorebooks", put<LoreBook>(`/lorebooks/${id}`, data)),
  lorebookDelete: (id: string) => notifyAfterDataCatalogMutation("lorebooks", del<{ ok: boolean }>(`/lorebooks/${id}`)),
  lorebookExportWorldInfo: (id: string) => requestBlob("GET", `/lorebooks/${id}/export/world-info`),
  ragCollectionList: () => get<RagCollection[]>("/rag/collections"),
  ragCollectionCreate: (data: { name: string; description?: string; scope?: "global" | "chat" | "writer" }) =>
    notifyAfterDataCatalogMutation("ragCollections", post<RagCollection>("/rag/collections", data)),
  ragCollectionUpdate: (id: string, data: { name?: string; description?: string; scope?: "global" | "chat" | "writer" }) =>
    notifyAfterDataCatalogMutation("ragCollections", patchReq<RagCollection>(`/rag/collections/${id}`, data)),
  ragCollectionDelete: (id: string) => notifyAfterDataCatalogMutation("ragCollections", del<{ ok: boolean; id: string }>(`/rag/collections/${id}`)),
  ragDocumentList: (collectionId: string) => get<RagDocument[]>(`/rag/collections/${collectionId}/documents`),
  ragIngestDocument: (collectionId: string, payload: {
    title: string;
    text: string;
    sourceType?: string;
    sourceId?: string | null;
    metadata?: Record<string, unknown>;
    force?: boolean;
  }) => post<RagIngestResult>(`/rag/collections/${collectionId}/documents`, payload),
  ragDocumentDelete: (documentId: string) => del<{ ok: boolean; id: string }>(`/rag/documents/${documentId}`),
  personaList: () => get<UserPersona[]>("/personas"),
  personaCreate: (data: Partial<UserPersona>) => notifyAfterDataCatalogMutation("personas", post<UserPersona>("/personas", data)),
  personaUpdate: (id: string, data: Partial<UserPersona>) => notifyAfterDataCatalogMutation("personas", put<UserPersona>(`/personas/${id}`, data)),
  personaDelete: (id: string) => notifyAfterDataCatalogMutation("personas", del<void>(`/personas/${id}`)),
  personaSetDefault: (id: string) => notifyAfterDataCatalogMutation("personas", post<{ ok: boolean }>(`/personas/${id}/set-default`)),
  uploadFile: (base64Data: string, filename: string) => post<FileAttachment>("/upload", { base64Data, filename })
};
