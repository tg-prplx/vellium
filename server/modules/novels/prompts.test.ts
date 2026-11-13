import { describe, expect, it } from "vitest";
import { DEFAULT_NOVEL_CONFIG, type NovelStory } from "../../../src/shared/types/novels.js";
import { novelMessages, parseNovelBatch } from "./prompts.js";
import { mergeMemory } from "./normalize.js";
const initial = (): NovelStory => ({ id: "fiction-test", title: "Test", config: { ...DEFAULT_NOVEL_CONFIG, premise: "Invented test world", imagesEnabled: true, imagesPerScene: 2 }, cast: [], memory: { summary: "", facts: [], threads: [], characters: [] }, scenes: [], turns: [], cursor: { scene: 0, line: 0 }, revision: 0, createdAt: "", updatedAt: "", cache: null });
const scene = (question = "") => ({ title: "Test scene", lines: [{ speaker: "Test", text: "Fictional test line" }, { speaker: "Test", text: "Another line" }], question, choices: question ? ["A", "B"] : [], illustrations: [{ prompt: "Shot one", atLine: 0 }, { prompt: "Shot two", atLine: 1 }], memory: { summary: "A test event", characters: [{ id: "test", name: "Test", appearance: "red hair", state: "library" }], facts: ["A test fact"], threads: ["A test mystery"] } });
describe("novel cache and continuity", () => {
  it("keeps the prefix byte-identical across memory updates and appends existing turns intact", () => {
    const story = initial(); const first = novelMessages(story, "");
    story.turns = [{ user: first.user, assistant: "fixed response", throughSceneId: "test" }];
    story.memory.summary = "Changed memory";
    const second = novelMessages(story, "Go");
    expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
    expect(second.messages[2]).toEqual({ role: "assistant", content: "fixed response" });
    expect(second.messages.at(-1)?.content).not.toContain("Changed memory");
    expect(first.messages[0].content).not.toContain("Changed memory");
  });
  it("keeps appearance, identity and prior facts while updating state", () => {
    const previous = mergeMemory(initial().memory, scene().memory);
    const next = mergeMemory(previous, { summary: "new", facts: ["another"], characters: [{ id: "test", name: "Different", appearance: "blue hair", state: "garden" }] });
    expect(next.characters[0]).toMatchObject({ name: "Test", appearance: "red hair", state: "garden" });
    expect(next.facts).toEqual([]);
  });
  it("resolves changed model IDs back to canonical characters and image anchors", () => {
    const story = initial(); story.memory = mergeMemory(story.memory, scene().memory);
    const output = scene(); output.memory.characters[0] = { id: "different-id", name: "Test", appearance: "blue hair", state: "garden" };
    const withImages = { ...output, illustrations: [{ prompt: "new shot", atLine: 0, characterIds: ["different-id"] }] };
    const parsed = parseNovelBatch(JSON.stringify({ scenes: [withImages] }), story)[0];
    expect(parsed.memory.characters).toHaveLength(1);
    expect(parsed.memory.characters[0]).toMatchObject({ id: "test", appearance: "red hair", state: "garden" });
    expect(parsed.illustrations[0].characterIds).toEqual(["test"]);
  });
  it("creates multiple shots per scene, respects bounds and stops the batch at a dynamic question", () => {
    const story = initial(); story.config.questionFrequency = "frequent";
    const result = parseNovelBatch(JSON.stringify({ scenes: [scene(), scene("Which path?"), scene()] }), story);
    expect(result).toHaveLength(2); expect(result[0].illustrations).toHaveLength(2);
    expect(result[0].illustrations.map((im) => im.atLine)).toEqual([0, 1]);
    expect(result[1].memory.characters[0].appearance).toBe("red hair");
  });
  it("enforces question spacing and allows a batch with no forced questions", () => {
    const story = initial(); story.config.questionFrequency = "rare"; story.config.scenesPerTurn = 5;
    const result = parseNovelBatch(JSON.stringify({ scenes: [scene("a"), scene("b"), scene("c"), scene("d"), scene()] }), story);
    expect(result.map((s) => s.question)).toEqual(["", "", "", "d"]);
    story.config.questionFrequency = "off";
    expect(parseNovelBatch(JSON.stringify({ scenes: [scene("q")] }), story)[0].choices).toEqual([]);
    expect(parseNovelBatch(JSON.stringify({ scenes: [scene(), scene()] }), story)).toHaveLength(2);
  });
  it("accepts one compact memory delta per batch and anchors every frame to new cast", () => {
    const story = initial(); const one = scene();
    const { memory, ...rest } = one;
    const compact = { ...rest, illustrations: [{ prompt: "Shot", atLine: 0, characterIds: ["test"] }] };
    const result = parseNovelBatch(JSON.stringify({ scenes: [compact, compact], memory }), story);
    expect(result).toHaveLength(2);
    expect(result[1].memory.facts).toEqual([]);
    for (const item of result) {
      expect(item.illustrations[0].characterIds).toEqual(["test"]);
      expect(item.memory.characters[0].appearance).toBe("red hair");
    }
  });
  it("applies compact ID-only state updates without losing unchanged canon", () => {
    const prior = mergeMemory(initial().memory, {characters:[{id:"test",name:"Test",appearance:"red hair",state:"injured, holds key",relationships:"trusts guide"}]});
    const next = mergeMemory(prior, {characters:[{id:"test",state:"injured, holds key, in garden"}]});
    expect(next.characters[0]).toMatchObject({name:"Test",appearance:"red hair",state:"injured, holds key, in garden",relationships:"trusts guide"});
    expect(mergeMemory(next,{characters:[{id:"test",relationships:""}]}).characters[0].relationships).toBe("");
  });
  it("maps batch-level aliases to canonical IDs on every shot", () => {
    const story = initial();story.memory=mergeMemory(story.memory,scene().memory);
    const compact={lines:scene().lines,illustrations:[{prompt:"Synthetic shot",atLine:0,characterIds:["alias"]}]};
    const output={scenes:[compact,compact],memory:{characters:[{id:"alias",name:"Test",state:"garden"}]}};
    const parsed=parseNovelBatch(JSON.stringify(output),story);
    for(const item of parsed)expect(item.illustrations[0].characterIds).toEqual(["test"]);
    expect(parsed[1].memory.characters[0]).toMatchObject({id:"test",state:"garden"});
  });
  it("keeps library anchors once in the prefix and sends only nonduplicate memory fields", () => {
    const story=initial();const character={id:"test",name:"Synthetic",appearance:"unique visual anchor",description:"unique visual anchor",personality:"patient",state:"garden",relationships:""};
    story.cast=[{...character,state:""}];story.memory.characters=[character];
    const request=novelMessages(story,"");const user=JSON.parse(request.user);
    expect(user.maxScenes).toBe(2);expect(user.replyTokenLimit).toBe(story.config.maxTokens);
    expect(user.characters).toEqual([{id:"test",name:"Synthetic",state:"garden"}]);
    expect(request.messages[0].content.split("unique visual anchor")).toHaveLength(2);
    expect(request.messages[0].content).toContain('"appearance":"English identity:');
    expect(request.messages[0].content).not.toContain('"memory":');
    expect(request.messages[0].content).not.toContain('dynamic =');
  });
  it("anchors opening shots at zero and prevents generating invisible duplicate shots", () => {
    const story=initial();story.config.imagesPerScene=4;
    const output={...scene(),illustrations:[{prompt:"First",atLine:1},{prompt:"Second",atLine:1},{prompt:"Invisible",atLine:1}]};
    expect(parseNovelBatch(JSON.stringify({scenes:[output]}),story)[0].illustrations.map(f=>f.atLine)).toEqual([0]);
  });
  it("never silently drops uncompressed oversized history", () => {
    const story = initial(); story.memory.summary = "Distant durable event";
    story.turns = [{ user: "x".repeat(50000), assistant: "old", throughSceneId: "old" }];
    const request = novelMessages(story, "Continue");
    expect(request.messages).toHaveLength(4); expect(request.user).not.toContain("Distant durable event");
  });
});

