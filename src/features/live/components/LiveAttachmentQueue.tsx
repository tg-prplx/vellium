import { useI18n } from "../../../shared/i18n";
import type { FileAttachment } from "../../../shared/types/contracts";

export function LiveAttachmentChips({
  attachments,
  onRemove
}: {
  attachments: FileAttachment[];
  onRemove: (attachmentId: string) => void;
}) {
  const { t } = useI18n();
  if (!attachments.length) return null;
  return <div className="mb-2 flex flex-wrap gap-2">
    {attachments.map((attachment) => (
      <span key={attachment.id} className="flex max-w-full items-center gap-1 rounded-lg border border-border-subtle bg-bg-primary px-2 py-1 text-xs text-text-secondary">
        <span className="truncate">{attachment.filename}</span>
        <button type="button" onClick={() => onRemove(attachment.id)} aria-label={t("chat.delete")}>×</button>
      </span>
    ))}
  </div>;
}

export function LiveAttachmentButton({
  busy,
  uploading,
  onFiles
}: {
  busy: boolean;
  uploading: boolean;
  onFiles: (files: File[]) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <input id="live-attachment-input" type="file" multiple hidden disabled={busy || uploading} onChange={(event) => {
        onFiles(Array.from(event.target.files || []));
        event.target.value = "";
      }} />
      <label className="live-compose-attach" htmlFor="live-attachment-input" aria-disabled={busy || uploading} aria-label={t("chat.attachFile")} title={t("chat.attachFile")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" /></svg>
      </label>
    </>
  );
}
