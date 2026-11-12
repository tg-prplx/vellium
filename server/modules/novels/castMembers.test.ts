import {expect,it} from "vitest";
import {mergeMemory} from "./normalize.js";
import {resolveVisibleMembers} from "./castMembers.js";
import {novelImagePrompt} from "./imagePrompt.js";
import {parseNovelBatch} from "./prompts.js";
import {DEFAULT_NOVEL_CONFIG,type NovelStory,type NovelIllustration,type NovelScene} from "../../../src/shared/types/novels.js";
const group={id:'card',name:'Alice & Beatrice',appearance:'Two adult explorers: Alice has red hair, Beatrice has black hair.',description:'Shared expedition card',personality:'',relationships:'',state:''};
const empty={summary:'',facts:[],threads:[],characters:[group]};
const members=[{id:'card',sourceCharacterId:'card',name:'Alice',appearance:'red hair, green eyes',outfit:'blue coat'},{id:'card',sourceCharacterId:'card',name:'Beatrice',appearance:'black hair, brown eyes',outfit:'yellow jacket'}];
it('separates members even when the model repeats the source card ID and keeps IDs stable',()=>{
 const memory=mergeMemory(empty,{characters:members});expect(memory.characters).toHaveLength(3);
 const a=memory.characters.find(c=>c.name==='Alice')!,b=memory.characters.find(c=>c.name==='Beatrice')!;expect(a.id).not.toBe(b.id);expect(a.id).not.toBe('card');expect(a.sourceCharacterId).toBe('card');
 const next=mergeMemory(memory,{characters:[{...members[0],appearance:'blue hair',outfit:'green coat',state:'at camp'}]});expect(next.characters.find(c=>c.name==='Alice')).toMatchObject({id:a.id,appearance:a.appearance,outfit:a.outfit,state:'at camp'});
});
it('flattens explicit group members without losing the source card',()=>{
 const memory=mergeMemory(empty,{characters:[{id:'card',name:group.name,members}]});expect(memory.characters.filter(c=>!c.isGroup&&c.id!=='card')).toHaveLength(2);expect(memory.characters.find(c=>c.id==='card')?.isGroup).toBe(true);
});
it('resolves a wrong group image ID from a single named subject and never adds the other member',()=>{
 const memory=mergeMemory(empty,{characters:members});const frame={characterIds:['card'],subjectNames:['Alice'],prompt:'Alice waves. Medium shot.'};
 const result=resolveVisibleMembers(frame,memory.characters);expect(result.ids).toEqual([memory.characters.find(c=>c.name==='Alice')!.id]);
 const story={config:{...DEFAULT_NOVEL_CONFIG,pov:'third'},cast:[group],memory} as NovelStory;const scene={memory,location:'Station'} as NovelScene;
 const prompt=novelImagePrompt(story,scene,frame as NovelIllustration);expect(prompt).toContain('red hair');expect(prompt).toContain('blue coat');expect(prompt).not.toMatch(/black hair|yellow jacket|Two adult explorers/);
});
it('keeps ambiguous legacy group frames drawable without calling the group a solo person or an empty scene',()=>{
 const prompt=novelImagePrompt({config:DEFAULT_NOVEL_CONFIG,cast:[group],memory:empty} as unknown as NovelStory,{memory:empty,location:'Station'} as unknown as NovelScene,{characterIds:['card'],prompt:'She waves.'} as NovelIllustration);
 expect(prompt).toContain('Shared character reference');expect(prompt).toContain('She waves.');expect(prompt).not.toMatch(/Solo framing|no visible people/);
});
it('extracts an available named passage from an unsplit card without mixing the other appearance',()=>{
 const prompt=novelImagePrompt({config:DEFAULT_NOVEL_CONFIG,cast:[group],memory:empty} as unknown as NovelStory,{memory:empty,location:'Station'} as unknown as NovelScene,{characterIds:['card'],subjectNames:['Alice'],prompt:'Alice waves.'} as NovelIllustration);
 expect(prompt).toContain('red hair');expect(prompt).not.toMatch(/black hair|Two adult explorers|no visible people/);expect(empty.characters).toEqual([group]);
});
it('supports two subjects and does not resolve short names inside another name',()=>{
 const memory=mergeMemory(empty,{characters:members});expect(resolveVisibleMembers({characterIds:['card'],subjectNames:['Alice','Beatrice'],prompt:'Both wave.'},memory.characters).ids).toHaveLength(2);
 expect(resolveVisibleMembers({characterIds:['card'],prompt:'Aliceville station.'},memory.characters).ambiguous).toBe(true);
});
it('carries individual subject IDs and clothing through a real parsed scene batch',()=>{
 const story={id:'synthetic',config:{...DEFAULT_NOVEL_CONFIG,imagesEnabled:true},cast:[group],memory:empty,scenes:[],turns:[]} as unknown as NovelStory;
 const scenes=parseNovelBatch(JSON.stringify({characters:members,scenes:[{lines:[{speaker:'Alice',text:'Synthetic greeting.'}],illustrations:[{prompt:'Alice waves. Medium shot.',characterIds:['card'],subjectNames:['Alice'],atLine:0}]}]}),story);
 const a=scenes[0].memory.characters.find(c=>c.name==='Alice')!;expect(scenes[0].illustrations[0].characterIds).toEqual([a.id]);expect(scenes[0].visuals?.outfits[a.id]).toBe('blue coat');
});
it('recovers repeated group IDs without source metadata for an identifiable duo',()=>{
 const memory=mergeMemory(empty,{characters:members.map(({sourceCharacterId,...member})=>member)});
 expect(memory.characters.find(c=>c.name==='Alice')?.id).not.toBe('card');expect(memory.characters).toHaveLength(3);
});
it('keeps explicit member IDs from a newly declared group and scopes equal names by source',()=>{
 const memory=mergeMemory({summary:'',facts:[],threads:[],characters:[]},{characters:[{id:'new-team',name:'Expedition',members:[{id:'alice-one',name:'Alice',appearance:'red hair',outfit:'blue coat'}]},{id:'other-team',name:'Other expedition',members:[{id:'alice-two',name:'Alice',appearance:'black hair',outfit:'yellow jacket'}]}]});
 expect(memory.characters.filter(c=>c.name==='Alice').map(c=>c.id)).toEqual(['alice-one','alice-two']);
 expect(resolveVisibleMembers({characterIds:['alice-two'],subjectNames:['Alice'],prompt:'She waves.'},memory.characters).ids).toEqual(['alice-two']);
});
it('retains member identities and clothing when a trailing scene is incomplete',()=>{
 const story={id:'synthetic',config:{...DEFAULT_NOVEL_CONFIG,imagesEnabled:true},cast:[group],memory:empty,scenes:[],turns:[]} as unknown as NovelStory;
 const scenes=parseNovelBatch(JSON.stringify({characters:[{id:'card',name:group.name,members}],scenes:[{lines:[{speaker:'Alice',text:'Synthetic greeting.'}],illustrations:[{prompt:'Alice waves. Medium shot.',characterIds:['card'],subjectNames:['Alice'],atLine:0}]},{lines:[]}]}),story);
 const a=scenes[0].memory.characters.find(c=>c.name==='Alice')!;
 expect(a).toMatchObject({sourceCharacterId:'card',outfit:'blue coat'});expect(scenes[0].illustrations[0].characterIds).toEqual([a.id]);
});
it('still recovers changed IDs for an ordinary imported card without source metadata',()=>{
 const person={...group,id:'single',sourceCharacterId:'single',name:'Alice',appearance:'red hair'};
 const memory=mergeMemory({...empty,characters:[person]},{characters:[{id:'changed',name:'Alice',state:'waiting'}]});
 expect(memory.characters).toHaveLength(1);expect(memory.characters[0]).toMatchObject({id:'single',appearance:'red hair',state:'waiting'});
});
