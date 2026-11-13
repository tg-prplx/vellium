import {layersEnabled} from "./layers.js";
import {visualNoiseSeed} from "./visualContinuity.js";
import {randomUUID} from "crypto";
import type {NovelStory,NovelScene} from "../../../src/shared/types/novels.js";

/** Text can survive a truncated JSON tail with no image plan. Recover a single
 * establishing shot locally, without another text-model request or new events. */
export function ensureSceneIllustration(scene:NovelScene) {
  if(scene.illustrations.length || !scene.lines.length)return false;
  const characterIds:string[]=[];
  const views=["Wide establishing composition.","Eye-level view from the side of the established space.","Medium environmental framing with foreground depth."];
  const view=views[Array.from(scene.id||scene.title||"scene").reduce((sum,c)=>sum+c.charCodeAt(0),0)%views.length];
  scene.illustrations.push({id:randomUUID(),prompt:`${view} An unoccupied environmental establishing shot shows only the surroundings; no people are visible.`,characterIds,atLine:0,seed:Math.floor(Math.random()*2147483647),url:null,status:"pending"});
  return true;
}
export function prepareNovelIllustrations(story:NovelStory) {
  // Layers mode draws backgrounds and sprites; scenes need no frame of their own.
  if(layersEnabled(story.config))return false;
  let changed=false;
  for(const scene of story.scenes)if(ensureSceneIllustration(scene)){
    scene.illustrations[0].seed=visualNoiseSeed(story,scene,scene.illustrations[0].id);changed=true;
  }
  return changed;
}