it("persists new visual anchors and first-person camera without copying batch-final wardrobe into earlier scenes",()=>{
 const story=initial();story.config.pov="first";
 const output={characters:[{id:"viewer",name:"Viewer",appearance:"short black hair",outfit:"plain white shirt"},{id:"guest",name:"Guest",appearance:"long red hair",outfit:"blue striped swimsuit"}],scenes:[
 {location:"Pool",setting:"white tiles and glass roof",lines:[{text:"Synthetic opening"}],illustrations:[{prompt:"The guest waves toward the camera. Eye-level shot, soft light.",characterIds:["guest"],camera:"first-person",viewpointCharacterId:"viewer",atLine:0}]},
 {location:"Pool",outfits:{guest:"white shirt and green shorts"},outfitChanges:{guest:{line:0,quote:"Synthetic explicit clothing change"}},lines:[{text:"Synthetic explicit clothing change"}],illustrations:[]}]};
 const scenes=parseNovelBatch(JSON.stringify(output),story);
 expect(scenes[0].visuals?.outfits.guest).toBe("blue striped swimsuit");expect(scenes[1].visuals?.outfits.guest).toBe("white shirt and green shorts");
 expect(scenes[0].visuals?.setting).toBe(scenes[1].visuals?.setting);expect(scenes[0].illustrations[0]).toMatchObject({camera:"first-person",viewpointCharacterId:"viewer"});
});

