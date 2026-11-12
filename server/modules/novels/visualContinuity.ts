import {legacyOutfit} from "./wardrobe.js";
import {createHash} from "crypto";
import type {NovelScene,NovelStory} from "../../../src/shared/types/novels.js";
import {record,text} from "./normalize.js";

export function visualNoiseSeed(story:NovelStory,scene:NovelScene,shotId="") {
  const location=scene.visuals?.location || scene.location;
  const setting=scene.visuals?.setting || location;
  return createHash("sha256").update(`${story.id}\0${location}\0${setting}\0${scene.id || ""}\0${shotId}`).digest().readUInt32BE(0)&0x7fffffff;
}
/** A model-proposed visual change must cite an actual complete narrative line.
 * Rephrased labels and repeated outfits alone cannot mutate the current anchors. */
function hasSceneChange(scene:NovelScene,value:unknown) {
  // A compact line index cites the same saved prose without echoing it in JSON.
  if(typeof value==='number')return Number.isInteger(value) && value>=0 && (scene.lines[value]?.text.trim().length||0)>=12;
  const change=record(value);
  return Number.isInteger(change.line) && typeof change.line==="number" && change.line>=0 &&
    text(change.quote).length>=12 && scene.lines[change.line]?.text.trim()===text(change.quote);
}
export function applyVisualContinuity(story:NovelStory,scenes:NovelScene[],sources:unknown[]) {
  const prior=story.scenes.at(-1);
  let outfits={...(prior?.visuals?.outfits || {})};
  let location=prior?.visuals?.location || prior?.location || "";
  let setting=prior?.visuals?.setting || location;
  const locations=new Map<string,string>();
  for(const scene of story.scenes)if(scene.visuals?.setting)locations.set((scene.visuals.location||scene.location).trim().toLocaleLowerCase(),scene.visuals.setting);
  for(let i=0;i<scenes.length;i++) {
    const scene=scenes[i],r=record(sources[i]);
    for(const c of scene.memory.characters)if(!outfits[c.id]){const outfit=c.outfit || legacyOutfit(c.appearance||c.description);if(outfit)outfits[c.id]=outfit;}
    for(const [id,value] of Object.entries(record(r.outfits))) {
      if(!scene.memory.characters.some(c=>c.id===id) || typeof value!=="string" || !text(value,500))continue;
      if(!outfits[id] || hasSceneChange(scene,record(r.outfitChanges)[id]))outfits[id]=text(value,500);
    }
    if(!location || hasSceneChange(scene,r.locationChange)) {
      location=scene.location || location;
      const key=location.trim().toLocaleLowerCase();
      setting=locations.get(key) || text(r.setting,900) || location;
      if(key)locations.set(key,setting);
    }
    if((!setting || setting===location) && text(r.setting,900) && (!r.location || text(r.location).toLocaleLowerCase()===location.toLocaleLowerCase())) {
      setting=text(r.setting,900);locations.set(location.trim().toLocaleLowerCase(),setting);
    }
    scene.location=location;
    scene.visuals={location,setting,outfits:{...outfits}};
    // Each planned image needs independent noise. Continuity comes from the
    // explicit visual anchors, not reusing identical noise for different shots.
    for(const frame of scene.illustrations)frame.seed=visualNoiseSeed(story,scene,frame.id);
  }
}
