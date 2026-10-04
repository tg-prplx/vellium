import { IconButton } from "../../../components/IconButton";
import { useI18n } from "../../../shared/i18n";

interface Props {
  suggestions: string[];
  loading: boolean;
  error: string;
  onPick: (text: string) => void;
  onRefresh: () => void;
  onDismiss: () => void;
}

export function ReplySuggestions({ suggestions, loading, error, onPick, onRefresh, onDismiss }: Props) {
  const { t } = useI18n();
  if (!loading && !error && suggestions.length === 0) return null;
  return (
    <div className="reply-suggestions" role="group" aria-label={t("chat.replySuggestions")} aria-busy={loading}>
      <span className="reply-suggestions-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3zm6 12l.9 2.1 2.1.9-2.1.9L18 21l-.9-2.1-2.1-.9 2.1-.9L18 15z" /></svg>
        {t("chat.replySuggestions")}
      </span>
      <div className="reply-suggestions-list">
        {loading && <span className="reply-suggestions-status">{t("chat.replySuggestionsLoading")}</span>}
        {!loading && error && <span className="reply-suggestions-status is-error" title={error}>{t("chat.replySuggestionsFailed")}</span>}
        {!loading && suggestions.map((suggestion) => (
          <button key={suggestion} type="button" className="reply-suggestion-chip" onClick={() => onPick(suggestion)} title={t("chat.replySuggestionInsert")}>
            {suggestion}
          </button>
        ))}
      </div>
      <div className="reply-suggestions-actions">
        <IconButton size="sm" label={t("chat.replySuggestionsRefresh")} disabled={loading} onClick={onRefresh}
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.6m14.8 2A8 8 0 004.6 9m0 0H9m11 11v-5h-.6m0 0a8 8 0 01-14.8-2m14.8 2H15" /></svg>} />
        <IconButton size="sm" label={t("chat.replySuggestionsDismiss")} onClick={onDismiss}
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>} />
      </div>
    </div>
  );
}
