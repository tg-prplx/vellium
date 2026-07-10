import type { FileAttachment } from "../../../shared/types/contracts";
import { ModalShell } from "../../../components/ModalShell";

export interface AttachmentViewerState {
  attachment: FileAttachment;
  mode: "image" | "text";
  previewUrl?: string | null;
}

interface AttachmentPreviewModalProps {
  viewer: AttachmentViewerState | null;
  onClose: () => void;
  onOpenRaw: (attachment: FileAttachment) => void | Promise<void>;
  t: (key: any) => string;
}

export function AttachmentPreviewModal({
  viewer,
  onClose,
  onOpenRaw,
  t
}: AttachmentPreviewModalProps) {
  if (!viewer) return null;

  return (
    <ModalShell
      title={viewer.attachment.filename || t("chat.attachment")}
      description={viewer.attachment.mimeType || (viewer.mode === "image" ? t("chat.imageAttachment") : t("chat.textAttachment"))}
      closeLabel={t("chat.closePreview")}
      onClose={onClose}
      size={viewer.mode === "image" ? "viewport" : "xl"}
      originId="attachment-preview"
      surfaceClassName="attachment-preview-modal"
      bodyClassName="attachment-preview-body"
      icon={viewer.mode === "image" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m7 16 3.5-3.5 2.5 2.5 2-2 3 3M8 9h.01" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 3h7l5 5v13H7zM14 3v6h5M10 13h6M10 17h6" />
        </svg>
      )}
      headerActions={(
        <button type="button" onClick={() => void onOpenRaw(viewer.attachment)} className="vellium-button vellium-button-secondary">
          {t("chat.openAttachment")}
        </button>
      )}
    >
        {viewer.mode === "image" ? (
          <div className="attachment-preview-canvas">
            <img
              src={viewer.previewUrl || undefined}
              alt={viewer.attachment.filename || t("chat.imageAttachment")}
              className="attachment-preview-image"
            />
          </div>
        ) : (
          <div className="attachment-preview-text-wrap">
            <pre className="attachment-preview-text">
              {viewer.attachment.content || t("chat.noAttachmentPreview")}
            </pre>
          </div>
        )}
    </ModalShell>
  );
}
