import type { NovelAsset, NovelConfig, NovelIllustration, NovelScene, NovelStory } from "../../shared/types/novels";

export const usesLayers = (config: NovelConfig) => config.imagesEnabled && config.generationMode === "lite" && config.visualMode === "layers";

/** Render order matches the server: backgrounds, sprites, then frames. */
export function novelImageQueue(story: NovelStory): Array<NovelIllustration | NovelAsset> {
  return [...Object.values(story.backgrounds || {}), ...Object.values(story.sprites || {}), ...story.scenes.flatMap((scene) => scene.illustrations)];
}

/** Frames in line order, each starting where it was placed. */
export const sceneFrames = (frames: NovelIllustration[]) => [...frames].sort((a, b) => a.atLine - b.atLine);

export interface StageSprite { characterId: string; name: string; url: string; cut: boolean; speaking: boolean; slot: "left" | "center" | "right" }
const SLOTS: Record<number, StageSprite["slot"][]> = { 1: ["center"], 2: ["left", "right"], 3: ["left", "center", "right"] };

/** What the layered stage shows for one line: the background of the scene's
 * place and the ready sprites of the people present, the speaker lit. */
export function stageFor(story: NovelStory, scene: NovelScene | undefined, speaker: string) {
  if (!scene) return { background: "", sprites: [] as StageSprite[] };
  const background = scene.background ? story.backgrounds?.[scene.background] : undefined;
  const ready = (scene.present || []).map((item) => {
    const asset = story.sprites?.[item.sprite];
    const person = scene.memory.characters.find((c) => c.id === item.characterId);
    return asset?.status === "ready" && asset.url ? { characterId: item.characterId, name: person?.name || "", url: asset.url, cut: asset.cut !== false } : null;
  }).filter((item): item is Omit<StageSprite, "speaking" | "slot"> => Boolean(item));
  const voice = speaker.trim().toLocaleLowerCase();
  const sprites = ready.map((item, i) => ({ ...item, speaking: Boolean(voice) && (item.name.toLocaleLowerCase() === voice || item.name.toLocaleLowerCase().split(/\s+/)[0] === voice), slot: SLOTS[ready.length][i] }));
  return { background: background?.status === "ready" && background.url ? background.url : "", sprites };
}
