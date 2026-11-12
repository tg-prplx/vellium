import {expect,it} from "vitest";
import {applyVisualContinuity} from "./visualContinuity.js";
import {DEFAULT_NOVEL_CONFIG,type NovelScene,type NovelStory} from "../../../src/shared/types/novels.js";
const scene=(location:string,line="Synthetic action without a visual change.")=>({location,lines:[{speaker:"A",text:line}],illustrations:[{id:"synthetic",seed:123}],memory:{characters:[{id:"a",name:"A",outfit:"red striped bikini"}]}} as unknown as NovelScene);
const prior={...scene("Pool"),visuals:{location:"Pool",setting:"white tiles, glass roof",outfits:{a:"red striped bikini"}}};
const story=()=>({id:"synthetic",config:DEFAULT_NOVEL_CONFIG,scenes:[prior]} as unknown as NovelStory);
it("ignores renamed locations and repeated wardrobe without a narrated transition",()=>{
 const scenes=[scene("Outdoor pool"),scene("Beach")];
 applyVisualContinuity(story(),scenes,[{setting:"blue outdoor tiles",outfits:{a:"green swimsuit"}},{setting:"golden sand",outfits:{a:"white bikini"}}]);
 for(const item of scenes){expect(item.location).toBe("Pool");expect(item.visuals).toEqual(prior.visuals);}
 expect(scenes[0].illustrations[0].seed).toBeGreaterThanOrEqual(0);
});
it("changes clothing and location only with separate exact line references",()=>{
 const clothing="A changes into a white shirt and blue shorts.";const move="They walk down the path to the beach.";
 const scenes=[scene("Pool",clothing),scene("Beach",move)];
 applyVisualContinuity(story(),scenes,[{outfits:{a:"white shirt and blue shorts"},outfitChanges:{a:{line:0,quote:clothing}}},{setting:"golden sand, stone pier",locationChange:{line:0,quote:move}}]);
 expect(scenes[0].visuals?.outfits.a).toBe("white shirt and blue shorts");expect(scenes[0].location).toBe("Pool");
 expect(scenes[1].visuals?.setting).toBe("golden sand, stone pier");expect(scenes[1].visuals?.outfits.a).toBe("white shirt and blue shorts");expect(prior.visuals.outfits.a).toBe("red striped bikini");
});
it("rejects invented change evidence and missing line indices",()=>{
 const scenes=[scene("Beach")];
 applyVisualContinuity(story(),scenes,[{setting:"sand",locationChange:{line:8,quote:"They arrive at the beach."},outfits:{a:"white dress"},outfitChanges:{a:{line:0,quote:"A changes into a white dress."}}}]);expect(scenes[0].visuals).toEqual(prior.visuals);
});
it("fills an old missing wardrobe from the existing appearance and retains it on continuation",()=>{
 const character={id:'a',name:'A',appearance:'long red hair, blue striped bikini',outfit:undefined};
 const old={...scene('Pool'),memory:{characters:[character]},visuals:{location:'Pool',setting:'Pool',outfits:{}}};
 const next=[{...scene('Pool'),memory:{characters:[character]}}] as unknown as NovelScene[];
 applyVisualContinuity({...story(),scenes:[old]} as unknown as NovelStory,next,[{location:'Pool',setting:'white tiles, glass roof, diffuse daylight'}]);
 expect(next[0].visuals?.outfits.a).toBe('blue striped bikini');expect(next[0].visuals?.setting).toBe('white tiles, glass roof, diffuse daylight');
 const continuation=[scene('Hotel swimming pool')];applyVisualContinuity({...story(),scenes:next},continuation,[{setting:'outdoor pool, stone walls'}]);
 expect(continuation[0].visuals?.setting).toBe(next[0].visuals?.setting);expect(continuation[0].visuals?.outfits.a).toBe('blue striped bikini');
});

it("uses distinct repeatable noise per scene and shot while leaving visual anchors identical",()=>{
 const a={...scene('Pool'),id:'scene-a',illustrations:[{id:'shot-a',seed:0},{id:'shot-b',seed:0}]} as NovelScene;const b={...scene('Pool'),id:'scene-b'};
 applyVisualContinuity(story(),[a,b],[{},{}]);expect(a.visuals).toEqual(b.visuals);expect(new Set([...a.illustrations,b.illustrations[0]].map(f=>f.seed)).size).toBe(3);
 const seed=a.illustrations[0].seed;applyVisualContinuity(story(),[a],[{}]);expect(a.illustrations[0].seed).toBe(seed);
});
it('accepts compact change indices without repeating prose and rejects missing or invalid references',()=>{
 const clothing='A changes into a white shirt and blue shorts.';const move='They walk down the path to the beach.';
 const scenes=[scene('Pool',clothing),scene('Beach',move)];
 applyVisualContinuity(story(),scenes,[{outfits:{a:'white shirt and blue shorts'},outfitChanges:{a:0}},{setting:'Golden sand, stone pier.',locationChange:0}]);
 expect(scenes[0].visuals?.outfits.a).toBe('white shirt and blue shorts');expect(scenes[1].location).toBe('Beach');
 for(const invalid of [-1,9,0.5,false,null]){
  const unchanged=[scene('Beach',move)];applyVisualContinuity(story(),unchanged,[{locationChange:invalid,outfits:{a:'green coat'},outfitChanges:{a:invalid}}]);expect(unchanged[0].visuals).toEqual(prior.visuals);
 }
});
it('reuses an established set on return without asking for its description again',()=>{
 const beach='They walk down the path to the beach.';const pool='They return along the path to the pool.';
 const scenes=[scene('Beach',beach),scene('Pool',pool),scene('')];
 applyVisualContinuity(story(),scenes,[{setting:'Golden sand, stone pier.',locationChange:0},{locationChange:0},{}]);
 expect(scenes[1].visuals?.setting).toBe(prior.visuals.setting);expect(scenes[2].location).toBe('Pool');expect(scenes[2].visuals).toEqual(scenes[1].visuals);
});
