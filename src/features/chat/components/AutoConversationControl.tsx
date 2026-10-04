import { useI18n } from "../../../shared/i18n";

export interface AutoConversationProgress {
  done: number;
  total: number;
  speaker: string;
}

/**
 * Idle: turn count + start. Running: the same pill morphs into a progress bar with the
 * current speaker and a small stop button, so the state change reads as one motion.
 */
export function AutoConversationControl({ turns, onTurns, running, progress, disabled, onStart, onStop }: {
  turns: number;
  onTurns: (turns: number) => void;
  running: boolean;
  progress: AutoConversationProgress | null;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const { t } = useI18n();
  const total = progress?.total || turns;
  const done = progress?.done || 0;
  const percent = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const label = progress
    ? t("chat.autoConvoProgress").replace("{speaker}", progress.speaker).replace("{current}", String(Math.min(done + 1, total))).replace("{total}", String(total))
    : t("chat.autoConvoStarting");

  return (
    <div className={`auto-convo${running ? " is-running" : ""}`}>
      <div className="auto-convo-idle" aria-hidden={running}>
        <input type="number" min={1} max={50} value={turns} aria-label={t("chat.turns")} tabIndex={running ? -1 : undefined}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onTurns(Number.isFinite(parsed) ? Math.max(1, Math.min(50, Math.floor(parsed))) : 1);
          }} />
        <span>{t("chat.turns")}</span>
        <button type="button" className="auto-convo-start" onClick={onStart} disabled={disabled} tabIndex={running ? -1 : undefined}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5z" /></svg>
          {t("chat.autoConvoStart")}
        </button>
      </div>
      <div className="auto-convo-running" aria-hidden={!running}>
        <div className="auto-convo-track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label}>
          <div className="auto-convo-fill" style={{ width: `${percent}%` }} />
          <span className="auto-convo-label">{label}</span>
        </div>
        <button type="button" className="auto-convo-stop" onClick={onStop} tabIndex={running ? undefined : -1} aria-label={t("chat.autoConvoStop")} title={t("chat.autoConvoStop")}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
        </button>
      </div>
    </div>
  );
}
