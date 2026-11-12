import {expect,it} from "vitest";
import {novelImagePrompt} from "./imagePrompt.js";
import {DEFAULT_NOVEL_CONFIG,type NovelStory,type NovelScene,type NovelIllustration} from "../../../src/shared/types/novels.js";
const a={id:"a",name:"A",appearance:"short red hair, green eyes, blue coat",description:"",personality:"",state:"knows the murderer; hates B",relationships:"secretly distrusts B"};
const b={...a,id:"b",name:"B",appearance:"black hair, yellow coat"};
const frame={id:"f",prompt:"A opens the door, close shot, morning light",characterIds:["a"],atLine:0,seed:1,status:"pending",url:null} as NovelIllustration;
const scene={location:"Station",memory:{characters:[a,b]}} as NovelScene;
const story={config:{...DEFAULT_NOVEL_CONFIG,artStyle:"watercolor"},memory:{characters:[a,b]},cast:[]} as unknown as NovelStory;
it("uses stable visible identity without mental state or off-screen cast",()=>{
 const prompt=novelImagePrompt(story,scene,frame);expect(prompt).toContain("short red hair, green eyes");expect(prompt).toContain("wearing blue coat");expect(prompt).not.toContain(b.appearance);expect(prompt).not.toContain('murderer');expect(prompt).not.toContain('distrusts');expect(prompt).toContain("A opens the door");
});
it("retains identical identity blocks between shots and recovers legacy missing per-scene anchors",()=>{
 const second=novelImagePrompt(story,{...scene,memory:{...scene.memory,characters:[]}}, {...frame,prompt:"A sits by the window, side view"});
 expect(second).toContain("short red hair, green eyes");expect(second.split("blue coat")).toHaveLength(2);
});
it("keeps first-person viewer off screen without transferring their outfit onto the other subject",()=>{
 const config={...story.config,pov:"first" as const,imagePov:"first" as const,povCharacter:"a"};
 const result=novelImagePrompt({...story,config}, {...scene,pov:"A",visuals:{setting:"white pool tiles, glass roof, afternoon sun",outfits:{a:"red striped bikini",b:"plain yellow one-piece swimsuit"}}}, {...frame,characterIds:["a","b"],viewpointCharacterId:"a",prompt:"B stands beside the pool and looks toward the viewer. Eye-level medium shot, soft afternoon light."});
 expect(result).toContain("first-person view");expect(result).not.toContain(a.appearance);expect(result).not.toContain("red striped bikini");expect(result).toContain("plain yellow one-piece swimsuit");expect(result).toContain("white pool tiles");expect(result).not.toContain("yellow coat");
});
it("supports subjective shots in dynamic POV while keeping third-person shots external",()=>{
 expect(novelImagePrompt({...story,config:{...story.config,pov:"dynamic"}},scene,{...frame,camera:"first-person",viewpointCharacterId:"a"})).toContain("first-person view");
 expect(novelImagePrompt({...story,config:{...story.config,pov:"third",imagePov:"third"}},scene,{...frame,camera:"first-person"})).toContain("external camera");
});
it("upgrades old factory style on rendering and keeps the style block unchanged between shots",()=>{
 const old={...story,config:{...story.config,artStyle:'hand-painted visual novel, cinematic lighting, detailed scenery, no text'}};
 const one=novelImagePrompt(old,scene,{...frame,prompt:'Watercolor painting. Golden hour sunlight. She waves toward the viewer.'});
 const two=novelImagePrompt(old,scene,{...frame,prompt:'Photorealistic image. Neon lighting. She looks toward the viewer.'});
 expect(one.split('\n\n')[0]).toBe(two.split('\n\n')[0]);expect(one.split('\n\n')[0]).toBe(DEFAULT_NOVEL_CONFIG.artStyle);
 for(const value of [one,two])expect(value).not.toMatch(/Watercolor|Photorealistic|Golden hour|Neon lighting/);
});
it("explicitly keeps a one-person close-up solo and an object shot free of the rest of the scene cast",()=>{
 const solo=novelImagePrompt(story,scene,frame);expect(solo).toContain('only visible person');expect(solo).not.toContain(b.appearance);
 const prop=novelImagePrompt(story,scene,{...frame,characterIds:[],prompt:'A brass key fills the foreground. Close-up composition.'});expect(prop).toContain('no visible people');expect(prop).not.toContain(a.appearance);expect(prop).not.toContain(b.appearance);
});
it('decouples first-person narration from an external image camera, including old subjective shots',()=>{
 const config={...story.config,pov:'first' as const,imagePov:'third' as const,povCharacter:'a'};
 const prompt=novelImagePrompt({...story,config},scene,{...frame,characterIds:['a','b'],camera:'first-person',viewpointCharacterId:'a',prompt:'First-person POV shot. A waves. Medium framing.'});
 expect(prompt).toContain('external camera');expect(prompt).not.toMatch(/first-person|behind the camera/);expect(prompt).toContain('short red hair');expect(prompt).toContain('black hair');
 const legacy=novelImagePrompt({...story,config:{...config,imagePov:undefined}},scene,{...frame,camera:undefined});expect(legacy).toContain('external camera');
});
it('supports a separate image viewpoint and over-shoulder framing independently of the prose narrator',()=>{
 const config={...story.config,pov:'third' as const,imagePov:'first' as const,imagePovCharacter:'b'};
 const first=novelImagePrompt({...story,config},scene,{...frame,characterIds:['a','b'],viewpointCharacterId:'a'});
 expect(first).toContain('first-person view');expect(first).toContain('short red hair');expect(first).not.toContain('black hair');
 const shoulder=novelImagePrompt({...story,config:{...config,imagePov:'over-shoulder'}},scene,frame);
 expect(shoulder).toContain('Over-the-shoulder');expect(shoulder).toContain('black hair');expect(shoulder).toContain('yellow coat');expect(shoulder).toContain('short red hair');
});
it('chooses each dynamic camera from its frame rather than the narrative person',()=>{
 const config={...story.config,pov:'first' as const,imagePov:'dynamic' as const};
 const first=novelImagePrompt({...story,config},scene,{...frame,camera:'first-person',viewpointCharacterId:'b'});
 const external=novelImagePrompt({...story,config},scene,{...frame,camera:'external'});
 const shoulder=novelImagePrompt({...story,config},scene,{...frame,camera:'over-shoulder',viewpointCharacterId:'b'});
 expect(first).toContain('first-person view');expect(external).toContain('external camera');expect(external).not.toContain('first-person view');expect(shoulder).toContain('Over-the-shoulder');
});
