import type { RefObject } from "react";
import { useI18n } from "../../../shared/i18n";

export function ChatHistorySearch({ query, onChange, inputRef }: {
  query: string; onChange: (query: string) => void; inputRef: RefObject<HTMLInputElement>;
}) {
  const { t } = useI18n();
  return (
    <div className="chat-history-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path strokeLinecap="round" d="M21 21l-4.35-4.35m1.1-5.15a6.25 6.25 0 11-12.5 0 6.25 6.25 0 0112.5 0z" />
      </svg>
      <input ref={inputRef} value={query} onChange={(event) => onChange(event.target.value)}
        placeholder={t("chat.searchChats")} aria-label={t("chat.searchChats")}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query) {
            event.preventDefault(); event.stopPropagation(); onChange("");
          }
        }} />
      {query && <button type="button" onClick={() => { onChange(""); inputRef.current?.focus(); }} aria-label={t("chat.clearSearch")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>}
    </div>
  );
}
