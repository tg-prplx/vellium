import type { NovelIllustration } from "../../shared/types/novels";
/** Old responses may use one-based positions or put every shot at zero. */
export function scheduledNovelFrames(frames: NovelIllustration[], lines: number) {
  let previous = -1;
  return [...frames].sort((a,b)=>a.atLine-b.atLine).slice(0,Math.max(1,lines)).map((frame,index)=>{
    const atLine=index===0?0:Math.min(Math.max(previous+1,frame.atLine),lines-(Math.min(frames.length,lines)-index));
    previous=atLine; return {...frame,atLine};
  });
}
