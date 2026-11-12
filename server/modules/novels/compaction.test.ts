import {expect,it,vi} from "vitest";
import {compactNovelContext,novelCompactionTarget} from "./compaction.js";
import {recentNovelTurns} from "./continuity.js";
import {novelMessages} from "./prompts.js";
import {DEFAULT_NOVEL_CONFIG,type NovelStory} from "../../../src/shared/types/novels.js";
const fixture=(count=10):NovelStory=>({id:"synthetic",title:"Synthetic",config:{...DEFAULT_NOVEL_CONFIG,contextChars:8000},cast:[],memory:{summary:"",facts:[],threads:[],characters:[]},scenes:[],turns:Array.from({length:count},(_,i)=>({user:JSON.stringify({action:`Choice ${i}`}),assistant:JSON.stringify({scenes:[{lines:[{text:`Synthetic event ${i} `+"x".repeat(900)}]}]}),throughSceneId:`scene-${i}`})),cursor:{scene:0,line:0},revision:0,createdAt:"",updatedAt:"",cache:null});
const persist=(story:NovelStory)=>({...story,revision:story.revision+1});
it("does not compact small context and preserves the newest turns when crossing the budget",()=>{
 expect(novelCompactionTarget(fixture(2),1000)).toBe(0);
 const story=fixture();const target=novelCompactionTarget(story,1000);expect(target).toBeGreaterThan(0);expect(target).toBeLessThanOrEqual(8);
});
it("persists bounded incremental summaries without changing history or visual/character anchors",async()=>{
 const story=fixture();const before=JSON.stringify(story);const inputs:string[]=[];
 const target=novelCompactionTarget(story,1000);
 const result=await compactNovelContext(story,target,async input=>{inputs.push(input);return "Synthetic earlier decisions remain relevant.";},persist,new AbortController().signal);
 expect(JSON.stringify(story)).toBe(before);expect(result.turns).toEqual(story.turns);expect(result.memory).toEqual(story.memory);expect(result.scenes).toEqual(story.scenes);
 expect(result.contextCheckpoint?.throughTurn).toBe(target);expect(recentNovelTurns(result)).toHaveLength(story.turns.length-target);expect(inputs.every(input=>!input.includes('illustrations'))).toBe(true);
 const request=novelMessages(result,"");expect(request.messages[0].content).toContain("Synthetic earlier decisions");
 expect(novelCompactionTarget(result,1000+result.contextCheckpoint!.text.length)).toBe(target);
});
it("checkpoints partial oversized turns and resumes after a later failure without resending completed slices",async()=>{
 const story=fixture(1);story.turns[0].assistant=JSON.stringify({scenes:[{lines:[{text:"a".repeat(14000)}]}]});
 let saved=story,calls=0;
 await expect(compactNovelContext(story,1,async()=>{if(++calls===2)throw Error("synthetic failure");return "Synthetic summary";},next=>saved=persist(next),new AbortController().signal)).rejects.toThrow("synthetic failure");
 expect(saved.contextCheckpoint?.throughTurn).toBe(0);expect(saved.contextCheckpoint?.turnOffset).toBeGreaterThan(0);
 const input=vi.fn(async(_input:string)=>"Synthetic summary after resume");const done=await compactNovelContext(saved,1,input,persist,new AbortController().signal);
 expect(done.contextCheckpoint?.throughTurn).toBe(1);expect(done.contextCheckpoint?.turnOffset).toBeUndefined();
 expect(JSON.parse(input.mock.calls[0]?.[0]||'{}').earlierEvents).toBe("Synthetic summary");
});
it("does not advance a checkpoint after empty output or cancellation",async()=>{
 const story=fixture(3),save=vi.fn(persist);
 await expect(compactNovelContext(story,1,async()=>"",save,new AbortController().signal)).rejects.toThrow("no summary");expect(save).not.toHaveBeenCalled();
 const controller=new AbortController();await expect(compactNovelContext(story,1,async()=>{controller.abort();return "summary";},save,controller.signal)).rejects.toThrow();expect(save).not.toHaveBeenCalled();
});
