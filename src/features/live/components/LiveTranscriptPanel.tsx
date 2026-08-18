import { useEffect, useRef, useState } from "react";
import { AvatarBadge } from "../../../components/AvatarBadge";
import { useI18n } from "../../../shared/i18n";
import type {
  AppSettings,
  ChatMessage,
  CharacterDetail,
  FileAttachment,
  UserPersona
} from "../../../shared/types/contracts";
import { LiveAttachmentButton, LiveAttachmentChips } from "./LiveAttachmentQueue";
import { LiveIcon } from "./LiveIcon";
import { LiveModelActivity, type LiveModelActivityCall } from "./LiveModelActivity";
import { LiveTranscriptMessage } from "./LiveTranscriptMessage";

/** Distance from the bottom, in pixels, within which the transcript keeps following new turns. */
const STICK_TO_BOTTOM_THRESHOLD = 120;

interface LiveTranscriptPanelProps {
  messages: ChatMessage[];
  character: CharacterDetail | null;
  characterAvatarUrl: string | null;
  persona: UserPersona | null;
  security?: AppSettings["security"];
  busy: boolean;
  uploading: boolean;
  error: string;
  draft: string;
  attachments: FileAttachment[];
  providerReady: boolean;
  speechInputAvailable: boolean;
  voicePhase: "ready" | "listening" | "thinking" | "speaking";
  voiceActionLabel: string;
  screenAttached: boolean;
  canRegenerate: boolean;
  streamingReply: string;
  toolCalls: LiveModelActivityCall[];
  reasoningCalls: LiveModelActivityCall[];
  reasoningText: string;
  translatedTexts: Record<string, string>;
  translatingId: string | null;
  ttsLoadingId: string | null;
  ttsPlayingId: string | null;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onVoiceAction: () => void;
  onUploadFiles: (files: File[]) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onRegenerate: () => void;
  onOpenProviderSettings: () => void;
  onEditMessage: (messageId: string, content: string) => Promise<void>;
  onDeleteMessage: (messageId: string) => Promise<void>;
  onTranslateMessage: (messageId: string) => Promise<void>;
  onTtsMessage: (messageId: string) => Promise<void>;
  onForkMessage: (messageId: string) => Promise<void>;
  onPreviewAttachment: (attachment: FileAttachment) => void;
}

