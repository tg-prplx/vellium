import type { NovelStory } from "../../../src/shared/types/novels.js";
import { retrieveRagContextForCollections } from "../../services/rag.js";

export const NOVEL_REFERENCE_LIMIT = 1500;

/** Search the story's knowledge collections with the reader's action and the
 * last lines of the story. Retrieval honours the RAG service's own provider
 * and local-only checks; a failed search never blocks the turn. */
export async function novelReference(story: NovelStory, action: string, settings: Record<string, unknown>) {
  const ids = story.config.ragEnabled ? story.config.ragCollectionIds || [] : [];
  if (!ids.length) return "";
  const recent = story.scenes.at(-1)?.lines.slice(-2).map((line) => line.text).join(" ") || story.config.premise;
  try {
    const result = await retrieveRagContextForCollections({ collectionIds: ids, queryText: `${action} ${recent}`.trim().slice(0, 2000), settings });
    return result.context.replace(/\s+\n/g, "\n").trim().slice(0, NOVEL_REFERENCE_LIMIT);
  } catch { return ""; }
}
