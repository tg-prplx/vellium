import {expect,it} from "vitest";
import {hasSeenNovelAnnouncement,markNovelAnnouncementSeen,NOVEL_ANNOUNCEMENT_KEY} from "./featureAnnouncements";
it("shows the new feature once for existing installations and remembers dismissal across launches",()=>{
 const values=new Map([["vellium:welcome-tour:v1","completed"]]);const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
 expect(hasSeenNovelAnnouncement(storage)).toBe(false);markNovelAnnouncementSeen(storage);expect(hasSeenNovelAnnouncement(storage)).toBe(true);expect(values.get(NOVEL_ANNOUNCEMENT_KEY)).toBe("seen");expect(values.get("vellium:welcome-tour:v1")).toBe("completed");
});
it("does not break startup when storage is blocked",()=>{
 const storage={getItem:()=>{throw Error("blocked");},setItem:()=>{throw Error("blocked");}};
 expect(hasSeenNovelAnnouncement(storage)).toBe(false);expect(()=>markNovelAnnouncementSeen(storage)).not.toThrow();
});
