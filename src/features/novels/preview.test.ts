import { describe, expect, it } from "vitest";
import { DEFAULT_NOVEL_CONFIG, type NovelStory } from "../../shared/types/novels";
import { withPreviewScenes } from "./preview";

const story = { id: "s", title: "Synthetic", config: DEFAULT_NOVEL_CONFIG, cast: [], memory: { summary: "", facts: [], threads: [], characters: [] },
  scenes: [{ id: "a", title: "A", location: "Test hall", pov: "Tester", lines: [{ speaker: "", text: "Saved line." }], question: "", choices: [], illustrations: [], memory: { summary: "", facts: [], threads: [], characters: [] }, createdAt: "" }],
  turns: [], cursor: { scene: 0, line: 0 }, revision: 1, createdAt: "", updatedAt: "", cache: null } as NovelStory;

describe("streamed preview scenes", () => {
  it("appends new scenes without pictures or choices and keeps their IDs", () => {
    const view = withPreviewScenes(story, [{ id: "b", location: "Test pier", lines: [{ speaker: "Mira", text: "Synthetic reply." }] }]);
    expect(view.scenes.map((scene) => scene.id)).toEqual(["a", "b"]);
    expect(view.scenes[1]).toMatchObject({ location: "Test pier", pov: "Tester", choices: [], illustrations: [] });
    expect(view.revision).toBe(1);
  });
  it("keeps the current place for a scene without its own header", () => {
    const view = withPreviewScenes(story, [{ id: "b", location: "", lines: [{ speaker: "", text: "Still here." }] }, { id: "c", location: "Test pier", lines: [{ speaker: "", text: "Moved." }] }, { id: "d", location: "", lines: [{ speaker: "", text: "Still on the pier." }] }]);
    expect(view.scenes.slice(1).map((scene) => scene.location)).toEqual(["Test hall", "Test pier", "Test pier"]);
  });
  it("ignores empty and already saved scenes", () => {
    expect(withPreviewScenes(story, [{ id: "a", location: "", lines: [{ speaker: "", text: "Dup." }] }, { id: "c", location: "", lines: [] }])).toBe(story);
  });
});
