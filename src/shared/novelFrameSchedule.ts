import type {NovelIllustration} from "./types/novels";
/** Keep the model's intentional cut points; never relocate duplicate shots onto
 * arbitrary dialogue lines. The opening image always starts at zero. When there
 * are more cuts than `max`, keep the opening and spread the rest evenly over
 * the scene, so pictures do not bunch up at its start. */
export function scheduleNovelFrames(frames:NovelIllustration[],lines:number,max=frames.length) {
  if(lines<1 || max<1)return [];
  const sorted=[...frames].sort((a,b)=>a.atLine-b.atLine);
  const cuts:NovelIllustration[]=[];const used=new Set<number>();const originalCuts=new Set<number>();
  for(const frame of sorted){
    const sourceLine=Math.max(0,Math.min(lines-1,Math.round(frame.atLine)));
    if(originalCuts.has(sourceLine))continue;originalCuts.add(sourceLine);
    const atLine=cuts.length?sourceLine:0;
    if(used.has(atLine))continue;
    cuts.push({...frame,atLine});used.add(atLine);
  }
  if(cuts.length<=max)return cuts;
  const chosen=[cuts[0]];const rest=cuts.slice(1);
  for(let k=1;k<max && rest.length;k++){
    const target=k*lines/max;
    let best=0;for(let i=1;i<rest.length;i++)if(Math.abs(rest[i].atLine-target)<Math.abs(rest[best].atLine-target))best=i;
    chosen.push(rest.splice(best,1)[0]);
  }
  return chosen.sort((a,b)=>a.atLine-b.atLine);
}
