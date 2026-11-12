import type {NovelIllustration} from "./types/novels";
/** Keep the model's intentional cut points; never relocate duplicate shots onto
 * arbitrary dialogue lines. The opening image always starts at zero. */
export function scheduleNovelFrames(frames:NovelIllustration[],lines:number,max=frames.length) {
  if(lines<1 || max<1)return [];
  const sorted=[...frames].sort((a,b)=>a.atLine-b.atLine);
  const result:NovelIllustration[]=[];const used=new Set<number>();const originalCuts=new Set<number>();
  for(const frame of sorted){
    const sourceLine=Math.max(0,Math.min(lines-1,Math.round(frame.atLine)));
    if(originalCuts.has(sourceLine))continue;originalCuts.add(sourceLine);
    const atLine=result.length?Math.max(0,Math.min(lines-1,Math.round(frame.atLine))):0;
    if(used.has(atLine))continue;
    result.push({...frame,atLine});used.add(atLine);if(result.length>=max)break;
  }
  return result;
}
