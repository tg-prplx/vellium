import {visualNoiseSeed} from "./visualContinuity.js";
import {randomUUID} from "crypto";
import type {NovelStory,NovelScene} from "../../../src/shared/types/novels.js";

/** Text can survive a truncated JSON tail with no image plan. Recover a single
 * establishing shot locally, without another text-model request or new events. */
export function ensureSceneIllustration(scene:NovelScene) {
  if(scene.illustrations.length || !scene.lines.length)return false;
  const characterIds=scene.memory.characters.filter(c=>scene.lines.some(line=>line.speaker.toLocaleLowerCase()===c.name.toLocaleLowerCase())).map(c=>c.id);
  scene.illustrations.push({id:randomUUID(),prompt:"An establishing view of the current scene. Eye-level framing shows the surroundings and the visible characters.",characterIds,atLine:0,seed:Math.floor(Math.random()*2147483647),url:null,status:"pending"});
  return true;
}
export function prepareNovelIllustrations(story:NovelStory) {
  let changed=false;
  for(const scene of story.scenes)if(ensureSceneIllustration(scene)){
    scene.illustrations[0].seed=visualNoiseSeed(story,scene);changed=true;
  }
  return changed;
}
