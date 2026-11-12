import {useState} from "react";
import {ModalShell} from "./ModalShell";
import {useI18n} from "../shared/i18n";
import {hasSeenNovelAnnouncement,markNovelAnnouncementSeen} from "../shared/featureAnnouncements";
export function NovelFeatureNotice({enabled,onOpen}:{enabled:boolean;onOpen:()=>void}) {
  const {t}=useI18n();
  const [pending,setPending]=useState(()=>{try{return !hasSeenNovelAnnouncement(window.localStorage);}catch{return true;}});
  function dismiss(){try{markNovelAnnouncementSeen(window.localStorage);}catch{/* Unavailable storage. */}setPending(false);}
  if(!enabled || !pending)return null;
  return <ModalShell title={t("novel.announcement.title")} eyebrow={t("novel.announcement.new")} closeLabel={t("novel.announcement.dismiss")} onClose={dismiss} size="md" footer={<><button onClick={dismiss}>{t("novel.announcement.dismiss")}</button><button className="novel-primary" onClick={()=>{dismiss();onOpen();}}>{t("novel.announcement.open")}</button></>}>
    <div className="novel-announcement-copy"><p>{t("novel.announcement.body")}</p><p>{t("novel.announcement.navigation")}</p></div>
  </ModalShell>;
}
