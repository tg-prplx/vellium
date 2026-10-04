import { useEffect, useId, useState } from "react";
import { useI18n } from "../../../shared/i18n";

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const NEAR_LIMIT_RATIO = 0.85;

interface Props {
  /** Prompt tokens of the last request in this branch. */
  usedTokens?: number;
  estimated?: boolean;
  windowTokens?: number;
  reservedTokens?: number;
  onOpen: () => void;
  /** Called when the details are revealed so the budget can be re-read cheaply. */
  onPeek?: () => void;
}

function formatTokens(value: number, locale: string) {
  return value.toLocaleString(locale);
}

export function ContextMeter({ usedTokens, estimated = false, windowTokens, reservedTokens = 0, onOpen, onPeek }: Props) {
  const { t, locale } = useI18n();
  const tooltipId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const hasUsage = usedTokens !== undefined && Number.isFinite(usedTokens);
  const hasWindow = windowTokens !== undefined && windowTokens > 0;
  const used = hasUsage ? Math.max(0, usedTokens as number) : 0;
  const usedRatio = hasUsage && hasWindow ? Math.min(1, used / (windowTokens as number)) : 0;
  const reserveRatio = hasUsage && hasWindow ? Math.min(1 - usedRatio, reservedTokens / (windowTokens as number)) : 0;
  const pressure = hasUsage && hasWindow ? (used + reservedTokens) / (windowTokens as number) : 0;
  const tone = pressure > 1 ? "is-over" : pressure >= NEAR_LIMIT_RATIO ? "is-near" : "";
  const percent = hasUsage && hasWindow ? Math.round((used / (windowTokens as number)) * 100) : null;
  const approx = estimated ? "≈" : "";
  const percentLabel = percent === null ? "—" : `${approx}${percent}%`;
  const available = hasUsage && hasWindow ? Math.max(0, (windowTokens as number) - used - reservedTokens) : null;

  const show = () => {
    if (!open) onPeek?.();
    setOpen(true);
  };

  return (
    <span className={`chat-context-ring-wrap ${tone}`} onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="chat-simple-bar-model chat-context-ring"
        onClick={() => { setOpen(false); onOpen(); }}
        onFocus={(event) => {
          // Focus restored after closing the dialog is not keyboard navigation; only show details for focus-visible.
          if (event.currentTarget.matches(":focus-visible")) show();
        }}
        onBlur={() => setOpen(false)}
        aria-haspopup="dialog"
        aria-describedby={open ? tooltipId : undefined}
        aria-label={t("context.meterAria").replace("{percent}", percentLabel)}
      >
        <svg viewBox="0 0 18 18" aria-hidden="true" className="chat-context-ring-icon">
          <circle className="chat-context-ring-track" cx="9" cy="9" r={RADIUS} />
          {reserveRatio > 0 && (
            <circle className="chat-context-ring-reserve" cx="9" cy="9" r={RADIUS}
              strokeDasharray={`${reserveRatio * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              strokeDashoffset={-usedRatio * CIRCUMFERENCE} />
          )}
          {usedRatio > 0 && (
            <circle className="chat-context-ring-used" cx="9" cy="9" r={RADIUS}
              strokeDasharray={`${usedRatio * CIRCUMFERENCE} ${CIRCUMFERENCE}`} />
          )}
        </svg>
        {percent !== null && <span className="chat-context-ring-value">{percentLabel}</span>}
      </button>
      {open && (
        <div role="tooltip" id={tooltipId} className="chat-context-ring-tooltip">
          <div className="chat-context-ring-tooltip-head">
            <span>{t("context.title")}</span>
            <b>{percentLabel}</b>
          </div>
          {hasUsage ? (
            <>
              <div className="chat-context-ring-tooltip-total">
                {approx}{formatTokens(used, locale)}
                {hasWindow && <small> / {formatTokens(windowTokens as number, locale)} tok</small>}
              </div>
              {hasWindow && (
                <div className={`context-meter chat-context-ring-bar ${pressure > 1 ? "is-over" : ""}`} aria-hidden="true">
                  <span style={{ width: `${usedRatio * 100}%` }} />
                  <i style={{ width: `${reserveRatio * 100}%` }} />
                </div>
              )}
              <dl className="chat-context-ring-rows">
                <div><dt>{t("context.lastRequest")}</dt><dd>{approx}{formatTokens(used, locale)}</dd></div>
                {hasWindow && <div><dt>{t("context.replyReserve")}</dt><dd>{formatTokens(reservedTokens, locale)}</dd></div>}
                {available !== null && <div><dt>{t("context.free")}</dt><dd>{formatTokens(available, locale)}</dd></div>}
              </dl>
              {tone && <p className="chat-context-ring-note">{t("context.meterNearLimit")}</p>}
            </>
          ) : (
            <p className="chat-context-ring-note">{t("context.meterEmpty")}</p>
          )}
          <p className="chat-context-ring-hint">{t("context.meterOpen")}</p>
        </div>
      )}
    </span>
  );
}
