import type { ReactNode } from "react";
import { useI18n } from "../../../shared/i18n";
import type { LiveSttSource, LiveTtsSource } from "../utils";

/** Session-level settings grouped in the header menu instead of a second toolbar row. */
export function LiveSessionMenu({
  branchControl, reasoningControl,
  ttsSource, ttsLocked, customTtsLabel, onTtsSource,
  sttSource, sttLocked, systemSttAvailable, whisperLabel, onSttSource,
  onOpenChatControls
}: {
  branchControl: ReactNode;
  reasoningControl: ReactNode;
  ttsSource: LiveTtsSource;
  ttsLocked: boolean;
  customTtsLabel: string;
  onTtsSource: (source: LiveTtsSource) => void;
  sttSource: LiveSttSource;
  sttLocked: boolean;
  systemSttAvailable: boolean;
  whisperLabel: string;
  onSttSource: (source: LiveSttSource) => void;
  onOpenChatControls: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="live-session-menu">
      <section>
        <h3>{t("live.conversation")}</h3>
        <div className="live-session-menu-row">{branchControl}{reasoningControl}</div>
      </section>
      <section>
        <h3>{t("live.voiceSection")}</h3>
        <label className="live-session-field">
          <span>{t("live.tts")}</span>
          <select value={ttsSource} disabled={ttsLocked} onChange={(event) => onTtsSource(event.target.value as LiveTtsSource)}
            title={ttsSource === "custom" ? t("live.customTtsHint") : t("live.systemTtsHint")}>
            <option value="system">{t("live.systemTts")}</option>
            <option value="custom">{t("live.customTts")} · {customTtsLabel}</option>
          </select>
        </label>
        <label className="live-session-field">
          <span>{t("live.stt")}</span>
          <select value={sttSource} disabled={sttLocked} onChange={(event) => onSttSource(event.target.value as LiveSttSource)}
            title={sttSource === "whisper" ? t("live.whisperSttHint") : t("live.sttHint")}>
            <option value="system">{t("live.systemStt")} · {systemSttAvailable ? t("live.available") : t("live.sttUnavailable")}</option>
            <option value="whisper">{t("live.whisperStt")} · {whisperLabel}</option>
          </select>
        </label>
      </section>
      <button type="button" className="live-session-menu-link" onClick={onOpenChatControls}>
        <span>{t("live.chatControls")}</span>
        <small>{t("live.chatControlsShort")}</small>
      </button>
    </div>
  );
}
