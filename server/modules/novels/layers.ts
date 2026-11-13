import { createHash, randomUUID } from "crypto";
import type { NovelAsset, NovelCharacter, NovelConfig, NovelScene, NovelStory } from "../../../src/shared/types/novels.js";
import { normalizeNovelArtStyle } from "../../../src/shared/novelVisualDefaults.js";
import { legacyOutfit, stripClothing } from "./wardrobe.js";
import { protagonistName } from "./protagonist.js";
import { pictureLook } from "./looks.js";

/** Layers mode composes a background per place and a sprite per person and
 * outfit. Who is on screen is derived from the prose; no model call is needed. */
export const SPRITE_WIDTH = 832, SPRITE_HEIGHT = 1216, MAX_PRESENT = 3;
export const layersEnabled = (config: NovelConfig) => config.imagesEnabled && config.generationMode === "lite" && config.visualMode === "layers";

const fold = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const backgroundKey = (location: string) => fold(location) || "unknown place";
export const spriteKey = (characterId: string, outfit: string) => `${characterId}:${createHash("sha256").update(fold(outfit)).digest("hex").slice(0, 12)}`;

function mentions(textValue: string, name: string) {
  const words = ` ${fold(textValue)} `, target = fold(name);
  return Boolean(target) && words.includes(` ${target} `);
}
function viewpoint(story: NovelStory) {
  if (story.config.pov !== "first" && story.config.pov !== "second") return undefined;
  const name = fold(story.config.povCharacter || protagonistName(story));
  return name ? story.memory.characters.find((c) => fold(c.name) === name) : undefined;
}

/** People on screen: speakers and people named in narration, in order of first
 * appearance, at most three. The narrator in first/second person is the camera. */
export function scenePresence(story: NovelStory, scene: Pick<NovelScene, "lines">): NovelCharacter[] {
  const people = story.memory.characters.filter((c) => !c.isGroup && c.name.trim());
  const hidden = viewpoint(story);
  const found: NovelCharacter[] = [];
  for (const line of scene.lines) {
    for (const person of people) {
      if (found.includes(person) || person.id === hidden?.id) continue;
      const first = person.name.trim().split(/\s+/)[0];
      const named = fold(line.speaker) === fold(person.name) || (first.length >= 3 && fold(line.speaker) === fold(first))
        || mentions(line.text, person.name) || (first.length >= 3 && mentions(line.text, first));
      if (named) found.push(person);
    }
    if (found.length >= MAX_PRESENT) break;
  }
  return found.slice(0, MAX_PRESENT);
}

const outfitOf = (scene: NovelScene, person: NovelCharacter) => scene.visuals?.outfits[person.id] || person.outfit || legacyOutfit(person.appearance || person.description) || "";
/** Style presets end in background tags; a sprite needs a plain backdrop. */
const spriteStyle = (style: string) => style.replace(/,?\s*(?:detailed|minimalist|simple) background/gi, "").replace(/\s+,/g, ",").trim();
function bareAppearance(person: NovelCharacter, outfit: string) {
  let appearance = pictureLook(person).slice(0, 900);
  if (outfit) appearance = stripClothing(appearance);
  return appearance;
}

export function backgroundPrompt(story: NovelStory, scene: NovelScene) {
  const setting = scene.visuals?.setting || scene.location;
  return [normalizeNovelArtStyle(story.config.artStyle), "no humans, scenery, wide shot, empty scene.", setting ? `The scene takes place at ${setting}.` : "", "No people, no characters, no figures."].filter(Boolean).join("\n\n");
}
/** A saturated chroma-key backdrop the character does not wear. Grey or white
 * backdrops merge with pale hair and clothes. Measured on Anima 1.1 turbo:
 * plain "green"/"blue" come out muted or near-grey, "vivid …" and "magenta"
 * come out saturated (chroma 140-190), which the cut-out separates cleanly. */
const BACKDROPS = [
  { colour: "vivid green", clash: /\b(?:green|emerald|olive|lime|jade|mint|teal|зелён|зелен)/i },
  { colour: "vivid blue", clash: /\b(?:blue|navy|azure|cyan|teal|sapphire|indigo|син|голуб)/i },
  { colour: "magenta", clash: /\b(?:pink|magenta|purple|violet|lilac|fuchsia|rose|розов|фиолет)/i }
] as const;
export function spriteBackdrop(person: NovelCharacter, outfit: string) {
  const description = `${person.appearance || person.description} ${outfit}`;
  return (BACKDROPS.find((backdrop) => !backdrop.clash.test(description)) || BACKDROPS[0]).colour;
}
export function spritePrompt(story: NovelStory, person: NovelCharacter, outfit: string) {
  const appearance = bareAppearance(person, outfit), backdrop = spriteBackdrop(person, outfit);
  return [spriteStyle(normalizeNovelArtStyle(story.config.artStyle)), `solo, cowboy shot, standing, looking at viewer, straight-on, simple background, ${backdrop} background.`,
    `${person.name} has ${appearance || "their established appearance"}.${outfit ? ` ${person.name} is wearing ${outfit}.` : ""}`,
    `Plain flat ${backdrop} background, no scenery, no other people, no shadow on the background.`].join("\n\n");
}

const seedOf = (story: NovelStory, key: string) => createHash("sha256").update(`${story.id}\0${key}`).digest().readUInt32BE(0) & 0x7fffffff;
function asset(story: NovelStory, kind: NovelAsset["kind"], key: string, prompt: string, width: number, height: number, characterId?: string): NovelAsset {
  return { id: randomUUID(), kind, prompt, seed: seedOf(story, `${kind}:${key}`), url: null, status: "pending", width, height, ...(characterId ? { characterId } : {}) };
}

/** Mark who and where for the newest scenes and queue any background or
 * sprite not rendered yet. Existing assets are reused, never replaced. */
export function registerLayerAssets(story: NovelStory, count: number): NovelStory {
  const backgrounds = { ...(story.backgrounds || {}) }, sprites = { ...(story.sprites || {}) };
  const scenes = story.scenes.slice(-count).map((scene) => {
    const key = backgroundKey(scene.location);
    if (!backgrounds[key]) backgrounds[key] = asset(story, "background", key, backgroundPrompt(story, scene), story.config.width, story.config.height);
    const present = scenePresence(story, scene).map((person) => {
      const outfit = outfitOf(scene, person), sprite = spriteKey(person.id, outfit);
      if (!sprites[sprite]) sprites[sprite] = asset(story, "sprite", sprite, spritePrompt(story, person, outfit), SPRITE_WIDTH, SPRITE_HEIGHT, person.id);
      return { characterId: person.id, sprite };
    });
    return { ...scene, background: key, present };
  });
  return { ...story, backgrounds, sprites, scenes: [...story.scenes.slice(0, -count), ...scenes] };
}
