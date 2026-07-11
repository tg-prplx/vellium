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
      <div key={cardKey} className="attachment-card is-compact">
        <button type="button" onClick={() => onPreview(attachment)} className="attachment-card-main">
          {imageSrc ? (
            <img src={imageSrc} alt={attachment.filename || t("chat.imageAttachment")} className="attachment-card-thumb" />
          ) : (
            <div className="attachment-card-file-icon">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          )}
          <div className="attachment-card-copy">
            <div className="attachment-card-name">{attachment.filename || t("chat.attachment")}</div>
            <div className="attachment-card-meta">{kindLabel}</div>
          </div>
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            className="attachment-card-remove"
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
        className="attachment-card is-image"
      >
        <div className="attachment-card-image-frame">
          <img src={imageSrc} alt={attachment.filename || t("chat.imageAttachment")} />
        </div>
        <div className="attachment-card-copy">
          <div className="attachment-card-name">{attachment.filename || t("chat.attachment")}</div>
          <div className="attachment-card-meta">{attachment.mimeType || kindLabel}</div>
        </div>
      </button>
    );
  }

  return (
    <button
      key={cardKey}
      type="button"
      onClick={() => onPreview(attachment)}
      className="attachment-card is-file"
    >
      <div className="attachment-card-file-icon">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <div className="attachment-card-copy">
        <div className="attachment-card-name">{attachment.filename || t("chat.attachment")}</div>
        <div className="attachment-card-meta">{attachment.mimeType || kindLabel}</div>
      </div>
    </button>
  );
}
