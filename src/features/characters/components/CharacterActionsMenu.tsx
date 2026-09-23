import { useEffect, useRef } from "react";
import { useI18n } from "../../../shared/i18n";

interface CharacterActionsMenuProps {
  deleteDisabled: boolean;
  exportDisabled: boolean;
  translateDisabled: boolean;
  translating: boolean;
  onDelete: () => void;
  onExport: () => void;
  onTranslate: () => void;
}

export function CharacterActionsMenu({
  deleteDisabled,
  exportDisabled,
  translateDisabled,
  translating,
  onDelete,
  onExport,
  onTranslate
}: CharacterActionsMenuProps) {
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
    <details ref={menuRef} className="character-actions-menu">
      <summary aria-label={t("chars.moreActions")} title={t("chars.moreActions")}>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </summary>
      <div className="character-actions-menu-panel">
        <button type="button" disabled={translateDisabled} onClick={() => run(onTranslate)}>
          <span>{translating ? t("chars.translatingCopy") : t("chars.translateCopy")}</span>
        </button>
        <button type="button" disabled={exportDisabled} onClick={() => run(onExport)}>
          <span>{t("chars.exportJson")}</span>
        </button>
        <button type="button" className="is-danger" disabled={deleteDisabled} onClick={() => run(onDelete)}>
          <span>{t("chat.delete")}</span>
        </button>
      </div>
    </details>
  );
}
