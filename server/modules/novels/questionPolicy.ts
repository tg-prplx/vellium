import type {NovelStory} from '../../../src/shared/types/novels.js';
const intervals={off:1000000,rare:4,balanced:2,frequent:1};
export function questionCooldown(story:Pick<NovelStory,'config'|'scenes'>){
 let last=-1;story.scenes.forEach((scene,index)=>{if(scene.question||scene.choices.length)last=index;});
 return Math.max(0,intervals[story.config.questionFrequency]-(story.scenes.length-last));
}
export function novelQuestionPolicy(story:Pick<NovelStory,'config'|'scenes'>){
 const earliestSceneOffset=questionCooldown(story);
 const enabled=story.config.questionFrequency!=='off';
 const maxScenes=enabled?Math.min(story.config.scenesPerTurn,earliestSceneOffset+1):story.config.scenesPerTurn;
 return {frequency:story.config.questionFrequency,earliestSceneOffset,required:enabled&&earliestSceneOffset<maxScenes,maxScenes};
}
