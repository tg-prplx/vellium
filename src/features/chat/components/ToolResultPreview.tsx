import { useState } from "react";
import type { FileAttachment } from "../../../shared/types/contracts";

export interface ToolResultMediaItem {
  type: "image";
  url: string;
  markdown?: string;
  alt?: string;
}

interface ToolResultPreviewProps {
  result: string;
  summary?: string;
  media?: ToolResultMediaItem[];
  onPreview: (attachment: FileAttachment) => void;
  t: (key: any) => string;
}

function ToolImagePreview({
  item,
  index,
  onPreview,
  t
}: {
  item: ToolResultMediaItem;
  index: number;
  onPreview: (attachment: FileAttachment) => void;
  t: (key: any) => string;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const label = item.alt || `${t("chat.generatedImage")} ${index + 1}`;

  return (
    <button
      type="button"
      className={`tool-result-image is-${state}`}
      onClick={() => onPreview({
        id: `tool-image-${index}-${item.url}`,
        filename: label,
        type: "image",
        url: item.url,
        mimeType: "image/*"
      })}
      disabled={state === "error"}
      aria-label={`${t("chat.previewImage")}: ${label}`}
      title={label}
    >
      <span className="tool-result-image-frame">
        {state === "loading" ? <span className="tool-result-image-skeleton" aria-hidden="true" /> : null}
        <img
          src={item.url}
          alt={label}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setState("ready")}
          onError={() => setState("error")}
        />
        {state === "error" ? (
          <span className="tool-result-image-error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 17l4.5-4.5 3 3L14 13l6 6M7 7h.01M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM4 4l16 16" />
            </svg>
            <span>{t("chat.imageUnavailable")}</span>
          </span>
        ) : null}
        {state === "ready" ? (
          <span className="tool-result-image-action" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 14v6h6M20 10V4h-6M14 4l6 6M10 20l-6-6" />
            </svg>
          </span>
        ) : null}
      </span>
      <span className="tool-result-image-label">{label}</span>
    </button>
  );
}

export function ToolResultPreview({ result, summary, media = [], onPreview, t }: ToolResultPreviewProps) {
  if (media.length === 0) {
    return <pre className="tool-result-code">{result || t("chat.empty")}</pre>;
  }

  return (
    <section className="tool-result-media" aria-label={t("chat.generatedMedia")}>
      <header className="tool-result-media-header">
        <span className="tool-result-media-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path strokeLinecap="round" strokeLinejoin="round" d="m7 16 3.5-3.5 2.5 2.5 2-2 3 3M8 9h.01" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="tool-result-media-title">{t("chat.generatedMedia")}</span>
          <span className="tool-result-media-summary">{summary || t("chat.imageReady")}</span>
        </span>
        <span className="tool-result-media-count">{media.length}</span>
      </header>
      <div className="tool-result-image-grid">
        {media.map((item, index) => (
          <ToolImagePreview key={`${item.url}-${index}`} item={item} index={index} onPreview={onPreview} t={t} />
        ))}
      </div>
    </section>
  );
}
