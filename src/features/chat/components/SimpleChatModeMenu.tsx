import { useEffect, useRef } from "react";
import { useI18n } from "../../../shared/i18n";
import type { ChatMode } from "../constants";

const MODE_OPTIONS = [
  { mode: "pure_chat", label: "inspector.modePureChat", hint: "chat.modeMenuPureHint", icon: "M8.5 18.5H7a3 3 0 01-3-3v-7a3 3 0 013-3h10a3 3 0 013 3v7a3 3 0 01-3 3h-4l-3.5 2.5v-2.5z" },
  { mode: "light_rp", label: "inspector.modeLightRp", hint: "chat.modeMenuLightHint", icon: "M12 4a4 4 0 110 8 4 4 0 010-8zM5 20a7 7 0 0114 0" },
  { mode: "rp", label: "inspector.modeRp", hint: "chat.modeMenuRpHint", icon: "M9 4a3 3 0 110 6 3 3 0 010-6zm7 2a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM3 20a6 6 0 0112 0m1-5a5 5 0 015 5" }
] as const;

// The chat mode decides which prompts reach the model, so it lives next to the
// model picker instead of being buried in Context Setup.
export function SimpleChatModeMenu({ chatMode, disabled, onChange }: {
  chatMode: ChatMode;
  disabled?: boolean;
  onChange: (mode: ChatMode) => void;
}) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const current = MODE_OPTIONS.find((option) => option.mode === chatMode) ?? MODE_OPTIONS[2];

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) menuRef.current?.removeAttribute("open");
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !menuRef.current?.open) return;
      event.preventDefault();
      event.stopPropagation();
      menuRef.current.removeAttribute("open");
      menuRef.current.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function choose(mode: ChatMode) {
    menuRef.current?.removeAttribute("open");
    menuRef.current?.querySelector("summary")?.focus();
    onChange(mode);
  }

  return (
    <details ref={menuRef} className={`chat-simple-more-menu chat-simple-mode-menu ${disabled ? "is-disabled" : ""}`}>
      <summary
        className="chat-simple-bar-model chat-simple-more-menu-trigger"
        title={`${t("inspector.chatMode")}: ${t(current.label)}`}
        aria-label={`${t("inspector.chatMode")}: ${t(current.label)}`}
        onClick={(event) => { if (disabled) event.preventDefault(); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d={current.icon} />
        </svg>
        <span className="truncate">{t(current.label)}</span>
      </summary>
      <div className="chat-simple-more-menu-panel" role="menu" aria-label={t("inspector.chatMode")}>
        <div className="chat-simple-mode-menu-title">{t("chat.modeMenuTitle")}</div>
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            role="menuitemradio"
            aria-checked={option.mode === chatMode}
            className={option.mode === chatMode ? "is-active" : ""}
            onClick={() => choose(option.mode)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d={option.icon} />
            </svg>
            <span className="chat-simple-mode-menu-text">
              <b>{t(option.label)}</b>
              <small>{t(option.hint)}</small>
            </span>
            {option.mode === chatMode && (
              <svg className="chat-simple-mode-menu-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </details>
  );
}
