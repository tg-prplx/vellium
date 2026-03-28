import type { FileAttachment } from "../../../shared/types/contracts";
import { imageSourceFromAttachment } from "../utils";

interface AttachmentCardProps {
  attachment: FileAttachment;
  cardKey?: string;
  compact?: boolean;
  onPreview: (attachment: FileAttachment) => void;
  onRemove?: (attachmentId: string) => void;
  t: (key: any) => string;
}

export function AttachmentCard({
  attachment,
  cardKey,
  compact = false,
  onPreview,
  onRemove,
  t
}: AttachmentCardProps) {
  const imageSrc = imageSourceFromAttachment(attachment);
  const kindLabel = imageSrc
    ? t("chat.imageAttachment")
    : (attachment.mimeType?.split("/")[1] || t("chat.textAttachment"));

  if (compact) {
    return (
      <div key={cardKey} className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-bg-primary/80 px-2 py-1.5">
        <button type="button" onClick={() => onPreview(attachment)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {imageSrc ? (
            <img src={imageSrc} alt={attachment.filename || t("chat.imageAttachment")} className="h-8 w-8 rounded-md object-cover" />
          ) : (
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-border-subtle bg-bg-secondary text-text-tertiary">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium text-text-primary">{attachment.filename || t("chat.attachment")}</div>
            <div className="truncate text-[10px] text-text-tertiary">{kindLabel}</div>
          </div>
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            className="rounded-md p-1 text-text-tertiary hover:bg-bg-hover hover:text-danger"
            title={t("chat.delete")}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  if (imageSrc) {
    return (
      <button
        key={cardKey}
        type="button"
        onClick={() => onPreview(attachment)}
        className="flex w-[164px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-primary text-left"
      >
        <div className="flex min-h-[88px] w-full items-center justify-center overflow-hidden bg-bg-secondary">
          <img src={imageSrc} alt={attachment.filename || t("chat.imageAttachment")} className="h-full w-full object-cover" />
        </div>
        <div className="px-2.5 py-2">
          <div className="truncate text-[11px] font-medium text-text-primary">{attachment.filename || t("chat.attachment")}</div>
          <div className="mt-0.5 truncate text-[10px] text-text-tertiary">{attachment.mimeType || kindLabel}</div>
        </div>
      </button>
    );
  }

  return (
    <button
      key={cardKey}
      type="button"
      onClick={() => onPreview(attachment)}
      className="inline-flex min-w-0 max-w-[260px] items-center gap-2 rounded-lg border border-border bg-bg-primary px-2.5 py-1.5 text-left hover:bg-bg-hover"
    >
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-border-subtle bg-bg-secondary text-text-tertiary">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium text-text-primary">{attachment.filename || t("chat.attachment")}</div>
        <div className="truncate text-[10px] text-text-tertiary">{attachment.mimeType || kindLabel}</div>
      </div>
    </button>
  );
}
