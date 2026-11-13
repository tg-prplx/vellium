import type { NovelPreviewScene, NovelScene, NovelStory } from "../../shared/types/novels";

/** Show streamed scenes after the saved ones. They have no pictures or choices
 * yet; the saved story replaces them, keeping the same scene IDs. */
export function withPreviewScenes(story: NovelStory, preview: NovelPreviewScene[]): NovelStory {
  const known = new Set(story.scenes.map((scene) => scene.id));
  const pov = story.scenes[story.scenes.length - 1]?.pov || story.config.povCharacter || story.config.protagonist;
  // A scene without its own `##` line stays where the story already is, as it will once saved.
  let location = story.scenes[story.scenes.length - 1]?.location || "";
  const scenes: NovelScene[] = preview.filter((scene) => !known.has(scene.id) && scene.lines.length).map((scene) => {
    location = scene.location || location;
    return { id: scene.id, title: scene.location || scene.lines[0].text.slice(0, 60), location, pov, lines: scene.lines,
      question: "", choices: [], illustrations: [], memory: story.memory, createdAt: "" };
  });
  return scenes.length ? { ...story, scenes: [...story.scenes, ...scenes] } : story;
}
