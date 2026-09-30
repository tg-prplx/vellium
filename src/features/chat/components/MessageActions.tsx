import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "../../../components/IconButton";
import { useI18n } from "../../../shared/i18n";

const MENU_HEIGHT_ESTIMATE = 176;

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Clipboard API can be unavailable in some embedded contexts; fall back below.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("Copy failed");
}

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">{path}</svg>
);

/** Frequent actions stay visible; rarer ones live in an overflow menu. */
export function MessageActions({
  copyText,
  busy,
  onEdit,
  onDelete,
  deleting,
  onRegenerate,
  onFork,
  onTranslateSide,
  onTranslateInPlace,
  translating,
  tts,
  alignEnd,
  extra
}: {
  copyText: string;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  /** Only the latest reply can be regenerated. */
  onRegenerate?: () => void;
  onFork: () => void;
  onTranslateSide: () => void;
  onTranslateInPlace: () => void;
  translating: boolean;
  tts?: { loading: boolean; playing: boolean; onToggle: () => void };
  alignEnd: boolean;
  extra?: ReactNode;
}) {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<"up" | "down">("up");
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
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

  // Open downward when the scroll area has no room above the trigger.
  useLayoutEffect(() => {
    if (!menuOpen || !triggerRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const scrollTop = triggerRef.current.closest(".chat-scroll")?.getBoundingClientRect().top ?? 0;
    setMenuPlacement(trigger.top - scrollTop < MENU_HEIGHT_ESTIMATE ? "down" : "up");
  }, [menuOpen]);

  async function copy() {
    try {
      await writeClipboard(copyText);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyState("idle"), 1600);
  }

  function run(action: () => void) {
    setMenuOpen(false);
    action();
  }

  const copyLabel = copyState === "copied" ? t("chat.copiedMessage") : copyState === "failed" ? t("chat.copyFailed") : t("chat.copyMessage");

  return (
    <div className={`message-actions mt-2 flex flex-wrap items-center gap-1 ${menuOpen ? "is-menu-open" : ""}`}>
      <IconButton
        label={copyLabel}
        onClick={() => { void copy(); }}
        size="sm"
        tone={copyState === "copied" ? "accent" : "neutral"}
        className="message-icon-button"
        icon={copyState === "copied"
          ? icon(<path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" />)
          : icon(<><rect x="8" y="8" width="12" height="12" rx="2.5" /><path strokeLinecap="round" strokeLinejoin="round" d="M16 8V6.5A2.5 2.5 0 0013.5 4h-7A2.5 2.5 0 004 6.5v7A2.5 2.5 0 006.5 16H8" /></>)}
      />
      <IconButton
        label={t("chat.edit")}
        onClick={onEdit}
        size="sm"
        className="message-icon-button"
        icon={icon(<path strokeLinecap="round" strokeLinejoin="round" d="M4 20h4l10.5-10.5a2.12 2.12 0 00-3-3L5 17v3zM13.5 8.5l3 3" />)}
      />
      {onRegenerate && (
        <IconButton
          label={t("chat.regenerate")}
          onClick={onRegenerate}
          disabled={busy}
          size="sm"
          className="message-icon-button"
          icon={icon(<path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h4.586M20 20v-5h-4.586M4.93 9A8 8 0 0119.07 9M19.07 15A8 8 0 014.93 15" />)}
        />
      )}
      <IconButton
        label={t("chat.delete")}
        onClick={onDelete}
        disabled={deleting}
        size="sm"
        tone="danger"
        className="message-icon-button"
        icon={icon(<path strokeLinecap="round" strokeLinejoin="round" d="M5 7h14M9 7V4h6v3m-8 0l1 13h8l1-13M10 11v5m4-5v5" />)}
      />
      <div ref={menuRef} className="message-more-menu">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className={`ui-icon-button is-neutral is-sm message-icon-button ${tts?.playing || translating ? "is-active" : ""}`}
          aria-label={t("chat.messageMoreActions")}
          title={t("chat.messageMoreActions")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
        {menuOpen && (
          <div role="menu" className={`message-more-menu-panel is-${menuPlacement} ${alignEnd ? "is-end" : ""}`}>
            <button type="button" role="menuitem" onClick={() => run(onFork)}>
              {icon(<path strokeLinecap="round" strokeLinejoin="round" d="M6 3v6a4 4 0 004 4h8M6 9l4-4M6 9L2 5m16 8l-4-4m4 4l-4 4" />)}
              {t("chat.fork")}
            </button>
            <button type="button" role="menuitem" disabled={translating} onClick={() => run(onTranslateSide)}>
              {icon(<path strokeLinecap="round" strokeLinejoin="round" d="M4 5h9M8.5 3v2m-2 0c.7 3.2 2.8 5.8 6.5 7M6 12c2.4-1.2 4.3-3.2 5.4-6M14 14h6m-3-3l4 9m-8 0l4-9" />)}
              {translating ? t("chat.translating") : t("chat.translateSide")}
            </button>
            <button type="button" role="menuitem" disabled={translating} onClick={() => run(onTranslateInPlace)}>
              {icon(<path strokeLinecap="round" strokeLinejoin="round" d="M7 7h11l-3-3m3 3l-3 3M17 17H6l3 3m-3-3l3-3" />)}
              {t("chat.translateInPlace")}
            </button>
            {tts && (
              <button type="button" role="menuitem" disabled={tts.loading} onClick={() => run(tts.onToggle)}>
                {icon(<path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H3v6h3l5 4V5zm4 4a4 4 0 010 6m3-9a8 8 0 010 12" />)}
                {tts.loading ? t("chat.ttsLoading") : tts.playing ? t("chat.ttsStop") : t("chat.tts")}
              </button>
            )}
          </div>
        )}
      </div>
      {extra}
    </div>
  );
}

/** ‹ n / m › for the latest reply once regenerate has produced alternatives. */
export function ReplyVariantSwitcher({ index, count, disabled, onSelect }: {
  index: number;
  count: number;
  disabled: boolean;
  onSelect: (direction: -1 | 1) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="reply-variant-switcher" role="group" aria-label={t("chat.variantPosition").replace("{index}", String(index + 1)).replace("{count}", String(count))}>
      <button type="button" onClick={() => onSelect(-1)} disabled={disabled || index <= 0} aria-label={t("chat.previousVariant")} title={t("chat.previousVariant")}>
        {icon(<path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />)}
      </button>
      <span aria-hidden="true">{index + 1} / {count}</span>
      <button type="button" onClick={() => onSelect(1)} disabled={disabled || index >= count - 1} aria-label={t("chat.nextVariant")} title={t("chat.nextVariant")}>
        {icon(<path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />)}
      </button>
    </div>
  );
}
