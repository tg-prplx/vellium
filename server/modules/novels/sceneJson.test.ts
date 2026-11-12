import { describe, expect, it } from "vitest";
import { readSceneJson } from "./sceneJson.js";
import { parseNovelBatch } from "./prompts.js";
import { DEFAULT_NOVEL_CONFIG, type NovelStory } from "../../../src/shared/types/novels.js";
const story = (): NovelStory => ({ id:"synthetic", title:"Test", config:{...DEFAULT_NOVEL_CONFIG}, cast:[],memory:{summary:"Existing canon",facts:["Existing fact"],threads:[],characters:[]},scenes:[],turns:[],cursor:{scene:0,line:0},revision:0,createdAt:"",updatedAt:"",cache:null });
const scene = { title:"Synthetic scene", lines:[{speaker:"Tester",text:'Keep punctuation: },] and "quoted" text.'},{speaker:"Narrator",text:"Another completed line."}],illustrations:[] };
describe("local scene JSON recovery", () => {
  it("keeps completed scenes when the response is cut in a later scene", () => {
    const raw = '{"scenes":['+JSON.stringify(scene)+',{"title":"Next scene","lines":[{"speaker":"Tester","text":"Unfinished';
    const parsed = parseNovelBatch(raw, story());
    expect(parsed).toHaveLength(1);expect(parsed[0].lines).toEqual(scene.lines);
    expect(parsed[0].memory.summary).toBe("Existing canon");
  });
  it("keeps completed lines in the first scene without inventing the cut-off line", () => {
    const raw = '{"scenes":[{"title":"Test","lines":['+JSON.stringify(scene.lines[0])+',{"speaker":"Tester","text":"Cut off';
    expect(parseNovelBatch(raw,story())[0].lines).toEqual([scene.lines[0]]);
  });
  it("does not drop completed scenes if only memory or closing delimiters were truncated", () => {
    const raw = '{"scenes":['+JSON.stringify(scene)+'],"memory":{"summary":"unfinished';
    expect(parseNovelBatch(raw,story())[0].lines).toEqual(scene.lines);
    expect(parseNovelBatch(raw,story())[0].memory.summary).toBe("Existing canon");
  });
  it("accepts markdown, commentary, trailing commas and literal newlines without rewriting string punctuation", () => {
    const raw='Here is the scene:\n```json\n{"scenes":[{"lines":[{"text":"A },] sequence\nand a second line",},],},],}\n```';
    expect(parseNovelBatch(raw,story())[0].lines[0].text).toBe('A },] sequence\nand a second line');
  });
  it("accepts a top-level array and common dialogue field names", () => {
    expect(parseNovelBatch(JSON.stringify([{dialogue:[{name:"Test",content:"Synthetic line"}]}]),story())[0].lines).toEqual([{speaker:"Test",text:"Synthetic line"}]);
  });
  it("accepts single quotes and unquoted keys without evaluating anything", () => {
    expect(parseNovelBatch("{scenes:[{lines:[{speaker:'Test',text:'Synthetic line'}]}]}",story())[0].lines[0].text).toBe("Synthetic line");
    expect(()=>parseNovelBatch("{scenes:process.exit()}",story())).toThrow();
  });
  it("preserves unicode and escaped quotes/backslashes", () => {
    const value={scenes:[{lines:[{text:'日本語 Привет \\ "quoted"'}]}]};
    expect(readSceneJson('```json\n'+JSON.stringify(value)+'\n```')).toEqual(value);
  });
  it("rejects missing prose, arbitrary errors, excessive nesting and oversized output", () => {
    for(const raw of ['not json','{"error":"provider failed"}','{"scenes":[{"lines":[{"text":"cut off'])expect(()=>parseNovelBatch(raw,story())).toThrow();
    expect(()=>readSceneJson('['.repeat(70))).toThrow('deeply');
    expect(()=>readSceneJson('x'.repeat(500001))).toThrow('limit');
  });
  it("does not allow object keys to mutate prototypes", () => {
    const parsed=readSceneJson('prefix {"__proto__":{"syntheticPollution":true},"scenes":[],}');
    expect(Object.prototype).not.toHaveProperty('syntheticPollution');
    expect(Object.hasOwn(parsed as object,'__proto__')).toBe(true);
  });
});

it('repairs missing property and array commas without dropping later shots or people',()=>{
 const raw=`{"scenes":[{"title":"Synthetic" "lines":[{"speaker":"Test" "text":"A complete line."} {"speaker":"Test","text":"Another complete line."}] "illustrations":[{"prompt":"The key turns. Close shot." "characterIds":[] "atLine":0} {"prompt":"The box opens. Detail shot.","characterIds":[],"atLine":1}]}] "characters":[{"id":"a" "name":"Test" "appearance":"brown hair"}]}`;
 const draft=story();draft.config.imagesEnabled=true;draft.config.imagesPerScene=2;
 const parsed=parseNovelBatch(raw,draft)[0];
 expect(parsed.lines.map(line=>line.text)).toEqual(['A complete line.','Another complete line.']);
 expect(parsed.illustrations.map(frame=>frame.atLine)).toEqual([0,1]);
 expect(parsed.memory.characters[0]).toMatchObject({id:'a',name:'Test',appearance:'brown hair'});
});
it('repairs missing commas between scenes and repeated commas while preserving literal punctuation',()=>{
 const raw='{"scenes":['+JSON.stringify(scene)+',, '+JSON.stringify(scene)+' '+JSON.stringify(scene)+',,]}';
 expect(parseNovelBatch(raw,story()).map(item=>item.lines)).toEqual([scene.lines,scene.lines,scene.lines]);
 expect(readSceneJson("{a:[true false null -2 3.5],,b:'literal },] punctuation',,}")).toEqual({a:[true,false,null,-2,3.5],b:'literal },] punctuation'});
});
it('keeps completed image prompts but does not invent an unfinished image or line after repair',()=>{
 const raw='{"scenes":[{"lines":[{"text":"Complete prose."}] "illustrations":[{"prompt":"The key rests on the table. Detail shot.","characterIds":[],"atLine":0} {"prompt":"Unfinished';
 const draft=story();draft.config.imagesEnabled=true;
 const parsed=parseNovelBatch(raw,draft)[0];
 expect(parsed.illustrations).toHaveLength(1);expect(parsed.illustrations[0].prompt).toBe('The key rests on the table. Detail shot.');
 expect(parsed.lines).toEqual([{speaker:'',text:'Complete prose.'}]);
});
it('does not resume past arbitrary expressions or turn them into generated prose',()=>{
 const raw='{"scenes":['+JSON.stringify(scene)+' process.exit(), {"lines":[{"text":"Must not be recovered past arbitrary code"}]}]}';
 expect(parseNovelBatch(raw,story())).toHaveLength(1);
 expect(()=>parseNovelBatch('{scenes:process.exit()}',story())).toThrow();
});
