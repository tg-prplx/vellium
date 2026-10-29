import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../shared/api";
import type { AppSettings } from "../../../shared/types/contracts";

const SAVE_DELAY_MS = 400;

export function usePureChatSystemPrompt() {
  const [pureChatSystemPrompt, setPureChatSystemPrompt] = useState("");
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending === null) return;
    void api.settingsUpdate({ pureChatSystemPrompt: pending }).then((updated) => {
      window.dispatchEvent(new CustomEvent("settings-change", { detail: updated }));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.settingsGet().then((settings) => {
      if (!cancelled && pendingRef.current === null) setPureChatSystemPrompt(settings.pureChatSystemPrompt ?? "");
    }).catch(() => {});
    const onSettingsChange = (event: Event) => {
      const detail = (event as CustomEvent<AppSettings>).detail;
      if (pendingRef.current === null && typeof detail?.pureChatSystemPrompt === "string") {
        setPureChatSystemPrompt(detail.pureChatSystemPrompt);
      }
    };
    window.addEventListener("settings-change", onSettingsChange);
    return () => {
      cancelled = true;
      window.removeEventListener("settings-change", onSettingsChange);
      flush();
    };
  }, [flush]);

  const updatePureChatSystemPrompt = useCallback((value: string) => {
    setPureChatSystemPrompt(value);
    pendingRef.current = value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [flush]);

  return { pureChatSystemPrompt, updatePureChatSystemPrompt };
}
