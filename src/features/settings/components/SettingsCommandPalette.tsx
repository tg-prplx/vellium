import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useI18n } from "../../../shared/i18n";
import {
  buildSettingsSearchEntries,
  searchSettingsEntries,
  type SettingsSearchEntry
} from "../settingsSearch";

interface SettingsCommandPaletteProps {
  onNavigate: (entry: SettingsSearchEntry) => void;
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="11" cy="11" r="6.5" />
      <path strokeLinecap="round" d="m16 16 4 4" />
    </svg>
  );
}

function ResultIcon({ section }: { section: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d={section
          ? "M4 6.5h16M4 12h16M4 17.5h10"
          : "M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm7.4-3.5a7.3 7.3 0 00-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 00-1.7-1L15 3.5h-4L10.6 6a8 8 0 00-1.7 1L6.5 6 4.5 9.5l2 1.5a7.3 7.3 0 000 2l-2 1.5 2 3.4 2.4-1a8 8 0 001.7 1l.4 2.6h4l.4-2.6a8 8 0 001.7-1l2.4 1 2-3.4-2-1.5a7.3 7.3 0 00.1-1z"}
      />
    </svg>
  );
}

export function SettingsCommandPalette({ onNavigate }: SettingsCommandPaletteProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const entries = useMemo(() => buildSettingsSearchEntries(t), [t]);
  const results = useMemo(() => searchSettingsEntries(entries, query), [entries, query]);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.code !== "KeyP") return;
      event.preventDefault();
      event.stopPropagation();
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
    window.addEventListener("keydown", handleShortcut, true);
    return () => window.removeEventListener("keydown", handleShortcut, true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleDismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", handleDismiss, true);
    return () => window.removeEventListener("keydown", handleDismiss, true);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`settings-command-${activeIndex}`)?.scrollIntoView({
      block: "nearest"
    });
  }, [activeIndex, open]);

  function close() {
    setOpen(false);
    window.requestAnimationFrame(() => restoreFocusRef.current?.focus());
  }

  function choose(entry: SettingsSearchEntry) {
    setOpen(false);
    onNavigate(entry);
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(results.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[Math.min(activeIndex, results.length - 1)]);
    }
  }

  if (!open) return null;

  return (
    <div
      className="settings-command-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="settings-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.commandPaletteTitle")}
      >
        <div className="settings-command-search">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={t("settings.commandPalettePlaceholder")}
            aria-label={t("settings.commandPalettePlaceholder")}
            aria-controls="settings-command-results"
            aria-activedescendant={results[activeIndex] ? `settings-command-${activeIndex}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>{isMac ? "⌘⇧P" : "Ctrl ⇧ P"}</kbd>
        </div>

        <div id="settings-command-results" className="settings-command-results" role="listbox">
          {results.length ? results.map((entry, index) => (
            <button
              id={`settings-command-${index}`}
              key={entry.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`settings-command-result ${index === activeIndex ? "is-active" : ""}`}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => choose(entry)}
            >
              <span className="settings-command-result-icon">
                <ResultIcon section={entry.kind === "section"} />
              </span>
              <span className="settings-command-result-copy">
                <strong>{entry.label}</strong>
                <small>{entry.categoryLabel} <b>/</b> {entry.sectionLabel}</small>
              </span>
              <span className="settings-command-result-kind">
                {entry.kind === "section"
                  ? t("settings.commandPaletteSection")
                  : t("settings.commandPaletteSetting")}
              </span>
            </button>
          )) : (
            <div className="settings-command-empty">
              <SearchIcon />
              <span>{t("settings.commandPaletteEmpty")}</span>
            </div>
          )}
        </div>

        <footer className="settings-command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd>{t("settings.commandPaletteMove")}</span>
          <span><kbd>↵</kbd>{t("settings.commandPaletteOpen")}</span>
          <span><kbd>Esc</kbd>{t("settings.commandPaletteClose")}</span>
        </footer>
      </section>
    </div>
  );
}
