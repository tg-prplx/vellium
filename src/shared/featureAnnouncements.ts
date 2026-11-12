export const NOVEL_ANNOUNCEMENT_KEY="vellium:feature-announcement:novels:v1";
export function hasSeenNovelAnnouncement(storage: Pick<Storage,"getItem">) {
  try{return storage.getItem(NOVEL_ANNOUNCEMENT_KEY)==="seen";}catch{return false;}
}
export function markNovelAnnouncementSeen(storage: Pick<Storage,"setItem">) {
  try{storage.setItem(NOVEL_ANNOUNCEMENT_KEY,"seen");}catch{/* Session dismissal still works if storage is disabled. */}
}
