import {normalizeNovelArtStyle} from "../../../src/shared/novelVisualDefaults.js";
import {legacyOutfit} from "./wardrobe.js";
import {canonicalShot} from "./shotPrompt.js";
import type {NovelIllustration,NovelScene,NovelStory} from "../../../src/shared/types/novels.js";

export function novelImagePrompt(story:NovelStory,scene:NovelScene,frame:NovelIllustration) {
  const known=[...scene.memory.characters,...story.memory.characters,...story.cast];
  const first=story.config.pov==="first" || (story.config.pov==="dynamic" && frame.camera==="first-person");
  const focus=frame.viewpointCharacterId || story.config.povCharacter || scene.pov || story.config.protagonist;
  const viewer=first ? known.find(c=>c.id===focus || c.name.toLocaleLowerCase()===focus?.toLocaleLowerCase()) : undefined;
  const cast=[...new Set(frame.characterIds)].filter(id=>id!==viewer?.id).map(id=>known.find(c=>c.id===id)).filter(c=>!!c);
  const characters=cast.map(c=>{
    const outfit=scene.visuals?.outfits[c.id] || c.outfit || legacyOutfit(c.appearance||c.description);
    let appearance=(c.appearance||c.description).slice(0,900);
    if(outfit) {
      appearance=appearance.replace(/\b(?:wearing|dressed in)\b.*$/i,"").split(",").filter(part=>! /\b(?:bikini|swimsuit|coat|jacket|dress|shirt|skirt|shorts|trousers|pants|boots|sandals|bra|panties|stockings|hat)\b/i.test(part)).join(",").trim();
    }
    return `${c.name} has ${appearance || "their established appearance"}.${outfit?` ${c.name} is wearing ${outfit}.`:""}`;
  });
  const setting=scene.visuals?.setting || scene.location;
  return [normalizeNovelArtStyle(story.config.artStyle),
    first?"pov, first-person view. The image is seen directly through the viewpoint character's eyes. The viewpoint character stays behind the camera; only hands or forearms involved in the described action may enter the foreground. This is not an external portrait or an over-the-shoulder shot.":"An external camera view of the described scene.",
    ...characters, setting?`The scene takes place at ${setting}.`:"",canonicalShot(frame.prompt,cast.some(c=>Boolean(scene.visuals?.outfits[c.id] || c.outfit || legacyOutfit(c.appearance||c.description))),Boolean(setting))].filter(Boolean).join("\n\n");
}
