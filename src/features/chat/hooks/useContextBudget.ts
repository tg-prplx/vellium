import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../shared/api";
import type { ChatContextBudget } from "../../../shared/types/chatContext";

/**
 * Loads the branch context window and reply reserve for the composer meter.
 * The endpoint only reads the database, so refreshing after each reply or on
 * hover never triggers prompt assembly, RAG retrieval or tokenizer calls.
 */
export function useContextBudget(chatId: string | null, branchId: string | null, refreshKey: unknown) {
  const [budget, setBudget] = useState<ChatContextBudget | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    controllerRef.current?.abort();
    if (!chatId || !branchId) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    api.chatContextBudget(chatId, branchId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted && next.branchId === branchId) setBudget(next);
      })
      .catch(() => {
        // Keep the last known budget; the meter still shows the token count without a percentage.
      });
  }, [chatId, branchId]);

  useEffect(() => {
    setBudget(null);
  }, [chatId, branchId]);

  useEffect(() => {
    refresh();
    return () => controllerRef.current?.abort();
  }, [refresh, refreshKey]);

  return { budget, refresh };
}
