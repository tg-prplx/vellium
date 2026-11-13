import type { NovelCharacter, NovelScene } from "../../../src/shared/types/novels.js";
import { legacyOutfit } from "./wardrobe.js";

/** A person is drawable once they have a short English look. Card prose (long,
 * often not English, without skin tone or build) makes the image model guess
 * anew on every frame, so it does not count. */
export function hasPictureLook(person: Pick<NovelCharacter, "look" | "appearance">) {
  if (person.look) return true;
  const appearance = person.appearance || "";
  return appearance.length > 0 && appearance.length <= 400 && !/[^\x00-\x7F\u2019\u2014]/.test(appearance);
}
/** The text drawn for a person's looks. */
export const pictureLook = (person: Pick<NovelCharacter, "look" | "appearance" | "description">) => person.look || person.appearance || person.description;
/** Clothing known for a person at the end of the saved story, if any. */
export const knownOutfit = (person: NovelCharacter, lastScene?: Pick<NovelScene, "visuals">) =>
  lastScene?.visuals?.outfits[person.id] || person.outfit || legacyOutfit(person.appearance || person.description);
