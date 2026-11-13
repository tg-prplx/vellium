import { useState } from "react";
import { ModalShell } from "../../../components/ModalShell";
import { useI18n } from "../../../shared/i18n";
import type { NovelAsset, NovelIllustration, NovelScene } from "../../../shared/types/novels";

type Picture = NovelIllustration | NovelAsset;
/** User-started picture actions. Each one is a deliberate click; nothing here
 * runs on its own. `picture` is what the stage shows now: a frame, or in
 * layers mode the background. */
export function NovelImageTools({ picture, scene, lineIndex, busy, onEdit, onAdd }: {
  picture?: Picture; scene?: NovelScene; lineIndex: number; busy: boolean;
  onEdit: (id: string, patch: { prompt?: string; reseed?: boolean }) => Promise<unknown>;
  onAdd: (sceneId: string, atLine: number, prompt: string) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<"edit" | "add" | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const line = scene?.lines[lineIndex];
  const asset = picture && "kind" in picture;
  async function run(action: () => Promise<unknown>) {
    if (pending || busy) return;
    setPending(true);
    try { setDialog(null); await action(); } finally { setPending(false); }
  }
  const disabled = busy || pending;
  return <>
    {picture && picture.status !== "pending" && <button disabled={disabled} title={t("novel.redrawHint")} onClick={() => void run(() => onEdit(picture.id, { reseed: true }))}>{t("novel.redraw")}</button>}
    {picture && <button disabled={disabled} onClick={() => { setDraft(picture.prompt); setDialog("edit"); }}>{t("novel.editPicture")}</button>}
    {scene && line && <button disabled={disabled} onClick={() => { setDraft(""); setDialog("add"); }}>{t("novel.pictureForLine")}</button>}
    {dialog && <ModalShell size="md" title={t(dialog === "edit" ? "novel.editPicture" : "novel.pictureForLine")} closeLabel={t("chat.cancel")} onClose={() => setDialog(null)}
      footer={<><button onClick={() => setDialog(null)}>{t("chat.cancel")}</button>
        <button className="novel-primary" disabled={disabled || (dialog === "edit" && !draft.trim())} onClick={() => void run(() => dialog === "edit" && picture ? onEdit(picture.id, { prompt: draft.trim() }) : onAdd(scene!.id, lineIndex, draft.trim()))}>{t(dialog === "edit" ? "novel.redrawPicture" : "novel.addPicture")}</button></>}>
      <label className="novel-field"><span>{t("novel.pictureDescription")}</span>
        <textarea rows={dialog === "edit" && asset ? 8 : 4} maxLength={4000} value={draft} placeholder={dialog === "add" ? line?.text : undefined} onChange={(e) => setDraft(e.target.value)} autoFocus />
        <p>{t(dialog === "add" ? "novel.pictureForLineHint" : asset ? "novel.pictureAssetHint" : "novel.pictureDescriptionHint")}</p>
      </label>
    </ModalShell>}
  </>;
}
