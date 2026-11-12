import {expect,it} from "vitest";
import {prepareNovelIllustrations} from "./illustrationPlan.js";
import {DEFAULT_NOVEL_CONFIG,type NovelStory,type NovelScene} from "../../../src/shared/types/novels.js";
it("recovers a locally planned opening shot for old text-only responses without replacing existing frames",()=>{
 const scene={lines:[{speaker:"Guest",text:"Synthetic line"}],illustrations:[],memory:{characters:[{id:"guest",name:"Guest"},{id:"absent",name:"Absent"}]}} as unknown as NovelScene;
 const story={config:{...DEFAULT_NOVEL_CONFIG,imagesEnabled:true},scenes:[scene]} as NovelStory;
 expect(prepareNovelIllustrations(story)).toBe(true);expect(scene.illustrations[0]).toMatchObject({atLine:0,status:"pending",characterIds:["guest"]});const id=scene.illustrations[0].id;expect(prepareNovelIllustrations(story)).toBe(false);expect(scene.illustrations[0].id).toBe(id);
});
