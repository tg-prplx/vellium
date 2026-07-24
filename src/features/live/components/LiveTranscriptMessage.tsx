import { useEffect, useState } from "react";
import { AvatarBadge } from "../../../components/AvatarBadge";
import { AttachmentCard, renderContentWithFallback } from "../../chat/public";
import { useI18n } from "../../../shared/i18n";
import type { AppSettings, ChatMessage, FileAttachment } from "../../../shared/types/contracts";

type LiveMessageAction = "edit" | "delete" | "translate" | "tts" | "fork";

const ACTION_PATHS: Record<LiveMessageAction, string> = {
  edit: "M4 20h4l10-10a2.8 2.8 0 10-4-4L4 16v4z",
  delete: "M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13",
  translate: "M4 6h10M9 4v2c0 4-2 7-5 9m3-4c1.5 2 3.5 3.5 5 4m2 5 4-10 4 10m-7-3h6",
  tts: "M11 5 6 9H3v6h3l5 4V5zm4.5 3.5a5 5 0 010 7m2.8-9.8a9 9 0 010 12.6",
  fork: "M7 4v7a4 4 0 004 4h6M7 4a2 2 0 100 4 2 2 0 000-4zm10 9a2 2 0 100 4 2 2 0 000-4z"
};

function ActionIcon({ name }: { name: LiveMessageAction }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d={ACTION_PATHS[name]} />
    </svg>
  );
}

interface LiveTranscriptMessageProps {
  message: ChatMessage;
  speakerName: string;
  avatarUrl?: string | null;
  characterName?: string;
  userName?: string;
  security?: AppSettings["security"];
  busy: boolean;
  translation?: string;
  translating: boolean;
  ttsLoading: boolean;
  ttsPlaying: boolean;
  onEdit: (messageId: string, content: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onTranslate: (messageId: string) => Promise<void>;
  onTts: (messageId: string) => Promise<void>;
  onFork: (messageId: string) => Promise<void>;
  onPreviewAttachment: (attachment: FileAttachment) => void;
}

export function LiveTranscriptMessage({
  message,
  speakerName,
  avatarUrl,
  characterName,
  userName,
  security,
  busy,
  translation,
  translating,
  ttsLoading,
  ttsPlaying,
  onEdit,
  onDelete,
  onTranslate,
  onTts,
  onFork,
  onPreviewAttachment
}: LiveTranscriptMessageProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const isAssistant = message.role === "assistant";
  const streaming = message.id === "live-streaming";

  useEffect(() => {
    if (!editing) setDraft(message.content);
  }, [editing, message.content]);

  async function save() {
    const content = draft.trim();
    if (!content) return;
    await onEdit(message.id, content);
    setEditing(false);
  }

  return (
    <article className={`live-message is-${message.role}${streaming ? " is-streaming" : ""}`}>
      <div className="live-message-head">
        {isAssistant ? (
          <AvatarBadge
            name={speakerName}
            src={avatarUrl || undefined}
            alt=""
            className="live-message-avatar"
          />
        ) : null}
        <span className="live-message-author">{speakerName}</span>
        {message.tokenCount > 0 ? <span className="live-message-badge">{message.tokenCount} tok</span> : null}
      </div>

      {editing ? (
        <div className="live-message-editor">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
          <div>
            <button type="button" className="is-primary" onClick={() => { void save(); }}>{t("chat.save")}</button>
            <button type="button" onClick={() => setEditing(false)}>{t("chat.cancel")}</button>
          </div>
        </div>
      ) : (
        <div
          className="live-message-body prose-chat"
          dangerouslySetInnerHTML={{
            __html: renderContentWithFallback(message.content, characterName, userName, security)
          }}
        />
      )}

      {translation && !editing ? (
        <div className="live-message-translation">
          <span>{t("chat.translate")}</span>
          <div
            className="prose-chat"
            dangerouslySetInnerHTML={{
              __html: renderContentWithFallback(translation, characterName, userName, security)
            }}
          />
        </div>
      ) : null}

      {message.attachments?.length ? (
        <div className="live-message-attachments">
          {message.attachments.map((attachment, index) => (
            <AttachmentCard
              key={`${message.id}-att-${attachment.id || index}`}
              cardKey={`${message.id}-att-${attachment.id || index}`}
              attachment={attachment}
              compact
              onPreview={onPreviewAttachment}
              t={t}
            />
          ))}
        </div>
      ) : null}

      {!streaming && !busy && !editing ? (
        <div className="live-message-actions">
          <button type="button" title={t("chat.edit")} aria-label={t("chat.edit")} onClick={() => setEditing(true)}>
            <ActionIcon name="edit" />
          </button>
          <button type="button" title={t("chat.delete")} aria-label={t("chat.delete")} onClick={() => { void onDelete(message.id); }}>
            <ActionIcon name="delete" />
          </button>
          <button
            type="button"
            title={translating ? t("chat.translating") : t("chat.translate")}
            aria-label={t("chat.translate")}
            disabled={translating}
            onClick={() => { void onTranslate(message.id); }}
          >
            <ActionIcon name="translate" />
          </button>
          {isAssistant ? (
            <button
              type="button"
              className={ttsPlaying ? "is-on" : ""}
              title={ttsPlaying ? t("chat.ttsStop") : t("chat.tts")}
              aria-label={t("chat.tts")}
              disabled={ttsLoading}
              onClick={() => { void onTts(message.id); }}
            >
              <ActionIcon name="tts" />
            </button>
          ) : null}
          <button type="button" title={t("chat.fork")} aria-label={t("chat.fork")} onClick={() => { void onFork(message.id); }}>
            <ActionIcon name="fork" />
          </button>
        </div>
      ) : null}
    </article>
  );
}
