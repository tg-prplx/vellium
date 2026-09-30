import { useEffect, useRef, useState, type ReactNode } from "react";
import { AvatarBadge } from "../../../components/AvatarBadge";
import { useI18n } from "../../../shared/i18n";
import { LiveIcon, type LiveIconName } from "./LiveIcon";

export interface LiveHeaderWarning {
  id: string;
  label: string;
  icon: LiveIconName;
  onClick: () => void;
}

const chevron = (
  <svg className="live-pill-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
  </svg>
);

/**
 * One row: who you talk to, what state the session is in, and the few choices that
 * change the conversation. Everything rarer lives behind the settings menu.
 */
export function LiveHeader({
  phaseLabel, characterName, characterAvatarUrl, personaName, modelLabel,
  chatId, sessions, busy, warnings, menu,
  onPickCharacter, onPickPersona, onSelectSession, onPickModel, onNewSession
}: {
  phaseLabel: string;
  characterName: string;
  characterAvatarUrl: string | null;
  personaName: string;
  modelLabel: string;
  chatId: string;
  sessions: Array<{ id: string; title: string }>;
  busy: boolean;
  warnings: LiveHeaderWarning[];
  menu: (close: () => void) => ReactNode;
  onPickCharacter: () => void;
  onPickPersona: () => void;
  onSelectSession: (sessionId: string) => void;
  onPickModel: () => void;
  onNewSession: () => void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      // Selects inside the menu open native popups; modals opened from it render outside.
      if (menuRef.current?.contains(target) || target?.closest?.("[role='dialog']")) return;
      setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [menuOpen]);

  const contextPills = (
    <>
      <button type="button" className="live-pill" onClick={onPickPersona} disabled={busy}
        data-modal-trigger="persona" title={t("live.persona")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 8a4 4 0 11-8 0 4 4 0 018 0zM5 20a7 7 0 0114 0" />
        </svg>
        <span>{personaName}</span>
      </button>
      <label className="live-pill live-pill-select" title={t("live.conversation")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5m-8 6l2.5-3H18a3 3 0 003-3V7a3 3 0 00-3-3H6a3 3 0 00-3 3v7a3 3 0 002 2.8V20z" />
        </svg>
        <select value={chatId} onChange={(event) => onSelectSession(event.target.value)} disabled={busy}
          aria-label={t("live.conversation")}>
          <option value="">{t("live.newConversation")}</option>
          {sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
        </select>
        {chevron}
      </label>
      <button type="button" className="live-pill" onClick={onPickModel} data-modal-trigger="live-model" title={t("live.model")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M7 5h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2zm3 5h4v4h-4z" />
        </svg>
        <span>{modelLabel}</span>
      </button>
    </>
  );

  return (
    <header className="live-header">
      <button type="button" className="live-identity" onClick={onPickCharacter} disabled={busy}
        data-modal-trigger="live-character" title={t("live.character")}>
        <AvatarBadge name={characterName} src={characterAvatarUrl} alt="" className="live-header-avatar" />
        <span className="live-identity-copy">
          <strong>{characterName}{chevron}</strong>
          <span className="live-status"><span className="live-status-dot" aria-hidden="true" />{phaseLabel}</span>
        </span>
      </button>

      <div className="live-header-context" aria-label={t("live.context")}>{contextPills}</div>

      <div className="live-header-actions">
        {warnings.map((warning) => (
          <button key={warning.id} type="button" className="live-quiet-button is-warning" onClick={warning.onClick}>
            <LiveIcon name={warning.icon} />
            <span>{warning.label}</span>
          </button>
        ))}
        <button type="button" className="live-quiet-button" onClick={onNewSession} disabled={busy} title={t("live.new")}>
          <LiveIcon name="plus" />
          <span>{t("live.new")}</span>
        </button>
        <div className="live-menu" ref={menuRef}>
          <button ref={triggerRef} type="button" className={`live-quiet-button is-icon${menuOpen ? " is-open" : ""}`}
            onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-haspopup="dialog"
            aria-label={t("live.controls")} title={t("live.controls")}>
            <LiveIcon name="settings" />
          </button>
          {menuOpen ? (
            <div className="live-menu-panel" role="dialog" aria-label={t("live.controls")}>
              {/* On narrow windows the header has no room for context, so it moves here. */}
              <div className="live-menu-context">{contextPills}</div>
              {menu(() => setMenuOpen(false))}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
