import {afterEach,expect,it,vi} from "vitest";
import {novelSpeechKey,readNovelSpeechEnabled} from "./useNovelSpeech";
afterEach(()=>vi.unstubAllGlobals());
it("defaults off and never inherits another novel's opt-in",()=>{
 const values=new Map<string,string>();vi.stubGlobal("localStorage",{getItem:(key:string)=>values.get(key)??null});
 expect(readNovelSpeechEnabled("first")).toBe(false);values.set(novelSpeechKey("first"),"on");
 expect(readNovelSpeechEnabled("first")).toBe(true);expect(readNovelSpeechEnabled("second")).toBe(false);
 values.set(novelSpeechKey("first"),"off");expect(readNovelSpeechEnabled("first")).toBe(false);
});
it("keeps automatic speech off when preferences are blocked or malformed",()=>{
 vi.stubGlobal("localStorage",{getItem:()=>{throw Error("blocked");}});expect(readNovelSpeechEnabled("first")).toBe(false);
 vi.stubGlobal("localStorage",{getItem:()=>"unexpected"});expect(readNovelSpeechEnabled("first")).toBe(false);
});
