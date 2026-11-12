import { IconButton } from "../../components/IconButton";
import { useState } from "react";
import { useI18n } from "../../shared/i18n";
import { ModalShell } from "../../components/ModalShell";
import { resolveApiAssetUrl } from "../../shared/api";
import { useNovelWorkspace } from "./useNovelWorkspace";
import { NovelSetup } from "./components/NovelSetup";
import { NovelReader } from "./components/NovelReader";
import type { NovelDraft } from "./setup";
export function NovelsScreen() {
  const { t } = useI18n(); const workspace = useNovelWorkspace();
  const [setup, setSetup] = useState(false); const [confirmDelete, setConfirmDelete] = useState<{id:string;title:string}|null>(null);
  const [confirmReset,setConfirmReset]=useState(false);const [readerEpoch,setReaderEpoch]=useState(0);
  const { story, busy } = workspace;
  const [draft, setDraft] = useState<NovelDraft | null>(null);
  const hasDraft = Boolean(draft?.title.trim() || draft?.config.premise.trim() || draft?.config.characterIds.length);
  function openSetup() { workspace.clearError(); setSetup(true); }
  const showNavigationHelp = () => window.dispatchEvent(new Event("vellium:novel-navigation-help"));
  return <div className="novels-workspace">
    {workspace.error && !setup && !confirmDelete && !confirmReset && <div role="alert" className="novel-error-banner"><span>{workspace.error}</span><button onClick={workspace.clearError} aria-label={t("chat.cancel")}>×</button></div>}
    {story ? <NovelReader key={`${story.id}:${readerEpoch}`} paused={setup || Boolean(confirmDelete) || confirmReset} story={story} busy={busy} onGenerate={workspace.generate} onSave={workspace.progress} onSettings={openSetup} onLibrary={workspace.close} onCancel={workspace.cancel} /> : <div className="novel-library">
      <aside><span className="novel-eyebrow">{t("novel.workspace")}</span><h1>{t("novel.library")}</h1><p>{t("novel.libraryHint")}</p><button className="novel-primary" onClick={openSetup}>{hasDraft ? "↗" : "＋"} {t(hasDraft ? "novel.setup.resumeDraft" : "novel.create")}</button>
        <button className="novel-library-help" onClick={showNavigationHelp}>{t("novel.setup.navigationHelp")}</button>
        <div className="novel-library-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M4 5c3-1 5-1 8 1 3-2 5-2 8-1v14c-3-1-5-1-8 1-3-2-5-2-8-1zM12 6v14" /></svg><span>{t("novel.libraryNote")}</span></div>
      </aside>
      <main>{workspace.loading ? <p className="novel-hint" role="status">{t("chat.loading")}</p> : workspace.list.length ? <div className="novel-books">{workspace.list.map((item) => <article className="novel-book-item" key={item.id}><button className="novel-book" disabled={busy} onClick={() => void workspace.open(item.id)}><div className="novel-book-cover" style={item.cover ? { backgroundImage: `url("${resolveApiAssetUrl(item.cover)}")` } : undefined}><span>{String(item.sceneCount).padStart(2, "0")}<small>{t("novel.scenes")}</small></span></div><h2>{item.title}</h2><p>{new Date(item.updatedAt).toLocaleDateString()}</p><span>{t("novel.resume")} →</span></button><IconButton label={t("novel.deleteNamed").replace("{title}",item.title)} disabled={busy} tone="danger" size="sm" className="novel-book-delete" onClick={()=>{workspace.clearError();setConfirmDelete({id:item.id,title:item.title});}} icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="16" height="16" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></svg>} /></article>)}</div> : <div className="novel-library-empty"><div className="novel-library-art" /><div><span className="novel-eyebrow">{t("novel.emptyEyebrow")}</span><h2>{t("novel.emptyTitle")}</h2><p>{t("novel.emptyHint")}</p><button onClick={openSetup}>{t(hasDraft ? "novel.setup.resumeDraft" : "novel.create")} →</button></div></div>}</main>
    </div>}
    {confirmDelete && <ModalShell title={t("novel.delete")} closeLabel={t("chat.cancel")} closeDisabled={busy} onClose={() => setConfirmDelete(null)} size="sm" footer={<><button disabled={busy} onClick={()=>setConfirmDelete(null)}>{t("chat.cancel")}</button><button className="novel-primary" disabled={busy} onClick={async () => { if(await workspace.remove(confirmDelete.id))setConfirmDelete(null); }}>{t(busy ? "novel.deleting" : "novel.delete")}</button></>}>
      <p>{t("novel.deleteNamed").replace("{title}",confirmDelete.title)}</p><p className="novel-hint">{t("novel.deleteConfirm")}</p>{workspace.error && <p role="alert" className="novel-error">{workspace.error}</p>}
    </ModalShell>}
    {confirmReset && story && <ModalShell title={t("novel.resetHistory")} closeLabel={t("chat.cancel")} closeDisabled={busy} onClose={()=>setConfirmReset(false)} size="sm" footer={<><button disabled={busy} onClick={()=>setConfirmReset(false)}>{t("chat.cancel")}</button><button className="novel-primary" disabled={busy} onClick={async()=>{if(await workspace.reset()){setReaderEpoch(n=>n+1);setConfirmReset(false);}}}>{t(busy?"chat.loading":"novel.resetHistory")}</button></>}>
      <p>{story.title}</p><p className="novel-hint">{t("novel.resetHistoryHint")}</p>{workspace.error && <p role="alert" className="novel-error">{workspace.error}</p>}
    </ModalShell>}
    {setup && <NovelSetup initial={story?.config} title={story?.title} onReset={story?()=>{setSetup(false);workspace.clearError();setConfirmReset(true);}:undefined} onDelete={story ? () => { setSetup(false); workspace.clearError(); setConfirmDelete({id:story.id,title:story.title}); } : undefined} busy={busy} draft={draft} onDraftChange={setDraft} submitError={workspace.error} onClose={() => { workspace.clearError(); setSetup(false); }} onSave={async (title, config) => {
      const saved = story ? await workspace.save({ title, config }) : await workspace.create(title, config);
      if (!saved) return;
      setSetup(false);
      if (!story) { setDraft(null); await workspace.generate("", undefined, false, saved); }
    }} />}
  </div>;
}
