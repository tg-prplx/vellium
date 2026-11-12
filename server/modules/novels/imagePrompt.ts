import {resolveImageCast} from "./castMembers.js";
import {normalizeNovelArtStyle} from "../../../src/shared/novelVisualDefaults.js";
import {legacyOutfit} from "./wardrobe.js";
import {canonicalShot} from "./shotPrompt.js";
import type {NovelIllustration,NovelScene,NovelStory} from "../../../src/shared/types/novels.js";

export function novelImagePrompt(story:NovelStory,scene:NovelScene,frame:NovelIllustration) {
  const known=[...scene.memory.characters,...story.memory.characters,...story.cast];
  const mode=story.config.imagePov || "dynamic";
  const camera=mode==="first"?"first-person":mode==="third"?"external":mode==="over-shoulder"?"over-shoulder":frame.camera||"external";
  const first=camera==="first-person",shoulder=camera==="over-shoulder";
  const focus=(mode!=="dynamic"?story.config.imagePovCharacter:undefined) || frame.viewpointCharacterId || story.config.imagePovCharacter || scene.pov || story.config.povCharacter || story.config.protagonist;
  const viewer=(first||shoulder) ? known.find(c=>c.id===focus || c.name.toLocaleLowerCase()===focus?.toLocaleLowerCase()) : undefined;
  const resolved=resolveImageCast(frame,known);
  const cast=resolved.characters.filter(c=>!first || (c.id!==viewer?.id && c.name.toLocaleLowerCase()!==focus?.toLocaleLowerCase()));
  if(shoulder && viewer && !cast.some(c=>c.id===viewer.id))cast.unshift(viewer);
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
    first?"pov, first-person view. The image is seen directly through the viewpoint character's eyes. The viewpoint character stays behind the camera; only hands or forearms involved in the described action may enter the foreground. This is not an external portrait or an over-the-shoulder shot.":shoulder?`Over-the-shoulder camera view from behind ${viewer?.name||focus||"the viewpoint character"}. Their shoulder and back of the head may occupy the foreground; frame the action beyond them. The camera is outside their body, not through their eyes.`:"Third-person view. An external camera view of the described scene observes the action from outside. The protagonist may be visible when included in the shot.",
    resolved.references.length?`Follow the shot's visible subjects${frame.subjectNames?.length?`: ${frame.subjectNames.join(', ')}`:''}. Shared cards are reference context, not a request to show every member. Keep unrelated members off screen.`:cast.length===1?`Solo framing: ${cast[0].name} is the only visible person. Other speakers remain off screen.`:cast.length>1?`Only ${cast.length} people are visible: ${cast.map(c=>c.name).join(", ")}. No additional people.`:"Environment or object shot, no visible people or background figures.",
    ...characters,...resolved.references.map(c=>`Shared character reference (${c.name}): ${(c.appearance||c.description).slice(0,1600)}${c.outfit?` Clothing reference: ${c.outfit.slice(0,500)}`:''}`), setting?`The scene takes place at ${setting}.`:"",canonicalShot(frame.prompt,cast.some(c=>Boolean(scene.visuals?.outfits[c.id] || c.outfit || legacyOutfit(c.appearance||c.description))),Boolean(setting),camera)].filter(Boolean).join("\n\n");
}
