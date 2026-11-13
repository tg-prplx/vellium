import { get, post, patchReq, del, streamNdjson } from "./core";
import { notifyAfterDataCatalogMutation } from "../dataCatalog";
import type { NovelConfig, NovelStory, NovelSummary, NovelStreamEvent } from "../types/novels";
const TEXT_TIMEOUT_MS = 20 * 60 * 1000;
export const novelClient = {
  novelPromptPreview: (config:Partial<NovelConfig>)=>post<{defaultPrompt:string}>("/novels/prompt-preview",{config}),
  novelList: () => get<NovelSummary[]>("/novels"),
  novelGet: (id: string) => get<NovelStory>(`/novels/${id}`),
  novelCreate: (title: string, config: NovelConfig) => post<NovelStory>("/novels", { title, config }),
  novelUpdate: (story: NovelStory, patch: { title?: string; config?: Partial<NovelConfig>; cursor?: NovelStory["cursor"] }) => patchReq<NovelStory>(`/novels/${story.id}`, { revision: story.revision, ...patch }),
  novelProgress: (id: string, cursor: NovelStory["cursor"]) => post<NovelStory["cursor"]>(`/novels/${id}/progress`, cursor),
  novelReset: (story:NovelStory)=>post<NovelStory>(`/novels/${story.id}/reset`,{revision:story.revision}),
  novelDelete: (id: string) => del<{ ok: boolean }>(`/novels/${id}`),
  novelGenerate: (story: NovelStory, action: string, signal: AbortSignal) => post<NovelStory>(`/novels/${story.id}/generate`, { revision: story.revision, action }, { signal, timeoutMs: TEXT_TIMEOUT_MS }),
  /** Lite stories: streams `preview` scenes while the model writes, then `done`. */
  novelGenerateStream: (story: NovelStory, action: string, onEvent: (event: NovelStreamEvent) => void, signal: AbortSignal) => streamNdjson<NovelStreamEvent>(`/novels/${story.id}/generate-stream`, { revision: story.revision, action }, onEvent, { signal, timeoutMs: 0 }),
  novelImages: (story: NovelStory, signal: AbortSignal, illustrationId?: string) => post<NovelStory>(`/novels/${story.id}/images`, { revision: story.revision, illustrationId }, { signal, timeoutMs: 26 * 60 * 1000 }),
  novelPrepareImages: (story: NovelStory, signal: AbortSignal) => post<NovelStory>(`/novels/${story.id}/images`, { revision: story.revision, prepareOnly: true }, {signal}),
  /** User-started only: new description and/or seed, then render that picture again. */
  novelEditImage: (story: NovelStory, imageId: string, patch: { prompt?: string; reseed?: boolean }) => patchReq<NovelStory>(`/novels/${story.id}/illustrations/${imageId}`, { revision: story.revision, ...patch }),
  novelAddFrame: (story: NovelStory, sceneId: string, atLine: number, prompt: string) => post<{ story: NovelStory; frameId: string }>(`/novels/${story.id}/illustrations`, { revision: story.revision, sceneId, atLine, prompt }),
  novelComfyCheck: (config: Pick<NovelConfig, "comfyUrl" | "workflow" | "positiveNode" | "negativeNode">) => post<{ reachable: boolean; workflowOk: boolean; positiveNode?: string; negativeNode?: string; error?: string }>("/novels/comfy-check", { config }, { timeoutMs: 15000 }),
  /** Start a lite novel from a chat branch; the chat is not changed. */
  novelFromChat: (chatId: string, branchId?: string) => post<NovelStory>("/novels/from-chat", { chatId, branchId }),
  /** Continue a novel as an ordinary chat with the same cast. */
  novelToChat: (id: string) => post<{ chatId: string; title: string }>(`/novels/${id}/to-chat`),
  /** Copy the novel's prose into a new Writer project. */
  novelExportWriter: (id: string) => notifyAfterDataCatalogMutation("writerProjects", post<{ projectId: string; name: string; chapters: number; scenes: number }>(`/novels/${id}/export-writer`)),
  novelAbort: (id: string) => post<{ ok: boolean }>(`/novels/${id}/abort`)
};
