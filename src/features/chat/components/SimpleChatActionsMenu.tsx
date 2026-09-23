import { useEffect, useRef } from "react";
import { useI18n } from "../../../shared/i18n";

interface SimpleChatActionsMenuProps {
  compressDisabled: boolean;
  compressing: boolean;
  exportDisabled: boolean;
  exporting: boolean;
  onCompress: () => void;
  onExport: () => void;
}

export function SimpleChatActionsMenu({
  compressDisabled,
  compressing,
  exportDisabled,
  exporting,
  onCompress,
  onExport
}: SimpleChatActionsMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDetailsElement>(null);

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

  function run(action: () => void) {
    menuRef.current?.removeAttribute("open");
    menuRef.current?.querySelector("summary")?.focus();
    action();
  }

  return (
    <details ref={menuRef} className="chat-simple-more-menu">
      <summary className={`chat-simple-thread-action-btn chat-simple-more-menu-trigger ${compressing || exporting ? "is-active" : ""}`} aria-label={t("chat.moreActions")} title={t("chat.moreActions")}>
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </summary>
      <div className="chat-simple-more-menu-panel">
        <button type="button" disabled={compressDisabled || compressing} onClick={() => run(onCompress)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          <span>{compressing ? t("chat.compressing") : t("chat.compress")}</span>
        </button>
        <button type="button" disabled={exportDisabled || exporting} onClick={() => run(onExport)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 3.75h7.25L18 8v12.25H6.5V3.75Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.75 3.75V8H18M10.25 11c-.9 0-1.25.55-1.25 1.5S8.65 14 7.75 14m6-3c.9 0 1.25.55 1.25 1.5s.35 1.5 1.25 1.5" />
          </svg>
          <span>{exporting ? t("chat.exporting") : t("chat.exportJson")}</span>
        </button>
      </div>
    </details>
  );
}
