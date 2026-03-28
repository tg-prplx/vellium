import type { FileAttachment } from "../../../shared/types/contracts";

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
    <div
      className="overlay-animate fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-6"
      onClick={onClose}
    >
      <div
        className={`modal-pop w-full overflow-hidden rounded-2xl border border-border bg-bg-secondary shadow-2xl ${
          viewer.mode === "image" ? "max-w-6xl" : "max-w-4xl"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text-primary">
              {viewer.attachment.filename || t("chat.attachment")}
            </div>
            <div className="truncate text-[11px] text-text-tertiary">
              {viewer.attachment.mimeType || (viewer.mode === "image" ? t("chat.imageAttachment") : t("chat.textAttachment"))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void onOpenRaw(viewer.attachment);
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            >
              {t("chat.openAttachment")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            >
              {t("chat.closePreview")}
            </button>
          </div>
        </div>
        {viewer.mode === "image" ? (
          <div className="flex max-h-[78vh] items-center justify-center overflow-auto bg-bg-primary p-4">
            <img
              src={viewer.previewUrl || undefined}
              alt={viewer.attachment.filename || t("chat.imageAttachment")}
              className="max-h-[72vh] max-w-full rounded-xl object-contain"
            />
          </div>
        ) : (
          <div className="max-h-[72vh] overflow-auto bg-bg-primary p-4">
            <pre className="whitespace-pre-wrap break-words rounded-xl border border-border-subtle bg-bg-secondary p-4 font-mono text-xs leading-relaxed text-text-secondary">
              {viewer.attachment.content || t("chat.noAttachmentPreview")}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
