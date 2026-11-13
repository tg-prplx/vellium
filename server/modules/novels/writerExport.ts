import { db, newId } from "../../db.js";
import type { NovelStory } from "../../../src/shared/types/novels.js";
import { DEFAULT_PROJECT_NOTES } from "../writer/defs.js";
import { createChapterRecord, createGeneratedSceneRecord, createProjectRecord } from "../writer/repository.js";
import { text } from "./normalize.js";

const SCENES_PER_CHAPTER = 5;
const prose = (lines: NovelStory["scenes"][number]["lines"]) => lines.map((line) => line.speaker ? `${line.speaker}: ${line.text}` : line.text).join("\n\n");

/** Copy a novel's prose into a new Writer project: a chapter per five scenes,
 * one Writer scene per novel scene, in story order. The novel is not changed. */
export function exportNovelToWriter(story: NovelStory) {
  if (!story.scenes.length) throw Object.assign(new Error("The story has no scenes to export yet"), { status: 400 });
  const projectId = newId(), name = text(story.title, 160) || "Novel", start = Date.now();
  // Writer lists scenes by creation time; distinct, increasing stamps keep story order.
  let tick = 0;
  const stamp = () => new Date(start + tick++).toISOString();
  const characterIds = story.config.characterIds.filter((id) => db.prepare("SELECT 1 FROM characters WHERE id = ?").get(id));
  let chapters = 0;
  db.transaction(() => {
    createProjectRecord({ id: projectId, name, description: text(story.config.premise, 2000), characterIds, notes: { ...DEFAULT_PROJECT_NOTES, premise: text(story.config.premise, 4000) }, createdAt: stamp() });
    for (let i = 0; i < story.scenes.length; i += SCENES_PER_CHAPTER) {
      const group = story.scenes.slice(i, i + SCENES_PER_CHAPTER), chapterId = newId();
      createChapterRecord({ id: chapterId, projectId, title: text(group[0].title || group[0].location, 200) || `Chapter ${chapters + 1}`, createdAt: stamp() });
      chapters++;
      for (const scene of group) createGeneratedSceneRecord({ id: newId(), chapterId, title: text(scene.title || scene.location, 200) || "Scene", content: prose(scene.lines), createdAt: stamp() });
    }
  })();
  return { projectId, name, chapters, scenes: story.scenes.length };
}
