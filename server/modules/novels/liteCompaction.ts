import type { NovelStory } from "../../../src/shared/types/novels.js";
import type { UnifiedGenerateMessage } from "../../services/unifiedGeneration.js";
import { novelCheckpoint } from "./contextCheckpoint.js";
import { liteContextMessages } from "./litePrompt.js";
import { writeNovel } from "./repository.js";

export const LITE_SUMMARY_LIMIT = 1600;

export function liteCompactionInstruction(language: string) {
  return `[Technical task. Do not continue the story.]
Summarise everything that has happened so far in ${language}, at most 1400 characters: decisions, promises, discoveries, relationships, in order. Plain prose, no lists, no JSON.`;
}

/** Summarise old turns as a continuation of the cached context: the request
 * starts with the same system message and history the provider already holds,
 * so only the instruction is new. The summary replaces turns before `target`. */
export async function compactLiteContext(story: NovelStory, target: number, summarize: (messages: UnifiedGenerateMessage[]) => Promise<string>, signal: AbortSignal) {
  const checkpoint = novelCheckpoint(story), start = checkpoint?.throughTurn || 0;
  if (target <= start) return story;
  const context = liteContextMessages(story);
  const messages = [...context.slice(0, 1 + 2 * (target - start)), { role: "user", content: liteCompactionInstruction(story.config.language) }];
  const result = (await summarize(messages)).trim();
  signal.throwIfAborted();
  if (!result) throw new Error("Context compaction returned no summary. Nothing was discarded; retry explicitly.");
  return writeNovel({ ...story, contextCheckpoint: { text: result.slice(0, LITE_SUMMARY_LIMIT), throughTurn: target, updatedAt: new Date().toISOString(), passes: (checkpoint?.passes || 0) + 1 } }, story.revision);
}
