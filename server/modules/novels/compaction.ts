import type {NovelStory} from "../../../src/shared/types/novels.js";
import {continuityTurn} from "./continuity.js";
import {novelCheckpoint} from "./contextCheckpoint.js";
import {readSceneJson} from "./sceneJson.js";
import {record} from "./normalize.js";

export function novelCompactionTarget(story:NovelStory,overhead:number) {
  const checkpoint=novelCheckpoint(story),start=checkpoint?.throughTurn || 0;
  const budget=story.config.contextChars-overhead-(checkpoint?0:1600)-256;
  if(budget<512)throw new Error("Novel context limit is too small for the world and character data. Increase the context budget.");
  const sizes=story.turns.slice(start).map(t=>continuityTurn(t.user).length+continuityTurn(t.assistant).length);
  if(sizes.reduce((a,b)=>a+b,0)<=budget*.9 && !checkpoint?.turnOffset)return start;
  let used=0,keep=0;
  for(const size of [...sizes].reverse()){
    if(used+size>budget*(keep<2?.8:.55))break;
    used+=size;keep++;
  }
  return Math.max(start+(checkpoint?.turnOffset?1:0),story.turns.length-keep);
}
function narrativeTurn(story:NovelStory,index:number) {
  const turn=story.turns[index];let action=turn.user;
  try{action=String(record(readSceneJson(turn.user)).action||"");}catch{/* Legacy plaintext action. */}
  try{
    const raw=readSceneJson(turn.assistant),root=record(raw);
    const scenes=Array.isArray(raw)?raw:Array.isArray(root.scenes)?root.scenes:[root];
    return JSON.stringify({readerAction:action,scenes:scenes.map(v=>{const s=record(v);return {location:s.location,lines:s.lines??s.dialogue??s.dialogues,question:s.question,choices:s.choices};})});
  }catch{return JSON.stringify({readerAction:action,response:turn.assistant});}
}
export async function compactNovelContext(story:NovelStory,target:number,
  summarize:(input:string)=>Promise<string>,persist:(story:NovelStory)=>NovelStory,signal:AbortSignal) {
  let current=story;
  const limit=Math.max(1000,Math.min(16000,story.config.contextChars-4500));
  while((novelCheckpoint(current)?.throughTurn||0)<target){
    signal.throwIfAborted();
    const checkpoint=novelCheckpoint(current);let turn=checkpoint?.throughTurn||0,offset=checkpoint?.turnOffset||0;
    const parts:string[]=[];let used=0;
    while(turn<target && used<limit){
      const narrative=narrativeTurn(current,turn);
      const part=narrative.slice(offset,offset+limit-used);parts.push(part);used+=part.length;offset+=part.length;
      if(offset>=narrative.length){turn++;offset=0;}else break;
    }
    const result=(await summarize(JSON.stringify({earlierEvents:checkpoint?.text||"",olderNarrative:parts}))).trim();
    signal.throwIfAborted();if(!result)throw new Error("Context compaction returned no summary. Nothing was discarded; retry explicitly.");
    current=persist({...current,contextCheckpoint:{text:result.slice(0,1600),throughTurn:turn,...(offset?{turnOffset:offset}:{}),updatedAt:new Date().toISOString(),passes:(checkpoint?.passes||0)+1}});
  }
  return current;
}
