import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../shared/api";

interface Params {
  enabled: boolean;
  chatId: string | null;
  branchId: string | null;
  /** Id of the latest assistant message when it is the last message in the branch. */
  lastAssistantId: string | null;
  busy: boolean;
  userName?: string;
}

interface State {
  key: string;
  suggestions: string[];
  loading: boolean;
  error: string;
}

const EMPTY: State = { key: "", suggestions: [], loading: false, error: "" };

/**
 * Requests reply suggestions once per character reply. Results are cached per
 * branch/message so re-renders, navigation and branch switches never repeat a
 * paid request; only an explicit refresh does.
 */
export function useReplySuggestions({ enabled, chatId, branchId, lastAssistantId, busy, userName }: Params) {
  const [state, setState] = useState<State>(EMPTY);
  const cache = useRef(new Map<string, string[]>());
  const dismissed = useRef(new Set<string>());
  const controllerRef = useRef<AbortController | null>(null);
  const key = enabled && !busy && chatId && branchId && lastAssistantId ? `${chatId}:${branchId}:${lastAssistantId}` : "";

  const load = useCallback((requestKey: string) => {
    if (!chatId || !branchId) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ key: requestKey, suggestions: [], loading: true, error: "" });
    api.chatReplySuggestions(chatId, branchId, userName, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        cache.current.set(requestKey, result.suggestions);
        setState({ key: requestKey, suggestions: result.suggestions, loading: false, error: "" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ key: requestKey, suggestions: [], loading: false, error: error instanceof Error ? error.message : String(error) });
      });
  }, [chatId, branchId, userName]);

  useEffect(() => {
    if (!key || dismissed.current.has(key)) {
      controllerRef.current?.abort();
      setState(EMPTY);
      return;
    }
    const cached = cache.current.get(key);
    if (cached) {
      setState({ key, suggestions: cached, loading: false, error: "" });
      return;
    }
    load(key);
    return () => controllerRef.current?.abort();
    // `load` changes with the persona name; a new name alone must not trigger another paid request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const refresh = useCallback(() => {
    if (!key) return;
    cache.current.delete(key);
    dismissed.current.delete(key);
    load(key);
  }, [key, load]);

  const dismiss = useCallback(() => {
    if (!key) return;
    dismissed.current.add(key);
    controllerRef.current?.abort();
    setState(EMPTY);
  }, [key]);

  const visible = state.key === key ? state : EMPTY;
  return { suggestions: visible.suggestions, loading: visible.loading, error: visible.error, refresh, dismiss };
}

/** Tracks the opt-in setting, including changes made in Settings while the chat stays mounted. */
export function useReplySuggestionsSetting() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let disposed = false;
    api.settingsGet().then((settings) => { if (!disposed) setEnabled(settings.replySuggestionsEnabled === true); }).catch(() => {});
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ replySuggestionsEnabled?: unknown }>).detail;
      if (detail && typeof detail.replySuggestionsEnabled === "boolean") setEnabled(detail.replySuggestionsEnabled);
    };
    window.addEventListener("settings-change", onChange);
    return () => {
      disposed = true;
      window.removeEventListener("settings-change", onChange);
    };
  }, []);
  return enabled;
}