it("still schedules the opening image when a new response has prose but omitted its illustration tail",()=>{
 const story=initial();const result=parseNovelBatch('{"scenes":[{"location":"Synthetic garden","lines":[{"speaker":"Test","text":"Synthetic completed line."}]}]}',story);
 expect(result[0].illustrations).toHaveLength(1);expect(result[0].illustrations[0]).toMatchObject({atLine:0,status:"pending"});
 expect(result[0].lines[0].text).toBe("Synthetic completed line.");
});

it("uses fewer than the image ceiling, respects intentional cut positions and keeps cast shot-specific",()=>{
 const story=initial();story.config.imagesPerScene=3;
 const raw={characters:[{id:"a",name:"A",appearance:"red hair"},{id:"b",name:"B",appearance:"black hair"}],scenes:[{lines:Array.from({length:8},(_,i)=>({speaker:i%2?"A":"B",text:`Synthetic line ${i}`})),illustrations:[{prompt:"A smiles. Medium shot.",characterIds:["a"],atLine:0},{prompt:"The key turns. Close shot.",characterIds:[],atLine:5}]}]};
 const result=parseNovelBatch(JSON.stringify(raw),story)[0];expect(result.illustrations).toHaveLength(2);expect(result.illustrations.map(f=>f.atLine)).toEqual([0,5]);expect(result.illustrations.map(f=>f.characterIds)).toEqual([["a"],[]]);
});

it("accepts twenty scenes without clipping the plan at the former five-scene ceiling",async()=>{
 const {normalizeConfig}=await import('./normalize.js');const story=initial();story.config=normalizeConfig({...story.config,scenesPerTurn:20,questionFrequency:'off'});
 expect(story.config.scenesPerTurn).toBe(20);const parsed=parseNovelBatch(JSON.stringify({scenes:Array.from({length:20},()=>scene())}),story);expect(parsed).toHaveLength(20);expect(new Set(parsed.map(s=>s.illustrations[0].seed)).size).toBe(20);
});

it("replaces default system instructions per novel while keeping the world, cast and current input",()=>{
 const story=initial();story.config.systemPrompt='SYNTHETIC_CUSTOM_NOVEL_PROMPT: return scenes JSON.';story.config.premise='SYNTHETIC_WORLD';
 const request=novelMessages(story,'SYNTHETIC_ACTION');expect(request.messages[0].content).toContain('SYNTHETIC_CUSTOM_NOVEL_PROMPT');expect(request.messages[0].content).toContain('SYNTHETIC_WORLD');expect(request.messages[0].content).not.toContain('SHOT PLANNING');expect(request.user).toContain('SYNTHETIC_ACTION');
 story.config.systemPrompt='';expect(novelMessages(story,'').messages[0].content).toContain('SHOT PLANNING');
});

