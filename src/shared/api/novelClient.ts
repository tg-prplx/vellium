import { get, post, patchReq, del } from "./core";
import type { NovelConfig, NovelStory, NovelSummary } from "../types/novels";
export const novelClient = {
  novelList: () => get<NovelSummary[]>("/novels"),
  novelGet: (id: string) => get<NovelStory>(`/novels/${id}`),
  novelCreate: (title: string, config: NovelConfig) => post<NovelStory>("/novels", { title, config }),
  novelUpdate: (story: NovelStory, patch: { title?: string; config?: Partial<NovelConfig>; cursor?: NovelStory["cursor"] }) => patchReq<NovelStory>(`/novels/${story.id}`, { revision: story.revision, ...patch }),
  novelProgress: (id: string, cursor: NovelStory["cursor"]) => post<NovelStory["cursor"]>(`/novels/${id}/progress`, cursor),
  novelDelete: (id: string) => del<{ ok: boolean }>(`/novels/${id}`),
  novelGenerate: (story: NovelStory, action: string, signal: AbortSignal) => post<NovelStory>(`/novels/${story.id}/generate`, { revision: story.revision, action }, { signal, timeoutMs: 190000 }),
  novelImages: (story: NovelStory, signal: AbortSignal, illustrationId?: string) => post<NovelStory>(`/novels/${story.id}/images`, { revision: story.revision, illustrationId }, { signal, timeoutMs: 26 * 60 * 1000 }),
  novelPrepareImages: (story: NovelStory, signal: AbortSignal) => post<NovelStory>(`/novels/${story.id}/images`, { revision: story.revision, prepareOnly: true }, {signal}),
  novelAbort: (id: string) => post<{ ok: boolean }>(`/novels/${id}/abort`)
};