export function LiveTranscriptPanel({
  messages,
  character,
  characterAvatarUrl,
  persona,
  security,
  busy,
  uploading,
  error,
  draft,
  attachments,
  providerReady,
  speechInputAvailable,
  voicePhase,
  voiceActionLabel,
  screenAttached,
  canRegenerate,
  streamingReply,
  toolCalls,
  reasoningCalls,
  reasoningText,
  translatedTexts,
  translatingId,
  ttsLoadingId,
  ttsPlayingId,
  onDraftChange,
  onSubmit,
  onVoiceAction,
  onUploadFiles,
  onRemoveAttachment,
  onRegenerate,
  onOpenProviderSettings,
  onEditMessage,
  onDeleteMessage,
  onTranslateMessage,
  onTtsMessage,
  onForkMessage,
  onPreviewAttachment
}: LiveTranscriptPanelProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const userName = persona?.name || t("live.you");
  const voiceActive = voicePhase !== "ready" || busy;

  const scrollToLatest = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  };

  // Hands-free conversations grow the transcript while nobody is touching it, so follow the newest
  // turn unless the user has scrolled back to read something earlier. Avatars and attachment
  // thumbnails settle after the first layout pass, so keep re-pinning while the content grows.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const pinToBottom = () => {
      if (!stickToBottomRef.current) return;
      scroller.scrollTop = scroller.scrollHeight;
      setShowJumpToLatest(false);
    };
    pinToBottom();
    const observer = new ResizeObserver(pinToBottom);
    for (const child of Array.from(scroller.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [messages.length, streamingReply]);

  return (
    <section className="live-transcript" aria-label={t("live.transcript")}>
      <div className="live-transcript-heading">
        <div>
          <span>{t("live.transcript")}</span>
          <small>{messages.length ? t("live.savedInChat") : t("live.privateUntilShared")}</small>
        </div>
        <div className="live-transcript-actions">
          {screenAttached ? <b>{t("live.screenAttached")}</b> : null}
          <button type="button" onClick={onRegenerate} disabled={!canRegenerate}>
            {t("live.regenerate")}
          </button>
        </div>
      </div>

      <div className="live-model-activity-slot">
        <LiveModelActivity toolCalls={toolCalls} reasoningCalls={reasoningCalls} reasoningText={reasoningText} />
      </div>

      <div className="live-message-viewport">
        <div
          className="live-message-list"
          aria-live="polite"
          ref={scrollRef}
          onScroll={(event) => {
            const scroller = event.currentTarget;
            const atBottom =
              scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < STICK_TO_BOTTOM_THRESHOLD;
            stickToBottomRef.current = atBottom;
            setShowJumpToLatest(!atBottom);
          }}
        >
        {messages.length === 0 ? (
          <div className="live-empty">
            {character ? (
              <AvatarBadge name={character.name} src={characterAvatarUrl} alt="" className="live-empty-avatar" />
            ) : <LiveIcon name="voice" />}
            <strong>{character?.name || t("live.emptyTitle")}</strong>
            <span>
              {character?.greeting
                ? character.greeting.slice(0, 220)
                : (speechInputAvailable ? t("live.emptyHint") : t("live.emptyTextHint"))}
            </span>
          </div>
        ) : messages.map((message) => (
          <LiveTranscriptMessage
            key={message.id}
            message={message}
            speakerName={message.role === "user"
              ? userName
              : (message.characterName || character?.name || t("live.assistant"))}
            avatarUrl={message.role === "assistant" ? characterAvatarUrl : null}
            characterName={message.characterName || character?.name}
            userName={userName}
            security={security}
            busy={busy}
            translation={translatedTexts[message.id]}
            translating={translatingId === message.id}
            ttsLoading={ttsLoadingId === message.id}
            ttsPlaying={ttsPlayingId === message.id}
            onEdit={onEditMessage}
            onDelete={onDeleteMessage}
            onTranslate={onTranslateMessage}
            onTts={onTtsMessage}
            onFork={onForkMessage}
            onPreviewAttachment={onPreviewAttachment}
          />
        ))}
        </div>
        {showJumpToLatest ? (
          <button type="button" className="live-jump-latest" onClick={scrollToLatest}>
            {t("live.jumpToLatest")}
          </button>
        ) : null}
      </div>

      <form
        className="live-compose"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {error ? (
          <div className="live-error" role="alert">
            <span>{error}</span>
            {!providerReady ? (
              <button type="button" onClick={onOpenProviderSettings}>{t("live.openSettings")}</button>
            ) : null}
          </div>
        ) : null}
        <LiveAttachmentChips attachments={attachments} onRemove={onRemoveAttachment} />
        <div className="live-compose-row">
          <LiveAttachmentButton busy={busy} uploading={uploading} onFiles={onUploadFiles} />
          <textarea
            className="live-compose-input"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if ((draft.trim() || attachments.length > 0) && !busy && !uploading) onSubmit();
              }
            }}
            placeholder={t("live.placeholder")}
            aria-label={t("live.placeholder")}
            disabled={busy}
            rows={1}
          />
          <button
            type="button"
            className={`live-compose-voice${voiceActive ? " is-active" : ""}`}
            onClick={onVoiceAction}
            disabled={!speechInputAvailable && !voiceActive}
            aria-label={voiceActionLabel}
            title={voiceActionLabel}
            aria-pressed={voicePhase === "listening"}
          >
            <LiveIcon name={voiceActive ? "stop" : "mic"} />
          </button>
          <button
            type="submit"
            disabled={(!draft.trim() && attachments.length === 0) || busy || uploading}
            aria-label={t("live.send")}
          >
            <LiveIcon name="send" />
          </button>
        </div>
        <small>{screenAttached ? t("live.nextFrameHint") : t("live.screenOffHint")}</small>
      </form>
    </section>
  );
}
