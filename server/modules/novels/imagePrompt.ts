import {resolveImageCast} from "./castMembers.js";
import {normalizeNovelArtStyle} from "../../../src/shared/novelVisualDefaults.js";
import {legacyOutfit,stripClothing} from "./wardrobe.js";
import {canonicalShot} from "./shotPrompt.js";
import type {NovelIllustration,NovelScene,NovelStory} from "../../../src/shared/types/novels.js";
import {protagonistCharacter} from "./protagonist.js";
import {pictureLook} from "./looks.js";

/** Danbooru-style head count ("1girl, 1boy"), which anime models follow far
 * better than "only 2 people". Only when every visible person's sex is clear
 * from their description; otherwise nothing is guessed. */
export function headCountTags(people:Array<{appearance:string;description:string}>) {
  const sexes=people.map(c=>{
    const looks=`${c.appearance} ${c.description}`.toLowerCase();
    const girl=/\b(?:woman|girl|female|lady|she|her)\b|девушк|женщин|девочк/.test(looks), boy=/\b(?:man|boy|male|guy|he|his)\b|парень|мужчин|мальчик|юноша/.test(looks);
    return girl===boy?"":girl?"girl":"boy";
  });
  if(!people.length || sexes.some(s=>!s))return "";
  const girls=sexes.filter(s=>s==="girl").length, boys=sexes.length-girls;
  return [girls?`${girls}girl${girls>1?"s":""}`:"",boys?`${boys}boy${boys>1?"s":""}`:""].filter(Boolean).join(", ");
}

export function novelImagePrompt(story:NovelStory,scene:NovelScene,frame:NovelIllustration) {
  const hero=protagonistCharacter(story);
  const known=[...scene.memory.characters,...story.memory.characters,...story.cast,...(hero?[hero]:[])];
  const mode=story.config.imagePov || "dynamic";
  const camera=mode==="first"?"first-person":mode==="third"?"external":mode==="over-shoulder"?"over-shoulder":frame.camera||"external";
  const first=camera==="first-person",shoulder=camera==="over-shoulder";
  const focus=(mode!=="dynamic"?story.config.imagePovCharacter:undefined) || frame.viewpointCharacterId || story.config.imagePovCharacter || scene.pov || story.config.povCharacter || story.config.protagonist;
  const viewer=(first||shoulder) ? known.find(c=>c.id===focus || c.name.toLocaleLowerCase()===focus?.toLocaleLowerCase()) : undefined;
  const resolved=resolveImageCast(frame,known);
  const cast=resolved.characters.filter(c=>!first || (c.id!==viewer?.id && c.name.toLocaleLowerCase()!==focus?.toLocaleLowerCase()));
  if(shoulder && viewer && !cast.some(c=>c.id===viewer.id))cast.unshift(viewer);
  const characters=cast.map(c=>{
    const outfit=frame.outfits?.[c.id] || scene.visuals?.outfits[c.id] || c.outfit || legacyOutfit(c.appearance||c.description);
    let appearance=pictureLook(c).slice(0,900);
    // The current outfit is stated on its own; clothing left in the card text
    // would be drawn on top of it.
    if(outfit)appearance=stripClothing(appearance);
    return `${c.name} has ${appearance || "their established appearance"}.${outfit?` ${c.name} is wearing ${outfit}.`:""}`;
  });
  const setting=scene.visuals?.setting || scene.location;
  // The narrator's "my hand" means nothing to an outside camera: name them.
  // Through their eyes, hands in the action are drawn as POV hands.
  const second=story.config.pov==="second";
  const pronoun=second?/\b(?:you|your|yours|yourself)\b/gi:/\b(?:I|me|my|mine|myself)\b/g;
  let shot=frame.prompt;
  if(!first && hero && (story.config.pov==="first"||second))shot=shot.replace(pronoun,word=>/^(?:my|mine|your|yours)$/i.test(word)?`${hero.name}'s`:hero.name);
  const povHands=first && new RegExp(`\\b(?:${second?"your":"my"}|the viewer's)\\s+(?:hands?|palms?|fingers?|arms?|wrists?)\\b`,"i").test(frame.prompt);
  return [normalizeNovelArtStyle(story.config.artStyle),
    // Anima reads these literally: "camera view" drew a lens vignette and
    // "speakers" drew loudspeakers. Keep framing in plain picture terms.
    first?(povHands?"pov hands, ":"")+"pov, first-person view through the viewer's eyes. The viewer stays out of the picture; only their hands or forearms may appear when they act. Not a portrait, not an over-the-shoulder view.":shoulder?`Over-the-shoulder view from behind ${viewer?.name||focus||"the viewpoint character"}: their shoulder and the back of their head in the foreground, the action beyond them.`:"Third-person view, seen from a short distance.",
    resolved.references.length?`Follow the shot's visible subjects${frame.subjectNames?.length?`: ${frame.subjectNames.join(', ')}`:''}. Shared cards are reference context, not a request to show every member. Keep unrelated members off screen.`:cast.length===1?`${headCountTags(cast)?`${headCountTags(cast)}, `:""}solo, ${cast[0].name} is the only visible person.`:cast.length>1?`${headCountTags(cast)?`${headCountTags(cast)}. `:""}Only ${cast.length} people are visible: ${cast.map(c=>c.name).join(", ")}. No additional people.`:"no humans, scenery, no visible people.",
    ...characters,...resolved.references.map(c=>`Shared character reference (${c.name}): ${(c.appearance||c.description).slice(0,1600)}${c.outfit?` Clothing reference: ${c.outfit.slice(0,500)}`:''}`), setting?`The scene takes place at ${setting}.`:"",canonicalShot(shot,cast.some(c=>Boolean(scene.visuals?.outfits[c.id] || c.outfit || legacyOutfit(c.appearance||c.description))),Boolean(setting),camera)].filter(Boolean).join("\n\n");
}