it("requests developed-scene coverage within the per-scene limit without changing reply limits",()=>{
 const story=initial();story.config.imagesPerScene=4;
 const request=novelMessages(story,'Continue');
 expect(JSON.parse(request.user)).toMatchObject({maxIllustrationsPerScene:4,replyTokenLimit:story.config.maxTokens,shotPolicy:{developedSceneMinLines:6,developedSceneMinFrames:2}});
 expect(request.messages[0].content).toContain('separately for EVERY scene');
 expect(request.messages[0].content).not.toContain('A quiet exchange needs only one image');
 story.config.imagesPerScene=1;expect(JSON.parse(novelMessages(story,'').user).shotPolicy.developedSceneMinFrames).toBe(1);
 story.config.imagesEnabled=false;expect(JSON.parse(novelMessages(story,'').user)).not.toHaveProperty('shotPolicy');
});

it('inherits omitted scene metadata across a batch and later turns without repeating the setting',()=>{
 const story=initial();story.config.povCharacter='Explorer';
 const first=parseNovelBatch(JSON.stringify({scenes:[{location:'Observatory',setting:'Circular stone hall, brass telescope, skylight.',lines:[{text:'Synthetic opening.'}]},{lines:[{text:'Synthetic continuation.'}]}]}),story);
 expect(first.map(scene=>scene.pov)).toEqual(['Explorer','Explorer']);
 expect(first[1].location).toBe('Observatory');expect(first[1].visuals).toEqual(first[0].visuals);expect(first[1].title).toBe('Synthetic continuation.');
 story.scenes=first;const request=novelMessages(story,'');
 expect(JSON.parse(request.user).sceneDefaults).toEqual({pov:'Explorer'});
 expect(request.messages[0].content).toContain('SCENE METADATA IS CHANGES-ONLY');
 const minimal=request.messages[0].content.split('Minimal continuation format: ')[1].split('\n')[0];
 expect(minimal).not.toMatch(/"title"|"location"|"setting"|"pov"/);
 const next=parseNovelBatch(JSON.stringify({scenes:[{lines:[{text:'Another synthetic turn.'}]}]}),story)[0];
 expect(next.pov).toBe('Explorer');expect(next.location).toBe('Observatory');expect(next.visuals).toEqual(first[0].visuals);
});
it('inherits dynamic viewpoint changes within a batch and uses newly configured fixed viewpoints',()=>{
 const story=initial();story.config.pov='dynamic';
 const scenes=parseNovelBatch(JSON.stringify({scenes:[{pov:'Alice',lines:[{text:'Synthetic opening.'}]},{pov:'Beatrice',lines:[{text:'Synthetic switch.'}]},{lines:[{text:'Synthetic continuation.'}]}]}),story);
 expect(scenes.map(scene=>scene.pov)).toEqual(['Alice','Beatrice','Beatrice']);
 story.scenes=scenes;story.config.pov='first';story.config.povCharacter='Explorer';
 expect(parseNovelBatch(JSON.stringify({scenes:[{lines:[{text:'Synthetic configured viewpoint.'}]}]}),story)[0].pov).toBe('Explorer');
});
it('accepts sparse narration and shot metadata without losing cast, cuts or defaults',async()=>{
 const story=initial();story.config.pov='first';story.config.imagePov='first';story.config.povCharacter='Viewer';
 const scenes=parseNovelBatch(JSON.stringify({characters:[{id:'viewer',name:'Viewer',appearance:'short silver hair',outfit:'green coat'},{id:'guest',name:'Guest',appearance:'brown hair',outfit:'blue coat'}],scenes:[{location:'Observatory',setting:'Stone hall, brass telescope, skylight.',lines:['Synthetic narration.',{speaker:'Guest',text:'Synthetic greeting.'},'Synthetic gesture.'],illustrations:[{prompt:'Guest waves. Medium shot.',characterIds:['guest']},{prompt:'Guest points. Close-up.',characterIds:['guest'],atLine:2}]}]}),story);
 const scene=scenes[0];expect(scene.pov).toBe('Viewer');expect(scene.lines[0]).toEqual({speaker:'',text:'Synthetic narration.'});expect(scene.lines[1].speaker).toBe('Guest');
 expect(scene.illustrations.map(frame=>frame.atLine)).toEqual([0,2]);expect(scene.choices).toEqual([]);expect(scene.question).toBe('');
 const {novelImagePrompt}=await import('./imagePrompt.js');const prompt=novelImagePrompt(story,scene,scene.illustrations[0]);
 expect(prompt).toContain('first-person view');expect(prompt).toContain('brown hair');expect(prompt).toContain('blue coat');expect(prompt).not.toContain('silver hair');
 const instructions=novelMessages(story,'').messages[0].content;
 expect(instructions).toContain('omit camera="external"');expect(instructions).toContain('Omit redundant subjectNames');expect(instructions).toContain('narration can be a plain string');
});
it('explicitly requests opening exposition as story prose while keeping continuation metadata sparse',()=>{
 const story=initial();const opening=novelMessages(story,'');
 expect(JSON.parse(opening.user)).toMatchObject({phase:'opening'});
 expect(JSON.parse(opening.user).action).toContain('in narration');
 expect(opening.messages[0].content).toContain('begin the first scene\'s lines with 2-4 readable narration passages');
 expect(opening.messages[0].content).toContain('technical data supplements the narration');
 expect(opening.messages[0].content).toContain('SCENE METADATA IS CHANGES-ONLY');
 const prose=['Synthetic opening establishes the old observatory and the falling rain.','The adult explorer waits beside a brass telescope, meeting her guide for the first time.',{speaker:'Guide',text:'Synthetic greeting.'}];
 const parsed=parseNovelBatch(JSON.stringify({scenes:[{location:'Observatory',setting:'Stone hall, brass telescope, skylight.',lines:prose}]}),story);
 expect(parsed[0].lines.map(line=>line.text)).toEqual(prose.map(line=>typeof line==='string'?line:line.text));
 story.scenes=parsed;story.memory=parsed[0].memory;story.turns=[{user:opening.user,assistant:JSON.stringify({scenes:[{lines:prose}]}),throughSceneId:parsed[0].id}];
 const next=novelMessages(story,'Follow the guide.');expect(JSON.parse(next.user)).toMatchObject({phase:'continuation',action:'Follow the guide.'});
 expect(next.messages.slice(0,opening.messages.length)).toEqual(opening.messages);
});
it('uses a source for both world and individual cast without requiring a second cast selection',()=>{
 const story=initial();story.config.premise='';story.config.protagonist='Synthetic reader';
 story.settingCards=[{sourceCharacterId:'source',name:'Observatory expedition',description:'The mountain observatory houses two adult explorers: Alice has red hair; Beatrice has black hair.',scenario:'{{user}} arrives with the {{char}} expedition.',instructions:'Keep the telescope mystery grounded.'}];
 const request=novelMessages(story,'');const settings=JSON.parse(request.messages[0].content.split('SETTINGS: ')[1]);
 expect(settings.storySources[0].description).toContain('mountain observatory');expect(settings.storySources[0].scenario).toBe('Synthetic reader arrives with the Observatory expedition expedition.');expect(settings.cast).toEqual([]);
 const raw={characters:[{id:'source',sourceCharacterId:'source',name:'Alice',appearance:'red hair',outfit:'blue coat'},{id:'source',sourceCharacterId:'source',name:'Beatrice',appearance:'black hair',outfit:'yellow coat'}],scenes:[{lines:[{speaker:'Alice',text:'Synthetic greeting.'}],illustrations:[{prompt:'Alice waves. Medium shot.',characterIds:['source'],subjectNames:['Alice']}]}]};
 const parsed=parseNovelBatch(JSON.stringify(raw),story)[0];expect(parsed.memory.characters).toHaveLength(2);
 const a=parsed.memory.characters.find(c=>c.name==='Alice')!,b=parsed.memory.characters.find(c=>c.name==='Beatrice')!;
 expect(a.id).not.toBe(b.id);expect(a.id).not.toBe('source');expect(parsed.illustrations[0].characterIds).toEqual([a.id]);expect(parsed.visuals?.outfits[a.id]).toBe('blue coat');
 story.scenes=[parsed];story.memory=parsed.memory;expect(novelMessages(story,'').messages[0].content).toBe(request.messages[0].content);
});
