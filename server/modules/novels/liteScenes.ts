import { randomUUID } from "crypto";
import { MAX_NOVEL_SCENES_PER_TURN, type NovelScene, type NovelStory } from "../../../src/shared/types/novels.js";
import type { LiteBatch } from "./liteFormat.js";
import { text } from "./normalize.js";
import { protagonistName } from "./protagonist.js";
import { novelQuestionPolicy } from "./questionPolicy.js";
import { applyVisualContinuity } from "./visualContinuity.js";

export const knownNames = (story: NovelStory) => [...story.memory.characters, ...story.cast].map((c) => c.name)
  .concat(protagonistName(story).length <= 40 ? [protagonistName(story)] : []).filter(Boolean);
// A move must be backed by real prose, as in JSON mode: cite the first full line.
const moveLine = (scene: Pick<NovelScene, "lines">) => scene.lines.findIndex((line) => line.text.trim().length >= 12);

/** Scene IDs are fixed when a scene first appears in the preview, so the
 * reader (and its speech playback) keeps tracking the same scene on save. */
export function buildLiteScenes(story: NovelStory, batch: LiteBatch, ids: string[] = []): NovelScene[] {
  const c = story.config, policy = novelQuestionPolicy(story);
  const pov = text(c.povCharacter, 160) || story.scenes.at(-1)?.pov || protagonistName(story);
  const scenes: NovelScene[] = batch.scenes.slice(0, MAX_NOVEL_SCENES_PER_TURN).map((scene, i) => ({
    id: ids[i] || randomUUID(), title: scene.location || scene.lines[0].text.slice(0, 60), location: scene.location, pov, lines: scene.lines,
    question: "", choices: [], illustrations: [], memory: story.memory, createdAt: new Date().toISOString() }));
  // The server asked for a decision or it did not; an unrequested one is dropped
  // so the configured cadence holds even when the model offers options anyway.
  if (policy.required) { const last = scenes[scenes.length - 1]; last.question = batch.question; last.choices = batch.choices; }
  applyVisualContinuity(story, scenes, scenes.map((scene) => ({ location: scene.location, locationChange: moveLine(scene) })));
  return scenes;
}
