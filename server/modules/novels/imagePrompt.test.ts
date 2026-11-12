import {expect,it} from "vitest";
import {novelImagePrompt} from "./imagePrompt.js";
import {DEFAULT_NOVEL_CONFIG,type NovelStory,type NovelScene,type NovelIllustration} from "../../../src/shared/types/novels.js";
const a={id:"a",name:"A",appearance:"short red hair, green eyes, blue coat",description:"",personality:"",state:"knows the murderer; hates B",relationships:"secretly distrusts B"};
const b={...a,id:"b",name:"B",appearance:"black hair, yellow coat"};
const frame={id:"f",prompt:"A opens the door, close shot, morning light",characterIds:["a"],atLine:0,seed:1,status:"pending",url:null} as NovelIllustration;
const scene={location:"Station",memory:{characters:[a,b]}} as NovelScene;
const story={config:{...DEFAULT_NOVEL_CONFIG,artStyle:"watercolor"},memory:{characters:[a,b]},cast:[]} as unknown as NovelStory;
it("uses stable visible identity without mental state or off-screen cast",()=>{
 const prompt=novelImagePrompt(story,scene,frame);expect(prompt).toContain("short red hair, green eyes");expect(prompt).toContain("wearing blue coat");expect(prompt).not.toContain(b.appearance);expect(prompt).not.toContain('murderer');expect(prompt).not.toContain('distrusts');expect(prompt).toContain(frame.prompt);
});
it("retains identical identity blocks between shots and recovers legacy missing per-scene anchors",()=>{
 const second=novelImagePrompt(story,{...scene,memory:{...scene.memory,characters:[]}}, {...frame,prompt:"A sits by the window, side view"});
 expect(second).toContain("short red hair, green eyes");expect(second.split("blue coat")).toHaveLength(2);
});
it("keeps first-person viewer off screen without transferring their outfit onto the other subject",()=>{
 const config={...story.config,pov:"first" as const,povCharacter:"a"};
 const result=novelImagePrompt({...story,config}, {...scene,pov:"A",visuals:{setting:"white pool tiles, glass roof, afternoon sun",outfits:{a:"red striped bikini",b:"plain yellow one-piece swimsuit"}}}, {...frame,characterIds:["a","b"],viewpointCharacterId:"a",prompt:"B stands beside the pool and looks toward the viewer. Eye-level medium shot, soft afternoon light."});
 expect(result).toContain("first-person view");expect(result).not.toContain(a.appearance);expect(result).not.toContain("red striped bikini");expect(result).toContain("plain yellow one-piece swimsuit");expect(result).toContain("white pool tiles");expect(result).not.toContain("yellow coat");
});
it("supports subjective shots in dynamic POV while keeping third-person shots external",()=>{
 expect(novelImagePrompt({...story,config:{...story.config,pov:"dynamic"}},scene,{...frame,camera:"first-person",viewpointCharacterId:"a"})).toContain("first-person view");
 expect(novelImagePrompt({...story,config:{...story.config,pov:"third"}},scene,{...frame,camera:"first-person"})).toContain("external camera");
});
it("upgrades old factory style on rendering and keeps the style block unchanged between shots",()=>{
 const old={...story,config:{...story.config,artStyle:'hand-painted visual novel, cinematic lighting, detailed scenery, no text'}};
 const one=novelImagePrompt(old,scene,{...frame,prompt:'Watercolor painting. Golden hour sunlight. She waves toward the viewer.'});
 const two=novelImagePrompt(old,scene,{...frame,prompt:'Photorealistic image. Neon lighting. She looks toward the viewer.'});
 expect(one.split('\n\n')[0]).toBe(two.split('\n\n')[0]);expect(one.split('\n\n')[0]).toBe(DEFAULT_NOVEL_CONFIG.artStyle);
 for(const value of [one,two])expect(value).not.toMatch(/Watercolor|Photorealistic|Golden hour|Neon lighting/);
});
